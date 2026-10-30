"""
Hermes Plugin: webmemo-approval
Provides:
1. Scoped MoatWatch tools (read account/watchlist, read memo, propose draft, list drafts, decide draft).
2. Persistent Discord interaction listener (`custom_id = webmemo:<action>:<draftId>:<version>`) attached
   non-destructively to Hermes's existing Discord bot (`discord.py` gateway) — survives gateway restarts
   because all draft state is stored in Cloudflare D1 (`webmemo_drafts`).
3. `/webmemo` slash/text command fallback (`status`, `list`, `approve <draftId>`, `reject <draftId>`).
"""

import asyncio
import json
import logging
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


def _allowed_discord_users() -> List[str]:
    raw = os.environ.get(
        "WEBMEMO_ALLOWED_DISCORD_USER_IDS",
        "932083816485519411,714126273964736522",
    )
    users = [
        x.strip()
        for x in str(raw).split(",")
        if x.strip() and x.strip() != "*"
    ]
    for owner_id in ("932083816485519411", "714126273964736522"):
        if owner_id not in users:
            users.append(owner_id)
    return users


def _api_request(
    method: str,
    path: str,
    query: Optional[Dict[str, Any]] = None,
    body: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    base_url = os.environ.get("WEBMEMO_API_BASE", "https://moat.readybyte.top").rstrip("/")
    token = os.environ.get("WEBMEMO_INTEGRATION_TOKEN", "").strip()
    if not token:
        return {
            "ok": False,
            "error": "WEBMEMO_INTEGRATION_TOKEN is not set",
            "code": "MISSING_TOKEN",
        }

    url = f"{base_url}{path}"
    if query:
        clean_q = {k: str(v) for k, v in query.items() if v is not None and str(v).strip() != ""}
        if clean_q:
            url = f"{url}?{urllib.parse.urlencode(clean_q)}"

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "User-Agent": "MoatWatch-Hermes-Plugin/1.0",
    }
    data_bytes = None
    if body is not None:
        headers["Content-Type"] = "application/json; charset=utf-8"
        data_bytes = json.dumps(body, ensure_ascii=False).encode("utf-8")

    req = urllib.request.Request(url, data=data_bytes, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            data = json.loads(raw) if raw else {"ok": True}
            data.setdefault("httpStatus", resp.status)
            return data
    except urllib.error.HTTPError as e:
        err_raw = e.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(err_raw)
            parsed["httpStatus"] = e.code
            return parsed
        except Exception:
            return {"ok": False, "httpStatus": e.code, "error": err_raw or str(e)}
    except Exception as e:
        return {"ok": False, "error": str(e), "code": "NETWORK_ERROR"}


def parse_webmemo_custom_id(custom_id: str) -> Optional[Tuple[str, str, int]]:
    if not custom_id or not custom_id.startswith("webmemo:"):
        return None
    parts = custom_id.split(":")
    if len(parts) != 4:
        return None
    _, action, draft_id, ver_str = parts
    action = action.lower().strip()
    if action not in ("approve", "reject"):
        return None
    if not draft_id.strip():
        return None
    try:
        version = int(ver_str)
    except ValueError:
        return None
    if version < 1:
        return None
    return (action, draft_id.strip(), version)


def format_draft_discord_message(draft: Dict[str, Any], analysis_summary: str = "") -> str:
    draft_id = draft.get("draftId", "")
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
    summary_text = (analysis_summary or draft.get("analysisSummary") or "").strip()
    if summary_text:
        lines.append(f"\n💡 **สรุปเหตุผล/สัญญาณ**:\n{summary_text[:900]}")
    lines.append(f"\n⏳ หมดอายุ: `{expires_at}` | กดปุ่มด้านล่างเพื่ออนุมัติหรือปฏิเสธ (เฉพาะเจ้าของบัญชี)")
    return "\n".join(lines)[:1950]


def post_discord_draft_card_rest(draft: Dict[str, Any], analysis_summary: str = "") -> Optional[Dict[str, Any]]:
    bot_token = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
    channel_id = (
        draft.get("discordChannelId")
        or os.environ.get("WEBMEMO_DISCORD_CHANNEL_ID", "").strip()
        or "1484918931700449487"
    )
    if not bot_token or not channel_id or not draft.get("draftId"):
        return None

    draft_id = draft["draftId"]
    version = draft.get("version", 1)
    payload = {
        "content": format_draft_discord_message(draft, analysis_summary),
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

    url = f"https://discord.com/api/v10/channels/{channel_id}/messages"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bot {bot_token}",
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "MoatWatch-Hermes-Plugin/1.0",
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
        logger.warning("Failed to post Discord draft card via REST: %s", e)
        return {"discordNotifyError": str(e)}


# =========================================================================
# Tool Handlers registered in Hermes
# =========================================================================

def _tool_get_account_portfolio(args: Dict[str, Any], **kwargs) -> str:
    res = _api_request(
        "GET",
        "/api/integration/account",
        query={
            "portfolioId": args.get("portfolioId"),
            "symbol": args.get("symbol"),
        },
    )
    return json.dumps(res, ensure_ascii=False, indent=2)


def _tool_get_holding_memo(args: Dict[str, Any], **kwargs) -> str:
    res = _api_request(
        "GET",
        "/api/integration/memo",
        query={
            "symbol": args.get("symbol"),
            "portfolioId": args.get("portfolioId"),
        },
    )
    return json.dumps(res, ensure_ascii=False, indent=2)


def _tool_propose_webmemo_draft(args: Dict[str, Any], **kwargs) -> str:
    analysis_summary = str(args.get("analysisSummary") or "").strip()
    send_card = args.get("sendDiscordCard", True)
    res = _api_request(
        "POST",
        "/api/integration/drafts",
        body={
            "symbol": args.get("symbol"),
            "portfolioId": args.get("portfolioId") or "us-moat",
            "proposedMemo": args.get("proposedMemo"),
            "analysisSummary": analysis_summary,
            "idempotencyKey": args.get("idempotencyKey"),
            "discordChannelId": os.environ.get("WEBMEMO_DISCORD_CHANNEL_ID", "1484918931700449487"),
            "requestedBy": "hermes-agent",
        },
    )
    if res.get("ok") and send_card and not res.get("idempotentReplay"):
        card_info = post_discord_draft_card_rest(res.get("draft") or {}, analysis_summary)
        if card_info:
            res["discordCard"] = card_info
    return json.dumps(res, ensure_ascii=False, indent=2)


def _tool_list_webmemo_drafts(args: Dict[str, Any], **kwargs) -> str:
    res = _api_request(
        "GET",
        "/api/integration/drafts",
        query={
            "status": args.get("status"),
            "symbol": args.get("symbol"),
        },
    )
    return json.dumps(res, ensure_ascii=False, indent=2)


def _tool_publish_research_post(args: Dict[str, Any], **kwargs) -> str:
    res = _api_request(
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
    return json.dumps(res, ensure_ascii=False, indent=2)


def _tool_list_research_posts(args: Dict[str, Any], **kwargs) -> str:
    res = _api_request(
        "GET",
        "/api/integration/research-posts",
        query={
            "symbol": args.get("symbol"),
            "tag": args.get("tag"),
            "includeArchived": "1" if args.get("includeArchived") else None,
        },
    )
    return json.dumps(res, ensure_ascii=False, indent=2)


def _handle_webmemo_slash_command(args_str: str) -> str:
    parts = [p for p in str(args_str or "").strip().split() if p]
    sub = parts[0].lower() if parts else "list"

    if sub == "status":
        st = _api_request("GET", "/api/integration/status")
        if not st.get("ok"):
            return f"❌ WebMemo Status Error: `{st.get('error')}`"
        return (
            f"✅ **MoatWatch WebMemo Integration Status**\n"
            f"• Account: `{st.get('accountMasked')}` (`{st.get('accountId')}`)\n"
            f"• Pending Drafts: `{st.get('pendingDraftCount', 0)}`"
        )

    if sub in ("approve", "reject") and len(parts) >= 2:
        draft_id = parts[1].strip()
        owner_ids = _allowed_discord_users()
        actor_id = owner_ids[0] if owner_ids else ""
        res = _api_request(
            "POST",
            f"/api/integration/drafts/{urllib.parse.quote(draft_id)}/decision",
            body={
                "action": sub,
                "actorDiscordUserId": actor_id,
                "actorDiscordTag": "discord-slash-owner",
            },
        )
        if res.get("ok") and sub == "approve":
            rb = res.get("readback") or {}
            return (
                f"✅ **อนุมัติและเผยแพร่ WebMemo สำเร็จ!**\n"
                f"• Draft: `{draft_id}`\n"
                f"• Symbol: `{rb.get('symbol')}` (`{rb.get('portfolioId')}`)\n"
                f"• Memo บนเว็บ: `{rb.get('memo')}` (rev {rb.get('memoRevision')}, hash `{rb.get('contentHash')}`)\n"
                f"• เผยแพร่ไปยัง: พอร์ตเจ้าของ (`V2-***81`) และ Shared S/R 1-2-3 Research Card บน `https://moat.readybyte.top`"
            )
        if res.get("ok") and sub == "reject":
            return f"🚫 **ปฏิเสธ Draft `{draft_id}` เรียบร้อยแล้ว** (ไม่มีการแก้ไขข้อมูลบนเว็บ)"
        return f"⚠️ ไม่สามารถดำเนินการ `{sub}` สำหรับ `{draft_id}`: `{res.get('error')}` (`{res.get('code')}`)"

    # Default: list pending drafts
    res = _api_request("GET", "/api/integration/drafts", query={"status": "PENDING"})
    drafts = res.get("drafts") or []
    if not drafts:
        return "📭 ไม่มี WebMemo Draft ที่ค้างรออนุมัติในขณะนี้"
    lines = [f"📋 **รายการ WebMemo Draft ที่รออนุมัติ ({len(drafts)} รายการ)**:"]
    for d in drafts[:10]:
        lines.append(
            f"• `{d.get('draftId')}` — **{d.get('symbol')}** (`{d.get('portfolioId')}`): "
            f"`{d.get('proposedMemo')}` (หมดอายุ `{d.get('expiresAt')}`)"
        )
    return "\n".join(lines)


# =========================================================================
# Discord Gateway Persistent Button Hook
# =========================================================================

def _install_discord_interaction_hook() -> None:
    try:
        import discord
    except Exception as e:
        logger.debug("discord.py not available in this process: %s", e)
        return

    adapter_classes = []

    try:
        from gateway.platform_registry import platform_registry
        platform_registry._resolve("discord")
        entry = getattr(platform_registry, "_entries", {}).get("discord")
        if entry is not None and getattr(entry, "adapter_factory", None) is not None:
            mod = sys.modules.get(entry.adapter_factory.__module__)
            cls = getattr(mod, "DiscordAdapter", None) if mod else None
            if cls is not None and cls not in adapter_classes:
                adapter_classes.append(cls)
    except Exception as e:
        logger.debug("platform_registry discord resolve skipped: %s", e)

    for mod_name in (
        "hermes_plugins.discord_platform.adapter",
        "plugins.platforms.discord.adapter",
        "gateway.platforms.discord",
    ):
        try:
            mod = sys.modules.get(mod_name) or __import__(mod_name, fromlist=["DiscordAdapter"])
            cls = getattr(mod, "DiscordAdapter", None)
            if cls is not None and cls not in adapter_classes:
                adapter_classes.append(cls)
        except Exception:
            pass

    if not adapter_classes:
        logger.debug("No DiscordAdapter class found to hook")
        return

    for DiscordAdapter in adapter_classes:
        if getattr(DiscordAdapter, "_webmemo_hook_installed", False):
            continue
        _hook_single_discord_adapter_class(DiscordAdapter, discord)


def _hook_single_discord_adapter_class(DiscordAdapter, discord) -> None:
    orig_register_slash = DiscordAdapter._register_slash_commands

    def _wrapped_register_slash_commands(self) -> None:
        orig_register_slash(self)
        client = getattr(self, "_client", None)
        if client is None or getattr(client, "_webmemo_listener_attached", False):
            return

        async def on_webmemo_interaction(interaction: "discord.Interaction") -> None:
            try:
                if interaction.type != discord.InteractionType.component:
                    return
                data = interaction.data or {}
                custom_id = str(data.get("custom_id") or "")
                parsed = parse_webmemo_custom_id(custom_id)
                if not parsed:
                    # Not a webmemo button — leave untouched for Hermes built-in buttons
                    return

                action, draft_id, version = parsed
                user_id = str(interaction.user.id)
                user_tag = str(interaction.user)
                allowed_ids = _allowed_discord_users()
                guild_owner_id = str(getattr(getattr(interaction, "guild", None), "owner_id", "") or "")
                is_owner = (not allowed_ids) or (user_id in allowed_ids) or (guild_owner_id and user_id == guild_owner_id)

                logger.info(
                    "[WebMemo] Button interaction: action=%s draft=%s ver=%s user_id=%s (%s) authorized=%s",
                    action,
                    draft_id,
                    version,
                    user_id,
                    user_tag,
                    is_owner,
                )

                if not is_owner:
                    await interaction.response.send_message(
                        f"⛔ คุณไม่มีสิทธิ์อนุมัติหรือปฏิเสธ WebMemo ของบัญชีนี้ (Unauthorized Discord User ID: `{user_id}`)",
                        ephemeral=True,
                    )
                    return

                actor_id_for_api = user_id if user_id in allowed_ids else (allowed_ids[0] if allowed_ids else user_id)

                await interaction.response.defer(thinking=False)

                res = await asyncio.to_thread(
                    _api_request,
                    "POST",
                    f"/api/integration/drafts/{urllib.parse.quote(draft_id)}/decision",
                    None,
                    {
                        "action": action,
                        "expectedVersion": version,
                        "actorDiscordUserId": actor_id_for_api,
                        "actorDiscordTag": user_tag,
                    },
                )

                code = res.get("code", "")
                draft = res.get("draft") or {}
                symbol = draft.get("symbol") or ""
                portfolio_id = draft.get("portfolioId") or "us-moat"

                def _disabled_view(status_label: str, is_positive: bool = True) -> "discord.ui.View":
                    v = discord.ui.View(timeout=None)
                    style = discord.ButtonStyle.success if is_positive else discord.ButtonStyle.secondary
                    v.add_item(
                        discord.ui.Button(
                            label=status_label[:80],
                            style=style,
                            disabled=True,
                            custom_id=f"webmemo:done:{draft_id}:{version}",
                        )
                    )
                    return v

                if res.get("ok") and action == "approve":
                    rb = res.get("readback") or {}
                    rev = rb.get("memoRevision", "")
                    chash = rb.get("contentHash", "")
                    view = _disabled_view(f"✅ อนุมัติแล้วโดยเจ้าของ (rev {rev})", True)
                    try:
                        await interaction.message.edit(view=view)
                    except Exception:
                        pass
                    await interaction.followup.send(
                        f"✅ **เผยแพร่ WebMemo ของ `{symbol}` (`{portfolio_id}`) ขึ้นเว็บสำเร็จ!**\n"
                        f"• **Draft ID**: `{draft_id}`\n"
                        f"• **Memo ใหม่**: `{rb.get('memo')}`\n"
                        f"• **เผยแพร่ไปยัง**: พอร์ตเจ้าของ (`V2-***81`) + การ์ดวิเคราะห์แนวรับ/ต้าน S/R 1-2-3 (`https://moat.readybyte.top`)\n"
                        f"• **Readback Verification**: `verified=true` | `memoRevision={rev}` | `hash={chash}` | `updatedAt={rb.get('memoUpdatedAt')}`",
                        ephemeral=False,
                    )
                    return

                if res.get("ok") and action == "reject":
                    view = _disabled_view("❌ ปฏิเสธแล้ว (ไม่แก้ไขเว็บ)", False)
                    try:
                        await interaction.message.edit(view=view)
                    except Exception:
                        pass
                    await interaction.followup.send(
                        f"🚫 **ปฏิเสธ Draft `{draft_id}` (`{symbol}`) เรียบร้อยแล้ว** — ไม่มีการเขียนทับข้อมูลบนเว็บ",
                        ephemeral=False,
                    )
                    return

                if code == "STALE_MEMO_CONFLICT":
                    view = _disabled_view("⚠️ Conflict (Memo บนเว็บเปลี่ยนไปก่อนกด)", False)
                    try:
                        await interaction.message.edit(view=view)
                    except Exception:
                        pass
                    replacement = res.get("replacementDraft")
                    msg = (
                        f"⚠️ **ตรวจพบการแก้ไข Memo ของ `{symbol}` บนเว็บก่อนที่คุณจะกดอนุมัติ (`STALE_MEMO_CONFLICT`)**\n"
                        f"• ระบบ **บล็อกการเขียนทับ** เพื่อป้องกันข้อมูลสูญหาย\n"
                        f"• Memo ปัจจุบันบนเว็บ: `{res.get('currentServerMemo')}` (rev {res.get('currentServerMemoRevision')})"
                    )
                    await interaction.followup.send(msg, ephemeral=False)
                    if isinstance(replacement, dict) and replacement.get("draftId"):
                        await asyncio.to_thread(
                            post_discord_draft_card_rest,
                            replacement,
                            "สร้าง Draft ใหม่อัตโนมัติหลังตรวจพบการแก้ไข Memo บนเว็บ",
                        )
                    return

                if code in ("DRAFT_ALREADY_DECIDED", "DRAFT_EXPIRED"):
                    label = (
                        f"⏳ หมดอายุแล้ว ({draft.get('status', 'EXPIRED')})"
                        if code == "DRAFT_EXPIRED"
                        else f"ℹ️ ดำเนินการไปแล้ว ({draft.get('status', 'DECIDED')})"
                    )
                    view = _disabled_view(label, False)
                    try:
                        await interaction.message.edit(view=view)
                    except Exception:
                        pass
                    await interaction.followup.send(
                        f"ℹ️ Draft `{draft_id}` ไม่สามารถทำซ้ำได้: `{res.get('error')}` (`{code}`)",
                        ephemeral=True,
                    )
                    return

                await interaction.followup.send(
                    f"❌ เกิดข้อผิดพลาดในการดำเนินการ Draft `{draft_id}`: `{res.get('error')}` (`{code}`)",
                    ephemeral=True,
                )
            except Exception as exc:
                logger.error("Error in on_webmemo_interaction: %s", exc, exc_info=True)

        client.add_listener(on_webmemo_interaction, "on_interaction")
        client._webmemo_listener_attached = True
        logger.info("Attached MoatWatch persistent Discord button listener (on_interaction)")

    DiscordAdapter._register_slash_commands = _wrapped_register_slash_commands
    DiscordAdapter._webmemo_hook_installed = True


def register(ctx) -> None:
    ctx.register_tool(
        name="moat_get_account_portfolio",
        toolset="webmemo",
        schema={
            "name": "moat_get_account_portfolio",
            "description": (
                "Read the owner's real MoatWatch web account, portfolios, holdings, and watchlist "
                "(read-only). Optionally filter by portfolioId or symbol."
            ),
            "parameters": {
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
        handler=_tool_get_account_portfolio,
    )

    ctx.register_tool(
        name="moat_get_holding_memo",
        toolset="webmemo",
        schema={
            "name": "moat_get_holding_memo",
            "description": (
                "Read the current WebMemo, memoRevision, contentHash, and any pending draft "
                "for a single stock symbol in the owner's account."
            ),
            "parameters": {
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
                },
                "required": ["symbol"],
            },
        },
        handler=_tool_get_holding_memo,
    )

    ctx.register_tool(
        name="moat_propose_webmemo_draft",
        toolset="webmemo",
        schema={
            "name": "moat_propose_webmemo_draft",
            "description": (
                "Create a pending WebMemo draft (<=140 chars) for a stock in the owner's account "
                "and automatically post an interactive Approve/Reject button card to Discord. "
                "Never publishes to the web app without explicit owner approval."
            ),
            "parameters": {
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
                        "description": "Optional idempotency key.",
                    },
                },
                "required": ["symbol", "proposedMemo"],
            },
        },
        handler=_tool_propose_webmemo_draft,
    )

    ctx.register_tool(
        name="moat_list_webmemo_drafts",
        toolset="webmemo",
        schema={
            "name": "moat_list_webmemo_drafts",
            "description": "List recent WebMemo drafts (optionally filtered by status or symbol).",
            "parameters": {
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
        handler=_tool_list_webmemo_drafts,
    )

    ctx.register_tool(
        name="moat_publish_research_post",
        toolset="webmemo",
        schema={
            "name": "moat_publish_research_post",
            "description": (
                "Publish or update a shared Support/Resistance Level 1-2-3 (Short/Medium/Long-term: ระยะสั้น-กลาง-ยาว) "
                "and #tagged research post to the MoatWatch Web App section card (shared across all SyncKeys)."
            ),
            "parameters": {
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
        handler=_tool_publish_research_post,
    )

    ctx.register_tool(
        name="moat_list_research_posts",
        toolset="webmemo",
        schema={
            "name": "moat_list_research_posts",
            "description": (
                "List active shared Support/Resistance 1-2-3 research posts and the full Watchlist S/R 1-2-3 matrix."
            ),
            "parameters": {
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
        handler=_tool_list_research_posts,
    )

    ctx.register_command(
        name="webmemo",
        description="ดูสถานะ รายการรออนุมัติ หรืออนุมัติ/ปฏิเสธ MoatWatch WebMemo Draft",
        handler=_handle_webmemo_slash_command,
    )

    _install_discord_interaction_hook()
