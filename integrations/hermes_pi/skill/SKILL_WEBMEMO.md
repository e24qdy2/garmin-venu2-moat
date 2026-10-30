---
name: moatwatch-webmemo
description: Publish shared Support/Resistance 1-2-3 (S1/S2/S3, R1/R2/R3) research cards and propose owner-approved WebMemo drafts on moat.readybyte.top.
version: 2.1.0
platforms: [linux]
metadata:
  hermes:
    tags: [finance, moatwatch, webmemo, support-resistance, garmin, discord]
    related_skills: [portfolio-monitoring-analysis]
---

# MoatWatch S/R 1-2-3 Research & WebMemo Skill (`moatwatch-webmemo`)

## Overview
Connects Hermes Agent on `echo24` to MoatWatch (`https://moat.readybyte.top`) for:
1. Reading the owner's real MoatWatch portfolio & watchlist (`V2-07090781` / `us-moat`) via `moat_get_account_portfolio` and `moat_get_holding_memo`.
2. Publishing/updating shared **Support / Resistance Level 1–2–3 (ระยะสั้น S1/R1, ระยะกลาง S2/R2, ระยะยาว S3/R3)** research cards with `#tags` via `moat_publish_research_post`.
3. Proposing single-line (`<= 140` chars) `WebMemo` drafts with Discord **Approve / Reject** buttons via `moat_propose_webmemo_draft`.

## Strict Rules
- **Read-Only Holdings**: Never modify `shares`, `avgCost`, `targetPrice`, or `stopPrice`.
- **S/R 1-2-3 Card Updates**: Always pass `referencePrice`, `s1`, `s2`, `s3`, `r1`, `r2`, `r3`, `headline`, `summary`, `signalMemo`, `bias`, and `tags` to `moat_publish_research_post`. Verify in the JSON response that `post.supportLevels.s1.price == s1` and `post.resistanceLevels.r1.price == r1`.
- **WebMemo Approval Gate**: WebMemos only publish to the holding's `memo` field after the owner clicks **อนุมัติขึ้นเว็บ (Approve)** in Discord.
- **Pi 3B+ Sequential Batching**: Process stocks sequentially (all held positions with `shares > 0` + 4–6 rotating Watchlist tickers per cron run) to keep RAM and token usage light.
