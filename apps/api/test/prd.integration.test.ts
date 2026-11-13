import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, transaction } from "../../../packages/database/src/db.ts";
import { seed } from "../../../packages/testing/seed.ts";
import { AuctionService } from "../src/service.ts";
import { AdministrationService } from "../src/admin.ts";
import { ProfilesService } from "../src/profiles.ts";
const admin = new AdministrationService(),
  profiles = new ProfilesService(),
  auction = new AuctionService();
after(() => pool.end());
const command = (type: string, extra: any = {}) => ({
  type,
  commandId: randomUUID(),
  ...extra,
});
test("owners manage staff; cross-club and administrator escalation are rejected", async () => {
  const f = await seed(),
    other = await seed();
  await assert.rejects(
    admin.staff(f.managerA, f.auction, {
      userId: f.outsider,
      role: "ADMIN",
      reason: "Club staff",
    }),
    /FORBIDDEN/,
  );
  await admin.staff(f.admin, f.auction, {
    userId: f.outsider,
    role: "ADMIN",
    reason: "Club staff",
  });
  assert.ok(
    (await auction.snapshot(f.outsider, f.auction)).roles.includes("ADMIN"),
  );
  await assert.rejects(
    admin.staff(f.outsider, f.auction, {
      userId: f.managerA,
      role: "ADMIN",
      reason: "Escalation",
    }),
    /FORBIDDEN/,
  );
  await assert.rejects(admin.directory(f.admin, other.auction), /FORBIDDEN/);
  await admin.staff(f.admin, f.auction, {
    userId: f.outsider,
    role: "ADMIN",
    revoke: true,
    reason: "Staff changed",
  });
  assert.ok(
    !(await auction.snapshot(f.outsider, f.auction)).roles.includes("ADMIN"),
  );
});
test("display credentials are scoped, private, expiring, rotated and revocable", async () => {
  const f = await seed();
  await transaction(f.admin, async (db) => {
    await db.query("SELECT set_config('app.club_id',$1,true)", [f.club]);
    await db.query("UPDATE auctions SET public_visible=false WHERE id=$1", [
      f.auction,
    ]);
  });
  const first = await admin.display(f.admin, f.auction);
  await assert.rejects(auction.publicSnapshot(f.auction), /NOT_FOUND/);
  const snapshot = await admin.projection(first.token);
  assert.equal(snapshot.id, f.auction);
  assert.ok(!JSON.stringify(snapshot).includes("@"));
  assert.ok(!JSON.stringify(snapshot).includes("555-0100"));
  const next = await admin.display(f.admin, f.auction);
  await assert.rejects(admin.projection(first.token), /NOT_FOUND/);
  await admin.revokeDisplay(f.admin, f.auction);
  await assert.rejects(admin.projection(next.token), /NOT_FOUND/);
  await assert.rejects(admin.display(f.managerA, f.auction), /FORBIDDEN/);
});
test("handover is explicit and paused; old operator loses bidding authority", async () => {
  const f = await seed();
  const team = (await auction.snapshot(f.managerA, f.auction)).myTeamId;
  await transaction(f.admin, async (db) => {
    await db.query("SELECT set_config('app.club_id',$1,true)", [f.club]);
    await db.query(
      "INSERT INTO memberships VALUES($1,$2,'MEMBER') ON CONFLICT DO NOTHING",
      [f.club, f.outsider],
    );
    await db.query(
      "INSERT INTO manager_applications(club_id,auction_id,user_id,team_id,status) VALUES($1,$2,$3,$4,'APPROVED')",
      [f.club, f.auction, f.outsider, team],
    );
  });
  await auction.command(f.admin, f.auction, command("LOCK"));
  await auction.command(f.admin, f.auction, command("START"));
  await assert.rejects(
    admin.handover(f.admin, f.auction, {
      teamId: team,
      userId: f.outsider,
      reason: "Replacement",
    }),
    /PAUSE_REQUIRED/,
  );
  await auction.command(f.admin, f.auction, command("PAUSE"));
  await admin.handover(f.admin, f.auction, {
    teamId: team,
    userId: f.outsider,
    reason: "Replacement",
  });
  assert.equal((await auction.snapshot(f.managerA, f.auction)).myTeamId, null);
  assert.equal((await auction.snapshot(f.outsider, f.auction)).myTeamId, team);
  await assert.rejects(
    auction.command(f.managerA, f.auction, command("BID")),
    /NOT_OPERATOR/,
  );
});
test("reusable profiles preserve historical registrations and withdrawal blocks selection", async () => {
  const f = await seed();
  const value = {
    name: "Profile Player",
    birthDate: "1994-02-03",
    phone: "555-0133",
    location: "Kochi",
    role: "BATTER",
    battingStyle: "Right hand",
    bowlingStyle: "Not applicable",
  };
  await profiles.save(f.managerA, value);
  const profile = await profiles.get(f.managerA);
  assert.equal(profile.name, value.name);
  const { PreparationService } = await import("../src/preparation.ts");
  const preparation = new PreparationService();
  const registration = await preparation.register(f.managerA, f.auction, {
    ...value,
    displayConsent: true,
  });
  await profiles.save(f.managerA, { ...value, name: "Updated Source" });
  const snapshot = await auction.snapshot(f.admin, f.auction);
  assert.equal(
    snapshot.players.find((r: any) => r.id === registration.id).name,
    value.name,
  );
  await profiles.withdraw(f.managerA, f.auction);
  assert.equal(
    (await preparation.myRegistration(f.managerA, f.auction)).players[0].status,
    "WITHDRAWN",
  );
  await assert.rejects(
    profiles.withdraw(f.outsider, f.auction),
    /FORBIDDEN|NOT_FOUND/,
  );
});
test("pre-lock rule changes reset purse and require reapproval, while invalid schedule/capacity are rejected", async () => {
  const f = await seed();
  const { PreparationService } = await import("../src/preparation.ts");
  const p = new PreparationService();
  const snapshot = await auction.snapshot(f.admin, f.auction);
  await p.configure(f.admin, f.auction, {
    rules: { ...snapshot.rules, purse: 12000 },
  });
  const changed = await auction.snapshot(f.admin, f.auction);
  assert.equal(changed.teams[0].remainingPurse, 12000);
  assert.ok(changed.players.every((p: any) => p.status === "PENDING"));
  await assert.rejects(
    p.configure(f.admin, f.auction, {
      scheduledAt: "2026-11-15T10:00:00+05:30",
      registrationDeadline: "2026-11-16T10:00:00+05:30",
    }),
    /INVALID_SCHEDULE/,
  );
});
test("platform support is time-limited and audited; suspension pauses rather than destroys an auction", async () => {
  const f = await seed(),
    other = await seed();
  const pg = await import("pg");
  const db = new pg.default.Client({
    connectionString: process.env.DATABASE_URL,
  });
  await db.connect();
  try {
    await db.query("INSERT INTO platform_operators(user_id) VALUES($1)", [
      other.admin,
    ]);
    const { PlatformService } = await import("../src/platform.ts");
    const p = new PlatformService();
    await assert.rejects(auction.snapshot(other.admin, f.auction), /FORBIDDEN/);
    const access = await p.support(other.admin, {
      clubId: f.club,
      reason: "Investigate registration",
      minutes: 1,
    });
    assert.ok(
      (await auction.snapshot(other.admin, f.auction)).roles.includes(
        "SUPPORT",
      ),
    );
    await profiles.review(other.admin, f.auction, f.players[0]);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM audit_log WHERE club_id=$1 AND actor_id=$2 AND action='SUPPORT_PRIVATE_READ'",
          [f.club, other.admin],
        )
      ).rows[0].n,
      1,
    );
    await db.query(
      "UPDATE support_access SET expires_at=now()-interval '1 second' WHERE id=$1",
      [access.id],
    );
    await assert.rejects(auction.snapshot(other.admin, f.auction), /FORBIDDEN/);
    await auction.command(f.admin, f.auction, command("LOCK"));
    await auction.command(f.admin, f.auction, command("START"));
    await p.suspend(other.admin, {
      clubId: f.club,
      suspended: true,
      reason: "Club safety review",
    });
    assert.equal((await auction.snapshot(f.admin, f.auction)).status, "PAUSED");
    await assert.rejects(
      auction.command(f.admin, f.auction, command("RESUME")),
      /CLUB_SUSPENDED/,
    );
    await p.suspend(other.admin, {
      clubId: f.club,
      suspended: false,
      reason: "Review resolved",
    });
    await auction.command(f.admin, f.auction, command("RESUME"));
  } finally {
    await db.end();
  }
});
test("a separate fictional rehearsal starts without consuming a real credit and cannot be converted", async () => {
  const f = await seed();
  const clone = await admin.rehearse(f.admin, f.auction);
  const practice = await auction.snapshot(f.admin, clone.id);
  assert.equal(practice.rehearsal, true);
  assert.ok(
    practice.players.every((p: any) => p.name.startsWith("Sample Player")),
  );
  const credits = practice.credits;
  await auction.command(f.admin, clone.id, command("LOCK"));
  await auction.command(f.admin, clone.id, command("START"));
  assert.equal((await auction.snapshot(f.admin, clone.id)).credits, credits);
  const { PreparationService } = await import("../src/preparation.ts");
  await assert.rejects(
    new PreparationService().configure(f.admin, clone.id, { rehearsal: false }),
    /Unrecognized|unrecognized/,
  );
});
test("ownership transfer preserves an owner and removes the previous owner grant authority", async () => {
  const f = await seed();
  await assert.rejects(
    admin.transfer(f.admin, f.auction, {
      userId: f.outsider,
      reason: "Invalid transfer",
    }),
    /UNAPPROVED/,
  );
  await admin.transfer(f.admin, f.auction, {
    userId: f.managerA,
    reason: "Organizer handover",
  });
  assert.ok(
    (await auction.snapshot(f.managerA, f.auction)).roles.includes("OWNER"),
  );
  assert.ok(
    !(await auction.snapshot(f.admin, f.auction)).roles.includes("OWNER"),
  );
  await assert.rejects(
    admin.staff(f.admin, f.auction, {
      userId: f.outsider,
      role: "ADMIN",
      reason: "Old owner",
    }),
    /FORBIDDEN/,
  );
});
