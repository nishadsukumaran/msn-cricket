import { test, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { seed } from "../../../packages/testing/seed.ts";
import { pool } from "../../../packages/database/src/db.ts";
import { PlatformService } from "../src/platform.ts";
import { runMaintenance } from "../src/jobs.ts";
after(() => pool.end());
test("catalog and operating console require platform authority; cleanup preserves referenced images", async () => {
  const f = await seed(),
    p = new PlatformService(),
    owner = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  try {
    await assert.rejects(
      p.product(f.admin, {
        sku: "TEST",
        units: 1,
        amountMinor: 100,
        currency: "INR",
      }),
      /FORBIDDEN/,
    );
    await owner.query("INSERT INTO platform_operators(user_id) VALUES($1)", [
      f.admin,
    ]);
    await p.product(f.admin, {
      sku: "TEST",
      units: 1,
      amountMinor: 100,
      currency: "INR",
    });
    assert.ok((await p.console(f.admin)).clubs.length);
    const key =
      "profiles/" + f.managerA + "/00000000-0000-4000-a000-000000000000.webp";
    await owner.query(
      "INSERT INTO image_objects(key,owner_id,created_at) VALUES($1,$2,now()-interval '10 days')",
      [key, f.managerA],
    );
    await owner.query(
      "INSERT INTO player_profiles(user_id,name,phone,location,role,batting_style,bowling_style,photo_key) VALUES($1,'Referenced','555-0100','Kochi','BATTER','Right hand','None',$2)",
      [f.managerA, key],
    );
    const deleted: string[] = [];
    const result = await runMaintenance({
      orphanImageDays: 7,
      sessionRetentionDays: 1,
      deleteObject: async (k: string) => {
        deleted.push(k);
      },
    });
    assert.ok(result);
    assert.ok(!deleted.includes(key));
  } finally {
    await owner.end();
  }
});
test("privacy deletion anonymizes completed history, preserves accounting and removes active sessions", async () => {
  const f = await seed();
  const { ProfilesService } = await import("../src/profiles.ts");
  const { PreparationService } = await import("../src/preparation.ts");
  const profiles = new ProfilesService(),
    p = new PreparationService();
  await profiles.save(f.managerA, {
    name: "Delete Me",
    birthDate: "1990-01-01",
    phone: "555-0188",
    location: "Kochi",
    role: "BATTER",
    battingStyle: "Right hand",
    bowlingStyle: "None",
  });
  await p.register(f.managerA, f.auction, {
    name: "Delete Me",
    birthDate: "1990-01-01",
    phone: "555-0188",
    location: "Kochi",
    role: "BATTER",
    battingStyle: "Right hand",
    bowlingStyle: "None",
    displayConsent: true,
  });
  await profiles.erase(f.managerA);
  const own = await profiles.get(f.managerA);
  assert.equal(own.name, "Deleted player");
  assert.equal(own.phone, "Removed");
});
test("a failed purge never makes an already deleted image attachable again", async () => {
  const f = await seed(),
    owner = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await owner.connect();
  const first = `profiles/${f.managerA}/10000000-0000-4000-a000-000000000000.webp`,
    second = `profiles/${f.managerA}/20000000-0000-4000-a000-000000000000.webp`;
  try {
    for (const key of [first, second])
      await owner.query(
        "INSERT INTO image_objects(key,owner_id,created_at) VALUES($1,$2,now()-interval '30 days')",
        [key, f.managerA],
      );
    try {
      await runMaintenance({
        orphanImageDays: 7,
        sessionRetentionDays: 1,
        deleteObject: async (key) => {
          if (key === second) throw Error("S3_UNAVAILABLE");
        },
      });
    } catch {
      /* A recorded failed job is acceptable; tombstones must survive. */
    }
    assert.ok(
      (
        await owner.query("SELECT deleted_at FROM image_objects WHERE key=$1", [
          first,
        ])
      ).rows[0].deleted_at,
    );
    const { ProfilesService } = await import("../src/profiles.ts");
    await assert.rejects(
      new ProfilesService().save(f.managerA, {
        name: "Race Test",
        birthDate: "1990-01-01",
        phone: "555-0101",
        location: "Kochi",
        role: "BATTER",
        battingStyle: "Right hand",
        bowlingStyle: "None",
        photoKey: first,
      }),
      /INVALID_IMAGE/,
    );
  } finally {
    await owner.end();
  }
});
