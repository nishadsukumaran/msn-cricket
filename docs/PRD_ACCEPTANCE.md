# PRD implementation acceptance matrix — 13 November 2026

Authority: MSN_Cricket_PRD.md, approved architecture/blueprint and India Glass design system. “Implemented” below refers to application code with local evidence. It does not assert completed merchant/identity onboarding, production capacity, human language acceptance or physical-device acceptance.

| Requirement | Implementation | Reproducible evidence |
|---|---|---|
| F01 Club isolation | Transaction-local tenant context, restricted runtime identity, membership/role revalidation, scoped sockets; explicit expiring audited platform support | preparation.integration, prd.integration; runtime/default-deny and cross-club negatives |
| F02 Auction configuration | Name/venue/IST schedule/deadline, team capacity, selection mode, purse/base/increment/squad/reserve, public visibility; changes before lock reset purse and require player reapproval | prd.integration rule/schedule test; setup browser surface |
| F03 Player registration | Reusable own profile, adult validation, sanitized photo, optional base, consent, pending/review/resubmit/withdraw, private contact review and redacted snapshots | preparation.integration, prd.integration, storage.integration; completion browser profile journey |
| F04 Manager onboarding | Verified-account invitation and self-application converge into review; pending manager cannot bid; one active operator; paused/audited handover and observers retain team view | preparation.integration and prd.integration |
| F05 Teams | Name/code/colour/logo management, capacity checks, unique codes, approved operator assignment | PostgreSQL constraints, branding service, management browser surface |
| F06 Readiness/locking | Valid rules, enough approved players, resolved reviews and approved operators; lock before start; real start redeems a credit atomically | lifecycle/domain and auction integration; rule edits force reapproval |
| F07 Player selection | Approved available players only, audited random pool, one unsettled lot, explicit recall; withdrawal prevents opening | domain/auction integration; unique database index |
| F08 Authoritative bidding | Actor/operator/live/lot/version/exact amount/purse/reserve/squad checks under auction lock | domain tests; real PostgreSQL competing bids |
| F09 Simultaneous bids | Single serialization authority; stale rejection contains current state; no automatic rebid | 50-request race, bid/close race, manager browser contexts |
| F10 Retry safety | Stable actor/command key plus request hash and committed outcome; uncertain commands preserve identity and need explicit synchronized retry | auction integration; lost-before-server browser case |
| F11 Sold | Close distinct from sell; allocation, purse, ledger, event/outbox/audit and command result commit together | settlement/duplicate sale integration and browser projection |
| F12 Unsold/recall | No-bid unsold; separate reasoned correction and fresh attempt; random selection never silently recalls | domain/auction integration |
| F13 Pause/recovery | Bid blocked on pause/stale/offline; foreground/online resubscribe and snapshot; durable cursor/replay; no queued offline mutation | sync domain; disconnect/reconnect and uncertain-command browser cases |
| F14 Correction | Paused, reasoned, downstream-safe reversal; explicit reversed outcome, compensating ledger, recall and resale | reverse→recall→resell integration and public state checks |
| F15 Projection | Independent read-only redacted stage, squads/purses/leader/points, reduced-motion sold feedback, private expiring/revocable/rotated credentials and token-authorized assets | display integration; private projection revoke browser case; 1920px screenshot |
| F16 Reports | Approved pool, allocation history, unsold, immutable ledger and bids; escaped CSV with stable IDs and explicit IST strings | report assertion in auction integration; mobile report links |
| F17 Language | English/Malayalam navigation, status/action/error copy, forms and management views; persistent toggle; entered names/styles stay unchanged | dictionaries and English/Malayalam mobile checks; fluent review remains external |
| F18 Licensing | Configurable catalog, checkout adapter, raw signature/merchant/order/amount/currency verification, event/refund idempotency, provider recovery, partial-refund exceptions, manual request/approval/revoke and one real-start redemption | commerce.integration, last-credit race, platform catalog/browser journey; live provider sandbox remains external |
| F19 Completion | Unresolved lot/player rejection, unique allocations, exact team/ledger/allocation reconciliation before completion; immutable history and restore check | auction integration, database constraints, isolated snapshot-consistent restore |

Additional architecture deliverables: owner-managed staff/ownership transfer, MFA claim enforcement for production administrators/platform identities, private image tracking and race-safe tombstone/purge maintenance, configurable retention, session expiry, operational metrics/alerts/history, background reconciliation command, suspension/recovery, separate non-convertible fictional rehearsals, PWA metadata with network-only fetch and no mutation cache, CI workflow and container build recipe.

## External release acceptance

The following require external accounts, an agreed policy or physical/human acceptance and are not converted to “passed” by this matrix:

- Chosen OIDC provider integration, verified email delivery and provider-specific MFA policy/claims.
- Chosen merchant, agreed prices/tax/expiry/refund policy, actual sandbox checkout/refunds/webhook delivery, and production merchant activation.
- Real Android/iOS and native screen-reader rehearsal, actual 200% browser zoom, fluent Malayalam review, club artwork/branding and organizer rules acceptance.
- India-region hosting/TLS/DNS/secrets/support channel and managed backup/PITR; deployment-envelope load, restart and disaster-recovery targets on that deployment.
- Explicit production data-retention/image-cleanup periods. The implementation requires configured periods and does not invent a production retention contract.

See BUILD_STATUS.md for exact executed checks and measured local limits. No production deployment or external acceptance is implied by source upload.
