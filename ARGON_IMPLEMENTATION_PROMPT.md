# MoatWatch — Implement Premium UI Redesign

You are operating as a principal frontend engineer, product designer, design-system architect, and motion designer.

## Context / reference files
- Target visual concept: `design/reference/target/moatwatch_premium_concept.png`
- Current product UI references: `design/reference/current/*.png`
- The target image is an **illustrative visual design**, not a precise functional specification. It contains invented ticker examples, prices, account statistics, visualized device data and illustrative labels. Do NOT copy these invented values into production. Use the repository's actual data, calculations, APIs, and app states.
- The current screenshots document EXISTING product capabilities and rough architecture, NOT the desired look.

## Objective
Modernize the complete EXISTING MoatWatch web app based on the target concept, to a premium, high-end luxury fintech + professional trading terminal visual language, while retaining full functionality, usable Thai typography, responsiveness, accessibility and performance. Do not create a static replica or placeholder-only frontend.

## Non-negotiable functional requirements
- Keep current portfolio and multi-portfolio management, holdings, watchlist, sorting/filtering, editable asset details, returns and currency conversions operational.
- Keep actual market data sourcing and refresh behavior unchanged unless a bug is proven.
- Preserve WebMemo create/edit/read, per-stock note association, alert settings, earnings, import/export, and all other existing user workflows.
- Preserve Garmin watch preview, device model selection, watch payloads, watch sync, device settings, and all Monkey C / API contracts.
- Preserve existing login/user isolation, sync key handling, licensing, purchase/trial flows, admin links, data persistence, permissions, and endpoints.
- Never expose credentials, private sync keys, full license tokens, or confidential endpoints in screenshots or design mocks. Mask where appropriate.
- Never invent financial data or fake real-time statuses. Use the actual data store or explicit demo-mode fixtures clearly labeled as demo.
- Do not rewrite backend/business logic during the visual overhaul. Any necessary service interface changes require tests and justification.

## Visual reference interpretation
Follow the composition and art direction shown in `design/reference/target/moatwatch_premium_concept.png`:
1. Purposeful dark navy surfaces, thin muted outlines, sparse cyan/teal highlights, and restrained market green/red.
2. Strong horizontal global navigation for Portfolio, Markets, WebMemo, Earnings, Garmin, Alerts and Settings as supported by existing app features.
3. Premium portfolio summary with clearly prioritized total value, daily P&L, total return, market status and a meaningful performance chart. Only render charts based on available real data; omit/label unavailable measures rather than inventing history.
4. High-density, scan-friendly holdings table replacing dozens of repetitive cards. Preserve all per-asset functions via accessible row actions, details drawers or popovers. Use virtualization if appropriate for scale.
5. Flagship Garmin panel with a real functional preview, selected ticker/portfolio context, sync states, and logically organized controls. A rendered watch visual may be stylized but must accurately reflect actual preview state and supported device behavior.
6. Secondary intelligence modules for WebMemo, earnings/catalysts and active alerts, only where backed by existing data/features. Avoid unrelated fabricated news/cards.
7. Put utilities, backup, device installation docs, raw API tools, trial/license management and admin tools in appropriate Settings/Tools views while remaining discoverable.

## Design system and motion
- Inspect the actual frontend framework/package versions; adopt the existing stack, rather than blindly replacing it.
- Create centralized tokens for backgrounds, surfaces, text, semantic financial colors, borders, spacing, radius, focus styles, typography and shadows.
- Use robust Thai + Latin font pairing, tabular numerals for financial numbers and consistent currency/date formatting.
- Make the composition visually polished at 1440px desktop, 1024px laptop/tablet and 390px mobile.
- Prefer Motion for React if this is a React application and it fits the existing stack; otherwise use the stack's native motion primitives.
- Apply subtle number updates, sorting/layout transitions, chart loading/change states, watch-screen transitions and meaningful hover/focus feedback. Avoid noisy endless animation and expensive rendering.
- Honor prefers-reduced-motion; maintain contrast and keyboard navigation. Do not compromise data clarity for visual effects.

## Execution plan
Phase 0 — Inspect the repository, working tree, routes, UI components, assets, API interfaces, tests and current app behavior. Do not discard user changes.
Phase 1 — Inventory existing features and map every current capability to a destination in the new information architecture. Highlight anything missing from the visual concept.
Phase 2 — Create brief `design/REDESIGN_PLAN.md` with new navigation, component architecture, design tokens, motion specification, implementation phases and risk/rollback strategy.
Phase 3 — Implement a working high-quality main Portfolio page, using existing data and API contracts; redesign the holdings table and Garmin preview without breaking interactions.
Phase 4 — Extend the visual system consistently across secondary pages, drawers, dialogs, empty/loading/error states, settings and mobile.
Phase 5 — Run existing tests and add regression coverage for key workflows. Visually verify using a real browser at viewport widths 1440, 1024 and 390. Capture before/after screenshots into `design/captures/` with descriptive filenames. Critique results and make at least two concrete visual refinements if browser capture is available.
Phase 6 — Report updated files, functional smoke-test results, screenshots, any limitations and unfinished work. Do not claim capture/test success unless completed.

## Required acceptance checks
- Layout is dramatically improved, with no large unused right-hand column beneath the Garmin panel.
- Holdings are scannable and sortable; all 40+ assets remain accessible, editable and accurately valued.
- All existing data and device workflows work without changing their meaning.
- No mockup financial values have been copied into real app state.
- Desktop/mobile UI is coherent, accessible and free of obvious overflow.
- No credentials or unique device keys are accidentally exposed in screenshots.
- A visual quality review is performed; do not stop at a superficial dark-theme reskin.

Begin by reading both sets of images and inspecting the repository; then implement incrementally. Do not ask for unnecessary confirmations. If a feature is unclear, inspect the code rather than guessing.
