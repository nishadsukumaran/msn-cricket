const limits = [10, 50, 100, 250, 500, 1000, 5000, Infinity];
const startedAt = new Date().toISOString();
let requests = 0,
  acceptedBids = 0,
  rejectedBids = 0;
const buckets = limits.map(() => 0);
const statuses: Record<string, number> = {};
export function observeRequest(status: number, ms: number, bid: boolean) {
  requests++;
  statuses[String(status)] = (statuses[String(status)] ?? 0) + 1;
  const bucket = limits.findIndex((limit) => ms <= limit);
  buckets[bucket < 0 ? buckets.length - 1 : bucket]++;
  if (bid) {
    if (status >= 200 && status < 300) acceptedBids++;
    else if (status >= 400) rejectedBids++;
  }
}
export function requestMetrics() {
  let count = 0;
  let p95: number | null = null;
  for (let i = 0; i < limits.length; i++) {
    count += buckets[i];
    if (requests && count >= Math.ceil(requests * 0.95)) {
      p95 = Number.isFinite(limits[i]) ? limits[i] : null;
      break;
    }
  }
  return {
    startedAt,
    requests,
    acceptedBids,
    rejectedBids,
    statuses,
    latencyBuckets: limits.map((limit, i) => ({
      upperMs: Number.isFinite(limit) ? limit : null,
      count: buckets[i],
    })),
    p95UpperMs: p95,
  };
}
