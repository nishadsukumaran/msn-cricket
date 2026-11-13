import pg from "pg";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
if (
  !["127.0.0.1", "localhost"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  )
)
  throw Error("LOCAL_CHECK_ONLY");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const name = "msn_fresh_" + randomBytes(5).toString("hex");
await db.query("CREATE DATABASE " + name);
const url = new URL(process.env.DATABASE_URL!);
url.pathname = "/" + name;
try {
  const run = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/migrate.ts"],
    { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8" },
  );
  await writeFile("artifacts/fresh-migration.log", run.stdout + run.stderr);
  if (run.status !== 0) throw Error("FRESH_MIGRATION_FAILED: " + run.stderr);
  const target = new pg.Client({ connectionString: url.toString() });
  await target.connect();
  try {
    const count = (
      await target.query("SELECT count(*)::int n FROM schema_migrations")
    ).rows[0].n;
    console.log("Fresh database migration verified:", count, "migrations");
  } finally {
    await target.end();
  }
} finally {
  await db.query("DROP DATABASE " + name);
  await db.end();
}
