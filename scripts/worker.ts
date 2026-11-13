import { runMaintenance } from "../apps/api/src/jobs.ts";
import { CommerceService } from "../apps/api/src/commerce.ts";
async function tick() {
  if (process.env.ORPHAN_IMAGE_DAYS && process.env.SESSION_RETENTION_DAYS)
    await runMaintenance({
      orphanImageDays: Number(process.env.ORPHAN_IMAGE_DAYS),
      sessionRetentionDays: Number(process.env.SESSION_RETENTION_DAYS),
    });
  if (process.env.RECONCILIATION_ACTOR_ID && process.env.RAZORPAY_KEY_ID)
    await new CommerceService().reconcile(process.env.RECONCILIATION_ACTOR_ID);
}
if (process.argv.includes("--once")) await tick();
else {
  const interval = Number(process.env.MAINTENANCE_INTERVAL_SECONDS ?? 300);
  if (!Number.isSafeInteger(interval) || interval < 30)
    throw Error("INVALID_INTERVAL");
  await tick();
  setInterval(
    () =>
      tick().catch((e) =>
        console.error(
          JSON.stringify({
            component: "maintenance",
            code: e.code ?? "JOB_FAILED",
          }),
        ),
      ),
    interval * 1000,
  );
}
