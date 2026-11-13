import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, scoped, type DB } from "../../../packages/database/src/db.ts";
import {
  validateNextBid,
  transitionLot,
  settle,
  reverseSettlement,
  computeMaxBid,
} from "../../../packages/domain/src/auction.ts";
import {
  transitionAuction,
  readinessIssues,
  assertReversalSafe,
} from "../../../packages/domain/src/lifecycle.ts";
const uuid = z.string().uuid();
const integer = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const commandSchema = z
  .object({
    commandId: uuid,
    type: z.enum([
      "PUBLISH",
      "LOCK",
      "UNLOCK",
      "START",
      "PAUSE",
      "RESUME",
      "COMPLETE",
      "SELECT",
      "RANDOM",
      "OPEN",
      "BID",
      "CLOSE",
      "SELL",
      "UNSOLD",
      "REOPEN",
      "RECALL",
      "REVERSE",
      "LOT_PAUSE",
      "LOT_RESUME",
    ]),
    lotId: uuid.optional(),
    registrationId: uuid.optional(),
    allocationId: uuid.optional(),
    expectedVersion: integer.optional(),
    amount: integer.optional(),
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();
export type Command = z.infer<typeof commandSchema>;
const admin = (roles: string[]) =>
  roles.some((r) => ["OWNER", "ADMIN"].includes(r));
const requireAdmin = (roles: string[]) => {
  if (!admin(roles)) throw Error("FORBIDDEN");
};
const required = (v: unknown) => {
  if (v === undefined || v === null) throw Error("INVALID_INPUT");
  return v;
};
async function rows(db: DB, sql: string, args: any[] = []) {
  return (await db.query(sql, args)).rows;
}
async function teamState(db: DB, auction: string, id: string) {
  const [t] = await rows(
    db,
    "SELECT * FROM teams WHERE auction_id=$1 AND id=$2 FOR UPDATE",
    [auction, id],
  );
  if (!t) throw Error("INVALID_TEAM");
  const [count] = await rows(
    db,
    "SELECT count(*)::int size FROM allocations WHERE team_id=$1 AND status='ACTIVE'",
    [id],
  );
  return {
    ...t,
    id: t.id,
    remainingPurse: t.remaining_purse,
    squadSize: count.size,
  };
}
async function currentLot(db: DB, auction: string, id: string) {
  const [l] = await rows(
    db,
    'SELECT l.*, b.amount, b.team_id AS "leadingTeamId" FROM lots l LEFT JOIN bids b ON b.id=l.leading_bid_id WHERE l.auction_id=$1 AND l.id=$2 FOR UPDATE OF l',
    [auction, id],
  );
  if (!l) throw Error("INVALID_LOT");
  return l;
}
async function readiness(db: DB, a: any) {
  const teams = await rows(
    db,
    "SELECT EXISTS(SELECT 1 FROM team_operators o JOIN manager_applications m ON m.auction_id=o.auction_id AND m.user_id=o.user_id AND m.team_id=o.team_id WHERE o.team_id=t.id AND o.active AND m.status='APPROVED') AS operator FROM teams t WHERE t.auction_id=$1",
    [a.id],
  );
  const [r] = await rows(
    db,
    "SELECT count(*) FILTER(WHERE status='APPROVED')::int approved,count(*) FILTER(WHERE status IN ('PENDING','CHANGES_REQUESTED'))::int pending FROM registrations WHERE auction_id=$1",
    [a.id],
  );
  const [m] = await rows(
    db,
    "SELECT count(*)::int pending FROM manager_applications WHERE auction_id=$1 AND status IN ('PENDING','CHANGES_REQUESTED')",
    [a.id],
  );
  return readinessIssues({
    rules: a.rules,
    teams: teams.map((t) => ({ approved: true, operator: t.operator })),
    approvedPlayers: r.approved,
    pendingReviews: r.pending + m.pending,
  });
}
export class AuctionService {
  async command(actor: string, auctionId: string, input: unknown) {
    const c = commandSchema.parse(input);
    const hash = createHash("sha256")
      .update(
        JSON.stringify(
          Object.fromEntries(
            Object.entries(c).sort(([a], [b]) => a.localeCompare(b)),
          ),
        ),
      )
      .digest("hex");
    return scoped(actor, auctionId, async (db, a, roles) => {
      const clubState = (
        await db.query("SELECT status FROM clubs WHERE id=$1", [a.club_id])
      ).rows[0];
      if (
        clubState.status === "SUSPENDED" &&
        !["PAUSE", "REVERSE"].includes(c.type)
      )
        throw Error("CLUB_SUSPENDED");
      if (c.type === "BID") {
        const [op] = await rows(
          db,
          "SELECT o.team_id FROM team_operators o JOIN manager_applications m ON m.auction_id=o.auction_id AND m.user_id=o.user_id AND m.team_id=o.team_id WHERE o.auction_id=$1 AND o.user_id=$2 AND o.active AND m.status='APPROVED'",
          [a.id, actor],
        );
        if (!op) throw Error("NOT_OPERATOR");
      } else if (
        !admin(roles) &&
        !(
          roles.includes("AUCTIONEER") &&
          [
            "SELECT",
            "RANDOM",
            "OPEN",
            "CLOSE",
            "SELL",
            "UNSOLD",
            "PAUSE",
            "RESUME",
            "LOT_PAUSE",
            "LOT_RESUME",
          ].includes(c.type)
        )
      )
        throw Error("FORBIDDEN");
      const [prior] = await rows(
        db,
        "SELECT request_hash,outcome FROM commands WHERE actor_id=$1 AND command_id=$2",
        [actor, c.commandId],
      );
      if (prior) {
        if (prior.request_hash !== hash) throw Error("IDEMPOTENCY_CONFLICT");
        return prior.outcome;
      }
      let lot: any = null;
      let detail: any = {};
      if (
        [
          "PUBLISH",
          "LOCK",
          "UNLOCK",
          "START",
          "PAUSE",
          "RESUME",
          "COMPLETE",
        ].includes(c.type)
      ) {
        if (c.type === "LOCK" || c.type === "START") {
          const issues = await readiness(db, a);
          if (issues.length) throw Error("NOT_READY:" + issues.join(","));
        }
        if (c.type === "START" && !a.rehearsal) {
          if (a.started_at) {
            detail.alreadyStarted = true;
          } else {
            // Lock grants in stable order. Shared across auctions: one final unit can be consumed once.
            const grants = await rows(
              db,
              "SELECT * FROM credit_grants WHERE club_id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) ORDER BY id FOR UPDATE",
              [a.club_id],
            );
            let redeemed = false;
            for (const g of grants) {
              const used = await rows(
                db,
                "SELECT unit_number FROM credit_redemptions WHERE grant_id=$1 ORDER BY unit_number",
                [g.id],
              );
              const occupied = new Set(used.map((u) => u.unit_number));
              let unit = 1;
              while (occupied.has(unit)) unit++;
              if (unit <= g.units) {
                await db.query(
                  "INSERT INTO credit_redemptions(club_id,auction_id,grant_id,unit_number) VALUES($1,$2,$3,$4)",
                  [a.club_id, a.id, g.id, unit],
                );
                redeemed = true;
                break;
              }
            }
            if (!redeemed) throw Error("CREDIT_REQUIRED");
          }
        }
        if (c.type === "COMPLETE") {
          const [unresolved] = await rows(
            db,
            "SELECT count(*)::int n FROM lots WHERE auction_id=$1 AND status IN ('PREVIEW','OPEN','PAUSED','CLOSED')",
            [a.id],
          );
          if (unresolved.n) throw Error("UNRESOLVED_LOTS");
          const [available] = await rows(
            db,
            "SELECT count(*)::int n FROM registrations r WHERE r.auction_id=$1 AND r.status='APPROVED' AND NOT EXISTS(SELECT 1 FROM lots l WHERE l.registration_id=r.id AND l.attempt=(SELECT max(attempt) FROM lots WHERE registration_id=r.id) AND l.status IN ('SOLD','UNSOLD'))",
            [a.id],
          );
          if (available.n) throw Error("PLAYERS_REMAIN");
          const result = await this.reconcileIn(db, a);
          if (!result.balanced) throw Error("RECONCILIATION_FAILED");
        }
        const status =
          c.type === "START" && a.started_at
            ? a.status
            : transitionAuction(a.status, c.type);
        await db.query(
          "UPDATE auctions SET status=$2,locked_at=CASE WHEN $3='LOCK' THEN now() WHEN $3='UNLOCK' THEN NULL ELSE locked_at END,started_at=CASE WHEN $3='START' THEN coalesce(started_at,now()) ELSE started_at END WHERE id=$1",
          [a.id, status, c.type],
        );
        detail.status = status;
      } else if (
        c.type === "SELECT" ||
        c.type === "RANDOM" ||
        c.type === "RECALL"
      ) {
        if (a.status !== "LIVE") throw Error("AUCTION_NOT_LIVE");
        if (
          (c.type === "RANDOM" && a.selection_mode === "MANUAL") ||
          (c.type === "SELECT" && a.selection_mode === "RANDOM")
        )
          throw Error("SELECTION_DISABLED");
        const eligible = await rows(
          db,
          "SELECT r.* FROM registrations r WHERE r.auction_id=$1 AND r.status='APPROVED' AND NOT EXISTS(SELECT 1 FROM allocations x WHERE x.registration_id=r.id AND x.status='ACTIVE') AND NOT EXISTS(SELECT 1 FROM lots l WHERE l.registration_id=r.id) ORDER BY r.id",
          [a.id],
        );
        let r: any;
        if (c.type === "RANDOM") {
          if (!eligible.length) throw Error("EMPTY_POOL");
          const { randomInt } = await import("node:crypto");
          r = eligible[randomInt(eligible.length)];
          detail.eligiblePool = eligible.map((p) => p.id);
        } else {
          const [registration] = await rows(
            db,
            "SELECT * FROM registrations WHERE id=$1 AND auction_id=$2 AND status='APPROVED'",
            [required(c.registrationId), a.id],
          );
          r = registration;
          if (!r) throw Error("INVALID_REGISTRATION");
          const previous = await rows(
            db,
            "SELECT status FROM lots WHERE registration_id=$1 ORDER BY attempt DESC LIMIT 1",
            [r.id],
          );
          if (
            previous.length &&
            (c.type !== "RECALL" ||
              !["UNSOLD", "REVERSED"].includes(previous[0].status))
          )
            throw Error("RECALL_REQUIRED");
          if (!previous.length && c.type === "RECALL")
            throw Error("INVALID_TRANSITION");
          const active = await rows(
            db,
            "SELECT 1 FROM allocations WHERE registration_id=$1 AND status='ACTIVE'",
            [r.id],
          );
          if (active.length) throw Error("ALREADY_ALLOCATED");
        }
        const [attempt] = await rows(
          db,
          "SELECT coalesce(max(attempt),0)+1 n FROM lots WHERE registration_id=$1",
          [r.id],
        );
        const [created] = await rows(
          db,
          "INSERT INTO lots(club_id,auction_id,registration_id,attempt,status,base) VALUES($1,$2,$3,$4,'PREVIEW',$5) RETURNING *",
          [a.club_id, a.id, r.id, attempt.n, r.effective_base],
        );
        lot = created;
        detail.lotId = lot.id;
      } else if (c.type === "REVERSE") {
        requireAdmin(roles);
        const [allocation] = await rows(
          db,
          "SELECT * FROM allocations WHERE id=$1 AND auction_id=$2 FOR UPDATE",
          [required(c.allocationId), a.id],
        );
        if (!allocation) throw Error("INVALID_ALLOCATION");
        const [later] = await rows(
          db,
          "SELECT EXISTS(SELECT 1 FROM allocations WHERE auction_id=$1 AND created_at>(SELECT created_at FROM allocations WHERE id=$2) AND status='ACTIVE') yes",
          [a.id, allocation.id],
        );
        assertReversalSafe(a.status, later.yes);
        const team = await teamState(db, a.id, allocation.team_id);
        const effect = reverseSettlement(
          {
            price: allocation.price,
            teamId: allocation.team_id,
            status: allocation.status,
          },
          team,
          a.rules,
          required(c.reason) as string,
        );
        const [debit] = await rows(
          db,
          "SELECT id FROM purse_ledger WHERE allocation_id=$1 AND reversal_of IS NULL",
          [allocation.id],
        );
        await db.query("UPDATE allocations SET status='REVERSED' WHERE id=$1", [
          allocation.id,
        ]);
        await db.query("UPDATE teams SET remaining_purse=$2 WHERE id=$1", [
          team.id,
          effect.team.remainingPurse,
        ]);
        await db.query(
          "INSERT INTO purse_ledger(club_id,auction_id,team_id,allocation_id,delta,reason,reversal_of) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            a.club_id,
            a.id,
            team.id,
            allocation.id,
            effect.ledgerDelta,
            c.reason,
            debit.id,
          ],
        );
        const [reversedLot] = await rows(
          db,
          "UPDATE lots SET status='REVERSED',version=version+1 WHERE id=$1 RETURNING id,version",
          [allocation.lot_id],
        );
        lot = reversedLot;
        detail.allocationId = allocation.id;
      } else {
        if (a.status !== "LIVE")
          throw Error(
            a.status === "PAUSED" ? "AUCTION_PAUSED" : "AUCTION_NOT_LIVE",
          );
        lot = await currentLot(db, a.id, required(c.lotId) as string);
        if (c.expectedVersion !== lot.version) throw Error("STALE_VERSION");
        if (c.type === "BID") {
          const [op] = await rows(
            db,
            "SELECT team_id FROM team_operators WHERE auction_id=$1 AND user_id=$2 AND active",
            [a.id, actor],
          );
          const team = await teamState(db, a.id, op.team_id);
          validateNextBid(
            lot,
            team,
            a.rules,
            required(c.expectedVersion) as number,
            required(c.amount) as number,
          );
          const id = randomUUID();
          await db.query(
            "INSERT INTO bids(id,club_id,auction_id,lot_id,team_id,actor_id,command_id,amount,event_sequence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [
              id,
              a.club_id,
              a.id,
              lot.id,
              team.id,
              actor,
              c.commandId,
              c.amount,
              a.sequence + 1,
            ],
          );
          await db.query(
            "UPDATE lots SET leading_bid_id=$2,version=version+1 WHERE id=$1",
            [lot.id, id],
          );
          detail = {
            bidId: id,
            lotId: lot.id,
            amount: c.amount,
            teamId: team.id,
          };
          lot.version++;
        } else if (c.type === "SELL") {
          const team = await teamState(
            db,
            a.id,
            required(lot.leadingTeamId) as string,
          );
          const effect = settle(lot, team, a.rules);
          const [allocation] = await rows(
            db,
            "INSERT INTO allocations(club_id,auction_id,lot_id,registration_id,team_id,price,status) VALUES($1,$2,$3,$4,$5,$6,'ACTIVE') RETURNING id",
            [a.club_id, a.id, lot.id, lot.registration_id, team.id, lot.amount],
          );
          await db.query("UPDATE teams SET remaining_purse=$2 WHERE id=$1", [
            team.id,
            effect.team.remainingPurse,
          ]);
          await db.query(
            "INSERT INTO purse_ledger(club_id,auction_id,team_id,allocation_id,delta,reason) VALUES($1,$2,$3,$4,$5,'Player sold')",
            [a.club_id, a.id, team.id, allocation.id, effect.ledgerDelta],
          );
          await db.query("UPDATE lots SET status=$2,version=$3 WHERE id=$1", [
            lot.id,
            effect.lot.status,
            effect.lot.version,
          ]);
          lot = effect.lot;
          detail.allocationId = allocation.id;
        } else {
          const action =
            c.type === "LOT_PAUSE"
              ? "PAUSE"
              : c.type === "LOT_RESUME"
                ? "RESUME"
                : c.type;
          const effect = transitionLot(lot, action as any, c.reason);
          await db.query("UPDATE lots SET status=$2,version=$3 WHERE id=$1", [
            lot.id,
            effect.status,
            effect.version,
          ]);
          lot = effect;
        }
      }
      const [updated] = await rows(
        db,
        "UPDATE auctions SET sequence=sequence+1,version=version+1 WHERE id=$1 RETURNING sequence",
        [a.id],
      );
      const outcome = {
        commandId: c.commandId,
        sequence: updated.sequence,
        lotVersion: lot?.version ?? null,
        ...detail,
      };
      const [event] = await rows(
        db,
        "INSERT INTO auction_events(club_id,auction_id,sequence,type,payload) VALUES($1,$2,$3,$4,$5) RETURNING id",
        [
          a.club_id,
          a.id,
          updated.sequence,
          c.type,
          {
            ...detail,
            lotId: lot?.id ?? null,
            lotVersion: lot?.version ?? null,
          },
        ],
      );
      await db.query("INSERT INTO outbox(event_id) VALUES($1)", [event.id]);
      await db.query(
        "INSERT INTO commands(actor_id,command_id,club_id,auction_id,request_hash,outcome) VALUES($1,$2,$3,$4,$5,$6)",
        [actor, c.commandId, a.club_id, a.id, hash, outcome],
      );
      await db.query(
        "INSERT INTO audit_log(club_id,actor_id,action,resource_id,reason,redacted_change) VALUES($1,$2,$3,$4,$5,$6)",
        [a.club_id, actor, c.type, lot?.id ?? a.id, c.reason ?? null, outcome],
      );
      return outcome;
    });
  }
  async snapshot(actor: string, id: string) {
    return scoped(actor, id, async (db, a, roles) => {
      const [club] = await rows(
        db,
        "SELECT name,branding FROM clubs WHERE id=$1",
        [a.club_id],
      );
      const teams = await rows(
        db,
        'SELECT t.id,t.name,t.code,t.color,(t.logo_key IS NOT NULL) AS "hasLogo",t.remaining_purse AS "remainingPurse",(SELECT count(*)::int FROM allocations x WHERE x.team_id=t.id AND x.status=\'ACTIVE\') AS "squadSize" FROM teams t WHERE auction_id=$1 ORDER BY t.code',
        [id],
      );
      const players = await rows(
        db,
        `SELECT id,status,effective_base AS base,profile_snapshot->>'name' name,profile_snapshot->>'role' role,profile_snapshot->>'location' location,profile_snapshot->>'battingStyle' AS "battingStyle",profile_snapshot->>'bowlingStyle' AS "bowlingStyle",(profile_snapshot ? 'photoKey') AS "hasPhoto",review_reason AS "reviewReason",${admin(roles) ? "duplicate_flags" : "'[]'::jsonb"} AS "duplicateFlags" FROM registrations WHERE auction_id=$1 ${admin(roles) ? "" : "AND status='APPROVED'"} ORDER BY profile_snapshot->>'name'`,
        [id],
      );
      const lots = await rows(
        db,
        'SELECT l.id,l.registration_id AS "registrationId",l.status,l.version,l.base,l.attempt,b.amount,b.team_id AS "leadingTeamId" FROM lots l LEFT JOIN bids b ON b.id=l.leading_bid_id WHERE l.auction_id=$1 ORDER BY l.created_at,l.id',
        [id],
      );
      const allocations = await rows(
        db,
        'SELECT id,registration_id AS "registrationId",team_id AS "teamId",price FROM allocations WHERE auction_id=$1 AND status=\'ACTIVE\'',
        [id],
      );
      const [op] = await rows(
        db,
        "SELECT o.team_id FROM team_operators o JOIN manager_applications m ON m.auction_id=o.auction_id AND m.user_id=o.user_id AND m.team_id=o.team_id WHERE o.auction_id=$1 AND o.user_id=$2 AND o.active AND m.status='APPROVED'",
        [id, actor],
      );
      const myTeam = teams.find((t) => t.id === op?.team_id);
      const assigned = (
        await db.query(
          "SELECT team_id FROM manager_applications WHERE auction_id=$1 AND user_id=$2 AND status='APPROVED'",
          [id, actor],
        )
      ).rows[0];
      const applications = admin(roles)
        ? await rows(
            db,
            'SELECT id,status,team_id AS "teamId",user_id AS "userId" FROM manager_applications WHERE auction_id=$1',
            [id],
          )
        : [];
      const grants = admin(roles)
        ? await rows(
            db,
            "SELECT g.id,g.units,g.reason,(SELECT count(*)::int FROM credit_redemptions r WHERE r.grant_id=g.id) used FROM credit_grants g WHERE club_id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())",
            [a.club_id],
          )
        : [];
      return {
        id: a.id,
        clubId: a.club_id,
        rehearsal: a.rehearsal,
        name: a.name,
        clubName: club.name,
        clubBranding: {
          color: club.branding?.color ?? null,
          hasLogo: !!club.branding?.logoKey,
        },
        teamCapacity: a.team_capacity,
        selectionMode: a.selection_mode,
        registrationDeadline: a.registration_deadline,
        publicVisible: a.public_visible,
        status: a.status,
        sequence: a.sequence,
        rules: a.rules,
        venue: a.venue,
        scheduledAt: a.scheduled_at,
        roles,
        myTeamId: op?.team_id ?? null,
        assignedTeamId: assigned?.team_id ?? null,
        maxBid: myTeam ? computeMaxBid(myTeam, a.rules) : null,
        teams,
        players,
        lots,
        allocations,
        applications,
        readiness: admin(roles) ? await readiness(db, a) : [],
        credits: grants.reduce((n, g) => n + g.units - g.used, 0),
        grants,
      };
    });
  }
  async publicSnapshot(id: string) {
    const result = await pool.query("SELECT public_auction($1) snapshot", [
      uuid.parse(id),
    ]);
    if (!result.rows[0]?.snapshot) throw Error("NOT_FOUND");
    return result.rows[0].snapshot;
  }
  async events(actor: string, id: string, after: number) {
    if (!Number.isSafeInteger(after) || after < 0)
      throw Error("INVALID_CURSOR");
    return scoped(actor, id, async (db, a) => {
      if (after > a.sequence) throw Error("RESYNC_REQUIRED");
      return rows(
        db,
        'SELECT id AS "eventId",auction_id AS "auctionId",sequence,type,occurred_at AS "occurredAt",payload FROM auction_events WHERE auction_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 500',
        [id, after],
      );
    });
  }
  async reconcileIn(db: DB, a: any) {
    const teams = await rows(
      db,
      "SELECT t.id,t.initial_purse,t.remaining_purse,coalesce((SELECT sum(delta) FROM purse_ledger WHERE team_id=t.id),0)::bigint delta,coalesce((SELECT sum(price) FROM allocations WHERE team_id=t.id AND status='ACTIVE'),0)::bigint spent FROM teams t WHERE auction_id=$1",
      [a.id],
    );
    return {
      balanced: teams.every(
        (t) =>
          t.initial_purse + t.delta === t.remaining_purse &&
          t.initial_purse - t.spent === t.remaining_purse,
      ),
      teams,
    };
  }
  async reconcile(actor: string, id: string) {
    return scoped(actor, id, async (db, a, roles) => {
      requireAdmin(roles);
      return this.reconcileIn(db, a);
    });
  }
  async report(actor: string, id: string, kind: string) {
    return scoped(actor, id, async (db, a, roles) => {
      requireAdmin(roles);
      const queries: Record<string, string> = {
        players:
          "SELECT r.id,r.status,r.profile_snapshot->>'name' name,r.effective_base FROM registrations r WHERE auction_id=$1 AND r.status='APPROVED'",
        allocations:
          "SELECT id,registration_id,team_id,price,status FROM allocations WHERE auction_id=$1",
        unsold:
          "SELECT id,registration_id,attempt FROM lots WHERE auction_id=$1 AND status='UNSOLD'",
        ledger:
          "SELECT id,team_id,allocation_id,delta,reason,to_char(created_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:MI:SS') || ' IST' AS time_ist FROM purse_ledger WHERE auction_id=$1",
        bids: "SELECT id,lot_id,team_id,amount,to_char(created_at AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD HH24:MI:SS') || ' IST' AS time_ist FROM bids WHERE auction_id=$1",
      };
      if (!queries[kind]) throw Error("INVALID_REPORT");
      const { rows: records, fields } = await db.query(queries[kind], [a.id]);
      const headers = fields.map((field) => field.name);
      const escape = (v: any) =>
        '"' +
        String(v ?? "")
          .replace(/^[=+@-]/, "'$&")
          .replaceAll('"', '""') +
        '"';
      return [
        headers.map(escape).join(","),
        ...records.map((r) => headers.map((h) => escape(r[h])).join(",")),
      ].join("\r\n");
    });
  }
}
