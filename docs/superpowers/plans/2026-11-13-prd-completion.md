# PRD completion implementation plan

> Implement against the existing approved PRD, architecture and India Glass design. User requested completion, so execute without another design gate. Keep one transaction authority and preserve prior tests.

**Goal:** Close the remaining controllable PRD implementation gaps and record external acceptance evidence separately.
**Spec:** docs/MSN_Cricket_PRD.md; docs/MSN_Cricket_Implementation_Blueprint.md.
**Stack:** Existing Next.js, NestJS, PostgreSQL, Socket.IO and private S3 adapters.

1. Access and presentation: add owner-managed staff roles, paused/audited operator handover, revocable expiring display credentials, public-safe private projection and logos. Tables/functions live in migration 008; application logic in admin.ts; authorized routes in prd-controller.ts; manager/admin UI in management.tsx. Tests cover cross-club grants, revoked staff, operator uniqueness, token rotation/revocation/expiry, unpublished data and photo redaction.
2. Player journey: reusable own profile read/update, snapshot-preserving registrations, withdrawal before opening and duplicate review signals. profiles.ts owns privacy and validation; registration uses a shared profile validator and upsert. Tests prove other-user denial, historical snapshot stability and withdrawn selection denial.
3. Commerce/operations: catalog and platform order console, manual credit revocation, exact payment/refund binding, partial-refund billing exceptions, idempotent reconciliation, configurable retention/image cleanup, operational metrics and alerts. jobs.ts and platform.ts own the additions; no live payment is assumed. Tests use provider fixtures and actual database/storage effects.
4. Finish complete application journeys in English/Malayalam and add PWA metadata without offline mutation caching. Render administrator/manager/public/account flows at mobile widths, landscape and text-resize; test keyboard focus and negative permission states.
5. Run all suites, full compilation, lint/format/audit, logical restore, restart/replay and measured local load. Independent final code review. Update F01-F19 acceptance matrix with source/test evidence and explicit external-provider/physical-device/deployment gates.

Global constraints: integer points, exact-next bids, no player money, mandatory server authorization, stable command IDs, no offline bid replay, immutable accounting, redacted public data, reasoned destructive actions and reduced-motion support.
Review focus: role changes during events, token leakage through public images, source-profile edits rewriting history, duplicate/refunded payment effects, cleanup deleting still-referenced images, reconnect leaving manager eligibility stale.

## Execution record

Tasks 1-4 implemented: scoped staff and ownership, paused operator transfer, private display/assets, branding, reusable profile/withdrawal/privacy, duplicate signals, platform catalog/license requests/revocation, refund-aware rotating reconciliation, safe image-maintenance claims, support/suspension, metrics/history, bilingual controls and PWA metadata. Local integration suite now has 29 passing tests; browser suite has 8 passing journeys. Task 5 has a fresh-database check, production compilation, review fixes, bounded load and restore evidence. External provider/physical/deployment acceptance is explicitly retained as an external gate rather than fabricated.

Review fixes: protect image attachment with row locks and recheck references after waits; commit tombstones before external deletion; rotate reconciliation batches using inspection times; reconcile known refund state before minting credits. These are pinned by real-database recovery/refund tests.
