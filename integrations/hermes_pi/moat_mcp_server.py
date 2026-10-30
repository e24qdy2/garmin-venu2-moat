#!/usr/bin/env python3
"""
MoatWatch Scoped MCP Server (Direction B: Hermes -> MoatWatch Scoped API).
Runs over stdio with zero external heavy dependencies (uses Python stdlib urllib + json).
Strictly least-privilege: cannot modify shares, avgCost, targetPrice, stopPrice, or holdings list.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Optional

SERVER_INFO = {
    "name": "moatwatch-webmemo",
    "version": "1.0.0",
}

TOOLS = [
    {
        "name": "moat_get_account_portfolio",
        "description": (
            "Read the owner's real MoatWatch web account, portfolios, holdings, and watchlist "
            "(read-only). Optionally filter by portfolioId or symbol."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "portfolioId": {
                    "type": "string",
                    "description": "Optional portfolio ID (e.g. 'us-moat').",
                },
                "symbol": {
                    "type": "string",
                    "description": "Optional ticker symbol (e.g. 'NVDA').",
                },
            },
        },
    },
    {
        "name": "moat_get_holding_memo",
        "description": (
            "Read the current WebMemo, memoRevision, contentHash, and any pending draft "
            "for a single stock symbol in the owner's account."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "Ticker symbol (e.g. 'NVDA').",
                },
                "portfolioId": {
                    "type": "string",
                    "description": "Portfolio ID (e.g. 'us-moat'). Required if symbol exists in multiple portfolios.",
                },
            },
            "required": ["symbol"],
        },
    },
    {
        "name": "moat_propose_webmemo_draft",
        "description": (
            "Create a pending WebMemo draft (<=140 chars) for a stock in the owner's account. "
            "Does NOT publish to the live web app until the owner explicitly approves in Discord."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "Ticker symbol (e.g. 'NVDA').",
                },
                "portfolioId": {
                    "type": "string",
                    "description": "Portfolio ID (default 'us-moat').",
                },
                "proposedMemo": {
                    "type": "string",
                    "description": "Concise WebMemo text (max 140 Unicode characters, single line).",
                },
                "analysisSummary": {
                    "type": "string",
                    "description": "Detailed analysis summary shown in Discord alongside the draft card.",
                },
                "idempotencyKey": {
                    "type": "string",
                    "description": "Optional idempotency key to prevent duplicate drafts.",
                },
            },
            "required": ["symbol", "proposedMemo"],
        },
    },
    {
        "name": "moat_list_webmemo_drafts",
        "description": "List recent WebMemo drafts (optionally filtered by status=PENDING/APPROVED/REJECTED/CONFLICT/EXPIRED or symbol).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "description": "Optional status filter (PENDING, APPROVED, REJECTED, CONFLICT, EXPIRED).",
                },
                "symbol": {
                    "type": "string",
                    "description": "Optional ticker symbol filter.",
                },
            },
        },
    },
    {
        "name": "moat_publish_research_post",
        "description": (
            "Publish or update a shared Support/Resistance Level 1-2-3 (Short/Medium/Long-term: ระยะสั้น-กลาง-ยาว) "
            "and #tagged research post to the MoatWatch Web App section card (shared across all SyncKeys)."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "Ticker symbol (e.g. 'NVDA', 'TSM', 'AVGO').",
                },
                "companyName": {
                    "type": "string",
                    "description": "Optional company name.",
                },
                "headline": {
                    "type": "string",
                    "description": "Headline of the research & support/resistance analysis post.",
                },
                "summary": {
                    "type": "string",
                    "description": "Detailed quantitative/fundamental research commentary.",
                },
                "signalMemo": {
                    "type": "string",
                    "description": "Compact actionable signal memo (<=160 chars).",
                },
                "bias": {
                    "type": "string",
                    "description": "Tactical bias: BULLISH, ACCUMULATE, NEUTRAL, or CAUTIOUS.",
                },
                "confidence": {
                    "type": "number",
                    "description": "Conviction score 50-99.",
                },
                "referencePrice": {
                    "type": "number",
                    "description": "Current/reference stock price used for S1-S3 / R1-R3 calculation.",
                },
                "s1": {
                    "type": "number",
                    "description": "Support 1 (ระยะสั้น / Short-term support price).",
                },
                "s2": {
                    "type": "number",
                    "description": "Support 2 (ระยะกลาง / Medium-term support price).",
                },
                "s3": {
                    "type": "number",
                    "description": "Support 3 (ระยะยาว / Long-term structural moat support price).",
                },
                "r1": {
                    "type": "number",
                    "description": "Resistance 1 (ระยะสั้น / Short-term resistance price).",
                },
                "r2": {
                    "type": "number",
                    "description": "Resistance 2 (ระยะกลาง / Medium-term resistance price).",
                },
                "r3": {
                    "type": "number",
                    "description": "Resistance 3 (ระยะยาว / Long-term structural target price).",
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Topic #tags (e.g. ['#hermes-daily', '#ai-infra', '#support-resistance']).",
                },
                "pinned": {
                    "type": "boolean",
                    "description": "Whether to pin this card at the top of the research feed.",
                },
            },
            "required": ["symbol", "headline", "summary"],
        },
    },
    {
        "name": "moat_list_research_posts",
        "description": (
            "List active shared Support/Resistance 1-2-3 research posts and the full Watchlist S/R 1-2-3 matrix."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "symbol": {
                    "type": "string",
                    "description": "Optional ticker symbol filter.",
                },
                "tag": {
                    "type": "string",
                    "description": "Optional #tag filter (e.g. '#ai-infra').",
                },
                "includeArchived": {
                    "type": "boolean",
                    "description": "Include archived/hidden posts.",
                },
            },
        },
    },
]


def _api_request(
    method: str,
    path: str,
    query: Optional[Dict[str, str]] = None,
    body: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    base_url = os.environ.get("WEBMEMO_API_BASE", "https://moat.readybyte.top").rstrip("/")
    token = os.environ.get("WEBMEMO_INTEGRATION_TOKEN", "").strip()
    if not token:
        return {
            "ok": False,
            "error": "WEBMEMO_INTEGRATION_TOKEN is not configured in environment",
            "code": "MISSING_TOKEN",
        }

    url = f"{base_url}{path}"
    if query:
        clean_q = {k: v for k, v in query.items() if v is not None and str(v).strip() != ""}
        if clean_q:
            url = f"{url}?{urllib.parse.urlencode(clean_q)}"

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "User-Agent": "MoatWatch-Hermes-MCP/1.0",
    }
    data_bytes = None
    if body is not None:
        headers["Content-Type"] = "application/json; charset=utf-8"
        data_bytes = json.dumps(body, ensure_ascii=False).encode("utf-8")

    req = urllib.request.Request(url, data=data_bytes, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {"ok": True}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(err_body)
            parsed["httpStatus"] = e.code
            return parsed
        except Exception:
            return {"ok": False, "httpStatus": e.code, "error": err_body or str(e)}
    except Exception as e:
        return {"ok": False, "error": str(e), "code": "NETWORK_ERROR"}


def _notify_discord_draft_card(draft_resp: Dict[str, Any], analysis_summary: str = "") -> Optional[Dict[str, Any]]:
    """
    If a draft was created via MCP tool call, post the interactive Approve/Reject button card
    to the configured Discord channel using Discord REST API and record the message ID.
    """
    draft = draft_resp.get("draft")
    if not isinstance(draft, dict) or not draft.get("draftId"):
        return None

    bot_token = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
    channel_id = (
        draft.get("discordChannelId")
        or os.environ.get("WEBMEMO_DISCORD_CHANNEL_ID", "").strip()
        or "1484918931700449487"
    )
    if not bot_token or not channel_id:
        return None

    draft_id = draft["draftId"]
    version = draft.get("version", 1)
    symbol = draft.get("symbol", "")
    portfolio_id = draft.get("portfolioId", "us-moat")
    base_memo = draft.get("baseMemo") or "(ว่าง)"
    proposed_memo = draft.get("proposedMemo") or ""
    char_len = len(proposed_memo)
    expires_at = draft.get("expiresAt", "")

    lines = [
        f"📋 **WebMemo Draft รออนุมัติ — `{symbol}` (`{portfolio_id}`)**",
        f"• **บัญชี**: `{draft.get('accountMasked', 'V2-***')}` (`{draft.get('accountId', '')}`)",
        f"• **Draft ID**: `{draft_id}` (v{version})",
        f"• **Memo เดิม**: `{base_memo}` (rev {draft.get('baseMemoRevision', 0)})",
        f"• **Memo ใหม่ ({char_len}/140 ตัวอักษร)**:",
        f"> **{proposed_memo}**",
    ]
    if analysis_summary:
        lines.append(f"\n💡 **สรุปเหตุผล/สัญญาณ**:\n{analysis_summary.strip()[:900]}")
    lines.append(f"\n⏳ หมดอายุ: `{expires_at}` | กดปุ่มด้านล่างเพื่ออนุมัติหรือปฏิเสธ (เฉพาะเจ้าของบัญชี)")

    payload = {
        "content": "\n".join(lines)[:1950],
        "components": [
            {
                "type": 1,
                "components": [
                    {
                        "type": 2,
                        "style": 3,
                        "label": "อนุมัติขึ้นเว็บ (Approve)",
                        "custom_id": f"webmemo:approve:{draft_id}:{version}",
                    },
                    {
                        "type": 2,
                        "style": 4,
                        "label": "ปฏิเสธ (Reject)",
                        "custom_id": f"webmemo:reject:{draft_id}:{version}",
                    },
                ],
            }
        ],
    }

    discord_url = f"https://discord.com/api/v10/channels/{channel_id}/messages"
    req = urllib.request.Request(
        discord_url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bot {bot_token}",
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "MoatWatch-Hermes-MCP/1.0",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            msg_data = json.loads(resp.read().decode("utf-8", errors="replace"))
            msg_id = str(msg_data.get("id", ""))
            if msg_id:
                _api_request(
                    "PATCH",
                    f"/api/integration/drafts/{urllib.parse.quote(draft_id)}/discord-message",
                    body={"discordMessageId": msg_id, "discordChannelId": str(channel_id)},
                )
            return {"discordMessageId": msg_id, "discordChannelId": str(channel_id)}
    except Exception as e:
        return {"discordNotifyError": str(e)}


def call_tool(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    if name == "moat_get_account_portfolio":
        return _api_request(
            "GET",
            "/api/integration/account",
            query={
                "portfolioId": args.get("portfolioId"),
                "symbol": args.get("symbol"),
            },
        )
    if name == "moat_get_holding_memo":
        return _api_request(
            "GET",
            "/api/integration/memo",
            query={
                "symbol": args.get("symbol"),
                "portfolioId": args.get("portfolioId"),
            },
        )
    if name == "moat_propose_webmemo_draft":
        analysis_summary = str(args.get("analysisSummary") or "").strip()
        resp = _api_request(
            "POST",
            "/api/integration/drafts",
            body={
                "symbol": args.get("symbol"),
                "portfolioId": args.get("portfolioId") or "us-moat",
                "proposedMemo": args.get("proposedMemo"),
                "analysisSummary": analysis_summary,
                "idempotencyKey": args.get("idempotencyKey"),
                "discordChannelId": os.environ.get("WEBMEMO_DISCORD_CHANNEL_ID", "1484918931700449487"),
                "requestedBy": "hermes-mcp",
            },
        )
        if resp.get("ok") and not resp.get("idempotentReplay"):
            notify_res = _notify_discord_draft_card(resp, analysis_summary)
            if notify_res:
                resp["discordNotification"] = notify_res
        return resp
    if name == "moat_list_webmemo_drafts":
        return _api_request(
            "GET",
            "/api/integration/drafts",
            query={
                "status": args.get("status"),
                "symbol": args.get("symbol"),
            },
        )
    if name == "moat_publish_research_post":
        return _api_request(
            "POST",
            "/api/integration/research-posts",
            body={
                "action": "UPSERT",
                "symbol": args.get("symbol"),
                "companyName": args.get("companyName"),
                "headline": args.get("headline"),
                "summary": args.get("summary"),
                "signalMemo": args.get("signalMemo"),
                "bias": args.get("bias") or "BULLISH",
                "confidence": args.get("confidence"),
                "referencePrice": args.get("referencePrice"),
                "s1": args.get("s1"),
                "s2": args.get("s2"),
                "s3": args.get("s3"),
                "r1": args.get("r1"),
                "r2": args.get("r2"),
                "r3": args.get("r3"),
                "s1Note": args.get("s1Note"),
                "s2Note": args.get("s2Note"),
                "s3Note": args.get("s3Note"),
                "r1Note": args.get("r1Note"),
                "r2Note": args.get("r2Note"),
                "r3Note": args.get("r3Note"),
                "signals": args.get("signals"),
                "tags": args.get("tags") or ["#hermes-daily", "#support-resistance", "#watchlist"],
                "pinned": bool(args.get("pinned", False)),
                "source": "HERMES_AGENT",
                "author": "Hermes Quant Research Agent",
            },
        )
    if name == "moat_list_research_posts":
        return _api_request(
            "GET",
            "/api/integration/research-posts",
            query={
                "symbol": args.get("symbol"),
                "tag": args.get("tag"),
                "includeArchived": "1" if args.get("includeArchived") else None,
            },
        )
    return {"ok": False, "error": f"Unknown tool: {name}"}


def handle_jsonrpc(msg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    msg_id = msg.get("id")
    method = msg.get("method", "")
    params = msg.get("params") or {}

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {
                "protocolVersion": params.get("protocolVersion", "2024-11-05"),
                "capabilities": {"tools": {}},
                "serverInfo": SERVER_INFO,
            },
        }
    if method.startswith("notifications/"):
        return None
    if method == "ping":
        return {"jsonrpc": "2.0", "id": msg_id, "result": {}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": msg_id, "result": {"tools": TOOLS}}
    if method == "tools/call":
        t_name = params.get("name", "")
        t_args = params.get("arguments") or {}
        result_obj = call_tool(t_name, t_args)
        is_err = not bool(result_obj.get("ok", True))
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(result_obj, ensure_ascii=False, indent=2),
                    }
                ],
                "isError": is_err,
            },
        }
    if msg_id is not None:
        return {
            "jsonrpc": "2.0",
            "id": msg_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }
    return None


def main() -> None:
    for line in sys.stdin:
        raw = line.strip()
        if not raw:
            continue
        try:
            msg = json.loads(raw)
        except Exception:
            continue
        resp = handle_jsonrpc(msg)
        if resp is not None:
            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
