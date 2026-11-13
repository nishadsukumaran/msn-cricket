import { z } from "zod";
import { transaction, scoped } from "../../../packages/database/src/db.ts";
import { requireAdmin, recordChange } from "./admin.ts";
export async function requirePlatform(db: any) {
  if (
    !(await db.query("SELECT is_platform_operator() allowed")).rows[0].allowed
  )
    throw Error("FORBIDDEN");
}
export class PlatformService {
  async console(actor: string) {
    return transaction(actor, async (db) => {
      await requirePlatform(db);
      return {
        ...(await db.query("SELECT platform_overview() data")).rows[0].data,
        grants: (await db.query("SELECT platform_grants() data")).rows[0].data,
      };
    });
  }
  async product(actor: string, input: unknown) {
    const p = z
      .object({
        sku: z.string().regex(/^[A-Z0-9_-]{2,80}$/),
        units: z.number().int().min(1).max(1000),
        amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        currency: z.string().regex(/^[A-Z]{3}$/),
        validityDays: z.number().int().positive().nullable().default(null),
        active: z.boolean().default(true),
      })
      .strict()
      .parse(input);
    return transaction(actor, async (db) => {
      await requirePlatform(db);
      await db.query(
        "INSERT INTO credit_products(sku,units,amount_minor,currency,validity_days,active) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(sku) DO UPDATE SET units=$2,amount_minor=$3,currency=$4,validity_days=$5,active=$6",
        [p.sku, p.units, p.amountMinor, p.currency, p.validityDays, p.active],
      );
      return { sku: p.sku };
    });
  }
  async revokeCredit(actor: string, input: unknown) {
    const c = z
      .object({
        clubId: z.string().uuid(),
        grantId: z.string().uuid(),
        reason: z.string().trim().min(3).max(2000),
      })
      .strict()
      .parse(input);
    return transaction(actor, async (db) => {
      await requirePlatform(db);
      await db.query("SELECT set_config('app.club_id',$1,true)", [c.clubId]);
      const grant = (
        await db.query(
          "SELECT * FROM credit_grants WHERE id=$1 AND club_id=$2 FOR UPDATE",
          [c.grantId, c.clubId],
        )
      ).rows[0];
      if (!grant) throw Error("NOT_FOUND");
      await db.query("UPDATE credit_grants SET revoked_at=now() WHERE id=$1", [
        c.grantId,
      ]);
      await db.query(
        "INSERT INTO audit_log(club_id,actor_id,action,resource_id,reason) VALUES($1,$2,'CREDIT_REVOKED',$3,$4)",
        [c.clubId, actor, c.grantId, c.reason],
      );
      return { id: c.grantId, revoked: true };
    });
  }
  async support(actor: string, input: unknown) {
    const c = z
      .object({
        clubId: z.string().uuid(),
        reason: z.string().trim().min(3).max(2000),
        minutes: z.number().int().min(1).max(60).default(15),
      })
      .strict()
      .parse(input);
    return transaction(actor, async (db) => {
      await requirePlatform(db);
      const access = (
        await db.query(
          "INSERT INTO support_access(club_id,actor_id,reason,expires_at) VALUES($1,$2,$3,now()+make_interval(mins=>$4)) RETURNING id,expires_at",
          [c.clubId, actor, c.reason, c.minutes],
        )
      ).rows[0];
      await db.query("SELECT set_config('app.club_id',$1,true)", [c.clubId]);
      await db.query(
        "INSERT INTO audit_log(club_id,actor_id,action,resource_id,reason) VALUES($1,$2,'SUPPORT_ACCESS_STARTED',$3,$4)",
        [c.clubId, actor, access.id, c.reason],
      );
      return access;
    });
  }
  async requestCredit(actor: string, id: string, input: unknown) {
    const c = z
      .object({
        units: z.number().int().min(1).max(1000),
        reference: z.string().trim().max(200).optional(),
      })
      .strict()
      .parse(input);
    return scoped(actor, id, async (db, a, roles) => {
      requireAdmin(roles);
      return (
        await db.query(
          "INSERT INTO credit_requests(club_id,requested_by,units,reference) VALUES($1,$2,$3,$4) RETURNING id,status",
          [a.club_id, actor, c.units, c.reference ?? null],
        )
      ).rows[0];
    });
  }
  async requests(actor: string) {
    return transaction(actor, async (db) => {
      await requirePlatform(db);
      return (await db.query("SELECT platform_credit_requests() data")).rows[0]
        .data;
    });
  }
  async reviewCredit(actor: string, input: unknown) {
    const c = z
      .object({
        id: z.string().uuid(),
        clubId: z.string().uuid(),
        status: z.enum(["APPROVED", "REJECTED"]),
        reason: z.string().trim().min(3).max(2000),
      })
      .strict()
      .parse(input);
    if (c.status === "APPROVED") {
      const request = await transaction(actor, async (db) => {
        await requirePlatform(db);
        await db.query("SELECT set_config('app.club_id',$1,true)", [c.clubId]);
        return (
          await db.query("SELECT units FROM credit_requests WHERE id=$1", [
            c.id,
          ])
        ).rows[0];
      });
      if (!request) throw Error("NOT_FOUND");
      const { CommerceService } = await import("./commerce.ts");
      return new CommerceService().manualGrant(actor, {
        clubId: c.clubId,
        units: request.units,
        requestId: c.id,
        reason: c.reason,
      });
    }
    return transaction(actor, async (db) => {
      await requirePlatform(db);
      await db.query("SELECT set_config('app.club_id',$1,true)", [c.clubId]);
      await db.query(
        "UPDATE credit_requests SET status='REJECTED',reason=$2,reviewed_by=$3 WHERE id=$1 AND status='PENDING'",
        [c.id, c.reason, actor],
      );
      return { id: c.id, status: c.status };
    });
  }
  async billing(actor: string, id: string) {
    return scoped(actor, id, async (db, a, roles) => {
      requireAdmin(roles);
      return {
        orders: (
          await db.query(
            'SELECT id,provider_reference AS reference,status,amount_minor AS "amountMinor",currency FROM orders WHERE club_id=$1 ORDER BY id',
            [a.club_id],
          )
        ).rows,
        requests: (
          await db.query(
            "SELECT id,units,reference,status,reason FROM credit_requests WHERE club_id=$1 ORDER BY created_at DESC",
            [a.club_id],
          )
        ).rows,
      };
    });
  }
  async suspend(actor: string, input: unknown) {
    const c = z
      .object({
        clubId: z.string().uuid(),
        suspended: z.boolean(),
        reason: z.string().trim().min(3).max(2000),
      })
      .strict()
      .parse(input);
    return transaction(actor, async (db) => {
      await requirePlatform(db);
      await db.query("SELECT set_config('app.club_id',$1,true)", [c.clubId]);
      const auctions = (
        await db.query(
          "SELECT * FROM auctions WHERE club_id=$1 ORDER BY id FOR UPDATE",
          [c.clubId],
        )
      ).rows;
      await db.query("UPDATE clubs SET status=$2 WHERE id=$1", [
        c.clubId,
        c.suspended ? "SUSPENDED" : "ACTIVE",
      ]);
      for (const a of auctions) {
        if (c.suspended && a.status === "LIVE")
          await db.query("UPDATE auctions SET status='PAUSED' WHERE id=$1", [
            a.id,
          ]);
        await recordChange(
          db,
          a,
          actor,
          c.suspended ? "CLUB_SUSPENDED" : "CLUB_REACTIVATED",
          c.clubId,
          c.reason,
        );
      }
      return { status: c.suspended ? "SUSPENDED" : "ACTIVE" };
    });
  }
  async metrics(actor: string, id: string) {
    return scoped(actor, id, async (db, a, roles) => {
      requireAdmin(roles);
      return (await db.query("SELECT club_metrics($1) data", [a.club_id]))
        .rows[0].data;
    });
  }
  async resolveAlert(actor: string, id: string) {
    return transaction(actor, async (db) => {
      await requirePlatform(db);
      await db.query(
        "UPDATE operations_alerts SET resolved_at=now() WHERE id=$1",
        [z.string().uuid().parse(id)],
      );
      return { ok: true };
    });
  }
}
