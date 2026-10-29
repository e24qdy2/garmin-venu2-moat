---
name: portfolio-monitoring-analysis
description: Monitor the owner's real MoatWatch portfolio & watchlist on moat.readybyte.top, analyze material news/earnings/signals, and propose concise WebMemo drafts with Discord Approve/Reject buttons.
version: 2.0.0
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

## Available Tools
- `moat_get_account_portfolio(portfolioId?, symbol?)`:
  Returns the owner's real account (`accountId`, `accountMasked`), portfolios (`us-moat`), holdings count, watchlist count, and each stock's current `memo` and `memoRevision`.
- `moat_get_holding_memo(symbol, portfolioId?)`:
  Returns the current `memo`, `memoRevision`, `contentHash`, and any `pendingDraft` for a specific symbol.
- `moat_propose_webmemo_draft(symbol, proposedMemo, portfolioId="us-moat", analysisSummary?, idempotencyKey?)`:
  Creates a 24h pending draft bound to the current `baseMemoRevision` and posts an interactive **Approve / Reject** card to Discord.
- `moat_list_webmemo_drafts(status?, symbol?)`:
  Lists drafts (`PENDING`, `APPROVED`, `REJECTED`, `CONFLICT`, `EXPIRED`).

## Workflow 1: On-Demand Stock Analysis & WebMemo Draft
When the owner asks in Discord to analyze a stock (e.g. `NVDA`, `SPCX`, `AVGO`, `TSM`) or draft a WebMemo:
1. Call `moat_get_holding_memo(symbol="<SYMBOL>", portfolioId="us-moat")` to read the stock's current position (`shares`, `avgCost`, `targetPrice`, `stopPrice`, `earningsDate`) and current `memo` (`memoRevision`).
2. Gather the latest news, earnings catalysts, or technical setup sequentially (keep memory usage low on Pi 3B+).
3. Synthesize:
   - Full analysis summary in Thai/English for Discord (`analysisSummary`).
   - Concise single-line `proposedMemo` (`<= 140` characters) suitable for the Garmin watch and MoatWatch Web UI.
4. Call `moat_propose_webmemo_draft(symbol="<SYMBOL>", portfolioId="us-moat", proposedMemo="<MEMO>", analysisSummary="<SUMMARY>")`.
5. Tell the owner the `draftId` and remind them to click **อนุมัติขึ้นเว็บ (Approve)** or **ปฏิเสธ (Reject)** on the Discord card.

## Workflow 2: Daily Sequential Monitor (Pi 3B+ Lightweight Cron)
When triggered by the daily scheduled monitor:
1. Call `moat_get_account_portfolio(portfolioId="us-moat")` once.
2. Prioritize:
   - Held positions (`shares > 0`, e.g., `SPCX`),
   - Watchlist stocks with upcoming earnings (`earningsDate` present) or missing/outdated memos (up to 3–5 notable tickers per run, processed strictly sequentially to keep RAM usage minimal on Raspberry Pi 3B+).
3. Only call `moat_propose_webmemo_draft` for stocks with a **material new catalyst, earnings update, or thesis change** (max 3 draft cards per daily run so Discord is never spammed).
4. Post a brief daily digest summarizing the portfolio/watchlist check and any new pending drafts awaiting approval.
