import { randomUUID, randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import {
  transaction,
  scoped,
  type DB,
} from "../../../packages/database/src/db.ts";
import {
  validateRules,
  resolveEffectiveBase,
} from "../../../packages/domain/src/auction.ts";
const text = z.string().trim().min(1).max(200);
const uuid = z.string().uuid();
const rulesSchema = z
  .object({
    purse: z.number(),
    minSquad: z.number(),
    maxSquad: z.number(),
    minimumBase: z.number(),
    defaultBase: z.number(),
    increment: z.number(),
    reserveEnabled: z.boolean(),
  })
  .strict();
const editable = (a: any) => {
  if (!["DRAFT", "REGISTRATION_OPEN", "READY"].includes(a.status))
    throw Error("ROSTER_LOCKED");
};
const admin = (roles: string[]) => {
  if (!roles.some((r) => r === "OWNER" || r === "ADMIN"))
    throw Error("FORBIDDEN");
};
const audit = async (
  db: DB,
  club: string,
  actor: string,
  action: string,
  resource: string,
  reason?: string,
) => {
  await db.query(
    "INSERT INTO audit_log(club_id,actor_id,action,resource_id,reason) VALUES($1,$2,$3,$4,$5)",
    [club, actor, action, resource, reason ?? null],
  );
};
const profileSchema = z
  .object({
    name: text,
    birthDate: z.iso.date(),
    phone: z.string().trim().min(6).max(30),
    location: text,
    role: z.enum(["BATTER", "BOWLER", "ALL_ROUNDER", "KEEPER"]),
    battingStyle: text,
    bowlingStyle: text,
    requestedBase: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    displayConsent: z.literal(true),
    photoKey: z.string().max(160).optional(),
  })
  .strict();
export class PreparationService {
  async list(actor: string) {
    return transaction(
      actor,
      async (db) => (await db.query("SELECT * FROM my_auctions()")).rows,
    );
  }
  async createClub(actor: string, input: unknown) {
    const c = z
      .object({ name: text, slug: z.string().regex(/^[a-z0-9-]{3,60}$/) })
      .strict()
      .parse(input);
    return transaction(actor, async (db) => {
      const id = randomUUID();
      await db.query("SELECT set_config('app.club_id',$1,true)", [id]);
      await db.query("INSERT INTO clubs(id,name,slug) VALUES($1,$2,$3)", [
        id,
        c.name,
        c.slug,
      ]);
      await db.query("INSERT INTO memberships VALUES($1,$2,'OWNER')", [
        id,
        actor,
      ]);
      return { id };
    });
  }
  async createAuction(actor: string, club: string, input: unknown) {
    const c = z
      .object({
        name: text,
        rules: rulesSchema,
        venue: text.optional(),
        scheduledAt: z.iso.datetime({ offset: true }).optional(),
      })
      .strict()
      .parse(input);
    validateRules(c.rules);
    return transaction(actor, async (db) => {
      await db.query("SELECT set_config('app.club_id',$1,true)", [
        uuid.parse(club),
      ]);
      const roles = (
        await db.query(
          "SELECT role FROM memberships WHERE club_id=$1 AND user_id=$2",
          [club, actor],
        )
      ).rows.map((r) => r.role);
      admin(roles);
      const { rows } = await db.query(
        "INSERT INTO auctions(club_id,name,rules,venue,scheduled_at) VALUES($1,$2,$3,$4,$5) RETURNING id",
        [club, c.name, c.rules, c.venue ?? null, c.scheduledAt ?? null],
      );
      return rows[0];
    });
  }
  async configure(actor: string, id: string, input: unknown) {
    const c = z
      .object({
        name: text.optional(),
        venue: text.optional(),
        rules: rulesSchema.optional(),
        publicVisible: z.boolean().optional(),
        teamCapacity: z.number().int().min(2).max(20).optional(),
        selectionMode: z.enum(["MANUAL", "RANDOM", "BOTH"]).optional(),
        scheduledAt: z.iso.datetime({ offset: true }).optional(),
        registrationDeadline: z.iso.datetime({ offset: true }).optional(),
      })
      .strict()
      .parse(input);
    return scoped(actor, id, async (db, a, roles) => {
      admin(roles);
      editable(a);
      const effectiveDate = c.scheduledAt ?? a.scheduled_at;
      const deadline = c.registrationDeadline ?? a.registration_deadline;
      if (
        effectiveDate &&
        deadline &&
        new Date(deadline) > new Date(effectiveDate)
      )
        throw Error("INVALID_SCHEDULE");
      if (c.rules) {
        validateRules(c.rules);
        const changed = Object.entries(c.rules).some(
          ([key, value]) => a.rules[key] !== value,
        );
        if (changed) {
          if (
            (
              await db.query("SELECT 1 FROM lots WHERE auction_id=$1 LIMIT 1", [
                id,
              ])
            ).rowCount
          )
            throw Error("RULES_IN_USE");
          await db.query(
            "UPDATE teams SET initial_purse=$2,remaining_purse=$2 WHERE auction_id=$1",
            [id, c.rules.purse],
          );
          await db.query(
            "UPDATE registrations SET status='PENDING',effective_base=NULL,review_reason=NULL,reviewed_by=NULL WHERE auction_id=$1 AND status='APPROVED'",
            [id],
          );
        }
      }

      await db.query(
        "UPDATE auctions SET name=coalesce($2,name),venue=coalesce($3,venue),rules=coalesce($4,rules),public_visible=coalesce($5,public_visible),scheduled_at=coalesce($6,scheduled_at),registration_deadline=coalesce($7,registration_deadline),version=version+1 WHERE id=$1",
        [
          id,
          c.name ?? null,
          c.venue ?? null,
          c.rules ?? null,
          c.publicVisible ?? null,
          c.scheduledAt ?? null,
          c.registrationDeadline ?? null,
        ],
      );
      if (c.teamCapacity !== undefined) {
        const count = (
          await db.query(
            "SELECT count(*)::int n FROM teams WHERE auction_id=$1",
            [id],
          )
        ).rows[0].n;
        if (count > c.teamCapacity) throw Error("TEAM_CAPACITY");
      }
      await db.query(
        "UPDATE auctions SET team_capacity=coalesce($2,team_capacity),selection_mode=coalesce($3,selection_mode) WHERE id=$1",
        [id, c.teamCapacity ?? null, c.selectionMode ?? null],
      );
      await audit(db, a.club_id, actor, "CONFIGURE", id);
      return { id };
    });
  }
  async register(actor: string, id: string, input: unknown) {
    const c = profileSchema.parse(input);
    if (process.env.NODE_ENV === "production" && !c.photoKey)
      throw Error("PHOTO_REQUIRED");
    if (
      c.photoKey &&
      !new RegExp("^profiles/" + actor + "/[a-f0-9-]{36}\\.webp$").test(
        c.photoKey,
      )
    )
      throw Error("INVALID_IMAGE");
    const birth = new Date(c.birthDate + "T00:00:00Z");
    const cutoff = new Date();
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 18);
    if (birth > cutoff) throw Error("ADULT_ONLY");
    await transaction(actor, async (db) => {
      await db.query("SELECT join_registration($1)", [uuid.parse(id)]);
    });
    return scoped(actor, id, async (db, a) => {
      if (
        a.status !== "REGISTRATION_OPEN" ||
        (a.registration_deadline &&
          new Date(a.registration_deadline) < new Date())
      )
        throw Error("REGISTRATION_CLOSED");
      if (c.requestedBase !== undefined)
        resolveEffectiveBase(c.requestedBase, undefined, a.rules);
      if (
        c.photoKey &&
        !(
          await db.query("SELECT * FROM lock_owned_image($1,$2)", [
            c.photoKey,
            actor,
          ])
        ).rowCount
      )
        throw Error("INVALID_IMAGE");
      const existing = (
        await db.query(
          "SELECT r.* FROM registrations r JOIN player_profiles p ON p.id=r.player_id WHERE r.auction_id=$1 AND p.user_id=$2 FOR UPDATE OF r",
          [id, actor],
        )
      ).rows[0];
      if (
        existing &&
        !["PENDING", "CHANGES_REQUESTED", "REJECTED", "WITHDRAWN"].includes(
          existing.status,
        )
      )
        throw Error("ALREADY_REGISTERED");
      const snapshot = {
        name: c.name,
        location: c.location,
        role: c.role,
        battingStyle: c.battingStyle,
        bowlingStyle: c.bowlingStyle,
        ...(c.photoKey ? { photoKey: c.photoKey } : {}),
      };
      let rows: any[];
      if (existing) {
        await db.query(
          "UPDATE player_profiles SET name=$2,birth_date=$3,phone=$4,location=$5,role=$6,batting_style=$7,bowling_style=$8,updated_at=now() WHERE id=$1",
          [
            existing.player_id,
            c.name,
            c.birthDate,
            c.phone,
            c.location,
            c.role,
            c.battingStyle,
            c.bowlingStyle,
          ],
        );
        rows = (
          await db.query(
            "UPDATE registrations SET profile_snapshot=$2,requested_base=$3,status='PENDING',effective_base=NULL,reviewed_by=NULL,review_reason=NULL,display_consent_at=now() WHERE id=$1 RETURNING id,status",
            [existing.id, snapshot, c.requestedBase ?? null],
          )
        ).rows;
      } else {
        let profile = (
          await db.query(
            "SELECT id FROM player_profiles WHERE user_id=$1 AND NOT rehearsal_only ORDER BY updated_at DESC LIMIT 1",
            [actor],
          )
        ).rows[0];
        if (profile)
          await db.query(
            "UPDATE player_profiles SET name=$2,birth_date=$3,phone=$4,location=$5,role=$6,batting_style=$7,bowling_style=$8,photo_key=coalesce($9,photo_key),updated_at=clock_timestamp() WHERE id=$10 AND user_id=$1",
            [
              actor,
              c.name,
              c.birthDate,
              c.phone,
              c.location,
              c.role,
              c.battingStyle,
              c.bowlingStyle,
              c.photoKey ?? null,
              profile.id,
            ],
          );
        else
          profile = (
            await db.query(
              "INSERT INTO player_profiles(user_id,name,birth_date,phone,location,role,batting_style,bowling_style,photo_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
              [
                actor,
                c.name,
                c.birthDate,
                c.phone,
                c.location,
                c.role,
                c.battingStyle,
                c.bowlingStyle,
                c.photoKey ?? null,
              ],
            )
          ).rows[0];
        rows = (
          await db.query(
            "INSERT INTO registrations(club_id,auction_id,player_id,profile_snapshot,requested_base,display_consent_at) VALUES($1,$2,$3,$4,$5,now()) RETURNING id,status",
            [a.club_id, id, profile.id, snapshot, c.requestedBase ?? null],
          )
        ).rows;
      }
      const flags = (
        await db.query("SELECT registration_duplicates($1,$2,$3,$4) flags", [
          id,
          c.phone,
          c.name,
          actor,
        ])
      ).rows[0].flags;
      await db.query(
        "UPDATE registrations SET duplicate_flags=$2 WHERE id=$1",
        [rows[0].id, flags],
      );
      await audit(db, a.club_id, actor, "REGISTER", rows[0].id);
      return rows[0];
    });
  }
  async myRegistration(actor: string, id: string) {
    return scoped(actor, id, async (db) => ({
      players: (
        await db.query(
          `SELECT r.id,r.status,r.review_reason AS reason,r.effective_base AS base,(SELECT t.name FROM allocations x JOIN teams t ON t.id=x.team_id WHERE x.registration_id=r.id AND x.status='ACTIVE') AS "teamName",(SELECT price FROM allocations x WHERE x.registration_id=r.id AND x.status='ACTIVE') price FROM registrations r JOIN player_profiles p ON p.id=r.player_id WHERE r.auction_id=$1 AND p.user_id=$2`,
          [id, actor],
        )
      ).rows,
      manager: (
        await db.query(
          "SELECT id,status,reason FROM manager_applications WHERE auction_id=$1 AND user_id=$2",
          [id, actor],
        )
      ).rows,
    }));
  }
  async applyManager(actor: string, id: string) {
    await transaction(actor, async (db) => {
      await db.query("SELECT join_registration($1)", [uuid.parse(id)]);
    });
    return scoped(actor, id, async (db, a) => {
      if (a.status !== "REGISTRATION_OPEN") throw Error("REGISTRATION_CLOSED");
      return (
        await db.query(
          "INSERT INTO manager_applications(club_id,auction_id,user_id) VALUES($1,$2,$3) ON CONFLICT(auction_id,user_id) DO UPDATE SET status='PENDING',reason=NULL WHERE manager_applications.status IN ('REJECTED','CHANGES_REQUESTED') RETURNING id,status",
          [a.club_id, id, actor],
        )
      ).rows[0];
    });
  }
  async team(actor: string, id: string, input: unknown) {
    const c = z
      .object({
        name: text,
        code: z
          .string()
          .trim()
          .regex(/^[A-Z0-9]{2,5}$/),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .default("#0759D3"),
      })
      .strict()
      .parse(input);
    return scoped(actor, id, async (db, a, roles) => {
      admin(roles);
      editable(a);
      if (
        (
          await db.query(
            "SELECT count(*)::int n FROM teams WHERE auction_id=$1",
            [id],
          )
        ).rows[0].n >= a.team_capacity
      )
        throw Error("TEAM_CAPACITY");
      return (
        await db.query(
          "INSERT INTO teams(club_id,auction_id,name,code,color,initial_purse,remaining_purse) VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING id",
          [a.club_id, id, c.name, c.code, c.color, a.rules.purse],
        )
      ).rows[0];
    });
  }
  async review(actor: string, id: string, input: unknown) {
    const c = z
      .object({
        kind: z.enum(["PLAYER", "MANAGER"]),
        id: uuid,
        status: z.enum(["APPROVED", "REJECTED", "CHANGES_REQUESTED"]),
        reason: z.string().trim().min(1).max(2000).optional(),
        base: z.number().int().positive().optional(),
        teamId: uuid.optional(),
      })
      .strict()
      .parse(input);
    return scoped(actor, id, async (db, a, roles) => {
      admin(roles);
      editable(a);
      if (c.status !== "APPROVED" && !c.reason) throw Error("REASON_REQUIRED");
      if (c.kind === "PLAYER") {
        const r = (
          await db.query(
            "SELECT * FROM registrations WHERE id=$1 AND auction_id=$2 FOR UPDATE",
            [c.id, id],
          )
        ).rows[0];
        if (!r) throw Error("NOT_FOUND");
        if (r.status === "WITHDRAWN") throw Error("INVALID_TRANSITION");
        const base =
          c.status === "APPROVED"
            ? resolveEffectiveBase(r.requested_base, c.base, a.rules)
            : null;
        await db.query(
          "UPDATE registrations SET status=$2,effective_base=$3,reviewed_by=$4,review_reason=$5 WHERE id=$1",
          [c.id, c.status, base, actor, c.reason ?? null],
        );
      } else {
        const m = (
          await db.query(
            "SELECT * FROM manager_applications WHERE id=$1 AND auction_id=$2 FOR UPDATE",
            [c.id, id],
          )
        ).rows[0];
        if (!m) throw Error("NOT_FOUND");
        if (c.status === "APPROVED") {
          const team = (
            await db.query(
              "SELECT id FROM teams WHERE id=$1 AND auction_id=$2",
              [c.teamId ?? m.team_id, id],
            )
          ).rows[0];
          if (!team) throw Error("TEAM_REQUIRED");
          await db.query(
            "UPDATE team_operators SET active=false WHERE auction_id=$1 AND (user_id=$2 OR team_id=$3)",
            [id, m.user_id, team.id],
          );
          await db.query(
            "INSERT INTO team_operators(club_id,auction_id,team_id,user_id) VALUES($1,$2,$3,$4)",
            [a.club_id, id, team.id, m.user_id],
          );
          await db.query(
            "UPDATE manager_applications SET team_id=$2 WHERE id=$1",
            [c.id, team.id],
          );
        } else
          await db.query(
            "UPDATE team_operators SET active=false WHERE auction_id=$1 AND user_id=$2",
            [id, m.user_id],
          );
        await db.query(
          "UPDATE manager_applications SET status=$2,reviewed_by=$3,reason=$4 WHERE id=$1",
          [c.id, c.status, actor, c.reason ?? null],
        );
      }
      await audit(db, a.club_id, actor, "REVIEW_" + c.kind, c.id, c.reason);
      return { id: c.id, status: c.status };
    });
  }
  async invite(actor: string, id: string, input: unknown) {
    const c = z
      .object({ email: z.email(), teamId: uuid })
      .strict()
      .parse(input);
    return scoped(actor, id, async (db, a, roles) => {
      admin(roles);
      editable(a);
      const token = randomBytes(32).toString("hex");
      await db.query(
        "INSERT INTO manager_invites(club_id,auction_id,team_id,email,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '7 days')",
        [
          a.club_id,
          id,
          c.teamId,
          c.email,
          createHash("sha256").update(token).digest("hex"),
        ],
      );
      await audit(db, a.club_id, actor, "INVITE", c.teamId);
      return { token, expiresInDays: 7 };
    });
  }
  async acceptInvite(actor: string, token: string) {
    const hash = createHash("sha256")
      .update(z.string().length(64).parse(token))
      .digest("hex");
    return transaction(actor, async (db) => {
      const club = (await db.query("SELECT invite_scope($1) club", [hash]))
        .rows[0].club;
      await db.query("SELECT set_config('app.club_id',$1,true)", [club]);
      const i = (
        await db.query(
          "SELECT * FROM manager_invites WHERE token_hash=$1 FOR UPDATE",
          [hash],
        )
      ).rows[0];
      if (i.accepted_by) throw Error("INVALID_INVITE");
      const a = (
        await db.query("SELECT status FROM auctions WHERE id=$1 FOR UPDATE", [
          i.auction_id,
        ])
      ).rows[0];
      editable(a);
      await db.query("UPDATE manager_invites SET accepted_by=$2 WHERE id=$1", [
        i.id,
        actor,
      ]);
      return (
        await db.query(
          "INSERT INTO manager_applications(club_id,auction_id,user_id,team_id) VALUES($1,$2,$3,$4) RETURNING id,status",
          [club, i.auction_id, actor, i.team_id],
        )
      ).rows[0];
    });
  }
}
