# MSN Cricket — India Glass design system
Version 1.0 · 12 November 2026
Status: proposed UI direction, based on approved PRD and technology stack.

## Intent
Mobile-first cricket auction product with India-inspired blue and saffron, bright frosted navigation, restrained motion and clearly legible transaction surfaces. This supersedes the earlier forest-green/lime visual direction. Colours are inspired by Indian cricket, not a claim of official team branding. MSN's official logo remains to be supplied; the typographic crest in the preview is a placeholder.

## Tokens
| Role | Value | Usage |
|---|---|---|
| Action blue | #0759D3 | Primary buttons, selection, links |
| Deep ink | #10254B | Primary text and projection background |
| Saffron | #FF8637 | Sporting accents and emphasis; use dark ink on it |
| Canvas | #EDF3FB | App background |
| Text secondary | #52637E | Supporting information |
| Surface | White at 82–95% | Cards; increase opacity behind dense text |
| Positive | #08704E | Accepted/approved, accompanied by text/icon |
| Divider | #DCE5F2 | Decorative grouping; stronger border on controls |
| Radius | 12 / 14 / 24px | Fields / controls / cards |
| Spacing | 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48px | Shared rhythm |
| Glass blur | 16px, fixed surfaces only | Navigation and selected cards |

Use semantic CSS variables mapped to Tailwind theme tokens in production. Do not apply blur to every player row or animate filters. Solid white fallback when backdrop-filter is unavailable. Support high-contrast/reduced-transparency treatment and evaluate composed text contrast, not only raw palette swatches.

## Typography
Use a locally hosted system-like sans family (Inter or equivalent) with Noto Sans Malayalam fallback for Malayalam. The self-contained preview uses system fonts and needs no font network request. Body 16px/1.5, supporting text 13–14px, labels 13px semibold, headings 28–38px, live numbers 48–54px. Use tabular numerals for points and timers. Uppercase micro-labels are decorative context, never the only important instruction. Malayalam uses natural casing, extra line height and flexible button widths; no forced English uppercase styling.

## Navigation and surfaces
- Phone: bottom navigation limited to Overview, Live, Players, Squad and Club. Safe-area padding and content clearance required. Club expands to setup, approvals, licenses, staff and reports according to role.
- Desktop: sidebar and spacious two-column layouts; administrative lists can become tables. Phone uses labelled cards rather than horizontally scrolling tables.
- Role switching in the design preview is a review aid. Production shows only authorized destinations after authentication and explicit club/team context.
- Player and manager onboarding use separate entry routes. Managers receive invite or application/approval state before their live room appears.
- Auditorium: independent read-only high-contrast broadcast layout; no private data, manager controls or commerce. Big player name, points and leading/winning team.

## Screen inventory and production routes
| Screen | Intended route | Main decision |
|---|---|---|
| Club home | /clubs/:slug | Register as player or apply as manager |
| Manager overview | /auctions/:id/overview | Enter event, understand purse and readiness |
| Live room | /auctions/:id/live | Place exactly the next eligible bid |
| Player pool | /auctions/:id/players | Search/filter approved players |
| Squad | /auctions/:id/teams/:team | Inspect allocation, purse and role mix |
| Player registration | /auctions/:id/register | Submit profile, optional base request, consent |
| Application status | /auctions/:id/my-registration | Pending, changes requested, rejection, approval |
| Manager application/invite | /auctions/:id/join-team | Apply or accept invitation, await approval |
| Setup | /club/auctions/:id/setup | Progressive auction rules, teams, readiness, lock |
| Approvals | /club/auctions/:id/approvals | Review player/manager details and reasons |
| Auctioneer console | /club/auctions/:id/control | Preview/open/close/confirm settlement |
| Licenses | /club/billing | Credits, checkout/manual request, receipt status |
| Projection | /display/:token | Public-safe synchronized broadcast |

Nine representative screens are implemented in the design preview. Public landing, full authentication, manager application detail, complete setup wizard, rejection/correction dialogs and the full auctioneer console still require production component design. The preview is not an implementation of the auction engine.

## Live bidding state contract
| State | CTA and feedback |
|---|---|
| Ready | Blue button: Bid [next amount] points |
| Sending | Disabled: Confirming bid…; preserve command identity |
| Accepted/leading | Disabled: You are leading + check; update only after server ack |
| Outbid | Next bid becomes available after fresh event/snapshot |
| Conflict | Announce that another bid was accepted; refresh amount; no automatic rebid |
| Disconnected/stale | Disabled: Reconnecting; no queued offline bids |
| Paused | Disabled: Auction paused; operator reason when supplied |
| Unaffordable/full | Disabled with exact explanatory text |
| Closed | Bidding closed; pending auctioneer confirmation |
| Sold | Winning team and points; own purse updates after committed settlement |

Show base, current accepted bid, leader, next bid, purse, squad and max eligible bid clearly. Points never use a rupee sign. Prices appear only in licensing. Mobile live layout orders player → bid action → activity; production can add a compact sticky bid dock after scroll, with safe-area clearance and no obstruction of form focus. Keep its amount synchronized with the same authoritative state as the full control.

## Motion choreography
Press: 100–150ms opacity/colour response, optional scale 0.98 without moving surrounding layout. Page entry: 250–350ms opacity + 8px translation. Accepted bid: 180–240ms emphasis, no looping pulse. Player change: 250ms crossfade preserving layout. Sold moment: one short 500–700ms celebration behind stable result text; never imply success before commit. Sheet opening: 220–300ms with focus containment; faster exit. Respect reduced motion by removing transforms and decorative animation. Screen readers receive concise important status updates, not every decorative numeric frame. Never animate a fake countdown; auctioneer closure remains authoritative.

## Glass treatment
Apple-inspired material depth, not an imitation of native iOS chrome. Use translucent white navigation with hairline highlights, subtle shadows and layered blue canvas. Keep action surfaces sufficiently opaque and visible on low-end Android devices. Bound blur layers, avoid large overlapping effects and fall back to solid surfaces. No continuous glow/shimmer behind bidding controls.

## Forms and accessibility
Visible labels and inline errors, 48px touch controls, at least 8px between targets, visible focus, native inputs with correct autocomplete/inputmode. Keep form values through validation failures. Actual submission must validate on server and show pending approval. Preview uses browser-native constraints and explicitly stores/uploads nothing. Photos require type/size/dimension validation in production. Modals need keyboard close, initial focus, containment and focus restoration. Prototype uses native dialog. Critical status is text plus icon, never colour alone. Target WCAG 2.2 AA; contrast and real-device testing remain release gates.

## Next.js implementation mapping
Use App Router route layouts, React/TypeScript components, Tailwind semantic tokens and accessible primitives. Separate presentational views from query/Socket.IO state; animations never modify auction authority. Components: AppShell, ClubSwitcher, BottomNav, AuctionStatus, PlayerHero, PointsAmount, BidAction, PurseSummary, TeamCard, ApprovalCard, RegistrationForm, RuleSummary, ReadinessChecklist, LicenseCard and ProjectionStage. Keep critical bid state in one client store fed by snapshot/events. Use next/link navigation, server-authorized pages, validated shared contracts and stable player IDs.

## Validation record
Completed: JavaScript syntax check; smoke rendering of all nine screen templates; paused bid control state check; no external assets required by preview; responsive CSS with 760/1100px changes; reduced-motion and opaque glass fallback rules.
Outstanding: rendered browser screenshots, 360/375/390/768/1440/1920px overflow inspection, landscape, 200% text zoom, actual focus/keyboard walk-through, screen reader, measured composed contrast, performance on Android, Malayalam translation review, mobile browser file input behaviour and full user-flow tests. The environment blocked local server binding and browser local-file access, so no visual/device verification is claimed.

## Production-component verification update — 13 November 2026

The historical preview validation above is superseded for the new Next.js implementation by `docs/MOBILE_UX_REVIEW.md` and `docs/BUILD_STATUS.md`. The implementation has rendered browser evidence, automated accessibility checks and persistent multi-manager rehearsal tests. Those records distinguish local verification from physical-device, fluent-language and production acceptance gates.
