# Build status — 13 November 2026

The PRD application workflows are implemented locally. The acceptance matrix in PRD_ACCEPTANCE.md maps F01–F19 to code and tests. External provider, policy, deployment and physical-device acceptance remains separate from implementation completion.

## Completed application work

- Persistent Next.js/React/Tailwind + NestJS/Socket.IO + PostgreSQL + private S3-compatible storage; 18 versioned migrations and restricted runtime/worker identities.
- Complete auction preparation, configuration, readiness/locking, operator bidding, close/sell, unsold/recall, reasoned reversal/resale, completion/reconciliation and CSV reporting.
- Reusable player profile/photo, registration review/resubmission/withdrawal, duplicate-review signals, private contact inspection, account anonymization and ownership transfer.
- Owner-managed staff, explicit paused handover, retained observer squad access, expiring audited support, suspension with visible pause, club/team branding and private token/asset access.
- Configurable credit catalog, manual request/approval/grant/revoke, checkout adapter, verified/replay-safe captures/refunds, billing exceptions and batched provider-status recovery.
- Durable event recovery, stale/offline/foreground gating, stable uncertain-command identity and venue-safe per-actor/per-auction rate limits.
- English/Malayalam management, player, manager and public surfaces; phone/tablet/projection layouts, accessible native controls, reduced-motion feedback and network-only PWA metadata.
- Separate fictional non-convertible practice auctions with approved operators and sample rosters; practice start does not consume real credits.
- Configurable maintenance and session retention, referenced-image protection, committed deletion tombstones and retried physical purges, platform metrics/alerts/job history, CI and container recipes.

## Evidence

- Domain suite: 18 tests.
- PostgreSQL/S3/API integration suite: 29 tests, covering concurrency, roles, private display, profile/privacy, handover, ownership, credits, refunds, reconciliation rotation and cleanup failure recovery.
- Browser suite: 8 passed. It covers the original manager/organizer flows plus new management/profile views, private projection revocation, photo/profile reuse and platform catalog. Final executed results are recorded in generated logs under artifacts/.
- API/shared/web TypeScript, lint, formatting and production build checks run locally.
- Fresh-database check applies all 18 migrations; migration reruns preserve applied versions. Local backup/restore uses one exported PostgreSQL snapshot and verifies ledger/allocation/event/redemption counts and exact balances.
- Bounded local load: 1 auction, 20 teams, 300 players, 50 viewers, 50 bid requests/second for 5 seconds. Observed 250 bids, 240 accepted and 10 stale conflicts, bid p95 20 ms, public-read p95 23 ms, no read/network failures. This is not proof of the full 10-auction/500-viewer India-region target.

## Review and recovery fixes

Independent review found and implementation corrected image attachment/cleanup races, deletion markers rolling back after successful external deletes, reconciliation batches starving newer orders, and missed partial-refund callbacks incorrectly recovering full credits. Deletion claims now commit before storage effects; attachment locks plus a fresh reference recheck protect live records; per-order inspection times rotate batches; provider refund state is reconciled before minting credit.

Earlier regression fixes cover reverse/recall/resale, normal random selection excluding attempted players, explicit uncertain-command retry gating, brief offline/online recovery, reserve/base/increment validation, venue Wi-Fi rate limits and host-independent IST export times.

## External acceptance still required

Configure and exercise the selected OIDC/MFA provider and merchant sandbox; confirm commercial/refund/retention/support policies; validate actual Android/iOS, native speech output, 200% zoom, fluent Malayalam and venue projection; choose hosting and validate production load, fanout, backup/PITR and disaster-recovery targets. No remote deployment, merchant payment, real-provider login or human acceptance is asserted.

README.md, RUNBOOK.md, MOBILE_UX_REVIEW.md and PRD_ACCEPTANCE.md are the handoff. The source is prepared for the user-selected GitHub repository; generated logs, databases, credentials, fixture sessions and local storage configuration are excluded.
