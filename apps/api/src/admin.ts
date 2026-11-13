import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { pool, scoped, type DB } from "../../../packages/database/src/db.ts";
const uuid = z.string().uuid(),
  reason = z.string().trim().min(3).max(2000);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function requireAdmin(roles: string[]) {
  if (!roles.some((r) => r === "OWNER" || r === "ADMIN"))
    throw Error("FORBIDDEN");
}
export async function recordChange(
  db: DB,
  a: any,
  actor: string,
  type: string,
  resource: string,
  why: string,
  payload: any = {},
) {
  await db.query(
    "INSERT INTO audit_log(club_id,actor_id,action,resource_id,reason,redacted_change) VALUES($1,$2,$3,$4,$5,$6)",
    [a.club_id, actor, type, resource, why, payload],
  );
  const e = (
    await db.query(
      "UPDATE auctions SET sequence=sequence+1,version=version+1 WHERE id=$1 RETURNING sequence",
      [a.id],
    )
  ).rows[0];
  const event = (
    await db.query(
      "INSERT INTO auction_events(club_id,auction_id,sequence,type,payload) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [a.club_id, a.id, e.sequence, type, payload],
    )
  ).rows[0];
  await db.query("INSERT INTO outbox(event_id) VALUES($1)", [event.id]);
  return { sequence: e.sequence };
}
export class AdministrationService {
  async rehearse(actor: string, id: string) {
    return scoped(actor, id, async (db, a, roles) => {
      requireAdmin(roles);
      if (a.rehearsal) throw Error("ALREADY_REHEARSAL");
      const teams = (
        await db.query(
          "SELECT t.*,o.user_id FROM teams t JOIN team_operators o ON o.team_id=t.id AND o.active WHERE t.auction_id=$1 ORDER BY t.id",
          [id],
        )
      ).rows;
      if (teams.length < 2) throw Error("OPERATORS_REQUIRED");
      const clone = (
        await db.query(
          "INSERT INTO auctions(club_id,name,venue,rules,status,rehearsal,public_visible,team_capacity,selection_mode) VALUES($1,$2,$3,$4,'REGISTRATION_OPEN',true,false,$5,'BOTH') RETURNING id",
          [
            a.club_id,
            "Practice · " + a.name,
            a.venue,
            a.rules,
            a.team_capacity,
          ],
        )
      ).rows[0];
      for (const team of teams) {
        const created = (
          await db.query(
            "INSERT INTO teams(club_id,auction_id,code,name,color,initial_purse,remaining_purse) VALUES($1,$2,$3,$4,$5,$6,$6) RETURNING id",
            [
              a.club_id,
              clone.id,
              team.code,
              team.name,
              team.color,
              a.rules.purse,
            ],
          )
        ).rows[0];
        await db.query(
          "INSERT INTO team_operators(club_id,auction_id,team_id,user_id) VALUES($1,$2,$3,$4)",
          [a.club_id, clone.id, created.id, team.user_id],
        );
        await db.query(
          "INSERT INTO manager_applications(club_id,auction_id,user_id,team_id,status,reviewed_by) VALUES($1,$2,$3,$4,'APPROVED',$5)",
          [a.club_id, clone.id, team.user_id, created.id, actor],
        );
      }
      for (let i = 0; i < Math.max(6, teams.length * a.rules.minSquad); i++) {
        const name = "Sample Player " + String(i + 1).padStart(3, "0");
        const profile = (
          await db.query(
            "INSERT INTO player_profiles(user_id,name,phone,location,role,batting_style,bowling_style,rehearsal_only) VALUES($1,$2,'Sample only','Practice venue','BATTER','Right hand','Not applicable',true) RETURNING id",
            [actor, name],
          )
        ).rows[0];
        await db.query(
          "INSERT INTO registrations(club_id,auction_id,player_id,profile_snapshot,effective_base,status,display_consent_at,reviewed_by) VALUES($1,$2,$3,$4,$5,'APPROVED',now(),$6)",
          [
            a.club_id,
            clone.id,
            profile.id,
            {
              name,
              location: "Practice venue",
              role: "BATTER",
              battingStyle: "Right hand",
              bowlingStyle: "Not applicable",
            },
            a.rules.defaultBase,
            actor,
          ],
        );
      }
      await recordChange(
        db,
        a,
        actor,
        "REHEARSAL_CREATED",
        clone.id,
        "Separate fictional rehearsal created",
      );
      return clone;
    });
  }
  async transfer(actor: string, id: string, input: unknown) {
    const c = z.object({ userId: uuid, reason }).strict().parse(input);
    return scoped(actor, id, async (db, a) => {
      await db.query("SELECT id FROM clubs WHERE id=$1 FOR UPDATE", [
        a.club_id,
      ]);
      if (
        !(
          await db.query(
            "SELECT 1 FROM memberships WHERE club_id=$1 AND user_id=$2 AND role='OWNER'",
            [a.club_id, actor],
          )
        ).rowCount
      )
        throw Error("FORBIDDEN");
      if (c.userId === actor) throw Error("SELF_CHANGE_FORBIDDEN");
      if (
        !(
          await db.query(
            "SELECT 1 FROM memberships WHERE club_id=$1 AND user_id=$2",
            [a.club_id, c.userId],
          )
        ).rowCount
      )
        throw Error("UNAPPROVED");
      await db.query(
        "INSERT INTO memberships VALUES($1,$2,'OWNER') ON CONFLICT DO NOTHING",
        [a.club_id, c.userId],
      );
      await db.query(
        "DELETE FROM memberships WHERE club_id=$1 AND user_id=$2 AND role='OWNER'",
        [a.club_id, actor],
      );
      await db.query(
        "INSERT INTO memberships VALUES($1,$2,'ADMIN') ON CONFLICT DO NOTHING",
        [a.club_id, actor],
      );
      return recordChange(
        db,
        a,
        actor,
        "OWNERSHIP_TRANSFERRED",
        c.userId,
        c.reason,
        { newOwner: c.userId },
      );
    });
  }
  async directory(actor: string, id: string) {
    return scoped(actor, id, async (db, a, roles) => {
      requireAdmin(roles);
      return (await db.query("SELECT * FROM club_staff($1)", [a.club_id])).rows;
    });
  }
  async staff(actor: string, id: string, input: unknown) {
    const c = z
      .object({
        userId: uuid.optional(),
        email: z.email().optional(),
        role: z.enum(["ADMIN", "AUCTIONEER", "MEMBER"]),
        revoke: z.boolean().default(false),
        reason,
      })
      .strict()
      .parse(input);
    return scoped(actor, id, async (db, a, roles) => {
      if (!roles.includes("OWNER")) throw Error("FORBIDDEN");
      const userId =
        c.userId ??
        (c.email
          ? (await db.query("SELECT lookup_staff_user($1) id", [c.email]))
              .rows[0].id
          : null);
      if (!userId) throw Error("USER_REQUIRED");
      if (userId === actor) throw Error("SELF_CHANGE_FORBIDDEN");
      if (c.revoke)
        await db.query(
          "DELETE FROM memberships WHERE club_id=$1 AND user_id=$2 AND role=$3",
          [a.club_id, userId, c.role],
        );
      else {
        await db.query(
          "INSERT INTO memberships VALUES($1,$2,'MEMBER') ON CONFLICT DO NOTHING",
          [a.club_id, userId],
        );
        await db.query(
          "INSERT INTO memberships VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [a.club_id, userId, c.role],
        );
      }
      return recordChange(
        db,
        a,
        actor,
        c.revoke ? "STAFF_REVOKED" : "STAFF_GRANTED",
        userId,
        c.reason,
        { userId, role: c.role },
      );
    });
  }
  async handover(actor: string, id: string, input: unknown) {
    const c = z
      .object({ teamId: uuid, userId: uuid, reason })
      .strict()
      .parse(input);
    return scoped(actor, id, async (db, a, roles) => {
      requireAdmin(roles);
      if (a.status === "LIVE") throw Error("PAUSE_REQUIRED");
      if (
        !["DRAFT", "REGISTRATION_OPEN", "READY", "LOCKED", "PAUSED"].includes(
          a.status,
        )
      )
        throw Error("INVALID_TRANSITION");
      const approved = await db.query(
        "SELECT 1 FROM manager_applications WHERE auction_id=$1 AND team_id=$2 AND user_id=$3 AND status='APPROVED'",
        [id, c.teamId, c.userId],
      );
      if (!approved.rowCount) throw Error("UNAPPROVED");
      const other = await db.query(
        "SELECT 1 FROM team_operators WHERE auction_id=$1 AND user_id=$2 AND team_id<>$3 AND active",
        [id, c.userId, c.teamId],
      );
      if (other.rowCount) throw Error("OPERATOR_ALREADY_ASSIGNED");
      await db.query(
        "UPDATE team_operators SET active=false WHERE auction_id=$1 AND team_id=$2",
        [id, c.teamId],
      );
      await db.query(
        "INSERT INTO team_operators(club_id,auction_id,team_id,user_id) VALUES($1,$2,$3,$4)",
        [a.club_id, id, c.teamId, c.userId],
      );
      return recordChange(
        db,
        a,
        actor,
        "OPERATOR_HANDOVER",
        c.teamId,
        c.reason,
        { teamId: c.teamId },
      );
    });
  }
  async display(actor: string, id: string) {
    return scoped(actor, id, async (db, a, roles) => {
      requireAdmin(roles);
      const token = randomBytes(32).toString("hex");
      await db.query(
        "UPDATE display_credentials SET revoked_at=now() WHERE auction_id=$1 AND revoked_at IS NULL",
        [id],
      );
      const value = (
        await db.query(
          "INSERT INTO display_credentials(club_id,auction_id,token_hash,expires_at,created_by) VALUES($1,$2,$3,now()+interval '24 hours',$4) RETURNING id,expires_at",
          [a.club_id, id, hash(token), actor],
        )
      ).rows[0];
      await recordChange(
        db,
        a,
        actor,
        "DISPLAY_ROTATED",
        value.id,
        "Display access rotated",
      );
      return { token, expiresAt: value.expires_at };
    });
  }
  async revokeDisplay(actor: string, id: string) {
    return scoped(actor, id, async (db, a, roles) => {
      requireAdmin(roles);
      await db.query(
        "UPDATE display_credentials SET revoked_at=now() WHERE auction_id=$1 AND revoked_at IS NULL",
        [id],
      );
      return recordChange(
        db,
        a,
        actor,
        "DISPLAY_REVOKED",
        id,
        "Display access revoked",
      );
    });
  }
  async projection(token: string) {
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(token);
    const data = (
      await pool.query("SELECT display_snapshot($1) data", [hash(token)])
    ).rows[0].data;
    if (!data) throw Error("NOT_FOUND");
    return data;
  }
  async branding(actor: string, id: string, input: unknown) {
    const c = z
      .object({
        name: z.string().trim().min(1).max(200).optional(),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
        logoKey: z.string().max(160).optional(),
        teamId: uuid.optional(),
        code: z
          .string()
          .regex(/^[A-Z0-9]{2,5}$/)
          .optional(),
      })
      .strict()
      .parse(input);
    return scoped(actor, id, async (db, a, roles) => {
      requireAdmin(roles);
      if (!["DRAFT", "REGISTRATION_OPEN", "READY"].includes(a.status))
        throw Error("ROSTER_LOCKED");
      if (c.logoKey) {
        const image = await db.query("SELECT * FROM lock_owned_image($1,$2)", [
          c.logoKey,
          actor,
        ]);
        if (!image.rowCount) throw Error("INVALID_IMAGE");
      }
      if (c.teamId) {
        const result = await db.query(
          "UPDATE teams SET name=coalesce($3,name),color=coalesce($4,color),logo_key=coalesce($5,logo_key),code=coalesce($6,code) WHERE id=$1 AND auction_id=$2",
          [
            c.teamId,
            id,
            c.name ?? null,
            c.color ?? null,
            c.logoKey ?? null,
            c.code ?? null,
          ],
        );
        if (!result.rowCount) throw Error("NOT_FOUND");
      } else
        await db.query(
          "UPDATE clubs SET name=coalesce($2,name),branding=branding||$3::jsonb WHERE id=$1",
          [
            a.club_id,
            c.name ?? null,
            {
              ...(c.color ? { color: c.color } : {}),
              ...(c.logoKey ? { logoKey: c.logoKey } : {}),
            },
          ],
        );
      return recordChange(
        db,
        a,
        actor,
        "BRANDING_UPDATED",
        c.teamId ?? a.club_id,
        "Club branding updated",
      );
    });
  }
}
