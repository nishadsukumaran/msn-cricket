import { z } from "zod";
import { transaction, scoped } from "../../../packages/database/src/db.ts";
import { recordChange } from "./admin.ts";
const text = z.string().trim().min(1).max(200);
export const profileInput = z
  .object({
    name: text,
    birthDate: z.iso.date(),
    phone: z.string().trim().min(6).max(30),
    location: text,
    role: z.enum(["BATTER", "BOWLER", "ALL_ROUNDER", "KEEPER"]),
    battingStyle: text,
    bowlingStyle: text,
    photoKey: z.string().max(160).optional(),
  })
  .strict();
export function adultOnly(date: string) {
  const cutoff = new Date();
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 18);
  if (new Date(date + "T00:00:00Z") > cutoff) throw Error("ADULT_ONLY");
}
export class ProfilesService {
  async get(actor: string) {
    return transaction(
      actor,
      async (db) =>
        (
          await db.query(
            'SELECT id,name,to_char(birth_date,\'YYYY-MM-DD\') AS "birthDate",phone,location,role,batting_style AS "battingStyle",bowling_style AS "bowlingStyle",photo_key AS "photoKey" FROM player_profiles WHERE user_id=$1 AND NOT rehearsal_only ORDER BY updated_at DESC LIMIT 1',
            [actor],
          )
        ).rows[0] ?? null,
    );
  }
  async save(actor: string, input: unknown) {
    const c = profileInput.parse(input);
    adultOnly(c.birthDate);
    return transaction(actor, async (db) => {
      await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [actor]);
      if (c.photoKey) {
        if (!c.photoKey.startsWith("profiles/" + actor + "/"))
          throw Error("INVALID_IMAGE");
        if (
          !(
            await db.query("SELECT * FROM lock_owned_image($1,$2)", [
              c.photoKey,
              actor,
            ])
          ).rowCount
        )
          throw Error("INVALID_IMAGE");
      }
      const existing = (
        await db.query(
          "SELECT id FROM player_profiles WHERE user_id=$1 AND NOT rehearsal_only ORDER BY updated_at DESC LIMIT 1",
          [actor],
        )
      ).rows[0];
      const args = [
        actor,
        c.name,
        c.birthDate,
        c.phone,
        c.location,
        c.role,
        c.battingStyle,
        c.bowlingStyle,
        c.photoKey ?? null,
      ];
      if (existing) {
        await db.query(
          "UPDATE player_profiles SET name=$2,birth_date=$3,phone=$4,location=$5,role=$6,batting_style=$7,bowling_style=$8,photo_key=coalesce($9,photo_key),updated_at=clock_timestamp() WHERE id=$10 AND user_id=$1",
          [...args, existing.id],
        );
        return { id: existing.id };
      }
      return (
        await db.query(
          "INSERT INTO player_profiles(user_id,name,birth_date,phone,location,role,batting_style,bowling_style,photo_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
          args,
        )
      ).rows[0];
    });
  }
  async withdraw(actor: string, id: string) {
    return scoped(actor, id, async (db, a) => {
      if (["COMPLETED", "ARCHIVED", "CANCELLED"].includes(a.status))
        throw Error("REGISTRATION_CLOSED");
      const r = (
        await db.query(
          "SELECT r.* FROM registrations r JOIN player_profiles p ON p.id=r.player_id WHERE r.auction_id=$1 AND p.user_id=$2 FOR UPDATE OF r",
          [id, actor],
        )
      ).rows[0];
      if (!r) throw Error("NOT_FOUND");
      const lots = (
        await db.query("SELECT status FROM lots WHERE registration_id=$1", [
          r.id,
        ])
      ).rows;
      if (lots.some((l) => l.status !== "PREVIEW"))
        throw Error("LOT_ALREADY_OPENED");
      if (lots.length) {
        await db.query(
          "UPDATE lots SET status='UNSOLD',version=version+1 WHERE registration_id=$1 AND status='PREVIEW'",
          [r.id],
        );
      }
      await db.query(
        "UPDATE registrations SET status='WITHDRAWN',review_reason=NULL WHERE id=$1",
        [r.id],
      );
      return recordChange(
        db,
        a,
        actor,
        "PLAYER_WITHDRAWN",
        r.id,
        "Player withdrew before bidding opened",
        { registrationId: r.id },
      );
    });
  }
  async erase(actor: string) {
    return transaction(actor, async (db) => ({
      erased: (await db.query("SELECT erase_own_profile() erased")).rows[0]
        .erased,
    }));
  }
  async review(actor: string, id: string, registration: string) {
    return scoped(actor, id, async (db, _a, roles) => {
      if (!roles.some((r) => r === "OWNER" || r === "ADMIN" || r === "SUPPORT"))
        throw Error("FORBIDDEN");
      const exists = (
        await db.query(
          "SELECT id FROM registrations WHERE id=$1 AND auction_id=$2",
          [registration, id],
        )
      ).rowCount;
      if (!exists) throw Error("NOT_FOUND");
      if (roles.includes("SUPPORT"))
        await db.query(
          "INSERT INTO audit_log(club_id,actor_id,action,resource_id,reason) VALUES($1,$2,'SUPPORT_PRIVATE_READ',$3,'Time-limited support read')",
          [_a.club_id, actor, registration],
        );
      return (await db.query("SELECT profile_review($1) data", [registration]))
        .rows[0].data;
    });
  }
}
