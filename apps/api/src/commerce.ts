import {
  createHmac,
  timingSafeEqual,
  createHash,
  randomUUID,
} from "node:crypto";
import { z } from "zod";
import { pool, transaction } from "../../../packages/database/src/db.ts";
export function verifyWebhook(raw: Buffer, signature: string, secret: string) {
  if (!secret) throw Error("PAYMENTS_NOT_CONFIGURED");
  const expected = createHmac("sha256", secret).update(raw).digest();
  if (
    !/^[a-f0-9]{64}$/i.test(signature) ||
    !timingSafeEqual(expected, Buffer.from(signature, "hex"))
  )
    throw Error("INVALID_SIGNATURE");
}
export class CommerceService {
  async products() {
    return (
      await pool.query(
        'SELECT sku,units,amount_minor AS "amountMinor",currency,validity_days AS "validityDays" FROM credit_products WHERE active ORDER BY units',
      )
    ).rows;
  }
  async manualGrant(actor: string, input: unknown) {
    const c = z
      .object({
        clubId: z.string().uuid(),
        units: z.number().int().min(1).max(1000),
        reason: z.string().trim().min(3).max(2000),
        expiresAt: z.iso.datetime({ offset: true }).optional(),
        requestId: z.string().uuid().optional(),
      })
      .strict()
      .parse(input);
    return transaction(actor, async (db) => {
      if (
        !(await db.query("SELECT is_platform_operator() allowed")).rows[0]
          .allowed
      )
        throw Error("FORBIDDEN");
      await db.query("SELECT set_config('app.club_id',$1,true)", [c.clubId]);
      if (c.requestId) {
        const request = (
          await db.query(
            "SELECT * FROM credit_requests WHERE id=$1 AND club_id=$2 FOR UPDATE",
            [c.requestId, c.clubId],
          )
        ).rows[0];
        if (!request || request.units !== c.units)
          throw Error("INVALID_REQUEST");
        if (request.status === "APPROVED")
          return (
            await db.query("SELECT id FROM credit_grants WHERE request_id=$1", [
              c.requestId,
            ])
          ).rows[0];
        if (request.status !== "PENDING") throw Error("INVALID_REQUEST");
      }
      const grant = (
        await db.query(
          "INSERT INTO credit_grants(club_id,units,source,granted_by,reason,expires_at,request_id) VALUES($1,$2,'MANUAL',$3,$4,$5,$6) RETURNING id",
          [
            c.clubId,
            c.units,
            actor,
            c.reason,
            c.expiresAt ?? null,
            c.requestId ?? null,
          ],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO audit_log(club_id,actor_id,action,resource_id,reason) VALUES($1,$2,'MANUAL_CREDIT',$3,$4)",
        [c.clubId, actor, grant.id, c.reason],
      );
      if (c.requestId)
        await db.query(
          "UPDATE credit_requests SET status='APPROVED',reviewed_by=$2,reason=$3 WHERE id=$1",
          [c.requestId, actor, c.reason],
        );
      return grant;
    });
  }
  async checkout(actor: string, input: unknown) {
    const c = z
      .object({ clubId: z.string().uuid(), sku: z.string().min(1).max(100) })
      .strict()
      .parse(input);
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET)
      throw Error("PAYMENTS_NOT_CONFIGURED");
    const order = await transaction(actor, async (db) => {
      await db.query("SELECT set_config('app.club_id',$1,true)", [c.clubId]);
      if (
        !(
          await db.query(
            "SELECT 1 FROM memberships WHERE club_id=$1 AND user_id=$2 AND role='OWNER'",
            [c.clubId, actor],
          )
        ).rowCount
      )
        throw Error("FORBIDDEN");
      const p = (
        await db.query(
          "SELECT * FROM credit_products WHERE sku=$1 AND active",
          [c.sku],
        )
      ).rows[0];
      if (!p) throw Error("INVALID_PRODUCT");
      const id = randomUUID();
      await db.query(
        "INSERT INTO orders(id,club_id,product_snapshot,amount_minor,currency,provider,status) VALUES($1,$2,$3,$4,$5,'RAZORPAY','PENDING')",
        [id, c.clubId, p, p.amount_minor, p.currency],
      );
      return { id, product: p };
    });
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            process.env.RAZORPAY_KEY_ID + ":" + process.env.RAZORPAY_KEY_SECRET,
          ).toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: order.product.amount_minor,
        currency: order.product.currency,
        receipt: order.id,
        notes: { internal_order_id: order.id },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw Error("CHECKOUT_UNAVAILABLE");
    const external: any = await response.json();
    if (typeof external.id !== "string") throw Error("CHECKOUT_UNAVAILABLE");
    await transaction(actor, async (db) => {
      await db.query("SELECT set_config('app.club_id',$1,true)", [c.clubId]);
      await db.query("UPDATE orders SET provider_reference=$2 WHERE id=$1", [
        order.id,
        external.id,
      ]);
    });
    return {
      orderId: external.id,
      keyId: process.env.RAZORPAY_KEY_ID,
      amount: order.product.amount_minor,
      currency: order.product.currency,
      internalOrderId: order.id,
    };
  }
  async reconcile(actor: string, fetcher: typeof fetch = fetch) {
    const {
      RAZORPAY_KEY_ID: key,
      RAZORPAY_KEY_SECRET: secret,
      RAZORPAY_WEBHOOK_SECRET: hook,
      RAZORPAY_ACCOUNT_ID: account,
    } = process.env;
    if (!key || !secret || !hook || !account)
      throw Error("PAYMENTS_NOT_CONFIGURED");
    const orders = await transaction(actor, async (db) => {
      if (
        !(await db.query("SELECT is_platform_operator() allowed")).rows[0]
          .allowed
      )
        throw Error("FORBIDDEN");
      return (await db.query("SELECT * FROM reconciliation_orders()")).rows;
    });
    let checked = 0,
      captured = 0;
    for (const order of orders) {
      const response = await fetcher(
        "https://api.razorpay.com/v1/orders/" +
          encodeURIComponent(order.provider_reference) +
          "/payments",
        {
          headers: {
            Authorization:
              "Basic " + Buffer.from(key + ":" + secret).toString("base64"),
          },
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) throw Error("RECONCILIATION_UNAVAILABLE");
      const data: any = await response.json();
      if (!Array.isArray(data.items)) throw Error("RECONCILIATION_UNAVAILABLE");
      checked++;
      for (const payment of data.items) {
        if (!["captured", "refunded"].includes(payment.status)) continue;
        if (
          payment.order_id !== order.provider_reference ||
          payment.amount !== order.amount_minor ||
          payment.currency !== order.currency
        )
          throw Error("PAYMENT_MISMATCH");
        const send = async (event: string, payload: any, identity: string) => {
          const raw = Buffer.from(
            JSON.stringify({ event, account_id: account, payload }),
          );
          return this.webhook(
            raw,
            createHmac("sha256", hook).update(raw).digest("hex"),
            identity,
          );
        };
        if (
          (payment.amount_refunded ?? 0) > 0 ||
          payment.status === "refunded"
        ) {
          const refundsResponse = await fetcher(
            "https://api.razorpay.com/v1/payments/" +
              encodeURIComponent(payment.id) +
              "/refunds?count=100",
            {
              headers: {
                Authorization:
                  "Basic " + Buffer.from(key + ":" + secret).toString("base64"),
              },
              signal: AbortSignal.timeout(10000),
            },
          );
          if (!refundsResponse.ok) throw Error("RECONCILIATION_UNAVAILABLE");
          const refunds: any = await refundsResponse.json();
          if (!Array.isArray(refunds.items))
            throw Error("RECONCILIATION_UNAVAILABLE");
          const processed = refunds.items.filter(
            (r: any) => r.status === "processed",
          );
          const sum = processed.reduce(
            (n: number, r: any) =>
              n + (Number.isSafeInteger(r.amount) ? r.amount : 0),
            0,
          );
          if (!sum || sum !== (payment.amount_refunded ?? payment.amount))
            throw Error("RECONCILIATION_INCOMPLETE");
          for (const refund of processed)
            await send(
              "refund.processed",
              { payment: { entity: payment }, refund: { entity: refund } },
              "reconcile-refund:" + refund.id,
            );
        } else {
          await send(
            "payment.captured",
            { payment: { entity: payment } },
            "reconcile:" + payment.id,
          );
          captured++;
        }
      }
      await transaction(actor, async (db) => {
        await db.query("SELECT set_config('app.club_id',$1,true)", [
          order.club_id,
        ]);
        await db.query(
          "UPDATE orders SET last_reconciled_at=clock_timestamp() WHERE id=$1",
          [order.id],
        );
      });
    }
    return { checked, captured };
  }
  async webhook(raw: Buffer, signature: string, eventId: string) {
    verifyWebhook(raw, signature, process.env.RAZORPAY_WEBHOOK_SECRET ?? "");
    if (!/^[a-zA-Z0-9_:-]{1,200}$/.test(eventId)) throw Error("INVALID_EVENT");
    const payload = JSON.parse(raw.toString());
    if (
      !process.env.RAZORPAY_ACCOUNT_ID ||
      payload.account_id !== process.env.RAZORPAY_ACCOUNT_ID
    )
      throw Error("MERCHANT_MISMATCH");
    if (!["payment.captured", "refund.processed"].includes(payload.event))
      return { ignored: true };
    const entity = payload.payload?.payment?.entity;
    if (!entity?.order_id) throw Error("INVALID_EVENT");
    const orderId = entity.order_id;
    return transaction("", async (db) => {
      const club = (await db.query("SELECT payment_scope($1) club", [orderId]))
        .rows[0]?.club;
      if (!club) throw Error("ORDER_MISMATCH");
      await db.query("SELECT set_config('app.club_id',$1,true)", [club]);
      const order = (
        await db.query(
          "SELECT * FROM orders WHERE provider_reference=$1 AND provider='RAZORPAY' FOR UPDATE",
          [orderId],
        )
      ).rows[0];
      if (
        entity.amount !== order.amount_minor ||
        entity.currency !== order.currency
      )
        throw Error("PAYMENT_MISMATCH");
      const hash = createHash("sha256").update(raw).digest("hex");
      const prior = await db.query(
        "SELECT payload_hash FROM provider_events WHERE provider='RAZORPAY' AND external_id=$1",
        [eventId],
      );
      if (prior.rowCount) {
        if (prior.rows[0].payload_hash !== hash) throw Error("EVENT_MISMATCH");
        return { duplicate: true };
      }
      await db.query(
        "INSERT INTO provider_events(provider,external_id,verified_at,processed_at,payload_hash) VALUES('RAZORPAY',$1,now(),now(),$2)",
        [eventId, hash],
      );
      if (payload.event === "payment.captured") {
        if (entity.status !== "captured") throw Error("PAYMENT_MISMATCH");
        if (order.status === "PAID") return { duplicate: true };
        if (["REFUNDED", "BILLING_EXCEPTION"].includes(order.status))
          return { ignored: true };
        if (order.status !== "PENDING") throw Error("ORDER_STATE_CONFLICT");
        const p = order.product_snapshot;
        await db.query(
          "INSERT INTO credit_grants(club_id,units,source,order_id,reason,expires_at) VALUES($1,$2,'PAYMENT',$3,'Verified Razorpay capture',CASE WHEN $4::int IS NULL THEN NULL ELSE now()+make_interval(days=>$4::int) END)",
          [club, p.units, order.id, p.validity_days],
        );
        await db.query(
          "UPDATE orders SET status='PAID',payment_id=$2 WHERE id=$1",
          [order.id, entity.id],
        );
      } else {
        const refund = payload.payload?.refund?.entity;
        if (
          !refund ||
          typeof refund.id !== "string" ||
          refund.payment_id !== entity.id ||
          !Number.isSafeInteger(refund.amount) ||
          refund.amount <= 0 ||
          refund.amount > order.amount_minor
        )
          throw Error("REFUND_MISMATCH");
        if (order.payment_id && order.payment_id !== refund.payment_id)
          throw Error("REFUND_MISMATCH");
        const duplicate = await db.query(
          "SELECT 1 FROM provider_refunds WHERE provider=$1 AND refund_id=$2",
          ["RAZORPAY", refund.id],
        );
        if (duplicate.rowCount) return { duplicate: true };
        const total =
          Number(
            (
              await db.query(
                "SELECT coalesce(sum(amount_minor),0) total FROM provider_refunds WHERE order_id=$1",
                [order.id],
              )
            ).rows[0].total,
          ) + refund.amount;
        if (total > order.amount_minor) throw Error("REFUND_MISMATCH");
        await db.query(
          "INSERT INTO provider_refunds VALUES('RAZORPAY',$1,$2,$3)",
          [refund.id, order.id, refund.amount],
        );
        const grants = (
          await db.query(
            "SELECT id FROM credit_grants WHERE order_id=$1 FOR UPDATE",
            [order.id],
          )
        ).rows;
        for (const g of grants)
          await db.query(
            "UPDATE credit_grants SET revoked_at=now() WHERE id=$1",
            [g.id],
          );
        const used = (
          await db.query(
            "SELECT 1 FROM credit_redemptions r JOIN credit_grants g ON r.grant_id=g.id WHERE g.order_id=$1 LIMIT 1",
            [order.id],
          )
        ).rowCount;
        await db.query("UPDATE orders SET status=$2 WHERE id=$1", [
          order.id,
          used || total < order.amount_minor ? "BILLING_EXCEPTION" : "REFUNDED",
        ]);
        if (used || total < order.amount_minor)
          await db.query(
            "INSERT INTO operations_alerts(club_id,kind,details) VALUES($1,'BILLING_EXCEPTION',$2)",
            [
              club,
              { orderId: order.id, refundedMinor: total, consumed: !!used },
            ],
          );
      }
      return { ok: true };
    });
  }
}
