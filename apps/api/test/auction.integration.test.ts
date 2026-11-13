import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../../../packages/database/src/db.ts";
import { seed } from "../../../packages/testing/seed.ts";
import { AuctionService } from "../src/service.ts";
const service = new AuctionService();
let f: any;
const cmd = (type: string, extra: any = {}) => ({
  commandId: randomUUID(),
  type,
  ...extra,
});
before(async () => {
  f = await seed();
});
after(async () => {
  await pool.end();
});
test("persistent rehearsal: authorization, approvals, lock, credit, concurrency, settlement, reversal and recovery", async () => {
  await assert.rejects(service.snapshot(f.outsider, f.auction), /FORBIDDEN/);
  await assert.rejects(
    service.command(f.managerA, f.auction, cmd("START")),
    /FORBIDDEN/,
  );
  const initial = await service.snapshot(f.admin, f.auction);
  assert.equal(initial.teams.length, 2);
  await service.command(f.admin, f.auction, cmd("LOCK"));
  const start = cmd("START");
  const [s1, s2] = await Promise.all([
    service.command(f.admin, f.auction, start),
    service.command(f.admin, f.auction, start),
  ]);
  assert.deepEqual(s1, s2);
  const picked = await service.command(
    f.admin,
    f.auction,
    cmd("SELECT", { registrationId: f.players[0] }),
  );
  await service.command(
    f.admin,
    f.auction,
    cmd("OPEN", { lotId: picked.lotId, expectedVersion: 1 }),
  );
  const a = cmd("BID", {
    lotId: picked.lotId,
    expectedVersion: 2,
    amount: 300,
  });
  const b = cmd("BID", {
    lotId: picked.lotId,
    expectedVersion: 2,
    amount: 300,
  });
  const bids = await Promise.allSettled([
    service.command(f.managerA, f.auction, a),
    service.command(f.managerB, f.auction, b),
  ]);
  assert.equal(bids.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(
    (bids.find((r) => r.status === "rejected") as PromiseRejectedResult).reason
      .message,
    /STALE_VERSION/,
  );
  const winner = bids[0].status === "fulfilled" ? f.managerA : f.managerB;
  const winningCommand = bids[0].status === "fulfilled" ? a : b;
  const duplicate = await service.command(winner, f.auction, winningCommand);
  assert.equal(duplicate.sequence, 5);
  await assert.rejects(
    service.command(winner, f.auction, { ...winningCommand, amount: 400 }),
    /IDEMPOTENCY_CONFLICT/,
  );
  await service.command(
    f.admin,
    f.auction,
    cmd("CLOSE", { lotId: picked.lotId, expectedVersion: 3 }),
  );
  await assert.rejects(
    service.command(
      winner,
      f.auction,
      cmd("BID", { lotId: picked.lotId, expectedVersion: 4, amount: 400 }),
    ),
    /LOT_NOT_OPEN/,
  );
  const sell = cmd("SELL", { lotId: picked.lotId, expectedVersion: 4 });
  const sold = await service.command(f.admin, f.auction, sell);
  assert.deepEqual(await service.command(f.admin, f.auction, sell), sold);
  const snap = await service.snapshot(winner, f.auction);
  assert.equal(
    snap.teams.find((t: any) => t.id === snap.myTeamId).remainingPurse,
    9700,
  );
  assert.equal(snap.allocations.length, 1);
  const csv = await service.report(f.admin, f.auction, "bids");
  assert.match(csv, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} IST/);
  assert.ok(!csv.includes("GMT"));
  assert.equal((await service.events(winner, f.auction, 0)).length, 7);
  const publicSnap = await service.publicSnapshot(f.auction);
  assert.ok(!JSON.stringify(publicSnap).includes("555-0100"));
  assert.ok(!JSON.stringify(publicSnap).includes("@"));
  await assert.rejects(
    service.command(
      f.admin,
      f.auction,
      cmd("REVERSE", {
        allocationId: snap.allocations[0].id,
        reason: "Wrong player",
      }),
    ),
    /PAUSE_REQUIRED/,
  );
  await service.command(f.admin, f.auction, cmd("PAUSE"));
  await service.command(
    f.admin,
    f.auction,
    cmd("REVERSE", {
      allocationId: snap.allocations[0].id,
      reason: "Wrong player",
    }),
  );
  const corrected = await service.snapshot(winner, f.auction);
  assert.equal(
    corrected.teams.find((t: any) => t.id === snap.myTeamId).remainingPurse,
    10000,
  );
  assert.equal(corrected.allocations.length, 0);
  assert.equal(
    corrected.lots.find((l: any) => l.id === picked.lotId).status,
    "REVERSED",
  );
  assert.equal(
    (await service.publicSnapshot(f.auction)).lots.find(
      (l: any) => l.id === picked.lotId,
    ).status,
    "REVERSED",
  );
  await service.command(f.admin, f.auction, cmd("RESUME"));
  const recalled = await service.command(
    f.admin,
    f.auction,
    cmd("RECALL", { registrationId: f.players[0] }),
  );
  assert.notEqual(recalled.lotId, picked.lotId);
  await service.command(
    f.admin,
    f.auction,
    cmd("OPEN", { lotId: recalled.lotId, expectedVersion: 1 }),
  );
  await service.command(
    winner,
    f.auction,
    cmd("BID", { lotId: recalled.lotId, expectedVersion: 2, amount: 300 }),
  );
  await service.command(
    f.admin,
    f.auction,
    cmd("CLOSE", { lotId: recalled.lotId, expectedVersion: 3 }),
  );
  await service.command(
    f.admin,
    f.auction,
    cmd("SELL", { lotId: recalled.lotId, expectedVersion: 4 }),
  );
  assert.equal(
    (await service.snapshot(winner, f.auction)).allocations.length,
    1,
  );
  assert.equal((await service.reconcile(f.admin, f.auction)).balanced, true);
});
test("last-credit race across two auctions consumes exactly once", async () => {
  const x = await seed();
  await service.command(x.admin, x.auction, cmd("LOCK"));
  await service.command(x.admin, x.secondAuction, cmd("LOCK"));
  const results = await Promise.allSettled([
    service.command(x.admin, x.auction, cmd("START")),
    service.command(x.admin, x.secondAuction, cmd("START")),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(
    (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
      .reason.message,
    /CREDIT_REQUIRED/,
  );
});
test("fifty competing bids and a concurrent close serialize to one authoritative result", async () => {
  const x = await seed();
  await service.command(x.admin, x.auction, cmd("LOCK"));
  await service.command(x.admin, x.auction, cmd("START"));
  const lot = await service.command(
    x.admin,
    x.auction,
    cmd("SELECT", { registrationId: x.players[0] }),
  );
  await service.command(
    x.admin,
    x.auction,
    cmd("OPEN", { lotId: lot.lotId, expectedVersion: 1 }),
  );
  const bidResults = await Promise.allSettled(
    Array.from({ length: 50 }, (_, i) =>
      service.command(
        i % 2 ? x.managerA : x.managerB,
        x.auction,
        cmd("BID", { lotId: lot.lotId, expectedVersion: 2, amount: 300 }),
      ),
    ),
  );
  assert.equal(bidResults.filter((r) => r.status === "fulfilled").length, 1);
  const snap = await service.snapshot(x.admin, x.auction);
  const leading = snap.lots.find((l: any) => l.id === lot.lotId);
  const losingActor =
    leading.leadingTeamId ===
    (await service.snapshot(x.managerA, x.auction)).myTeamId
      ? x.managerB
      : x.managerA;
  const race = await Promise.allSettled([
    service.command(
      x.admin,
      x.auction,
      cmd("CLOSE", { lotId: lot.lotId, expectedVersion: 3 }),
    ),
    service.command(
      losingActor,
      x.auction,
      cmd("BID", { lotId: lot.lotId, expectedVersion: 3, amount: 400 }),
    ),
  ]);
  assert.equal(race.filter((r) => r.status === "fulfilled").length, 1);
});
test("normal random selection never silently recalls previously unsold players", async () => {
  const f = await seed();
  await service.command(f.admin, f.auction, cmd("LOCK"));
  await service.command(f.admin, f.auction, cmd("START"));
  for (let i = 0; i < f.players.length; i++) {
    const lot = await service.command(f.admin, f.auction, cmd("RANDOM"));
    await service.command(
      f.admin,
      f.auction,
      cmd("OPEN", { lotId: lot.lotId, expectedVersion: 1 }),
    );
    await service.command(
      f.admin,
      f.auction,
      cmd("CLOSE", { lotId: lot.lotId, expectedVersion: 2 }),
    );
    await service.command(
      f.admin,
      f.auction,
      cmd("UNSOLD", { lotId: lot.lotId, expectedVersion: 3 }),
    );
  }
  await assert.rejects(
    service.command(f.admin, f.auction, cmd("RANDOM")),
    /EMPTY_POOL/,
  );
  const recalled = await service.command(
    f.admin,
    f.auction,
    cmd("RECALL", { registrationId: f.players[0] }),
  );
  assert.ok(recalled.lotId);
});
