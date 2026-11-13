import pg from "pg";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { seed } from "../packages/testing/seed.ts";
const args = Object.fromEntries(
  process.argv.slice(2).map((v) => v.replace(/^--/, "").split("=")),
);
const auctions = Number(args.auctions ?? 1),
  teams = Number(args.teams ?? 20),
  players = Number(args.players ?? 300),
  viewers = Number(args.viewers ?? 50),
  seconds = Number(args.seconds ?? 5),
  rate = Number(args.rate ?? 50);
for (const v of [auctions, teams, players, viewers, seconds, rate])
  if (!Number.isSafeInteger(v) || v < 1) throw Error("INVALID_LOAD_OPTIONS");
if (
  auctions > 10 ||
  teams > 20 ||
  teams < 2 ||
  players > 300 ||
  viewers > 500 ||
  seconds > 60 ||
  rate > 50
)
  throw Error("LOAD_ENVELOPE_EXCEEDED");
const base = process.env.API_URL ?? "http://127.0.0.1:4018";
if (
  !["127.0.0.1", "localhost"].includes(new URL(base).hostname) ||
  !["127.0.0.1", "localhost"].includes(
    new URL(process.env.DATABASE_URL!).hostname,
  )
)
  throw Error("LOCAL_LOAD_ONLY");
const owner = new pg.Client({ connectionString: process.env.DATABASE_URL });
await owner.connect();
const bidMs: number[] = [],
  readMs: number[] = [];
const outcomes: Record<string, number> = {};
let inFlight = 0,
  peak = 0,
  readFailures = 0;
const fixtures: any[] = [];
async function call(f: any, type: string, extra: any = {}) {
  const r = await fetch(base + `/api/auctions/${f.auction}/commands`, {
    method: "POST",
    headers: {
      Origin: process.env.WEB_ORIGIN!,
      "Content-Type": "application/json",
      Cookie: "msn_session=" + f.sessions.admin,
    },
    body: JSON.stringify({ type, commandId: randomUUID(), ...extra }),
  });
  const body = await r.json();
  if (!r.ok) throw Error(body.code);
  return body;
}
try {
  for (let n = 0; n < auctions; n++) {
    const f = await seed();
    const tokens = [f.sessions.managerA, f.sessions.managerB];
    for (let i = 2; i < teams; i++) {
      const uid = randomUUID(),
        tid = randomUUID(),
        token = randomBytes(32).toString("hex");
      await owner.query(
        "INSERT INTO users(id,identity_subject,email) VALUES($1,$2,$3)",
        [uid, "load:" + uid, "load-" + uid + "@example.invalid"],
      );
      await owner.query(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [createHash("sha256").update(token).digest("hex"), uid],
      );
      await owner.query("INSERT INTO memberships VALUES($1,$2,'MEMBER')", [
        f.club,
        uid,
      ]);
      await owner.query(
        "INSERT INTO teams(id,club_id,auction_id,code,name,initial_purse,remaining_purse) VALUES($1,$2,$3,$4,$5,1000000,1000000)",
        [
          tid,
          f.club,
          f.auction,
          "T" + String(i + 1).padStart(2, "0"),
          "Load Team " + (i + 1),
        ],
      );
      await owner.query(
        "INSERT INTO team_operators(club_id,auction_id,team_id,user_id) VALUES($1,$2,$3,$4)",
        [f.club, f.auction, tid, uid],
      );
      await owner.query(
        "INSERT INTO manager_applications(club_id,auction_id,user_id,team_id,status) VALUES($1,$2,$3,$4,'APPROVED')",
        [f.club, f.auction, uid, tid],
      );
      tokens.push(token);
    }
    await owner.query(
      "UPDATE teams SET initial_purse=1000000,remaining_purse=1000000 WHERE auction_id=$1",
      [f.auction],
    );
    await owner.query(
      "UPDATE auctions SET rules=jsonb_set(jsonb_set(rules,'{purse}','1000000'),'{increment}','1') WHERE id=$1",
      [f.auction],
    );
    if (players > 6)
      await owner.query(
        "WITH profiles AS (INSERT INTO player_profiles(user_id,name,phone,location,role,batting_style,bowling_style,rehearsal_only) SELECT $1,'Load Player '||i,'555-0000','Sample venue','BATTER','Right hand','None',true FROM generate_series(7,$2) i RETURNING id,name) INSERT INTO registrations(club_id,auction_id,player_id,profile_snapshot,effective_base,status,display_consent_at,reviewed_by) SELECT $3,$4,id,jsonb_build_object('name',name,'role','BATTER','location','Sample venue'),300,'APPROVED',now(),$1 FROM profiles",
        [f.admin, players, f.club, f.auction],
      );
    await call(f, "LOCK");
    await call(f, "START");
    const lot = await call(f, "SELECT", { registrationId: f.players[0] });
    await call(f, "OPEN", { lotId: lot.lotId, expectedVersion: 1 });
    fixtures.push({ ...f, tokens, lot: lot.lotId, version: 2, amount: 300 });
  }
  const start = performance.now(),
    pending: Promise<void>[] = [];
  for (let tick = 0; tick < seconds * rate; tick++) {
    for (const f of fixtures) {
      const token = f.tokens[tick % f.tokens.length],
        version = f.version,
        amount = f.amount;
      inFlight++;
      peak = Math.max(peak, inFlight);
      const begun = performance.now();
      pending.push(
        fetch(base + `/api/auctions/${f.auction}/commands`, {
          method: "POST",
          headers: {
            Origin: process.env.WEB_ORIGIN!,
            "Content-Type": "application/json",
            Cookie: "msn_session=" + token,
          },
          body: JSON.stringify({
            type: "BID",
            commandId: randomUUID(),
            lotId: f.lot,
            expectedVersion: version,
            amount,
          }),
          signal: AbortSignal.timeout(10000),
        })
          .then(async (r) => {
            const body = await r.json();
            bidMs.push(performance.now() - begun);
            const code = r.ok ? "ACCEPTED" : body.code;
            outcomes[code] = (outcomes[code] ?? 0) + 1;
            if (r.ok && body.lotVersion > f.version) {
              f.version = body.lotVersion;
              f.amount = amount + 1;
            }
          })
          .catch(() => {
            outcomes.NETWORK_ERROR = (outcomes.NETWORK_ERROR ?? 0) + 1;
          })
          .finally(() => {
            inFlight--;
          }),
      );
    }
    if (tick % rate === 0)
      for (const f of fixtures)
        for (let viewer = 0; viewer < viewers; viewer++) {
          const begun = performance.now();
          pending.push(
            fetch(base + `/api/auctions/${f.auction}/public`, {
              signal: AbortSignal.timeout(10000),
            })
              .then(async (r) => {
                if (!r.ok) readFailures++;
                await r.arrayBuffer();
                readMs.push(performance.now() - begun);
              })
              .catch(() => {
                readFailures++;
              }),
          );
        }
    const due = start + ((tick + 1) * 1000) / rate;
    const wait = due - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  await Promise.all(pending);
  const percentile = (a: number[], q: number) =>
    a.length
      ? [...a].sort((x, y) => x - y)[
          Math.min(a.length - 1, Math.ceil(a.length * q) - 1)
        ]
      : null;
  const report = {
    verifiedAt: new Date().toISOString(),
    environment: "local loopback; not India-region deployment capacity proof",
    configuration: {
      auctions,
      teams,
      players,
      viewers,
      seconds,
      bidsPerSecondPerAuction: rate,
    },
    bidRequests: bidMs.length,
    outcomes,
    bidP95Ms: percentile(bidMs, 0.95),
    publicReadP95Ms: percentile(readMs, 0.95),
    publicReadFailures: readFailures,
    peakInFlightBids: peak,
    elapsedMs: performance.now() - start,
  };
  await writeFile(
    "artifacts/load-result.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (outcomes.NETWORK_ERROR || readFailures || !(outcomes.ACCEPTED > 0))
    process.exitCode = 1;
} finally {
  await owner.end();
}
