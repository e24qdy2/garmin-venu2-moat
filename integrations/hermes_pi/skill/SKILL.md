---
name: portfolio-monitoring-analysis
description: Monitor the owner's real MoatWatch portfolio & watchlist on moat.readybyte.top, dynamically select Watchlist highlights without any static tickers, analyze material news/earnings/signals, and propose concise WebMemo drafts with Discord Approve/Reject buttons.
version: 2.1.0
platforms: [linux]
metadata:
  hermes:
    tags: [finance, portfolio, stocks, garmin, moatwatch, webmemo, discord]
    related_skills: []
---

# MoatWatch Portfolio & Watchlist Analyst + WebMemo Approval Workflow

## Overview
This skill connects Hermes Agent on Raspberry Pi 3B+ (`echo24`) to the owner's real MoatWatch production account on `https://moat.readybyte.top` using the **Scoped Least-Privilege Integration API** and the **`webmemo-approval`** plugin / `moatwatch` MCP server.

## Strict Safety & Least-Privilege Rules
1. **Read-Only Portfolio & Watchlist Access**:
   - Always use `moat_get_account_portfolio` and `moat_get_holding_memo` to inspect the owner's real holdings (`shares > 0`) and watchlist stocks (`shares == 0`).
   - **NEVER** call `PUT /api/portfolio` or attempt to modify `shares`, `avgCost`, `targetPrice`, `stopPrice`, or holdings lists.
2. **Mandatory Owner Approval Before Publishing**:
   - **NEVER** claim a WebMemo is live on the web until the owner clicks **Approve (`อนุมัติขึ้นเว็บ`)** on the Discord draft card (or runs `/webmemo approve <draftId>`).
   - Always use `moat_propose_webmemo_draft` to create a pending draft (`status: PENDING`, 24-hour expiry) and automatically post an interactive Discord card with **Approve / Reject** buttons.
3. **WebMemo Format Constraints**:
   - `proposedMemo` MUST be a **single line** (`<= 140` Unicode characters and `<= 140` UTF-16 code units, no newlines or control characters).
   - Format recommendation for Garmin watch readability:
     `[Signal/Catalyst] | [Key Metric/Thesis] | [Action/Level]`
     Example: `Blackwell demand strong | DC rev +93% YoY | Hold core / Watch 145`
4. **Secret Hygiene**:
   - Never print or ask for `WEBMEMO_INTEGRATION_TOKEN`, `DISCORD_BOT_TOKEN`, or any Sync Key in chat responses or logs.
5. **Zero Static Tickers — Dynamic Watchlist Highlight Selection Only**:
   - **NEVER** hardcode or lock any job or analysis loop to a static ticker list (e.g., never lock to `IREN/APLD/CIFR/ONDS` or any fixed symbol list).
   - **ALWAYS** call `moat_get_account_portfolio(portfolioId="us-moat")` first to fetch the live Watchlist (`shares == 0`) and Portfolio holdings (`shares > 0`).
   - Dynamically select **Highlight Stocks** from the live Watchlist & Portfolio on every run based on:
     1. Active held positions (`shares > 0`) or positions testing `targetPrice` / `stopPrice`.
     2. Watchlist symbols near Support/Resistance levels (`S1/S2/S3`, `R1/R2/R3`).
     3. Watchlist symbols with upcoming `earningsDate`, material breaking news, or outdated/missing WebMemo.

## Available Tools
- `moat_get_account_portfolio(portfolioId?, symbol?)`:
  Returns the owner's real account (`accountId`, `accountMasked`), portfolios (`us-moat`), holdings count, watchlist count, and each stock's current `memo` and `memoRevision`.
- `moat_get_holding_memo(symbol, portfolioId?)`:
  Returns the current `memo`, `memoRevision`, `contentHash`, and any `pendingDraft` for a specific symbol.
- `moat_propose_webmemo_draft(symbol, proposedMemo, portfolioId="us-moat", analysisSummary?, idempotencyKey?)`:
  Creates a 24h pending draft bound to the current `baseMemoRevision` and posts an interactive **Approve / Reject** card to Discord.
- `moat_list_webmemo_drafts(status?, symbol?)`:
  Lists drafts (`PENDING`, `APPROVED`, `REJECTED`, `CONFLICT`, `EXPIRED`).
- `moat_publish_research_post(symbol, headline, summary, signalMemo?, bias?, confidence?, referencePrice?, s1?, s2?, s3?, r1?, r2?, r3?, tags?, pinned?)`:
  Publishes or updates a shared **Support / Resistance Level 1–2–3 (ระยะสั้น S1/R1, ระยะกลาง S2/R2, ระยะยาว S3/R3)** & `#tag` research card on the MoatWatch Web App frontpage (visible across all SyncKeys).
- `moat_list_research_posts(symbol?, tag?, includeArchived?)`:
  Lists active/archived shared research posts and the full Watchlist S/R 1-2-3 matrix.

## Workflow 1: On-Demand Stock Analysis & WebMemo Draft
When the owner asks in Discord to analyze a symbol from the Watchlist/Portfolio or draft a WebMemo:
1. Call `moat_get_holding_memo(symbol="<SYMBOL>", portfolioId="us-moat")` to read the stock's current position (`shares`, `avgCost`, `targetPrice`, `stopPrice`, `earningsDate`) and current `memo` (`memoRevision`).
2. Gather the latest news, earnings catalysts, or technical setup sequentially (keep memory usage low on Pi 3B+).
3. Synthesize:
   - Full analysis summary in Thai/English for Discord (`analysisSummary`).
   - Concise single-line `proposedMemo` (`<= 140` characters) suitable for the Garmin watch and MoatWatch Web UI.
4. Call `moat_propose_webmemo_draft(symbol="<SYMBOL>", portfolioId="us-moat", proposedMemo="<MEMO>", analysisSummary="<SUMMARY>")`.
5. Tell the owner the `draftId` and remind them to click **อนุมัติขึ้นเว็บ (Approve)** or **ปฏิเสธ (Reject)** on the Discord card.

## Workflow 2: Dynamic Watchlist Highlight Monitor (All Scheduled Cron Jobs)
Whenever any scheduled MoatWatch job runs (Intraday Pulse, News & Sentiment, Pre-Market, Post-Market, Daily Analyst, Weekly Review, or Weekly Deep-Dive):
1. Call `moat_get_account_portfolio(portfolioId="us-moat")` once to load the live Watchlist & Portfolio dynamically (zero static tickers).
2. Rank and select **Highlight Stocks** dynamically from the live Watchlist (`shares == 0`) and Portfolio (`shares > 0`):
   - Held positions (`shares > 0`) and stocks testing `targetPrice`, `stopPrice`, or `S1/R1` levels,
   - Watchlist stocks with upcoming earnings (`earningsDate` present), breaking news catalysts, or missing/outdated memos (select the top 3–5 dynamic highlights per run, processed strictly sequentially to keep RAM usage minimal on Raspberry Pi 3B+).
3. Call `moat_publish_research_post` to update S/R 1–2–3 levels and `#tags` for the selected Watchlist highlights, and call `moat_propose_webmemo_draft` when a material catalyst or thesis update warrants a new Garmin/Web memo draft (max 3 draft cards per run).
4. Post a concise digest in Discord summarizing which Watchlist highlights were selected and why.
