import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../../packages/database/src/db.ts";
import { seed } from "../../../packages/testing/seed.ts";
import { PreparationService } from "../src/preparation.ts";
import { AuctionService } from "../src/service.ts";
import { randomUUID } from "node:crypto";
const p = new PreparationService(),
  a = new AuctionService();
after(() => pool.end());
test("registrations retain pending state until admin approval, lock freezes edits and outsider cannot review", async () => {
  const f = await seed();
  const registration = await p.register(f.managerA, f.auction, {
    name: "Test Player",
    birthDate: "1995-01-01",
    phone: "555-0123",
    location: "Kochi",
    role: "BATTER",
    battingStyle: "Right hand",
    bowlingStyle: "Not applicable",
    displayConsent: true,
  });
  assert.equal(registration.status, "PENDING");
  await assert.rejects(
    a.command(f.admin, f.auction, { commandId: randomUUID(), type: "LOCK" }),
    /REVIEWS_PENDING/,
  );
  await assert.rejects(
    p.review(f.outsider, f.auction, {
      kind: "PLAYER",
      id: registration.id,
      status: "APPROVED",
    }),
    /FORBIDDEN/,
  );
  await p.review(f.admin, f.auction, {
    kind: "PLAYER",
    id: registration.id,
    status: "APPROVED",
  });
  const snap = await a.snapshot(f.admin, f.auction);
  assert.equal(
    snap.players.find((x: any) => x.id === registration.id).base,
    300,
  );
  await a.command(f.admin, f.auction, {
    commandId: randomUUID(),
    type: "LOCK",
  });
  await assert.rejects(
    p.configure(f.admin, f.auction, {
      rules: { ...snap.rules, increment: 200 },
    }),
    /ROSTER_LOCKED/,
  );
});
test("database runtime is not owner, defaults to no tenant rows and cannot read other users profiles", async () => {
  await seed();
  const db = await pool.connect();
  try {
    const role = await db.query("SELECT current_user");
    assert.equal(role.rows[0].current_user, "msn_runtime");
    assert.equal((await db.query("SELECT * FROM auctions")).rowCount, 0);
    assert.equal((await db.query("SELECT * FROM player_profiles")).rowCount, 0);
    await assert.rejects(
      db.query("SELECT * FROM sessions"),
      /permission denied/,
    );
  } finally {
    db.release();
  }
});
test("requested changes can be resubmitted; approved registration cannot be silently edited", async () => {
  const f = await seed();
  const input = {
    name: "Original Player",
    birthDate: "1995-01-01",
    phone: "555-0123",
    location: "Kochi",
    role: "BATTER",
    battingStyle: "Right hand",
    bowlingStyle: "Not applicable",
    displayConsent: true,
  };
  const registration = await p.register(f.managerA, f.auction, input);
  await p.review(f.admin, f.auction, {
    kind: "PLAYER",
    id: registration.id,
    status: "CHANGES_REQUESTED",
    reason: "Correct your name",
  });
  const revised = await p.register(f.managerA, f.auction, {
    ...input,
    name: "Corrected Player",
  });
  assert.equal(revised.id, registration.id);
  assert.equal(revised.status, "PENDING");
  await p.review(f.admin, f.auction, {
    kind: "PLAYER",
    id: registration.id,
    status: "APPROVED",
  });
  await assert.rejects(
    p.register(f.managerA, f.auction, input),
    /ALREADY_REGISTERED/,
  );
});
test("invited manager must match verified email, await approval, and loses access after revocation", async () => {
  const f = await seed();
  const invite = await p.invite(f.admin, f.auction, {
    email: "outsider@example.invalid",
    teamId: (await a.snapshot(f.admin, f.auction)).teams[0].id,
  });
  await assert.rejects(
    p.acceptInvite(f.managerA, invite.token),
    /INVALID_INVITE/,
  );
  const application = await p.acceptInvite(f.outsider, invite.token);
  assert.equal(application.status, "PENDING");
  await assert.rejects(
    a.command(f.outsider, f.auction, { commandId: randomUUID(), type: "BID" }),
    /NOT_OPERATOR/,
  );
  await p.review(f.admin, f.auction, {
    kind: "MANAGER",
    id: application.id,
    status: "APPROVED",
  });
  assert.ok((await a.snapshot(f.outsider, f.auction)).myTeamId);
  await p.review(f.admin, f.auction, {
    kind: "MANAGER",
    id: application.id,
    status: "REJECTED",
    reason: "Revoked for fixture",
  });
  assert.equal((await a.snapshot(f.outsider, f.auction)).myTeamId, null);
});
