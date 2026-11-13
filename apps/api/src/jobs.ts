import pg from "pg";
import { randomUUID } from "node:crypto";
import { deletePhoto } from "./storage.ts";
export interface MaintenanceOptions {
  orphanImageDays: number;
  sessionRetentionDays: number;
  deleteObject?: (key: string) => Promise<void>;
}
export async function runMaintenance(options: MaintenanceOptions) {
  if (
    !Number.isSafeInteger(options.orphanImageDays) ||
    options.orphanImageDays < 1 ||
    !Number.isSafeInteger(options.sessionRetentionDays) ||
    options.sessionRetentionDays < 1
  )
    throw Error("RETENTION_POLICY_REQUIRED");
  const pool = new pg.Pool({
      connectionString: process.env.WORKER_DATABASE_URL,
      max: 1,
    }),
    db = await pool.connect();
  const job = randomUUID();
  let lock = false,
    inTransaction = false;
  try {
    lock = (await db.query("SELECT pg_try_advisory_lock(131318) locked"))
      .rows[0].locked;
    if (!lock) return { skipped: true };
    await db.query("BEGIN");
    inTransaction = true;
    await db.query(
      "INSERT INTO job_runs(id,kind,status) VALUES($1,'MAINTENANCE','RUNNING')",
      [job],
    );
    const expired = await db.query(
      "DELETE FROM sessions WHERE expires_at<now()-make_interval(days=>$1)",
      [options.sessionRetentionDays],
    );
    const images = (
      await db.query(
        "SELECT i.key FROM image_objects i WHERE deleted_at IS NULL AND created_at<now()-make_interval(days=>$1) AND NOT EXISTS(SELECT 1 FROM player_profiles p WHERE p.photo_key=i.key) AND NOT EXISTS(SELECT 1 FROM registrations r WHERE r.profile_snapshot->>'photoKey'=i.key) AND NOT EXISTS(SELECT 1 FROM clubs c WHERE c.branding->>'logoKey'=i.key) AND NOT EXISTS(SELECT 1 FROM teams t WHERE t.logo_key=i.key) ORDER BY i.key FOR UPDATE SKIP LOCKED LIMIT 100",
        [options.orphanImageDays],
      )
    ).rows;
    // A committed tombstone prevents attachment even if storage deletion or a later job step fails.
    for (const image of images) {
      // Recheck in a fresh statement after the row lock: an attachment may have committed while this job waited.
      const referenced = (
        await db.query(
          "SELECT EXISTS(SELECT 1 FROM player_profiles WHERE photo_key=$1 UNION ALL SELECT 1 FROM registrations WHERE profile_snapshot->>'photoKey'=$1 UNION ALL SELECT 1 FROM clubs WHERE branding->>'logoKey'=$1 UNION ALL SELECT 1 FROM teams WHERE logo_key=$1) yes",
          [image.key],
        )
      ).rows[0].yes;
      if (!referenced)
        await db.query(
          "UPDATE image_objects SET deleted_at=now() WHERE key=$1",
          [image.key],
        );
    }
    await db.query("COMMIT");
    inTransaction = false;
    const pending = (
      await db.query(
        "SELECT key FROM image_objects WHERE deleted_at IS NOT NULL AND purged_at IS NULL ORDER BY deleted_at,key LIMIT 100",
      )
    ).rows;
    let removed = 0,
      failed = 0;
    for (const image of pending) {
      try {
        await (options.deleteObject ?? deletePhoto)(image.key);
        await db.query(
          "UPDATE image_objects SET purged_at=now() WHERE key=$1",
          [image.key],
        );
        removed++;
      } catch {
        failed++;
      }
    }
    const backlog = (
      await db.query(
        "SELECT e.club_id,count(*)::int count FROM outbox o JOIN auction_events e ON e.id=o.event_id WHERE o.delivered_at IS NULL AND e.occurred_at<now()-interval '30 seconds' GROUP BY e.club_id",
      )
    ).rows;
    for (const b of backlog)
      await db.query(
        "INSERT INTO operations_alerts(club_id,kind,details) SELECT $1,'OUTBOX_LAG',$2 WHERE NOT EXISTS(SELECT 1 FROM operations_alerts WHERE club_id=$1 AND kind='OUTBOX_LAG' AND resolved_at IS NULL)",
        [b.club_id, { pending: b.count }],
      );
    await db.query(
      "UPDATE operations_alerts SET resolved_at=now() WHERE kind='OUTBOX_LAG' AND resolved_at IS NULL AND NOT EXISTS(SELECT 1 FROM outbox o JOIN auction_events e ON e.id=o.event_id WHERE e.club_id=operations_alerts.club_id AND o.delivered_at IS NULL AND e.occurred_at<now()-interval '30 seconds')",
    );
    const summary = {
      expiredSessions: expired.rowCount,
      removedImages: removed,
      failedImages: failed,
      laggingClubs: backlog.length,
    };
    await db.query(
      "UPDATE job_runs SET status=$2,summary=$3,finished_at=now() WHERE id=$1",
      [job, failed ? "FAILED" : "SUCCEEDED", summary],
    );
    if (failed)
      await db.query(
        "INSERT INTO operations_alerts(kind,details) VALUES('MAINTENANCE_FAILED',$1)",
        [{ jobId: job, failedImages: failed }],
      );
    return summary;
  } catch (e: any) {
    if (inTransaction) await db.query("ROLLBACK");
    await db.query(
      "INSERT INTO job_runs(id,kind,status,summary,finished_at) VALUES($1,'MAINTENANCE','FAILED',$2,now()) ON CONFLICT(id) DO UPDATE SET status='FAILED',summary=excluded.summary,finished_at=now()",
      [job, { code: e.code ?? "MAINTENANCE_FAILED" }],
    );
    throw e;
  } finally {
    if (lock) await db.query("SELECT pg_advisory_unlock(131318)");
    db.release();
    await pool.end();
  }
}
