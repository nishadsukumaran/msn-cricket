# Local development and recovery

The application uses Next.js/React, Tailwind, NestJS, Socket.IO, PostgreSQL and S3-compatible image storage. The reference prototype is not served.

## Start locally

Use Node 24 or newer and Docker. Work from the repository root. Copy `.env.example` to `.env` and replace the database, worker, image-storage and auth-cookie secrets with random values. Keep the private file out of source control.

```sh
npm ci
node scripts/check-environment.mjs
npm run storage:config
docker compose -f infra/compose.yaml up -d --wait
npm run db:migrate
npm run storage:init
npm run db:seed
npm run dev:api
```

In another terminal run `npm run dev:web`. Open http://localhost:3018. The local fixture offers organizer and two manager sessions with fictional Kerala clubs and players. The API binds to loopback port 4018; web uses 3018; PostgreSQL 55438; private S3-compatible storage 59018. All container ports bind to loopback. The storage image is pinned by digest. The generated `infra/s3.local.json`, `.env`, database backup and fixture/session files are private local files.

The local rehearsal login is disabled unless `ENABLE_REHEARSAL_LOGIN=true` and the environment is not production. Production startup rejects that flag. The seed script also refuses production. These sessions are not a public authentication system.

## Organizer rehearsal

1. Enter as organizer, open Club → Setup, inspect the rules/readiness and lock the event. Starting consumes one fictional credit.
2. In Control, preview a player and open bidding. Use two separate browser profiles as the Strikers and Waves managers.
3. Place a bid, disconnect one manager and reconnect. A fresh snapshot is required before the next bid.
4. Close bidding separately from confirming sold. Confirm settlement. Review purses, squads, read-only projection and CSV reports.
5. Pause before reversing a sale; supply a reason. The outcome becomes reversed, accounting is compensated, and after resume an explicit recall creates another lot attempt. Random selection never recalls attempted players.
6. Mark a no-bid player unsold. Recall is deliberate. Completion rejects unsettled lots and unresolved/reversed players.

Reports cover player pool, allocations, unsold attempts, ledger and accepted bid audit. Times in exports are labelled India time. CSV values are quoted and formula-leading values escaped. Public projection, public club pages and photo endpoints exclude contacts/birth dates.

## Verification

```sh
npm run db:migrate
npm run storage:init
npm test
npm run test:integration
npm run test:prototype
npm run lint
npm run typecheck
npm run format:check
npm run build
npm audit
```

With both local servers running, `npm run test:e2e` creates a fresh fictional fixture and runs the browser rehearsal. Do not edit app source during that run. The browser test uses two manager contexts, forces offline recovery, checks an uncertain command, inspects English/Malayalam, runs axe checks, and captures phone/tablet/desktop/projection images under `artifacts/`.

`npm run test:restore` creates a custom-format PostgreSQL dump in `artifacts/restore-check.dump`, restores it to a temporary database **inside this project's container**, compares bids/allocations/ledger/events/redemptions and reconciles all team balances. It drops only the temporary restore database and leaves the backup file private. This verifies a local logical restore, not managed-service point-in-time recovery or the production RPO/RTO targets.

## Identity configuration

Set OIDC issuer, audience, JWKS, authorization URL, token URL, client ID and optional client secret. Register `${WEB_ORIGIN}/api/auth/callback` with the provider. Authentication uses authorization code + PKCE, nonce/state checks, verified-email JWTs and server-side expiring session cookies. Production cookies are Secure/HttpOnly/SameSite. Validate provider-specific client authentication and MFA with the chosen identity provider before public launch; no real identity provider was configured in this run.

## License/payment configuration

Manual credit grants require a separately provisioned `platform_operators` identity. Club ownership alone does not grant platform authority. Provision operator identities through controlled database administration, never through self-service club creation.

No prices are assumed. Configure `credit_products` with agreed integer minor-unit prices, currency, units and optional validity. The optional Razorpay adapter is an implementation candidate, not a merchant selection decision. If selected, configure key ID/secret, merchant account ID and webhook secret; register `/api/billing/webhooks/razorpay`. Captured-payment webhooks must verify signature over the raw body, merchant, order reference, amount and currency. Checkout/return callbacks do not issue credits. Replay uses the provider event ID and payload hash. A consumed-credit refund becomes a billing exception; it does not stop a running auction automatically. Refund-policy acceptance and actual provider sandbox rehearsal remain launch gates; implementation now includes partial-refund exceptions and batched reconciliation.

## Production handoff

Use separate managed PostgreSQL, private S3 storage and identity/merchant accounts. Apply migrations with the owner connection, then run the API with **only** restricted `RUNTIME_DATABASE_URL` and `WORKER_DATABASE_URL`; the API does not require the migration owner URL. Use `npm run build:api` and start `node dist/apps/api/src/main.js` with secrets supplied by the runtime. Build/start web through its workspace scripts. Configure `API_HOST` for the container network and `API_URL` for web-to-API routing. Put both services behind the same HTTPS origin/reverse proxy, including `/socket.io`; use secure cookies and exact WEB_ORIGIN. Disable local rehearsal access.

Do not use this local compose file as a managed production deployment. The current outbox delivery loop is single-API-instance oriented. Before multiple API replicas, implement shared fanout/worker leadership and distributed rate limiting, and test the PRD load envelope. Retention/deletion jobs, operational alerting, image cleanup and provider reconciliation are implemented; configure the agreed operating policy and exercise the selected provider before launch. Do not deploy schema changes during a real auction; pause visibly if reconciliation fails and retain all immutable accounting/audit records.

## Completed management and operations workflows

Club management now includes Staff, Display access, Branding and Event health tabs. An owner can grant/revoke staff permissions and transfer ownership with a reason and confirmation. Bidding handover uses an approved manager, is audited, and requires pausing an active event. The former operator retains squad visibility and loses bid authority.

Private display links expire after 24 hours and are scoped to one auction. Creating another link rotates the prior credential; revocation or expiry removes access on the next refresh. The display and its photo/logo requests use the credential without exposing private contact fields. Public projection remains controlled separately by auction publication.

The profile screen saves reusable data and a sanitized image. Auction registration takes a snapshot; later profile edits leave that snapshot unchanged. Players can withdraw before opening, and account erasure anonymizes records while retaining accounting identifiers. Owners must transfer ownership and participants must finish an active event before erasure.

The platform console manages the credit catalog, manual license requests/approval, unused-credit revocation, audited temporary support, club suspension, payment reconciliation, alerts and maintenance history. Production owner/admin/platform sessions require verified MFA claims (`amr=mfa` or a configured provider `acr` value). `OIDC_MFA_ACR_VALUES` is provider-specific and must be confirmed with the selected identity service.

Run `npm run worker` as the background maintenance/reconciliation process. Configure `ORPHAN_IMAGE_DAYS` and `SESSION_RETENTION_DAYS` only after agreeing the retention policy. Reconciliation also needs configured provider credentials and a separately authorized `RECONCILIATION_ACTOR_ID`. `npm run worker:once` performs one configured pass. Unconfigured jobs do not invent policy or payment success. Cleanup commits a tombstone before storage deletion and retries failed purges; referenced images are protected by locks and a fresh reference check. Refund recovery handles partial refunds as billing exceptions rather than minting an unrestricted package.

`npm run test:fresh` applies every migration to an empty temporary database and removes that database afterward. `npm run test:load` runs the bounded local load profile; options include `-- --auctions=1 --teams=20 --players=300 --viewers=50 --seconds=5 --rate=50`. The script supports the documented larger envelope but refuses remote hosts and does not claim production capacity from a loopback run.

Build container artifacts using `docker build --target api -f infra/Dockerfile -t msn-cricket-api .` and `docker build --target web --build-arg API_URL=http://api:4018 -f infra/Dockerfile -t msn-cricket-web .`. The web proxy target is configured at build time. Build context excludes local secrets, fixture data and generated artifacts; runtime images run as the non-root Node user. Image build recipes do not configure external hosting or deploy the application.
