#!/usr/bin/env python3
"""MoatWatch <-> Hermes Agent (echo24) Live Heartbeat & Remote Control Daemon.

Runs as a lightweight independent systemd user service (`moat-hermes-node.service`)
on Raspberry Pi 3B+ (`echo24`). Even when `hermes-gateway.service` is paused/stopped
from the Admin Portal, this daemon remains online so the Admin Portal can monitor Pi
telemetry and start `hermes-gateway.service` back up at any time.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, Tuple


def load_dotenv_if_present(env_path: str = "/root/.hermes/.env") -> None:
    path = Path(env_path)
    if not path.is_file():
        return
    try:
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val
    except Exception:
        pass


load_dotenv_if_present()

API_BASE = os.environ.get("MOAT_API_BASE_URL", "https://moat.readybyte.top").rstrip("/")
TOKEN = os.environ.get("WEBMEMO_INTEGRATION_TOKEN", "").strip()
HEARTBEAT_INTERVAL_SEC = max(2, int(os.environ.get("MOAT_NODE_HEARTBEAT_SEC", "3") or "3"))


def run_cmd(cmd: list[str], timeout: int = 20) -> Tuple[int, str, str]:
    env = dict(os.environ)
    env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )
        return proc.returncode, (proc.stdout or "").strip(), (proc.stderr or "").strip()
    except Exception as exc:
        return 1, "", str(exc)


STATIC_TICKER_LEGACY_JOB_IDS = {"93e7014cfe37", "220b8a4712c8", "be097f1d6598"}


def is_static_ticker_job(job: Dict[str, Any]) -> bool:
    jid = str(job.get("id") or "").strip()
    if jid in STATIC_TICKER_LEGACY_JOB_IDS:
        return True
    name_lower = str(job.get("name") or "").strip().lower()
    if "iren-apld-cifr-onds" in name_lower or "onds call" in name_lower:
        return True
    return False


def read_hermes_cron_jobs(jobs_path: str = "/root/.hermes/cron/jobs.json") -> list[Dict[str, Any]]:
    path = Path(jobs_path)
    if not path.is_file():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        jobs = raw.get("jobs") if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
        compact_jobs: list[Dict[str, Any]] = []
        filtered_raw_jobs: list[Dict[str, Any]] = []
        pruned_static = False
        for j in jobs:
            if not isinstance(j, dict) or not j.get("id"):
                continue
            if is_static_ticker_job(j):
                pruned_static = True
                continue
            filtered_raw_jobs.append(j)
            compact_jobs.append(
                {
                    "id": str(j.get("id") or ""),
                    "name": str(j.get("name") or j.get("id") or ""),
                    "schedule": j.get("schedule") if isinstance(j.get("schedule"), dict) else {},
                    "schedule_display": str(j.get("schedule_display") or ""),
                    "enabled": bool(j.get("enabled", True)),
                    "state": str(j.get("state") or ("scheduled" if j.get("enabled", True) else "paused")),
                    "next_run_at": j.get("next_run_at"),
                    "last_run_at": j.get("last_run_at"),
                    "last_status": j.get("last_status"),
                    "last_error": j.get("last_error"),
                    "deliver": str(j.get("deliver") or "origin"),
                    "skills": list(j.get("skills") or []),
                    "repeat": j.get("repeat") if isinstance(j.get("repeat"), dict) else {},
                }
            )
        if pruned_static and isinstance(raw, dict):
            try:
                raw["jobs"] = filtered_raw_jobs
                path.write_text(json.dumps(raw, indent=2, ensure_ascii=False), encoding="utf-8")
            except Exception:
                pass
        return compact_jobs
    except Exception:
        return []


def collect_pi_metrics() -> Dict[str, Any]:
    hostname = socket.gethostname() or "echo24"

    # 1. Check hermes-gateway.service status & MainPID
    rc_active, out_active, _ = run_cmd(["systemctl", "--user", "is-active", "hermes-gateway.service"], timeout=5)
    is_active = rc_active == 0 and out_active.strip() == "active"

    rc_pid, out_pid, _ = run_cmd(
        ["systemctl", "--user", "show", "hermes-gateway.service", "-p", "MainPID", "-p", "SubState"],
        timeout=5,
    )
    main_pid = 0
    sub_state = out_active or "unknown"
    if rc_pid == 0:
        for line in out_pid.splitlines():
            if line.startswith("MainPID="):
                try:
                    main_pid = int(line.split("=", 1)[1].strip())
                except ValueError:
                    main_pid = 0
            elif line.startswith("SubState="):
                sub_state = line.split("=", 1)[1].strip()

    if is_active:
        gw_status = f"RUNNING (PID {main_pid})" if main_pid > 0 else "RUNNING"
    elif out_active.strip() in ("inactive", "deactivating"):
        gw_status = "PAUSED / STOPPED"
    else:
        gw_status = f"STOPPED ({out_active.strip() or sub_state})"

    # 2. CPU Temperature
    cpu_temp_c = 0.0
    try:
        raw_temp = Path("/sys/class/thermal/thermal_zone0/temp").read_text(encoding="utf-8").strip()
        cpu_temp_c = round(float(raw_temp) / 1000.0, 1)
    except Exception:
        pass

    # 3. Load average & Uptime
    load_1m = 0.0
    try:
        load_1m = round(os.getloadavg()[0], 2)
    except Exception:
        pass

    uptime_human = ""
    try:
        _, up_out, _ = run_cmd(["uptime", "-p"], timeout=4)
        uptime_human = up_out.replace("up ", "").strip()
    except Exception:
        pass

    # 4. Memory usage from /proc/meminfo
    mem_total_mb = 924
    mem_used_mb = 0
    try:
        meminfo: Dict[str, int] = {}
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                parts = v.strip().split()
                if parts and parts[0].isdigit():
                    meminfo[k.strip()] = int(parts[0])
        total_kb = meminfo.get("MemTotal", 946176)
        avail_kb = meminfo.get("MemAvailable", meminfo.get("MemFree", 0))
        mem_total_mb = max(1, round(total_kb / 1024))
        mem_used_mb = max(0, round((total_kb - avail_kb) / 1024))
    except Exception:
        pass

    # 5. Plugin & MCP verification
    plugin_ok = Path("/root/.hermes/plugins/webmemo-approval/__init__.py").is_file()
    mcp_ok = Path("/root/garmin-venu2-moat/.worktrees/hermes-webmemo-live/integrations/hermes_pi/moat_mcp_server.py").is_file()

    return {
        "nodeId": f"{hostname}-pi3b",
        "host": hostname,
        "lanIp": os.environ.get("MOAT_NODE_LAN_IP", "192.168.1.100"),
        "tailscaleIp": os.environ.get("MOAT_NODE_TAILSCALE_IP", "100.113.60.19"),
        "gatewayStatus": gw_status,
        "gatewayServiceActive": is_active,
        "gatewayPid": main_pid,
        "discordBotTag": "Hermesself#6138",
        "discordChannelId": os.environ.get("WEBMEMO_DISCORD_CHANNEL_ID", "1484918931700449487"),
        "mcpServerStatus": "READY" if mcp_ok else "MISSING",
        "pluginStatus": "ACTIVE (webmemo-approval v1.2.0)" if plugin_ok else "MISSING",
        "uptimeHuman": uptime_human,
        "cpuTempC": cpu_temp_c,
        "loadAvg1m": load_1m,
        "memUsedMb": mem_used_mb,
        "memTotalMb": mem_total_mb,
        "cronJobs": read_hermes_cron_jobs(),
        "agentVersion": "1.3.0",
    }


def api_request(method: str, path: str, payload: Dict[str, Any] | None = None, timeout: int = 15) -> Dict[str, Any]:
    url = f"{API_BASE}{path}"
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Accept": "application/json",
        "User-Agent": "MoatWatch-HermesNodeAgent/1.2 (echo24)",
    }
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def run_node_functional_test() -> Tuple[bool, str]:
    lines: list[str] = []
    all_ok = True

    # Step 1: Check systemd service state
    rc_act, out_act, _ = run_cmd(["systemctl", "--user", "is-active", "hermes-gateway.service"], timeout=5)
    gw_ok = rc_act == 0 and out_act.strip() == "active"
    lines.append(f"[1/6] Hermes Gateway Service: {'PASS' if gw_ok else 'WARN'} ({out_act.strip() or 'inactive'})")
    if not gw_ok:
        all_ok = False

    # Step 2: Check Discord plugin & owner IDs
    allowed_ids = os.environ.get("WEBMEMO_ALLOWED_DISCORD_USER_IDS", "")
    has_owner = "932083816485519411" in allowed_ids
    lines.append(
        f"[2/6] Discord Owner Allowlist: {'PASS' if has_owner else 'FAIL'} (IDs={allowed_ids or 'default'})"
    )
    if not has_owner:
        all_ok = False

    # Step 3: Account Summary API
    try:
        summary = api_request("GET", "/api/integration/account", timeout=10)
        p_cnt = len(summary.get("portfolios") or [])
        w_cnt = int(summary.get("watchlistCount") or 0)
        lines.append(f"[3/6] GET /api/integration/account: PASS ({p_cnt} portfolios, {w_cnt} watchlist symbols)")
    except Exception as exc:
        all_ok = False
        lines.append(f"[3/6] GET /api/integration/account: FAIL ({exc})")

    # Step 4: Research Feed API
    try:
        feed = api_request("GET", "/api/integration/research-posts", timeout=10)
        posts_cnt = len(feed.get("posts") or [])
        sr_cnt = len(feed.get("supportResistanceMatrix") or [])
        lines.append(f"[4/6] GET /api/integration/research-posts: PASS ({posts_cnt} posts, {sr_cnt} S/R cards)")
    except Exception as exc:
        all_ok = False
        lines.append(f"[4/6] GET /api/integration/research-posts: FAIL ({exc})")

    # Step 5: WebMemo Drafts Queue API
    try:
        drafts = api_request("GET", "/api/integration/drafts?limit=5", timeout=10)
        d_cnt = len(drafts.get("drafts") or [])
        lines.append(f"[5/6] GET /api/integration/drafts: PASS ({d_cnt} recent drafts queried)")
    except Exception as exc:
        all_ok = False
        lines.append(f"[5/6] GET /api/integration/drafts: FAIL ({exc})")

    # Step 6: MCP Server syntax & tool check
    mcp_script = "/root/garmin-venu2-moat/.worktrees/hermes-webmemo-live/integrations/hermes_pi/moat_mcp_server.py"
    rc_mcp, _, err_mcp = run_cmd(["python3", "-m", "py_compile", mcp_script], timeout=10)
    mcp_pass = rc_mcp == 0
    lines.append(f"[6/6] MoatWatch MCP Adapter Check: {'PASS' if mcp_pass else 'FAIL'} ({err_mcp or 'moat_mcp_server.py OK'})")
    if not mcp_pass:
        all_ok = False

    return all_ok, "\n".join(lines)


def execute_remote_command(cmd_obj: Dict[str, Any]) -> None:
    cmd_id = str(cmd_obj.get("commandId") or "").strip()
    action = str(cmd_obj.get("action") or "").strip().upper()
    if not cmd_id or not action:
        return

    print(f"[moat-node-agent] Executing command {cmd_id}: {action}", flush=True)

    if action == "REBOOT_PI":
        # Report acknowledgement before initiating reboot so Admin UI gets immediate feedback
        try:
            api_request(
                "POST",
                "/api/integration/hermes-node/command-result",
                {
                    "commandId": cmd_id,
                    "status": "SUCCEEDED",
                    "output": "Raspberry Pi (echo24) accepted REBOOT_PI command. System rebooting in 2 seconds...",
                    "metrics": collect_pi_metrics(),
                },
            )
        except Exception as exc:
            print(f"[moat-node-agent] Failed to send pre-reboot ack: {exc}", flush=True)
        subprocess.Popen(["sh", "-c", "sleep 2 && sudo -n /sbin/reboot || /sbin/reboot"])
        return

    ok = False
    output = ""

    if action == "RESTART_GW":
        rc, out, err = run_cmd(["systemctl", "--user", "restart", "hermes-gateway.service"], timeout=25)
        time.sleep(1.5)
        rc2, out2, _ = run_cmd(["systemctl", "--user", "is-active", "hermes-gateway.service"], timeout=5)
        ok = rc == 0 and rc2 == 0 and out2.strip() == "active"
        metrics = collect_pi_metrics()
        output = (
            f"Restarted hermes-gateway.service -> state={out2.strip()} (PID {metrics.get('gatewayPid')}). "
            f"{out} {err}".strip()
        )

    elif action == "PAUSE_STOP_HERMES":
        rc, out, err = run_cmd(["systemctl", "--user", "stop", "hermes-gateway.service"], timeout=20)
        time.sleep(1.0)
        _, out2, _ = run_cmd(["systemctl", "--user", "is-active", "hermes-gateway.service"], timeout=5)
        ok = rc == 0 and out2.strip() in ("inactive", "failed", "deactivating")
        output = (
            f"Paused/Stopped hermes-gateway.service -> state={out2.strip()}. "
            f"Node Control Agent remains ONLINE so you can click 'Start Hermes Service' anytime. {out} {err}".strip()
        )

    elif action == "START_HERMES":
        rc, out, err = run_cmd(["systemctl", "--user", "start", "hermes-gateway.service"], timeout=25)
        time.sleep(1.5)
        rc2, out2, _ = run_cmd(["systemctl", "--user", "is-active", "hermes-gateway.service"], timeout=5)
        ok = rc == 0 and rc2 == 0 and out2.strip() == "active"
        metrics = collect_pi_metrics()
        output = (
            f"Started hermes-gateway.service -> state={out2.strip()} (PID {metrics.get('gatewayPid')}). "
            f"{out} {err}".strip()
        )

    elif action == "TEST_ALL_FUNCTIONS":
        ok, output = run_node_functional_test()

    elif action in ("CRON_RUN_NOW", "CRON_PAUSE", "CRON_RESUME"):
        raw_job_id = str(cmd_obj.get("jobId") or "").strip()
        job_id = "".join(c for c in raw_job_id if c.isalnum() or c in ("-", "_"))[:64]
        if not job_id:
            ok = False
            output = f"Missing or invalid jobId for {action}"
        else:
            hermes_bin = "/root/.hermes/hermes-agent/venv/bin/hermes"
            if action == "CRON_RUN_NOW":
                try:
                    proc = subprocess.Popen(
                        [hermes_bin, "--accept-hooks", "cron", "run", job_id],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        start_new_session=True,
                    )
                    ok = True
                    output = (
                        f"Spawned background execution `hermes --accept-hooks cron run {job_id}` "
                        f"on echo24 (PID {proc.pid}) -> SUCCEEDED"
                    )
                except Exception as exc:
                    ok = False
                    output = f"Failed to spawn `hermes cron run {job_id}`: {exc}"
            else:
                subcmd = "pause" if action == "CRON_PAUSE" else "resume"
                rc, out, err = run_cmd([hermes_bin, "cron", subcmd, job_id], timeout=15)
                ok = rc == 0
                output = (
                    f"Executed `hermes cron {subcmd} {job_id}` -> {'OK' if ok else f'EXIT {rc}'}. "
                    f"{out} {err}".strip()
                )

    else:
        ok = False
        output = f"Unsupported command action: {action}"

    try:
        api_request(
            "POST",
            "/api/integration/hermes-node/command-result",
            {
                "commandId": cmd_id,
                "status": "SUCCEEDED" if ok else "FAILED",
                "output": output,
                "metrics": collect_pi_metrics(),
            },
        )
    except Exception as exc:
        print(f"[moat-node-agent] Failed to report command result for {cmd_id}: {exc}", flush=True)


def main() -> int:
    if not TOKEN:
        print("[moat-node-agent] ERROR: WEBMEMO_INTEGRATION_TOKEN is not set.", file=sys.stderr, flush=True)
        return 1

    print(
        f"[moat-node-agent] Started on {socket.gethostname()} -> polling {API_BASE} every {HEARTBEAT_INTERVAL_SEC}s",
        flush=True,
    )

    while True:
        try:
            metrics = collect_pi_metrics()
            res = api_request("POST", "/api/integration/hermes-node/heartbeat", metrics, timeout=12)
            next_cmd = res.get("nextCommand")
            if isinstance(next_cmd, dict) and next_cmd.get("commandId"):
                execute_remote_command(next_cmd)
        except urllib.error.HTTPError as exc:
            err_body = ""
            try:
                err_body = exc.read().decode("utf-8", errors="ignore")[:200]
            except Exception:
                pass
            print(f"[moat-node-agent] HTTP {exc.code}: {err_body}", flush=True)
        except Exception as exc:
            print(f"[moat-node-agent] Heartbeat error: {exc}", flush=True)

        time.sleep(HEARTBEAT_INTERVAL_SEC)


if __name__ == "__main__":
    raise SystemExit(main())
