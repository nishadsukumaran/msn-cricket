# MSN Cricket Auction Platform
## Product Requirements Document · v1.0 · 12 November 2026

Status: proposed implementation baseline. Requirements confirmed in conversation are distinguished from recommended defaults. This document supersedes the scope implied by the early local demo; that demo is an experiment, not the production foundation.

## 1. Product intent
A bilingual, mobile-first auction service for cricket clubs in Kerala. Players register for a club's auction; team managers register or receive invitations; the club approves participation. An auctioneer conducts the event in an auditorium while approved managers bid from phones. A presentation screen shows the player, accepted bid, leading team and team squads. Other clubs purchase licenses for one auction or a package of auction credits.

The product succeeds when an organizer can prepare, rehearse, run and reconcile a complete auction without spreadsheets becoming the source of truth. Virtual points determine player allocation. Actual money is collected only for platform licenses; player bids do not create payment obligations.

## 2. Confirmed requirements
| ID | Requirement |
|---|---|
| C01 | Each auction has a fixed virtual points purse per team, configured by the club administrator. |
| C02 | Club administrator configures each auction, including teams, player pool and bidding parameters. |
| C03 | Auctioneer selects a player manually or randomly and controls event progression. |
| C04 | Player registration includes identity/profile, photo, playing role, batting/bowling style and location. Base rate is optional. |
| C05 | Every player registration requires club approval. |
| C06 | Team managers may self-register for approval or be invited/created by the club. |
| C07 | Approved team managers bid live from their app/browser. |
| C08 | Auditorium display shows player status, auction activity and team-wise squads. |
| C09 | Clubs can purchase access online or obtain a manually issued license, one auction at a time or multiple. |
| C10 | English and Malayalam interfaces. |

## 3. Recommended defaults and boundaries
These are product decisions proposed for implementation, not additional user-confirmed requirements.

- Responsive installable web app/PWA; no app-store installation required. Online access is required to bid.
- One active bidding operator per team per auction. Other approved members can view their team's information. Operator handover is explicit and audited.
- One active lot per auction. Different clubs may run auctions simultaneously.
- Auctioneer closes bidding manually. An optional visual countdown supports the auctioneer but does not automatically sell a player in the first release.
- No skipped bid amounts: manager taps the server-provided next bid. Configurable fixed increments initially; value-based increment bands can follow once needed.
- Optional player base-rate request is reviewed by the club. Missing base rate resolves to the auction's default base points at approval. Lock the effective base before the event.
- Reserve enough points to fill the remaining minimum squad at the auction minimum base points. Club can disable this rule before locking the auction and sees an explicit warning.
- Player profile is reusable; registration, approval, base points and sale outcome belong to each auction separately.
- Licenses are credit-based, not recurring subscriptions initially. Package size, price, tax and validity are configurable. No assumed pricing or automatic renewal.
- Registration is account-based with verified email initially; phone recorded as contact. SMS OTP requires a selected provider and separate onboarding.
- Suggested initial scope is adult community cricket; junior participation and guardian consent require a defined policy before enabling under-18 registration.

## 4. Roles and permissions
| Action | Platform owner | Club owner/admin | Auctioneer | Team operator | Player | Audience |
|---|---|---|---|---|---|---|
| Issue/revoke unused credits | Yes, audited | Purchase/request only | No | No | No | No |
| Create club/assign club admins | Platform support | Own club | No | No | No | No |
| Configure and lock auction | Support only with audit | Own club | View | View published rules | View published rules | View published rules |
| Approve registrations/teams | No routine access | Own club | Optional delegated permission | No | No | No |
| Open/pause/close lots | No routine access | Yes | Delegated auction | No | No | No |
| Submit bids | No | Only if separately appointed operator | No | Assigned team only | No | No |
| View private contact details | Explicit support access | Own club | Only if needed | No | Own profile | No |
| View public results | Yes | Yes | Yes | Yes | Yes | If published |
| Correct sale | Support escalation | Reason + confirmation | Request correction | No | No | No |

All permissions are checked on the server. Hiding a control is not an authorization boundary. Platform support access is time-limited, reasoned and recorded.

## 5. User journeys
### Club onboarding and licensing
Create account → create club and branding → select single credit/package → online checkout or manual purchase request → verified payment/manual grant → credit balance → create auction draft. Draft creation does not consume credit. Starting a real auction consumes exactly one credit. Rehearsals use separate sample data and cannot publish real results.

### Auction preparation
Create auction → set rules and dates → publish registration link/QR → invite managers or accept applications → approve players and manager-to-team assignments → review missing data and duplicates → preview screen → readiness checks → lock roster and rules → begin.

### Player
Open club registration link → authenticate → select/create profile → provide details and optional requested base points → consent to profile display → submit → see pending/approved/rejected/changes requested status → edit while permitted → view assigned team/results after auction. Rejection reasons visible privately. A withdrawn registration cannot be selected.

### Manager
Open invite or apply → authenticate → club approves team assignment → view rules, approved player pool, own purse and squad → enter live room → receive connection/sync status → tap next bid → await accepted/rejected result → see winning team and purse after confirmed sale. A pending animation never implies acceptance.

### Auctioneer
Choose next eligible player manually or randomly → preview details → open bidding → observe accepted bids → pause/resume if needed → close bidding → confirm winning bid and mark sold, or mark unsold if no bids → display result → proceed. Random selection records the chosen eligible pool and outcome for audit; it is not a claim of independently verifiable randomness.

## 6. Functional requirements and acceptance
| ID | Feature | Acceptance condition |
|---|---|---|
| F01 | Club isolation | A user in Club A cannot read or mutate Club B private resources through any ID, API or socket subscription. |
| F02 | Auction configuration | Admin sets name, venue, IST schedule, team count/capacity, purse, minimum/maximum squad, default/minimum base, increment, registration deadline, selection mode and public visibility. Invalid combinations are rejected. |
| F03 | Player registration | Required profile fields validated; absent base accepted; submission remains pending until approval. Phone never appears on audience projection. |
| F04 | Manager onboarding | Invite and self-registration converge into the same approval workflow; an unapproved manager cannot bid. |
| F05 | Team setup | Team name, short code, logo, colour and operator assignment supported; duplicate short codes rejected within auction. |
| F06 | Preflight and locking | Cannot start without license, approved teams, players, operators and valid rules. Lock freezes purse/base/increment/squad rules. |
| F07 | Player selection | Only approved, available or explicitly recalled unsold registrations can be opened; only one lot live. |
| F08 | Bidding | Server checks active operator, live state, version, next amount, purse, reserve and squad eligibility atomically. |
| F09 | Simultaneous bids | Two requests on the same version/amount produce at most one accepted bid. Other requester gets conflict plus current state. |
| F10 | Retry safety | Retrying the same command ID never creates a second bid or sale. |
| F11 | Sold | Closing is distinct from settlement. Confirmation allocates player and deducts points exactly once in one transaction. |
| F12 | Unsold and recall | No-bid closed lot can be unsold; recall creates a new attempt linked to the prior lot. No silent base reduction. |
| F13 | Pause/recovery | Pause rejects bids; clients visibly indicate stale state and synchronize before enabling bidding again. |
| F14 | Correction | Reasoned administrative reversal restores purse and removes allocation atomically, preserving original records. Subsequent rule violations block correction pending a controlled resolution. |
| F15 | Projection | Read-only screen supports current player, leading team, accepted bid, sold animation, squads and remaining purses; no private contacts. |
| F16 | Reports | CSV export of approved pool, allocations, unsold players, purse ledger and bid audit with IST display times and stable IDs. |
| F17 | Language | All navigation, validation, status and notifications translate; names remain as entered. Language toggle preserves current workflow. |
| F18 | Credits | Online verified webhook or authorized manual grant creates entitlement once; starting auction redeems once. |
| F19 | Completion | Reconciliation shows no duplicate allocations, balanced points ledger and unresolved lots before publishing completion. |

## 7. Auction rules
Points are non-negative integers, never floating point. Minimum bid on first offer equals the effective base. Further bids equal the current accepted amount plus configured increment. Current leader cannot bid again. Maximum squad blocks any further purchase. If reserve protection is enabled, affordability is:

`maxBid = remainingPurse - max(0, minimumSquad - currentSquadSize - 1) × minimumBasePoints`

The rule protects only a minimum-points floor; it cannot guarantee enough suitable players will remain. An auction where `purse < minimumSquad × minimumBasePoints` fails setup validation. Per-player base cannot be below the auction minimum. Published rules explicitly state that server acceptance order determines the winner of simultaneous requests; client tap time and hall observation do not override it.

Late bid versus close is resolved by the same database lock: whichever valid command commits first determines state. Once close wins, no new bids enter that lot. A visual countdown has no independent authority.

## 8. UX and visual direction
Updated visual direction, 12 November 2026: India-inspired cricket blue with saffron accents, bright frosted navigation and layered glass surfaces. Follow design-system/msn-cricket/MASTER.md for tokens, mobile hierarchy and motion. Use solid readable bidding surfaces, system-like typography with Malayalam support, and restrained jersey/scorecard motifs. This supersedes the original forest-green/lime direction.

| Surface | Primary content and action |
|---|---|
| Public home/club page | Club identity, auction date, player registration, manager application and published results. |
| Platform console | Clubs, credit products, payments, manual grants and operational health. |
| Club dashboard | Upcoming auction, approval queue, readiness, credits and past events. |
| Auction setup wizard | Basics → rules → teams → registrations → readiness → lock. |
| Player directory | Photo cards, role/style filters, status and approval details. |
| Manager mobile room | Current player, own purse/reserve, leading bid, large next-bid control, connection status and recent accepted bids. |
| Auctioneer console | Current lot, preview queue, operator health, bid feed, close/sell controls and pause. |
| Auditorium projection | Large photo/name/role, points, leading crest, clear sold/unsold status; rotating team summaries between lots. |
| Team squad view | Purchased players, role distribution, purse spent/remaining and slots. |

Destructive auction actions require a deliberate confirmation. Bid submission uses a single large control with pending lockout; do not add a confirmation modal to every bid. Sold animations respect reduced motion. No essential information depends on colour or sound. Target WCAG 2.2 AA; keyboard control for auctioneer; minimum 44px touch controls. Initial responsive targets: 360px phone, 768px tablet, 1440px console, 1920×1080 projection.

## 9. Reliability and performance targets
Proposed initial validation envelope: 10 concurrent auctions, each up to 20 teams, 300 players and 500 read-only viewers; 50 competing bid requests/second per auction in stress tests. These are test targets, not a capacity claim.

Bid acceptance response p95 ≤500ms and committed update to connected display p95 ≤1 second under the test envelope, measured in an India-region deployment with documented network conditions. Reconnection and full snapshot p95 ≤5 seconds after connectivity returns. No accepted bid lost after acknowledgment; backup disaster recovery targets RPO ≤5 minutes and RTO ≤60 minutes, subject to purchased hosting/backup plan. Event-day manual rehearsal and recovery drill are required.

## 10. Scope exclusions and launch decisions
No match scoring, fixtures, fantasy wagering, player payments, automated AI valuations, native apps or offline bidding in the initial product. A full LAN-only deployment is a separate operating mode requiring packaging, local networking and reconciliation design.

Before public launch: confirm product name, club branding, license pricing/package expiry/refund policy, merchant ownership/payment provider, hosting budget, retention duration, minor eligibility and support contact. These do not block design or implementation using adapters and proposed defaults. Do not fabricate credentials or live payment success.

## 11. Definition of release readiness
Complete one rehearsal from club onboarding through purchase/manual credit, player/manager approvals, locked setup, multi-device bidding, intentional disconnect, simultaneous bid, sold/unsold recall, correction and reconciled exports. Pass tenant/role security tests, restore a backup, validate English/Malayalam screens, and demonstrate operation on real phones plus projection. Production launch requires configured merchant/hosting identities and club acceptance of published rules.
