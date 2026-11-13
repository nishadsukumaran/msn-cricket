import { test, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createHmac, randomUUID } from "node:crypto";
import { seed } from "../../../packages/testing/seed.ts";
import { pool } from "../../../packages/database/src/db.ts";
import { CommerceService } from "../src/commerce.ts";
after(() => pool.end());
test("duplicate verified capture grants once; forged or mismatched events grant nothing; manual grants need platform role", async () => {
  const f = await seed(),
    service = new CommerceService(),
    owner = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  try {
    const order = randomUUID(),
      reference = "order_" + randomUUID();
    await owner.query(
      "INSERT INTO orders(id,club_id,product_snapshot,amount_minor,currency,provider,provider_reference,status) VALUES($1,$2,$3,10000,'INR','RAZORPAY',$4,'PENDING')",
      [order, f.club, { units: 3, validity_days: 30 }, reference],
    );
    process.env.RAZORPAY_WEBHOOK_SECRET = "local-signature-test";
    process.env.RAZORPAY_ACCOUNT_ID = "acc_local";
    const payload = {
      account_id: "acc_local",
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_local",
            order_id: reference,
            amount: 10000,
            currency: "INR",
            status: "captured",
          },
        },
      },
    };
    const raw = Buffer.from(JSON.stringify(payload)),
      signature = createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(raw)
        .digest("hex");
    const id = "event_" + randomUUID();
    await assert.rejects(
      service.webhook(raw, "0".repeat(64), id),
      /INVALID_SIGNATURE/,
    );
    await service.webhook(raw, signature, id);
    await service.webhook(raw, signature, id);
    const grants = await owner.query(
      "SELECT * FROM credit_grants WHERE order_id=$1",
      [order],
    );
    assert.equal(grants.rowCount, 1);
    assert.equal(grants.rows[0].units, 3);
    const wrong = Buffer.from(
      JSON.stringify({
        ...payload,
        payload: {
          payment: {
            entity: { ...payload.payload.payment.entity, amount: 99 },
          },
        },
      }),
    );
    await assert.rejects(
      service.webhook(
        wrong,
        createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
          .update(wrong)
          .digest("hex"),
        "event_wrong",
      ),
      /PAYMENT_MISMATCH/,
    );
    await assert.rejects(
      service.manualGrant(f.admin, {
        clubId: f.club,
        units: 1,
        reason: "Requested",
      }),
      /FORBIDDEN/,
    );
    await owner.query("INSERT INTO platform_operators(user_id) VALUES($1)", [
      f.admin,
    ]);
    const grant = await service.manualGrant(f.admin, {
      clubId: f.club,
      units: 2,
      reason: "Authorized fixture grant",
    });
    assert.ok(grant.id);
  } finally {
    await owner.end();
  }
});
test("manual request approval is idempotent and partial refunds become exceptions without erasing consumed credits", async () => {
  const f = await seed(),
    owner = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  const { PlatformService } = await import("../src/platform.ts");
  const p = new PlatformService(),
    c = new CommerceService();
  try {
    await owner.query("INSERT INTO platform_operators(user_id) VALUES($1)", [
      f.admin,
    ]);
    const request = await p.requestCredit(f.admin, f.auction, {
      units: 2,
      reference: "Manual fixture",
    });
    const a = await p.reviewCredit(f.admin, {
      id: request.id,
      clubId: f.club,
      status: "APPROVED",
      reason: "Verified fixture",
    });
    const b = await p.reviewCredit(f.admin, {
      id: request.id,
      clubId: f.club,
      status: "APPROVED",
      reason: "Verified fixture",
    });
    assert.equal(a.id, b.id);
    const order = randomUUID(),
      ref = "order_" + randomUUID();
    await owner.query(
      "INSERT INTO orders(id,club_id,product_snapshot,amount_minor,currency,provider,provider_reference,status) VALUES($1,$2,$3,10000,'INR','RAZORPAY',$4,'PENDING')",
      [order, f.club, { units: 3, validity_days: 30 }, ref],
    );
    process.env.RAZORPAY_WEBHOOK_SECRET = "refund-fixture";
    process.env.RAZORPAY_ACCOUNT_ID = "acc_fixture";
    const payment = {
      id: "pay_" + randomUUID(),
      order_id: ref,
      amount: 10000,
      currency: "INR",
      status: "captured",
    };
    const send = async (event: string, extra: any, eventId: string) => {
      const raw = Buffer.from(
        JSON.stringify({
          account_id: "acc_fixture",
          event,
          payload: { payment: { entity: payment }, ...extra },
        }),
      );
      return c.webhook(
        raw,
        createHmac("sha256", "refund-fixture").update(raw).digest("hex"),
        eventId,
      );
    };
    await send("payment.captured", {}, "capture_" + randomUUID());
    const refund = {
      id: "rf_" + randomUUID(),
      payment_id: payment.id,
      amount: 3000,
    };
    await send(
      "refund.processed",
      { refund: { entity: refund } },
      "refund_" + randomUUID(),
    );
    await send(
      "refund.processed",
      { refund: { entity: refund } },
      "repeat_" + randomUUID(),
    );
    assert.equal(
      (await owner.query("SELECT status FROM orders WHERE id=$1", [order]))
        .rows[0].status,
      "BILLING_EXCEPTION",
    );
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::int n FROM provider_refunds WHERE order_id=$1",
          [order],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await owner.end();
  }
});
test("provider-status reconciliation binds the order and grants captured credits once", async () => {
  const f = await seed(),
    owner = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  try {
    await owner.query("INSERT INTO platform_operators(user_id) VALUES($1)", [
      f.admin,
    ]);
    const order = randomUUID(),
      ref = "order_" + randomUUID();
    await owner.query(
      "INSERT INTO orders(id,club_id,product_snapshot,amount_minor,currency,provider,provider_reference,status) VALUES($1,$2,$3,12345,'INR','RAZORPAY',$4,'PENDING')",
      [order, f.club, { units: 2 }, ref],
    );
    process.env.RAZORPAY_KEY_ID = "fixture";
    process.env.RAZORPAY_KEY_SECRET = "fixture";
    process.env.RAZORPAY_WEBHOOK_SECRET = "fixture";
    process.env.RAZORPAY_ACCOUNT_ID = "fixture";
    const c = new CommerceService();
    const fetcher = async (input: any) => {
      const orderRef = String(input).split("/").at(-2);
      const row = (
        await owner.query(
          "SELECT amount_minor,currency FROM orders WHERE provider_reference=$1",
          [orderRef],
        )
      ).rows[0];
      return new Response(
        JSON.stringify({
          items:
            row && orderRef === ref
              ? [
                  {
                    id: "pay_" + orderRef,
                    order_id: orderRef,
                    amount: row.amount_minor,
                    currency: row.currency,
                    status: "captured",
                  },
                ]
              : [],
        }),
      );
    };
    await c.reconcile(f.admin, fetcher as any);
    await c.reconcile(f.admin, fetcher as any);
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::int n FROM credit_grants WHERE order_id=$1",
          [order],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await owner.end();
  }
});
test("reconciliation never grants a partially refunded capture whose callbacks were missed", async () => {
  const f = await seed(),
    owner = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  try {
    await owner.query("INSERT INTO platform_operators(user_id) VALUES($1)", [
      f.admin,
    ]);
    const order = randomUUID(),
      ref = "order_" + randomUUID(),
      paymentId = "pay_" + randomUUID();
    await owner.query(
      "INSERT INTO orders(id,club_id,product_snapshot,amount_minor,currency,provider,provider_reference,status) VALUES($1,$2,$3,10000,'INR','RAZORPAY',$4,'PENDING')",
      [order, f.club, { units: 2 }, ref],
    );
    process.env.RAZORPAY_KEY_ID = "fixture";
    process.env.RAZORPAY_KEY_SECRET = "fixture";
    process.env.RAZORPAY_WEBHOOK_SECRET = "fixture";
    process.env.RAZORPAY_ACCOUNT_ID = "fixture";
    const fetcher = async (input: any) =>
      String(input).includes("/payments/" + paymentId + "/refunds")
        ? new Response(
            JSON.stringify({
              items: [
                {
                  id: "rf_fixture_" + order,
                  payment_id: paymentId,
                  amount: 4000,
                  status: "processed",
                },
              ],
            }),
          )
        : new Response(
            JSON.stringify({
              items: String(input).includes(ref)
                ? [
                    {
                      id: paymentId,
                      order_id: ref,
                      amount: 10000,
                      currency: "INR",
                      status: "captured",
                      amount_refunded: 4000,
                      refund_status: "partial",
                    },
                  ]
                : [],
            }),
          );
    await new CommerceService().reconcile(f.admin, fetcher as any);
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::int n FROM credit_grants WHERE order_id=$1",
          [order],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (await owner.query("SELECT status FROM orders WHERE id=$1", [order]))
        .rows[0].status,
      "BILLING_EXCEPTION",
    );
  } finally {
    await owner.end();
  }
});
test("reconciliation rotates beyond an initial batch of one hundred unpaid orders", async () => {
  const f = await seed(),
    owner = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  try {
    await owner.query("INSERT INTO platform_operators(user_id) VALUES($1)", [
      f.admin,
    ]);
    const created = (
      await owner.query(
        "INSERT INTO orders(club_id,product_snapshot,amount_minor,currency,provider,provider_reference,status) SELECT $1,'{\"units\":1}'::jsonb,1000,'INR','RAZORPAY','rotation_'||gen_random_uuid(),'PENDING' FROM generate_series(1,105) RETURNING id",
        [f.club],
      )
    ).rows;
    process.env.RAZORPAY_KEY_ID = "fixture";
    process.env.RAZORPAY_KEY_SECRET = "fixture";
    process.env.RAZORPAY_WEBHOOK_SECRET = "fixture";
    process.env.RAZORPAY_ACCOUNT_ID = "fixture";
    for (let i = 0; i < 6; i++)
      await new CommerceService().reconcile(
        f.admin,
        (async () => new Response(JSON.stringify({ items: [] }))) as any,
      );
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::int n FROM orders WHERE id=ANY($1::uuid[]) AND last_reconciled_at IS NOT NULL",
          [created.map((r) => r.id)],
        )
      ).rows[0].n,
      105,
    );
  } finally {
    await owner.end();
  }
});
