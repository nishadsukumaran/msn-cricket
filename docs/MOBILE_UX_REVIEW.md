# Mobile UX verification — 13 November 2026

Scope: implemented manager live room, overview, player search, own squad, organizer setup/approvals/licenses/reports and player form; separate public projection. Authority: India Glass MASTER.md, PRD and implementation blueprint. Review used browser rendering, accessibility-tree/axe checks and source inspection under the accessibility and mobile-native skills.

## Verified

- English live room rendered at 320, 360, 375, 390, 768, 1440 and 1920 CSS pixels with no document horizontal overflow.
- Malayalam live room rendered at 360px; language toggle retains auction state and command identity. Club/player names remain as supplied.
- Organizer overview, players, squad, setup, approvals, billing, reports and registration rendered at 360px with no document overflow.
- Automated axe WCAG A/AA checks on the inspected organizer screens and English/Malayalam live room report zero violations in the latest passing browser suite.
- Real server acknowledgments drive bid/leader state; one manager's accepted bid updates the other manager, and settlement reaches the projection view.
- Native disabled bid states cover pending/leading/stale/disconnected/closed/paused/full/unaffordable. Offline/online events force disconnect, reconnect and fresh snapshot. Offline bids are never queued.
- Uncertain commands retain their original command ID. Background checks are read-only. Deliberate retry is blocked until synchronized and has an in-flight lock.
- Forms have visible wrapping labels, native constraints and correct email/tel/date/numeric keyboards. Inputs are at least 16px; zoom is not disabled. Errors retain form values.
- Native confirmation/prompt dialogs protect settlement and correction. Visible focus styles, skip link, semantic controls, reduced-motion rules, text status cues, solid-surface fallback and bottom safe-area clearance are implemented.
- Live hierarchy was compacted after screenshot review so the player, amount and bidding control sit higher on phones. Long Malayalam labels wrap rather than truncate. Natural scrolling keeps all controls reachable above the bottom navigation.
- Photos are decoded, dimension/size/type checked, auto-oriented, resized, re-encoded to WebP and stripped of metadata before storage. Public retrieval requires an approved registration and published auction.

## Evidence

`tests/rehearsal.spec.ts` is the reproducible browser test. Screenshots, failure traces and the HTML test report are generated under `artifacts/` (ignored from version control). Images include `live-360.png`, `live-malayalam-360.png`, `projection-1920.png` and one image per organizer screen.

## Remaining acceptance gates

Physical iOS/Android browsers, actual safe-area/keyboard behavior, landscape and 200% browser/text zoom still require hands-on verification. Native screen-reader speech output and a complete keyboard-only business rehearsal have not been certified by the automated checks. Malayalam copy needs a fluent reviewer, including server-origin user data/styles and less frequent error codes. Rendered axe checks do not establish complete WCAG conformance. Actual venue projection, network quality and low-end Android performance remain event-day rehearsal requirements.

## PRD completion pass

The completion browser suite additionally covers Staff/Display/Branding/Event health/Profile in English and Malayalam at 360px, private-display revocation, a sanitized photo/profile save→reuse→registration→withdrawal journey, and the platform catalog at 360px. These checks include native keyboard focus, a landscape viewport and automated axe scans. Button-state colour interpolation was removed after the platform audit exposed an intermediate low-contrast frame. Long platform lists expose more-record controls rather than rendering an unbounded mobile page.

The final passing browser run contains eight suites. Native screen-reader speech, actual device zoom, real iOS/Android keyboards/safe areas, a fluent Malayalam review and venue hardware remain external acceptance activities; simulated widths and an accessibility tree are not represented as those acceptances.
