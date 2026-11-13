# MSN Cricket Auction Platform
## Implementation Blueprint · v1.1 · 12 November 2026

Companion documents: MSN_Cricket_PRD.md and MSN_Cricket_Solution_Architecture.md. This is one end-to-end execution contract; work packages below are engineering dependencies, not separate product launches.

## 1. Existing repository assessment
Current files are a browser-only experiment: auction.js, auction tests, index.html, app.js and style.css. They have no identity, tenant model, persistent database, multi-device transport, registration approval or commerce. Their passing unit tests do not establish product readiness. Preserve them as reference under an explicitly named prototype folder when production work starts; do not let public deployment accidentally serve that prototype as the product. Reimplement the domain against the architecture, borrowing only reviewed behaviour and visual concepts.

## 2. Target repository map
```text
apps/web/                 public pages, club console, phone room, projection
apps/api/                 authenticated routes, commands, sockets, webhooks
apps/worker/              outbox, notifications, exports, reconciliation
packages/domain/          pure auction rules, state machines, point arithmetic
packages/contracts/       shared validated command/event/request schemas
packages/database/        schema, migrations, tenant policies, repositories
packages/ui/              accessible cricket-themed components and tokens
packages/i18n/            English/Malayalam keys and formatting
packages/testing/         tenant fixtures, realtime harness, seeded auctions
infra/                    containers, environment templates, deployment/runbooks
docs/                     PRD, architecture, decisions, API and as-built notes
```

Approved implementation stack: Next.js + React + TypeScript with Tailwind CSS and accessible components; NestJS + TypeScript for the persistent API; Socket.IO for live notifications; PostgreSQL for authoritative storage; S3-compatible object storage. Use a single workspace and a shared TypeScript toolchain. NestJS modules own identity, clubs, registrations, auction commands, commerce and reporting. HTTPS mutation routes and Socket.IO gateways call the same application services; gateways do not implement a second bid processor. Domain code must not import UI, database or payment SDKs. API routes call application services; services enforce authorization and transactions; repositories handle persistence. Keep interface schemas versioned and validate at every network boundary.

## 3. Work packages and verification
| Package | Deliverable | Required proof |
|---|---|---|
| A. Foundation | Workspace, CI, lint/type checks, database migrations, seed command, config validation | Fresh environment boots; migration succeeds on empty database; missing secrets fail safely |
| B. Identity and tenants | Login, club creation, memberships, invitations, privileged platform role | Cross-tenant reads/mutations and socket joins rejected; role revocation takes effect |
| C. Auction preparation | Config wizard, team setup, player/manager registration, approvals, profile images | Both manager onboarding paths work; optional base resolves correctly; private data redacted |
| D. Auction engine | State machines, lock ordering, idempotent commands, purse ledger and credit redemption | Concurrent bid/close tests, duplicate-command tests, exact balance and allocation constraints |
| E. Live experiences | Manager phone room, auctioneer console, projection, snapshot/replay and reconnect | Multiple physical devices stay aligned; replay gaps recover; offline bid is blocked |
| F. Commerce | SKU catalog, sandbox online checkout, signed webhook processing, manual grants | Forged/duplicate webhooks fail; last-credit concurrency consumes once; refund exception handled |
| G. Bilingual/product quality | English/Malayalam, accessible components, club branding, reports | Complete translated journeys, keyboard checks, phone/projection visual review and export checks |
| H. Operations and release | Monitoring, backup restore, venue rehearsal, security/load checks, deployment docs | PRD release checklist demonstrated; results recorded with actual measured limits |

Proceed across packages autonomously within the agreed product scope. Keep unresolved provider credentials behind adapters and environment configuration. Missing live merchant access must not be disguised as a working payment integration. Sandbox verification is mandatory before marking online payment ready.

## 4. Domain implementation contract
Represent points with validated safe integers and explicit bounds. Define AuctionRules, RegistrationStatus, AuctionStatus, LotStatus, TeamState, BidCommand and AuctionEvent in shared contracts. No UI writes to balances. Current bid is derived from the committed leading bid record.

Pure domain functions:
- resolveEffectiveBase(requestedBase, approvedOverride, rules): valid non-negative integer respecting minimum; no silent invalid fallback.
- computeMaxBid(team, rules): remaining purse minus configured minimum-squad reserve.
- validateNextBid(state, actorTeam, expectedVersion, amount): typed acceptance or rejection, without persistence side effects.
- validateTransition(state, command): enforce legal auction and lot transitions.
- computeSettlement(lot, team): allocation and ledger delta for a closed lot with a winning bid.
- validateReversal(allocation, currentState): identify downstream conflicts before compensating entries.

Persistence services perform these calculations after acquiring locks. A command succeeds only after commit. Domain tests cover boundaries; integration tests prove database locking and constraints, which pure unit tests cannot prove.

## 5. Critical transaction recipes
### Start auction and redeem license
Lock auction → verify LOCKED/readiness → if already started return original outcome → lock eligible grants → calculate unused units excluding existing redemptions → insert unique redemption → set LIVE → append event/outbox/audit → commit. Concurrent starts return the same result or a conflict, never consume twice.

### Sell player
Lock auction → lot → winning team → registration/allocation scope → verify CLOSED and leading bid → recompute eligible balance/squad → insert allocation → decrement purse and append ledger → mark SOLD → event/outbox/audit → commit. Failure rolls back all changes. Settlement command retry returns original result.

### Correct result
Pause auction → identify sale and dependent actions → validate whether reversal would violate state → preview resulting purse/squads → admin confirms reason → compensate ledger and allocation → mark prior outcome reversed → create explicit recall attempt if requested → publish correction → reconcile → resume. Block arbitrary historical editing if subsequent purchases depend on it; require a documented resolution instead.

### Crash after commit, before broadcast
Worker finds pending outbox → publishes event → marks delivered. If worker crashes after publishing, event can repeat; clients deduplicate by event ID/sequence. On reconnect clients fetch authoritative snapshot regardless of local optimistic state. Never promise exactly-once network delivery; guarantee one logical database effect through idempotency and constraints.

## 6. UX specification by screen
### Auction creation
Save draft at each step. Present rules as a readable summary with units in points. Readiness list links to unresolved issues. Lock action shows a final rule snapshot and affected approved teams/players. Changes before start invalidate readiness and require relocking.

### Registration and approval
Separate player profile from auction entry. Required: name, photo, age/date-of-birth input per policy, contact, location, role, batting style, bowling style or not applicable. Optional requested base points clearly labelled. Approval queue filters by role and status, shows missing fields, supports request changes and individual review. Bulk approval requires selection review; duplicate email/phone is a review signal rather than silently deleting entries.

### Manager phone room
Top: auction name, live/paused and connection state. Main: player photo/name, role, styles and base; accepted bid and leading team. Sticky bottom: next bid amount, own purse, maximum eligible bid and primary action. Disable when leader, full, unaffordable, paused, pending or stale; explain why. Tabs: player pool, watchlist if included, own squad and all teams. Watchlists are optional convenience, not launch-critical.

### Auctioneer console
Left: eligible queue and role/status filters. Centre: preview/current player and bid feed with server timestamps. Right: team purses/slots and connection indicators. Primary actions vary by state: open → close → confirm sold. Unsold only when no accepted bid. Pausing is always prominent. No global keyboard shortcut can sell without deliberate confirmation.

### Projection
Use redacted endpoint/stream only. Display token is read-only, scoped to one auction, revocable and rotated after event. Full-screen mode is user-triggered. Do not expose contacts even in HTML source or network payload. Include stale connection indicator; do not continue animations that imply new bids after disconnect. Between lots show team squad and purse summaries. Public URL access respects club visibility settings.

### Platform billing console
Show order state, verified payment reference, credits granted/used/remaining and manual grant history. A manual grant requires count, club, reason and optional external payment reference. A user-entered payment reference does not mean verified online payment.

## 7. Test matrix and concrete examples
| Scenario | Expected outcome |
|---|---|
| Purse 10,000; min squad 5; squad size 2; minimum base 100 | Maximum next purchase is 9,800 before other constraints |
| First bid for base 500 | Only 500 accepted under fixed next-bid model |
| Current bid 500, increment 100; two teams submit 600 for same version | Exactly one accepted; other gets conflict and current state |
| Retry accepted command after network timeout | Same bid ID; no extra bid or points effect |
| Same command ID reused with different amount | Rejected as payload mismatch |
| Close and bid run concurrently | Serialized winner determines state; no bid accepted after successful close |
| Sell submitted twice | One allocation and one debit |
| Current leader tries another bid | Rejected with translated explanation |
| Missing optional requested base | Effective base equals approved auction default |
| Manager pending/revoked/wrong club | No bid or private socket access |
| Browser changes displayed purse/role | Server still enforces real purse/permissions |
| Phone sleeps, misses events, resumes | Snapshot/replay before controls enabled |
| Duplicate outbox publication | Client state applies event once |
| One remaining credit, two different auctions start | Only one starts unless another credit exists |
| Duplicate valid payment webhook | One payment effect and credit grant |
| Checkout redirect without webhook verification | Order pending; no credit |
| Photo uploaded as executable with image extension | Upload rejected |
| English → Malayalam during pending bid | Bid identity retained; translated state reflects server outcome |
| Restore production-like backup into isolated environment | Ledger, allocations and event sequence reconcile |

Also test empty pools, no teams, invalid base/increment, duplicate names/codes, Unicode names, large photos, long Malayalam text, overlapping admin actions, revoked projection token and expired replay cursor. Run tests against real PostgreSQL for concurrency; mocks cannot prove locks.

## 8. CI and quality gates
Every change: format, lint, typecheck, domain tests, database integration tests and production build. API/security changes include negative tenant/role tests. Live engine changes include concurrency and replay tests. UI changes receive responsive visual inspection and automated accessibility checks, then real keyboard/phone testing for critical flows. Record failures honestly; no 'ready' status while acceptance tests are skipped.

Use seed data with fictional Kerala club/team/player identities and visibly mark sample environments. Never copy real player contact details into test fixtures. Keep secrets out of source and logs. Preview environments use sandbox merchant keys and isolated databases.

## 9. Delivery and release runbook
1. Configure staging identities, database, storage and sandbox merchant.
2. Apply migrations; seed fictional data; execute full automated suite.
3. Complete functional rehearsal with separate player, manager, admin and projection sessions.
4. Run the PRD load envelope; record latency percentiles, errors, lock waits and publication lag.
5. Kill/restart API/worker during active test lots; verify no duplicate settlement or lost acknowledged command.
6. Restore a backup and reconcile purse ledger against allocations.
7. Review all Malayalam screens with a fluent speaker, including rejection/error text.
8. Prepare production accounts/configuration, merchant activation, branding and policies; record owners.
9. Deploy with rollback artifact; run smoke test using isolated rehearsal auction.
10. Club organizer signs off the rehearsed flow and event-day rules; conduct preflight before each event.

Rollback must not roll back committed auction business data. Use compatible code rollback; repair database defects through reviewed migrations/compensations. Stop bidding with a visible pause if invariant checks fail.

## 10. Definition of done / as-built report
Deliver working application, database migrations, environment template, seeded rehearsal, API/event reference, automated tests, deployment/restore runbooks and updated architecture decisions. Final as-built report must list actual features, measured test evidence, provider integrations exercised, deployment URL if authorized/configured, known gaps and operator instructions. No declaration of complete product based only on a local UI or pure domain tests.

## 11. Open decision register
| Decision | Proposed treatment until confirmed | Needed for |
|---|---|---|
| Public product name | MSN Cricket Auction Platform as working name | Branding launch |
| License prices/expiry/refund | Configurable catalog; sandbox products only | Real sales |
| Payment merchant/provider | Adapter + sandbox integration; club/platform legal owner to confirm | Production checkout |
| Hosting accounts/budget | India-region managed runtime/database proposed | Deployment |
| Authentication channel | Verified email; phone as contact | SMS OTP only if requested |
| Junior participants | Adult registration initially | Enabling minors |
| Reserve rule | Enabled, configurable before locking | Organizer rule sign-off |
| Data retention/support | Configurable retention job; no invented contractual period | Public launch policy |

None requires restarting the product definition. Resolve through configuration or a recorded architecture decision while preserving the agreed auction flow.
