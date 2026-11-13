import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import pg from "pg";
if (process.env.NODE_ENV === "production")
  throw Error("LOCAL_RESTORE_TEST_ONLY");
const container = "msn-cricket-postgres-1";
const restoreDB = "msn_restore_" + randomBytes(5).toString("hex");
function docker(args: string[], input?: Buffer) {
  const r = spawnSync("docker", ["exec", "-i", container, ...args], {
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw Error(r.stderr.toString());
  return r.stdout;
}
const source = new pg.Client({ connectionString: process.env.DATABASE_URL });
await source.connect();
const address = new URL(process.env.DATABASE_URL!);
address.pathname = "/" + restoreDB;
const target = new pg.Client({ connectionString: address.toString() });
let created = false;
let connected = false;
try {
  await source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const snapshot = (await source.query("SELECT pg_export_snapshot() snapshot"))
    .rows[0].snapshot;
  const backup = docker([
    "pg_dump",
    "-U",
    "msn_owner",
    "-d",
    "msn_cricket",
    "-Fc",
    "--snapshot=" + snapshot,
  ]);
  await writeFile("artifacts/restore-check.dump", backup, { mode: 0o600 });
  docker(["createdb", "-U", "msn_owner", restoreDB]);
  created = true;
  docker(
    ["pg_restore", "-U", "msn_owner", "-d", restoreDB, "--exit-on-error"],
    backup,
  );
  await target.connect();
  connected = true;
  const counts: Record<string, number> = {};
  for (const table of [
    "bids",
    "allocations",
    "purse_ledger",
    "auction_events",
    "credit_redemptions",
  ]) {
    const before = (await source.query(`SELECT count(*)::int n FROM ${table}`))
      .rows[0].n;
    const after = (await target.query(`SELECT count(*)::int n FROM ${table}`))
      .rows[0].n;
    if (before !== after) throw Error("RESTORE_COUNT_MISMATCH:" + table);
    counts[table] = after;
  }
  const broken = (
    await target.query(
      "SELECT t.id FROM teams t WHERE remaining_purse<>initial_purse+coalesce((SELECT sum(delta) FROM purse_ledger l WHERE l.team_id=t.id),0) OR remaining_purse<>initial_purse-coalesce((SELECT sum(price) FROM allocations a WHERE a.team_id=t.id AND a.status='ACTIVE'),0)",
    )
  ).rowCount;
  if (broken) throw Error("RESTORE_LEDGER_MISMATCH");
  await writeFile(
    "artifacts/restore-result.json",
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        counts,
        ledgerBalanced: true,
        isolatedDatabase: restoreDB,
      },
      null,
      2,
    ),
  );
  console.log(
    "Backup restored to isolated database; accounting and event counts match.",
    JSON.stringify(counts),
  );
} finally {
  if (connected) await target.end();
  await source.query("ROLLBACK");
  await source.end();
  if (created) docker(["dropdb", "-U", "msn_owner", restoreDB]);
}
