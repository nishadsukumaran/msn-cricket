import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
if (!process.env.DATABASE_URL || !process.env.RUNTIME_PASSWORD)
  throw Error("DATABASE_URL and RUNTIME_PASSWORD required");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("SELECT pg_advisory_lock(811218)");
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of (await readdir("packages/database/migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (
      (await db.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name]))
        .rowCount
    )
      continue;
    const sql = await readFile("packages/database/migrations/" + name, "utf8");
    await db.query(
      sql.replace(/COMMIT;\s*$/, "") +
        `\nINSERT INTO schema_migrations(name) VALUES('${name}'); COMMIT;`,
    );
    console.log("Applied", name);
  }
  if (!process.env.WORKER_PASSWORD) throw Error("WORKER_PASSWORD required");
  const workerPassword = process.env.WORKER_PASSWORD.replaceAll("'", "''");
  await db.query(`ALTER ROLE msn_worker LOGIN PASSWORD '${workerPassword}'`);
  const password = process.env.RUNTIME_PASSWORD.replaceAll("'", "''");
  await db.query(`ALTER ROLE msn_runtime PASSWORD '${password}'`);
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.query("SELECT pg_advisory_unlock(811218)");
  await db.end();
}
