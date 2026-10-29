# MoatWatch — Premium Fintech & Garmin Portfolio Terminal Redesign Plan

## 1. Visual Diagnosis & Reference Audit

### A. Current Interface Audit (`design/reference/current/`)
1. **Visual Clutter & Competing Accent Colors**:
   - The previous interface mixed neutral slate (`#0A0D14`), bright indigo (`#4F46E5`), purple gradients, emerald, amber, and sky blue across pills and borders, diluting the luxury financial terminal identity.
2. **Vertical Card Stacking & Poor Scan Density**:
   - Individual holdings were rendered as multi-line stacked cards with nested metric boxes (`Market Price`, `Market Value`, `Unrealized P&L`) and repeated action toolbars. Scanning 15–40 holdings required excessive vertical scrolling and made cross-asset comparison (price, daily %, 14D trend, weight %, unrealized P&L) difficult.
3. **Asymmetric Layout & Empty Space Under Watch Simulator**:
   - The right-hand sticky column contained the Garmin Watch Simulator followed by a long vertical stack of collapsible sections (Backup, Sideload, License), while the left column stretched far down the page—or conversely left large dead zones depending on portfolio size.
4. **Disconnected Secondary Workflows**:
   - WebMemo notes, upcoming earnings dates (`e-dd/mm/yy`), and price/RSI alerts were buried inside individual holding modals or badges rather than surfaced as dedicated intelligence modules for rapid review.

### B. Target Concept Audit (`design/reference/target/moatwatch_premium_concept.png`)
1. **Color & Surface Architecture**:
   - Deep obsidian-navy canvas (`#060A10`) paired with elevated carbon-teal surfaces (`#0B121C`, `#101A28`) and crisp 1px cyan-slate hairlines (`rgba(56, 189, 248, 0.14)`).
   - Restrained cyan/teal primary accents (`#06B6D4` / `#14B8A6`) for active navigation, interactive tabs, and focus rings; disciplined emerald (`#10B981`) for positive P&L and rose (`#F43F5E`) for drawdowns.
2. **Top Global Command Bar**:
   - Unified horizontal navigation (`Portfolio`, `Markets`, `WebMemo`, `Earnings`, `Garmin`, `Alerts`, `Settings`) + global search input (`Search ticker, memo, or portfolio...`) + alert notification trigger + currency toggle (`USD` / `THB`) + masked Sync Key pill + License status badge.
3. **Atmospheric Horizon Hero Banner**:
   - Full-width dark alpine mountain ridge banner with subtle glowing teal horizon contour, aspirational headline (`"INVEST SMARTER · ANYTIME, ANYWHERE"`), subtitle (`"FROM SCREEN TO WRIST"`), and quick sync/live telemetry status.
4. **5-Card Executive KPI & Market Summary Strip**:
   - **Card 1 — Total Portfolio Value**: Primary valuation in selected base currency, secondary converted currency readout (`USD` ↔ `THB`), balance privacy toggle, and daily delta badge.
   - **Card 2 — Today's P&L (Day Change)**: Net daily change ($/฿ and %) paired with a live multi-bar intraday/holding contribution sparkline.
   - **Card 3 — Total Return (Unrealized P&L)**: Cumulative unrealized return ($/฿ and %), cost basis summary, and smooth area trend curve computed from real portfolio holdings.
   - **Card 4 — Market Sentiment (Fear & Greed Index)**: Semi-circular / radial SVG gauge (`0–100`) driven by live CNN/Alternative.me Fear & Greed telemetry (`score`, `rating`, `previousClose`, `delta`).
   - **Card 5 — Portfolio & Market Benchmarks Overview**: Live comparison rows with mini sparklines derived from real portfolio groups / benchmark holdings in the user's live dataset (zero hardcoded illustrative numbers).
5. **Main 2-Column High-Density Workspace**:
   - **Left Column (8/12 cols) — High-Density Holdings Table**:
     - Portfolio switcher tabs (`All Holdings`, individual portfolios, `Watchlist`, `Alerts Only`) + search filter + sort selector + `Add Asset` CTA + portfolio summary ribbon.
     - Structured table columns: Selection/Watchlist toggle, Asset (`Symbol`, `Name`, `Type/Currency`, `Allocation %` bar), Live Price, 24h Change %, 14-Day Trend Sparkline (`<canvas>`), Market Value & Shares/Avg Cost, Unrealized P&L (Value + %), Intelligence Signals (WebMemo snippet, Earnings badge, Target/Stop/RSI alert pills), and quick row actions (`Preview on Watch`, `Edit`, `Delete`).
   - **Right Column (4/12 cols) — Integrated Garmin Connect & Watch Dock**:
     - Connection status header (`Connected` pill, live sync timestamp, Garmin device selector).
     - Internal segmented tabs (`Live Preview`, `Alerts`, `WebMemo`, `Device & License`) so users can switch between the interactive Garmin watch simulator and device/license tools without creating vertical dead space.
     - Interactive round AMOLED watch chassis (`390×390` scale) with physical Pusher A / Pusher B buttons, clickable Glance / List / Detail / Expired screens, watch metric visibility checkboxes (`Show Day P&L`, `Show Total Return`, `Show Price Alerts`, `Show WebMemo`), and a 3-card telemetry footer (`Sync Status`, `Active Alerts`, `Display / Auto-Swipe Mode`).
6. **Bottom 3-Column Financial Intelligence Modules**:
   - **Module 1 — WebMemo & Research Notes**: Live feed of holdings with thesis memos (`webMemo`), searchable/filterable by portfolio, with 1-click `Edit Memo` and `Preview on Watch`.
   - **Module 2 — Earnings & Catalysts Calendar**: Live chronological list of holdings with `earningsDate` (`e-dd/mm/yy`) or upcoming catalyst flags, showing countdown/date badge and quick date editor.
   - **Module 3 — Active Price Alerts & RSI Signals**: Live monitor of all configured Target Price (`▲`), Stop Loss (`▼`), `TARGET_HIT`, `STOP_BREACH`, `NEAR_TARGET`, and RSI (`<=30` / `>=70`) signals with visual progress bars and 1-click alert tuning.

---

## 2. Design Tokens & Typography Specification

### A. Color Tokens (`public/styles.css`)
| Token | Value | Purpose |
| :--- | :--- | :--- |
| `--bg-canvas` | `#060A10` | Deep obsidian-navy primary background |
| `--bg-surface-1` | `#0A111A` | Primary card & table container surface |
| `--bg-surface-2` | `#0E1724` | Elevated row hover, secondary panels, dock surface |
| `--bg-surface-3` | `#132032` | Interactive controls, inputs, segmented tabs |
| `--bg-glass` | `rgba(10, 17, 26, 0.82)` | Sticky navigation and modal glass backdrop |
| `--border-subtle` | `rgba(148, 163, 184, 0.10)` | Table row dividers and internal hairlines |
| `--border-default` | `rgba(56, 189, 248, 0.16)` | Primary card borders with subtle cyan tint |
| `--border-strong` | `rgba(6, 182, 212, 0.42)` | Active card / focused control / selected tab border |
| `--accent-cyan` | `#06B6D4` | Primary interactive brand accent |
| `--accent-teal` | `#14B8A6` | Secondary brand gradient & positive glow accent |
| `--semantic-up` | `#10B981` | Positive P&L, target hit, bullish trend |
| `--semantic-down` | `#F43F5E` | Negative P&L, stop breach, bearish trend |
| `--semantic-warn` | `#F59E0B` | Near target, trial countdown, caution indicator |
| `--text-primary` | `#F8FAFC` | Primary headlines and numerical readouts |
| `--text-secondary` | `#94A3B8` | Column headers, metadata labels, subtitles |
| `--text-muted` | `#64748B` | Secondary captions, timestamps, hints |

### B. Typography & Numeric Discipline
- **UI & Latin/Thai Sans**: `'Plus Jakarta Sans', 'Noto Sans Thai', -apple-system, BlinkMacSystemFont, sans-serif`
- **Financial & Telemetry Mono**: `'JetBrains Mono', monospace` with `font-variant-numeric: tabular-nums` enforced on every price, percentage, share count, P&L cell, and watch readout.
- **Hierarchy**:
  - Hero Headline: `clamp(1.35rem, 2.2vw, 1.85rem)`, `font-weight: 800`, letter-spacing `-0.02em`
  - KPI Primary Value: `clamp(1.35rem, 1.9vw, 1.75rem)`, `font-weight: 700`, `tabular-nums`
  - Section Header: `0.95rem`, `font-weight: 700`, uppercase tracking or crisp title case
  - Table Cell Primary: `0.84rem`, `font-weight: 600`
  - Table Cell Secondary / Meta: `0.72rem`, `color: var(--text-secondary)`

---

## 3. Motion & Interaction Specification

1. **Table & Card Transitions**:
   - Row hover elevation (`background: rgba(14, 23, 36, 0.85)`) with `150ms cubic-bezier(0.22, 1, 0.36, 1)` transition.
   - Inline `<canvas>` sparklines rendered with anti-aliased 2x devicePixelRatio gradients and subtle end-point pulse dot.
2. **Garmin Watch Simulator Transitions**:
   - Smooth view switching (`Glance` → `List` → `Detail` → `Expired`) with physical pusher depress feedback (`transform: scale(0.95)`).
   - Right-column tab switching (`Live Preview` | `Alerts` | `WebMemo` | `Device & License`) without layout shift.
3. **Reduced Motion Respect**:
   - `@media (prefers-reduced-motion: reduce)` disables decorative animations and transitions cleanly.

---

## 4. Feature Preservation & Backward Compatibility Matrix

Every existing DOM ID, function, event handler, and API contract tested in `tests/sdlc.test.js` and used by `public/watchSimulator.js` / `public/app.js` is strictly preserved:

| Feature / Contract | Preserved DOM IDs & Functions | Redesign Location |
| :--- | :--- | :--- |
| **KPI Totals & FX** | `grandTotalValue`, `grandTotalCost`, `fxRateReadout`, `lastUpdatedBadge`, `grandDayPnl`, `grandDayPct`, `grandTotalPnl`, `grandTotalPct`, `activeAlertCount`, `portfolioCountSummary` | 5-Card Executive KPI Row |
| **Fear & Greed Index** | `fearGreedBadge`, `fearGreedLabel`, `fearGreedPrevText`, `fearGreedBarFill` + new `fearGreedGaugeArc` | KPI Card 4 (Market Sentiment Gauge) |
| **Portfolio Navigation** | `portfolioTabsContainer`, `openAddPortfolioModalBtn`, `activePortfolioTitle`, `activePortfolioMeta`, `activePortValue`, `activePortDayPnl`, `activePortTotalPnl`, `renamePortfolioBtn`, `deletePortfolioBtn`, `sortHoldingsSelect`, `openAddHoldingModalBtn` | Left Column Holdings Workspace Header |
| **Holdings Table & Sparklines** | `holdingsListContainer`, `spark-canvas-{idx}` | High-Density Holdings Table (with All/Portfolio/Watchlist filter support) |
| **Garmin Watch Simulator** | `watchModelSelect`, `watchSimulatorBezel`, `venuScreenViewport`, `watchPusherTop`, `watchPusherBottom`, `watchViewGlance`, `watchViewList`, `watchViewDetail`, `watchViewExpired`, `watchSparklineCanvas`, `watchPageDots`, `watchModeBadge`, `watchHintText` | Right Column Garmin Connect Panel (`Live Preview` tab) |
| **Display & Sync Controls** | `watchSettingsCard`, `autoSwipeToggle`, `autoSwipeSecInput`, `alwaysOnToggle`, `saveWatchSettingsBtn`, `watchSettingsStatus` | Right Column Garmin Connect Panel (`Device & License` tab + Quick Controls) |
| **Device Activation & Trial/Pro** | `licenseStatusBadge`, `watchDeviceIdInput`, `copyDeviceIdBtn`, `activationKeyInput`, `activateDeviceBtn`, `openTrialExtendModalBtn`, `openPurchaseFormModalBtn`, `licenseFeedbackMsg`, `licenseRequestModal`, `licenseRequestForm` | Right Column `Device & License` tab + License Modal |
| **Backup, Sideload & Inspector** | `exportJsonBtn`, `exportCsvBtn`, `importJsonInput`, `watchEndpointUrl`, `copyEndpointBtn`, `inspectPayloadBtn`, `rawPayloadPre`, `sideloadGuideContent` | Settings / Tools Drawer & Bottom Utility Panel |
| **CRUD Modals** | `holdingModal`, `holdingForm`, `portfolioModal`, `portfolioForm`, `syncModal` | Preserved and restyled to match obsidian-navy glass theme |

---

## 5. Verification & Rollback Strategy

1. **Automated SDLC Test Suite**: Run `node tests/sdlc.test.js` after implementation to verify all 17+ unit, integration, security, and simulator tests pass.
2. **Multi-Viewport Browser Verification**:
   - Desktop (`1440×900`): Full 2-column workspace, 5-card KPI row, 3-column intelligence footer, watch simulator preview.
   - Laptop/Tablet (`1024×768`): Responsive grid adaptation without horizontal overflow.
   - Mobile (`390×844`): Clean stacked layout, scrollable table/cards, accessible navigation and modals.
3. **Rollback**: All changes are cleanly modularized within `public/index.html`, `public/styles.css`, `public/app.js`, and `public/admin.html` with Git version control.
