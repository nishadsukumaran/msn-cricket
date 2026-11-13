# MSN Cricket Auction Platform

A working local full-stack continuation of the approved PRD, architecture, blueprint and India Glass design system. The original browser-only experiment remains under `prototype/` and is not served by the application.

**Open the running local app: http://localhost:3018.** Use the explicitly fictional rehearsal login to enter as club organizer or either team manager. The API, PostgreSQL and private S3-compatible image store are separate persistent services.

## Run

Requires Node 24+ and Docker. From the project root:

```sh
npm ci
node scripts/setup-local.mjs
npm run storage:config
docker compose -f infra/compose.yaml up -d --wait
npm run db:migrate
npm run storage:init
npm run db:seed
npm run dev:api
```

Run `npm run dev:web` in another terminal. The setup script creates random local secrets only when `.env` is absent and preserves existing settings. See [the runbook](docs/RUNBOOK.md) for identity, merchant, storage, deployment and recovery configuration.

## Implemented

- Next.js/React/Tailwind interface with English/Malayalam switching, manager phone room, organizer controls, player search, squads, setup, approvals, licenses and CSV reports.
- Public club entry and separate redacted projection; verified-email OIDC adapter with code/PKCE/nonce/state checks; server-side session cookies and explicit local-only rehearsal sessions.
- Club/auction creation, player submission/resubmission, manager applications/invitations/approval, team setup, readiness/locking and optional-base resolution.
- PostgreSQL command serialization, exact-next bids, versions, retry-safe command identities, reserve/squad validation, closed-before-sold settlement, immutable ledger entries, reversal and explicit recall.
- Atomic credit redemption, platform-only manual grants, optional checkout adapter and signed/replay-safe webhook processing. No real merchant sandbox was configured.
- Private S3 image upload/read adapter with decoding, size/dimension/type checks, EXIF removal and re-encoding; exercised against isolated local SeaweedFS.
- Durable event replay/outbox, disconnected bid gating, uncertain-result recovery and reconciliation.
- Restricted database runtime/delivery identities, versioned migrations, integration/browser tests and an isolated backup/restore check.

## Verify

With local infrastructure running:

```sh
npm test
npm run test:integration
npm run test:prototype
npm run lint
npm run typecheck
npm run format:check
npm run build
npm audit
```

With web and API also running, use `npm run test:e2e`. Use `npm run test:restore` for the isolated logical-restore drill. The GitHub workflow runs these checks on pushes and pull requests; local verification and remote CI/deployment status are reported separately.

[Build status](docs/BUILD_STATUS.md) records the current acceptance evidence and remaining work. [Mobile review](docs/MOBILE_UX_REVIEW.md) states exactly which viewport, accessibility and recovery checks ran. The remaining PRD workflows are covered in [the acceptance matrix](docs/PRD_ACCEPTANCE.md), including staff/ownership, handover, private display, profile/privacy, billing recovery and operations. Public release requires real identity/merchant sandbox verification, agreed production policies, physical-phone/venue and fluent-language acceptance, and validation of the deployment load/recovery envelope.
