import pg from "pg";
pg.types.setTypeParser(20, (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw Error("INTEGER_OVERFLOW");
  return n;
});
export const pool = new pg.Pool({
  connectionString: process.env.RUNTIME_DATABASE_URL,
  max: 15,
  connectionTimeoutMillis: 5000,
});
export type DB = pg.PoolClient;
export async function transaction<T>(
  actor: string,
  work: (db: DB) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL lock_timeout='5s'");
    await db.query("SET LOCAL statement_timeout='15s'");
    await db.query("SELECT set_config('app.actor_id',$1,true)", [actor]);
    const result = await work(db);
    await db.query("COMMIT");
    return result;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export async function scoped<T>(
  actor: string,
  auction: string,
  work: (db: DB, a: any, roles: string[]) => Promise<T>,
): Promise<T> {
  return transaction(actor, async (db) => {
    const scope = await db.query("SELECT actor_club($1) club", [auction]);
    const club = scope.rows[0]?.club;
    if (!club) throw Error("FORBIDDEN");
    await db.query("SELECT set_config('app.club_id',$1,true)", [club]);
    const { rows } = await db.query(
      "SELECT * FROM auctions WHERE id=$1 FOR UPDATE",
      [auction],
    );
    const roles = await db.query(
      "SELECT role FROM memberships WHERE club_id=$1 AND user_id=$2 UNION ALL SELECT 'SUPPORT' WHERE active_support($1)",
      [club, actor],
    );
    if (!roles.rowCount) throw Error("FORBIDDEN");
    return work(
      db,
      rows[0],
      roles.rows.map((r) => r.role),
    );
  });
}
