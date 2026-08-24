# Candidates for removal

Pages/components that look like dead code or sit awkwardly against `PORTAL_SPEC.md`'s
two-persona rule (builder/customer and QS admin). Phase 1 removed the novelty theme
skins and the unrouted Notetaker page. **Phase 2 (UI improvements branch) removed the
entire Office in a Box add-on** — all of its pages, components, routes and nav — plus
the dead code listed below (ChangePasswordPage, GoogleSuccessPage, ProjectsPage,
ProjectManagerPage, the unrouted pages/AdminNotifications duplicate, chat-styles.css)
and PipelinePage. Old OiB bookmarks redirect to /ai-trades-pilot. The public
quote/invoice token pages (/q/:token, /i/:token) were kept so links already sent to
builders' clients still resolve. Server-side OiB routes are untouched for now —
removing them is a separate backend decision.

## Dead code (not routed / not imported anywhere)

- `src/pages/ChangePasswordPage.js` — no route in `App.js`, no importers; password change is not reachable in the UI.
- `src/pages/GoogleSuccessPage.js` — no route; Google OAuth callback landing that nothing links to.
- `src/pages/ProjectsPage.js` — no route; superseded by `DashboardPage` (My Projects).
- `src/pages/ProjectManagerPage.js` — no route; old AI project-manager experiment, superseded by Office in a Box pages.
- `src/pages/AdminNotifications.js` — unrouted duplicate; the live component is `src/components/AdminNotifications.js`.
- `src/chat-styles.css` — imported in `src/index.js` but none of its classes are used (`ChatPage` is fully inline-styled); dead weight on every page load.

## Violates the two-persona rule / spec page discipline (routed, needs a decision)

- `src/pages/PipelinePage.js` (`/pipeline`) — spec explicitly says the Pipeline view collapses into the home page; it is not a lifecycle destination for either persona.
- `src/pages/Builder3DPage.js` (`/builder3d`, admin-only "Preview") — a three.js sandbox serving neither persona's workflow; spec lists nothing like it and it ships `three` to the bundle.
- `src/pages/CalculatorsPage.js` (`/calculators`) and `src/pages/MaterialsPage.js` (`/materials`) as top-level routes — reference libraries, per spec they belong behind Tools (they already appear there), so the standalone routes are duplicate entry points.
- `src/components/WhatsAppWidget.js` — floating third-party contact bubble on every page; spec's chat/messaging is "not in scope" and it competes with the portal's own Chat.
- `src/components/OnboardingTour.js` vs `src/components/OfficeTour.js` — two separate tour systems with different versioning and theming; one should absorb the other.
- `/settings` alias route → `BrandingPage` (in `App.js`) — duplicate path to the same page; keep one.

## Notes

- `NotetakerPage.js` was deleted in Phase 1 (unrouted, no backend, external Stripe link only).
- Office in a Box pages (`OfficeInABoxPage`, `OfficeDemoPage`, popup, tour, box art) are explicitly kept.
