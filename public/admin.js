/* MoatWatch Admin Portal — Non-Persistent Auto-Expiring Admin Session, Multi-Select & Individual Key Removal, Customer Requests Approval Queue & Per-Device Activation Key Manager */

(() => {
  try {
    localStorage.removeItem("venu2_admin_token");
  } catch (_) {}

  const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes inactivity auto-logout
  const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes max session lifetime

  const state = {
    token: sessionStorage.getItem("venu2_admin_token") || "",
    authenticated: false,
    adminEmail: "saharat.bun@icloud.com",
    notifyEmail: "e24qdy2@gmail.com",
    authMethod: "",
    passwordUpdatedAt: "",
    isDefaultPassword: false,
    summary: null,
    devices: [],
    selectedDeviceIds: new Set(),
    customerRequests: [],
    emailLogs: [],
    smtpConfig: null,
    auditLogs: [],
    researchFeed: null,
    biAnalytics: null,
    hermesNode: null,
    hermesPollTimer: null,
    hermesFastPollRemaining: 0,
    hermesAutoPoll: true,
    hermesCommandBusy: false,
    biStackMode: "TAG_BY_BIAS", // "TAG_BY_BIAS" | "SR_BY_TICKER" | "USER_ASSETS" | "PORTFOLIO_MIX"
    biChartLayout: "STACKED_V", // "STACKED_V" | "STACKED_H" | "GROUPED"
    cmsStatusFilter: "ALL", // "ALL" | "ACTIVE" | "ARCHIVED"
    cmsTagFilter: "ALL",
    cmsSearchQuery: "",
    selectedPostIds: new Set(),
    lastGeneratedKey: "",
    lastActivityAt: Number(sessionStorage.getItem("venu2_admin_last_active")) || Date.now(),
    sessionExpiresAt: Number(sessionStorage.getItem("venu2_admin_expires_at")) || 0,
    idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
    watchdogTimer: null
  };

  const el = (id) => document.getElementById(id);

  function formatCountdown(sec) {
    const safeSec = Math.max(0, Math.floor(Number(sec) || 0));
    const mm = String(Math.floor(safeSec / 60)).padStart(2, "0");
    const ss = String(safeSec % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  function recordAdminActivity() {
    if (!state.authenticated) return;
    const now = Date.now();
    if (now - state.lastActivityAt < 1000) return;
    state.lastActivityAt = now;
    try {
      sessionStorage.setItem("venu2_admin_last_active", String(now));
    } catch (_) {}
  }

  function stopSessionWatchdog() {
    if (state.watchdogTimer) {
      clearInterval(state.watchdogTimer);
      state.watchdogTimer = null;
    }
    const timerBadge = el("adminSessionTimerBadge");
    if (timerBadge) {
      timerBadge.classList.add("hidden");
      timerBadge.classList.remove("inline-flex");
    }
  }

  async function performAutoLogout(reasonMsg) {
    stopSessionWatchdog();
    try {
      await fetch("/api/admin/auth/logout", {
        method: "POST",
        headers: authHeaders()
      });
    } catch (_) {}
    state.token = "";
    state.authenticated = false;
    state.selectedDeviceIds.clear();
    try {
      sessionStorage.removeItem("venu2_admin_token");
      sessionStorage.removeItem("venu2_admin_last_active");
      sessionStorage.removeItem("venu2_admin_expires_at");
    } catch (_) {}
    renderAuthView();
    if (reasonMsg) {
      const errBox = el("loginErrorBox");
      if (errBox) {
        errBox.textContent = reasonMsg;
        errBox.classList.remove("hidden");
      }
      showToast(reasonMsg);
    }
  }

  function startSessionWatchdog() {
    stopSessionWatchdog();
    if (!state.authenticated) return;

    const timerBadge = el("adminSessionTimerBadge");
    const timerText = el("adminSessionTimerText");
    if (timerBadge) {
      timerBadge.classList.remove("hidden");
      timerBadge.classList.add("inline-flex");
    }

    const tick = () => {
      if (!state.authenticated) {
        stopSessionWatchdog();
        return;
      }
      const now = Date.now();
      const idleRemSec = Math.max(0, Math.ceil((state.lastActivityAt + state.idleTimeoutMs - now) / 1000));
      const sessRemSec = state.sessionExpiresAt
        ? Math.max(0, Math.ceil((state.sessionExpiresAt - now) / 1000))
        : idleRemSec;
      const effectiveRemSec = Math.min(idleRemSec, sessRemSec);

      if (timerText) {
        timerText.textContent = `Auto-Logout: ${formatCountdown(effectiveRemSec)}`;
      }
      if (effectiveRemSec <= 0) {
        performAutoLogout(
          "Session expired automatically due to inactivity or max session lifetime to prevent forgotten logins. Please sign in again."
        );
      }
    };

    tick();
    state.watchdogTimer = setInterval(tick, 1000);
  }

  function showToast(msg) {
    const banner = el("adminToastBanner");
    const text = el("adminToastMessage");
    if (!banner || !text) return;
    text.textContent = msg;
    banner.classList.remove("translate-y-20", "opacity-0");
    banner.classList.add("translate-y-0", "opacity-100");
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      banner.classList.add("translate-y-20", "opacity-0");
      banner.classList.remove("translate-y-0", "opacity-100");
    }, 3200);
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function authHeaders() {
    const h = { "Content-Type": "application/json" };
    if (state.token) {
      h["Authorization"] = `Bearer ${state.token}`;
    }
    return h;
  }

  async function checkSessionAndLoad() {
    // Prevent permanent cookie auto-login if tab session token is absent or already idle-expired
    const now = Date.now();
    const hasTabToken = Boolean(state.token);
    const isIdleExpired = hasTabToken && now - state.lastActivityAt > state.idleTimeoutMs;
    if (!hasTabToken || isIdleExpired) {
      try {
        await fetch("/api/admin/auth/logout", { method: "POST" });
      } catch (_) {}
      state.token = "";
      state.authenticated = false;
      try {
        sessionStorage.removeItem("venu2_admin_token");
        sessionStorage.removeItem("venu2_admin_last_active");
        sessionStorage.removeItem("venu2_admin_expires_at");
      } catch (_) {}
    }

    const res = await fetch("/api/admin/session", { headers: authHeaders() });
    const data = await res.json();
    state.isDefaultPassword = Boolean(data.isDefaultPassword);
    state.passwordUpdatedAt = data.passwordUpdatedAt || "";
    if (data.notifyEmail) state.notifyEmail = data.notifyEmail;
    if (data.idleTimeoutSec) {
      state.idleTimeoutMs = Math.max(60 * 1000, Number(data.idleTimeoutSec) * 1000);
    }

    if (data.authenticated && (hasTabToken || data.authMethod === "CLOUDFLARE_ZERO_TRUST")) {
      state.authenticated = true;
      state.adminEmail = data.email || "saharat.bun@icloud.com";
      state.authMethod = data.authMethod || "ADMIN_PASSWORD";
      state.sessionExpiresAt = Number(data.expiresAt) || Date.now() + DEFAULT_SESSION_TTL_MS;
      state.lastActivityAt = Date.now();
      try {
        sessionStorage.setItem("venu2_admin_last_active", String(state.lastActivityAt));
        sessionStorage.setItem("venu2_admin_expires_at", String(state.sessionExpiresAt));
      } catch (_) {}
      startSessionWatchdog();
      await Promise.all([fetchDevicesData(), fetchEmailConfig(), fetchHermesNodeStatus(true)]);
      startHermesStatusPoller();
    } else {
      state.authenticated = false;
      stopSessionWatchdog();
      stopHermesStatusPoller();
    }
    renderAuthView();
  }

  function stopHermesStatusPoller() {
    if (state.hermesPollTimer) {
      clearTimeout(state.hermesPollTimer);
      state.hermesPollTimer = null;
    }
  }

  function scheduleNextHermesPoll() {
    stopHermesStatusPoller();
    if (!state.authenticated || !state.hermesAutoPoll) return;
    const hasActiveCmd =
      state.hermesFastPollRemaining > 0 ||
      (state.hermesNode?.commandQueue || []).some((c) => c.status === "PENDING" || c.status === "DISPATCHED");
    const delayMs = hasActiveCmd ? 1500 : 8000;
    if (state.hermesFastPollRemaining > 0) {
      state.hermesFastPollRemaining -= 1;
    }
    state.hermesPollTimer = setTimeout(async () => {
      await fetchHermesNodeStatus(true);
      scheduleNextHermesPoll();
    }, delayMs);
  }

  function startHermesStatusPoller() {
    stopHermesStatusPoller();
    if (!state.authenticated) return;
    scheduleNextHermesPoll();
  }

  async function fetchHermesNodeStatus(silent = true) {
    try {
      const res = await fetch("/api/admin/hermes-node/status", { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.ok) {
        state.hermesNode = data;
        renderHermesControlSection();
        if (!silent) {
          showToast(`Hermes (${data.host || "echo24"}): ${data.statusLabel || data.connectionState}`);
        }
      }
    } catch (_) {
      // Ignore transient network errors during background polling
    }
  }

  async function sendHermesRemoteCommand(action) {
    if (!action || state.hermesCommandBusy) return;
    if (action === "REBOOT_PI") {
      const confirmed = window.confirm(
        "Confirm hardware reboot of Raspberry Pi (echo24 / 192.168.1.100)?\n\nHermes Agent will go offline for ~45-60 seconds while the Pi reboots and systemd services auto-start."
      );
      if (!confirmed) return;
    }

    state.hermesCommandBusy = true;
    const cmdBadge = el("hermesCommandStateBadge");
    if (cmdBadge) {
      cmdBadge.textContent = `Sending ${action}...`;
      cmdBadge.className =
        "text-[11px] font-mono px-2.5 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 self-start sm:self-center";
    }

    try {
      const res = await fetch("/api/admin/hermes-node/command", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          action,
          reason: `Triggered from Admin Page by ${state.adminEmail}`
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showToast(data.error || `Command ${action} failed`);
        return;
      }

      if (data.nodeStatus) {
        state.hermesNode = data.nodeStatus;
      } else if (data.diagnosticReport && state.hermesNode) {
        state.hermesNode.lastDiagnosticReport = data.diagnosticReport;
      }
      renderHermesControlSection();

      if (action === "TEST_ALL_FUNCTIONS" && data.diagnosticReport) {
        const s = data.diagnosticReport.summary || {};
        showToast(
          `Functional Test Complete: ${s.passed || 0}/${s.total || 8} Checks PASSED (${data.diagnosticReport.overallStatus})`
        );
      } else {
        showToast(`Queued command "${data.command?.label || action}" for echo24`);
      }

      state.hermesFastPollRemaining = 10;
      scheduleNextHermesPoll();
    } catch (err) {
      showToast(`Command error: ${err.message}`);
    } finally {
      state.hermesCommandBusy = false;
    }
  }

  function renderHermesControlSection() {
    const node = state.hermesNode;
    if (!node) return;

    const connState = node.connectionState || "UNKNOWN";
    const statusLabel = node.statusLabel || connState;
    const ageSec = node.heartbeatAgeSec;
    const ageLabel =
      ageSec === null || ageSec === undefined
        ? "Waiting for first Pi heartbeat"
        : ageSec <= 2
        ? "Just now (<2s ago)"
        : `${ageSec}s ago`;

    // 1. Update Top Header Pill
    const hdrBadge = el("adminHermesStatusHeaderBadge");
    const hdrDot = el("adminHermesHeaderDot");
    const hdrText = el("adminHermesHeaderText");
    if (hdrBadge && hdrDot && hdrText) {
      hdrBadge.classList.remove("hidden");
      if (connState === "ONLINE") {
        hdrBadge.className =
          "hidden sm:inline-flex items-center gap-1.5 font-mono text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/35 text-emerald-300";
        hdrDot.className = "w-2 h-2 rounded-full bg-emerald-400 animate-pulse";
        hdrText.textContent = `Hermes (${node.host || "echo24"}): ONLINE`;
      } else if (connState === "PAUSED") {
        hdrBadge.className =
          "hidden sm:inline-flex items-center gap-1.5 font-mono text-[11px] px-2.5 py-1 rounded-full bg-amber-500/15 ring-1 ring-amber-500/35 text-amber-300";
        hdrDot.className = "w-2 h-2 rounded-full bg-amber-400";
        hdrText.textContent = `Hermes (${node.host || "echo24"}): PAUSED`;
      } else {
        hdrBadge.className =
          "hidden sm:inline-flex items-center gap-1.5 font-mono text-[11px] px-2.5 py-1 rounded-full bg-rose-500/15 ring-1 ring-rose-500/35 text-rose-300";
        hdrDot.className = "w-2 h-2 rounded-full bg-rose-400";
        hdrText.textContent = `Hermes (${node.host || "echo24"}): ${connState}`;
      }
    }

    // 2. Update Section Status Pill
    const secBadge = el("hermesLiveStatusBadge");
    const secDot = el("hermesLiveStatusDot");
    const secText = el("hermesLiveStatusText");
    if (secBadge && secDot && secText) {
      secText.textContent = `HERMES: ${statusLabel}`;
      if (connState === "ONLINE") {
        secBadge.className =
          "inline-flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/35";
        secDot.className = "w-2 h-2 rounded-full bg-emerald-400 animate-pulse";
      } else if (connState === "PAUSED") {
        secBadge.className =
          "inline-flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/35";
        secDot.className = "w-2 h-2 rounded-full bg-amber-400";
      } else {
        secBadge.className =
          "inline-flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/35";
        secDot.className = "w-2 h-2 rounded-full bg-rose-400";
      }
    }

    if (el("hermesGatewayStateBadge")) {
      el("hermesGatewayStateBadge").textContent = `GW: ${node.gatewayStatus || "UNKNOWN"}`;
    }
    if (el("hermesHeartbeatAgeText")) {
      el("hermesHeartbeatAgeText").textContent = `Last Check: ${ageLabel}`;
    }

    // 3. Telemetry Cards
    if (el("hermesNodeHostPill")) el("hermesNodeHostPill").textContent = node.host || "echo24";
    if (el("hermesNodeIpText")) {
      el("hermesNodeIpText").textContent = `${node.lanIp || "192.168.1.100"} · TS ${node.tailscaleIp || "100.113.60.19"}`;
    }
    if (el("hermesNodeUptimeText")) {
      el("hermesNodeUptimeText").textContent = `Uptime: ${node.uptimeHuman || "—"}`;
    }
    if (el("hermesGwPidPill")) {
      el("hermesGwPidPill").textContent = node.gatewayPid ? `PID ${node.gatewayPid}` : "systemd --user";
    }
    if (el("hermesGwServiceText")) {
      el("hermesGwServiceText").textContent = node.gatewayStatus || "UNKNOWN";
      el("hermesGwServiceText").className = node.gatewayServiceActive
        ? "font-mono text-sm font-bold text-emerald-400 mt-1"
        : "font-mono text-sm font-bold text-amber-300 mt-1";
    }
    if (el("hermesPluginMcpText")) {
      el("hermesPluginMcpText").textContent = `Plugin: ${node.pluginStatus || "ACTIVE"} · MCP: ${node.mcpServerStatus || "READY"}`;
    }
    if (el("hermesDiscordBotText")) {
      el("hermesDiscordBotText").textContent = `${node.discordBotTag || "Hermesself#6138"} (#${String(node.discordChannelId || "").slice(-6)})`;
    }
    if (el("hermesLastBeatIso")) {
      el("hermesLastBeatIso").textContent = node.lastHeartbeatAt
        ? new Date(node.lastHeartbeatAt).toLocaleTimeString("en-GB")
        : "—";
    }
    if (el("hermesPiMetricsText")) {
      const tempStr = node.cpuTempC ? `${Number(node.cpuTempC).toFixed(1)}°C` : "—°C";
      const memStr = node.memUsedMb ? `${node.memUsedMb}/${node.memTotalMb || 924} MB` : "— MB";
      el("hermesPiMetricsText").textContent = `Temp: ${tempStr} · RAM: ${memStr}`;
    }
    if (el("hermesPiLoadText")) {
      const loadStr = node.loadAvg1m !== undefined ? Number(node.loadAvg1m).toFixed(2) : "—";
      el("hermesPiLoadText").textContent = `Load 1m: ${loadStr} · Queue: ${node.pendingCommandCount || 0} pending`;
    }

    // 4. Command Console Output
    const queue = Array.isArray(node.commandQueue) ? node.commandQueue : [];
    const latestCmd = queue[0] || node.lastCommandResult || null;
    const cmdBadge = el("hermesCommandStateBadge");
    if (cmdBadge && latestCmd) {
      if (latestCmd.status === "PENDING" || latestCmd.status === "DISPATCHED") {
        cmdBadge.textContent = `${latestCmd.action}: ${latestCmd.status} on echo24...`;
        cmdBadge.className =
          "text-[11px] font-mono px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 self-start sm:self-center animate-pulse";
      } else if (latestCmd.status === "SUCCEEDED") {
        cmdBadge.textContent = `${latestCmd.action}: SUCCEEDED`;
        cmdBadge.className =
          "text-[11px] font-mono px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 self-start sm:self-center";
      } else {
        cmdBadge.textContent = `${latestCmd.action}: ${latestCmd.status}`;
        cmdBadge.className =
          "text-[11px] font-mono px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 self-start sm:self-center";
      }
    }

    if (el("hermesLastCmdMeta")) {
      if (latestCmd) {
        const ts = latestCmd.completedAt || latestCmd.dispatchedAt || latestCmd.requestedAt;
        el("hermesLastCmdMeta").textContent = `${latestCmd.commandId} · ${latestCmd.status}${ts ? " · " + new Date(ts).toLocaleTimeString("en-GB") : ""}`;
      } else {
        el("hermesLastCmdMeta").textContent = "Ready";
      }
    }

    const consoleEl = el("hermesCommandConsoleOutput");
    if (consoleEl) {
      if (queue.length > 0) {
        consoleEl.textContent = queue
          .slice(0, 5)
          .map((c) => {
            const ts = c.completedAt || c.dispatchedAt || c.requestedAt || "";
            const header = `[${ts ? new Date(ts).toLocaleTimeString("en-GB") : "NOW"}] ${c.action} (${c.status}) — ID: ${c.commandId}`;
            const body = c.output
              ? c.output
              : c.status === "PENDING"
              ? "Queued in Cloudflare D1 — waiting for echo24 heartbeat pickup (1-3s)..."
              : c.status === "DISPATCHED"
              ? "Dispatched to echo24 — executing on Raspberry Pi..."
              : "Completed.";
            return `${header}\n${body}`;
          })
          .join("\n────────────────────────────────────────────────────────\n");
      } else {
        consoleEl.textContent = `Connected to ${node.host || "echo24"} (${node.lanIp || "192.168.1.100"}).\nGateway: ${node.gatewayStatus || "RUNNING"}\nNo remote commands executed in this session yet.`;
      }
    }

    // 5. Render 8-Step Functional Verification Matrix
    const diag = node.lastDiagnosticReport;
    const diagBody = el("hermesDiagStepsBody");
    const diagBadge = el("hermesDiagOverallBadge");
    const diagSummary = el("hermesDiagSummaryText");
    if (diag && Array.isArray(diag.steps) && diagBody) {
      const s = diag.summary || {};
      if (diagBadge) {
        diagBadge.textContent = `${diag.overallStatus} · ${s.passed || 0}/${s.total || diag.steps.length} PASS (${diag.totalDurationMs || 0}ms)`;
        diagBadge.className =
          diag.overallStatus === "HEALTHY"
            ? "text-[10px] font-mono px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold"
            : "text-[10px] font-mono px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold";
      }
      if (diagSummary && diag.executedAt) {
        diagSummary.textContent = `Last tested at ${new Date(diag.executedAt).toLocaleString("en-GB")} · Passed: ${s.passed || 0}, Warn: ${s.warned || 0}, Failed: ${s.failed || 0}`;
      }
      diagBody.innerHTML = diag.steps
        .map((step) => {
          const badge =
            step.status === "PASS"
              ? `<span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">PASS</span>`
              : step.status === "WARN"
              ? `<span class="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold">WARN</span>`
              : `<span class="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold">FAIL</span>`;
          return `
            <tr class="hover:bg-white/[0.02]">
              <td class="py-1.5 pr-2 font-semibold text-white">${escapeHtml(step.name)}</td>
              <td class="py-1.5 px-2">${badge}</td>
              <td class="py-1.5 px-2 text-cyan-300">${Number(step.latencyMs || 0)}ms</td>
              <td class="py-1.5 pl-2 text-slate-300">${escapeHtml(step.detail || "")}</td>
            </tr>
          `;
        })
        .join("");
    }
  }

  async function fetchDevicesData() {
    const res = await fetch("/api/admin/devices", { headers: authHeaders() });
    if (res.status === 401) {
      state.authenticated = false;
      sessionStorage.removeItem("venu2_admin_token");
      renderAuthView();
      return;
    }
    const data = await res.json();
    state.summary = data.summary || {};
    state.devices = data.devices || [];
    state.customerRequests = data.customerRequests || [];
    state.emailLogs = data.emailLogs || [];
    state.auditLogs = data.auditLogs || [];
    if (data.researchFeed) state.researchFeed = data.researchFeed;
    if (data.biAnalytics) state.biAnalytics = data.biAnalytics;
    if (data.hermesNode) state.hermesNode = data.hermesNode;
    if (data.admin) {
      state.isDefaultPassword = Boolean(data.admin.isDefaultPassword);
      state.passwordUpdatedAt = data.admin.passwordUpdatedAt || state.passwordUpdatedAt;
    }
    if (!state.researchFeed || !state.biAnalytics) {
      await fetchBiAndResearchPosts(false);
    }
    renderDashboard();
  }

  async function fetchBiAndResearchPosts(shouldRender = true) {
    try {
      const [biRes, cmsRes] = await Promise.all([
        fetch("/api/admin/bi-dashboard", { headers: authHeaders() }),
        fetch("/api/admin/research-posts", { headers: authHeaders() })
      ]);
      if (biRes.ok) {
        const biData = await biRes.json();
        if (biData.biAnalytics) state.biAnalytics = biData.biAnalytics;
        if (biData.researchFeed) state.researchFeed = biData.researchFeed;
      }
      if (cmsRes.ok) {
        const cmsData = await cmsRes.json();
        if (cmsData.posts) {
          state.researchFeed = {
            ...(state.researchFeed || {}),
            ...cmsData
          };
        }
      }
      if (shouldRender) {
        renderBiDashboard();
        renderHermesCmsSection();
      }
    } catch (_) {
      // Ignore transient error
    }
  }

  async function fetchEmailConfig() {
    const res = await fetch("/api/admin/email/config", { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    if (data.smtpConfig) {
      state.smtpConfig = data.smtpConfig;
      populateSmtpForm(data.smtpConfig);
    }
    if (data.emailLogs) {
      state.emailLogs = data.emailLogs;
      renderEmailLogs();
    }
  }

  function populateSmtpForm(cfg) {
    if (!cfg) return;
    if (el("smtpRecipientEmailInput")) el("smtpRecipientEmailInput").value = cfg.recipientEmail || "e24qdy2@gmail.com";
    if (el("smtpFromEmailInput")) el("smtpFromEmailInput").value = cfg.fromEmail || "saharat.bun@icloud.com";
    if (el("smtpHostInput")) el("smtpHostInput").value = cfg.smtpHost || "smtp.gmail.com";
    if (el("smtpPortInput")) el("smtpPortInput").value = String(cfg.smtpPort || 465);
    if (el("smtpSecureCheck")) el("smtpSecureCheck").checked = cfg.smtpSecure !== false;
    if (el("smtpUserInput")) el("smtpUserInput").value = cfg.smtpUser || "";
    if (el("smtpPassInput")) {
      el("smtpPassInput").value = "";
      el("smtpPassInput").placeholder = cfg.hasPassword
        ? `Password saved (${cfg.smtpPassMasked}) — leave blank to keep current`
        : "Enter 16-digit App Password (if using SMTP Auth)";
    }
  }

  function renderAuthView() {
    const gate = el("adminLoginGate");
    const dash = el("adminDashboardContent");
    const pill = el("adminAuthStatusPill");
    const logoutBtn = el("adminLogoutBtn");

    if (state.authenticated) {
      gate.classList.add("hidden");
      dash.classList.remove("hidden");
      pill.textContent = `${state.adminEmail} (${state.authMethod})`;
      pill.className = "font-mono text-xs px-3 py-1 rounded-full bg-emerald/15 ring-1 ring-emerald/30 text-emerald";
      logoutBtn.classList.remove("hidden");
    } else {
      gate.classList.remove("hidden");
      dash.classList.add("hidden");
      pill.textContent = "Password Auth Required";
      pill.className = "font-mono text-xs px-3 py-1 rounded-full bg-amber/15 ring-1 ring-amber/30 text-amber";
      logoutBtn.classList.add("hidden");
    }
  }

  function renderCustomerRequests() {
    const reqListEl = el("adminCustomerRequestsList");
    const badgeEl = el("customerRequestsCountBadge");
    if (!reqListEl) return;

    const requests = state.customerRequests || [];
    const pendingCount = requests.filter((r) => r.status === "PENDING").length;
    if (badgeEl) {
      badgeEl.textContent = `${pendingCount} Pending / ${requests.length} Total`;
    }

    if (!requests.length) {
      reqListEl.innerHTML = `<div class="rounded-2xl bg-void/60 p-6 text-center text-xs text-slate-400">No customer trial extension or license purchase requests yet.</div>`;
      return;
    }

    reqListEl.innerHTML = requests
      .map((req) => {
        const isPurchase = req.requestType === "PURCHASE_LICENSE";
        const typeBadge = isPurchase
          ? `<span class="font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-cyan/20 text-cyan ring-1 ring-cyan/40 font-semibold">PURCHASE LICENSE</span>`
          : `<span class="font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-amber/20 text-amber ring-1 ring-amber/40 font-semibold">TRIAL EXTEND (+${escapeHtml(req.requestedExtendDays || 14)}D)</span>`;

        let statusBadge = `<span class="font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-amber/15 text-amber ring-1 ring-amber/35 font-bold">PENDING</span>`;
        if (req.status === "APPROVED") {
          const resLabel = req.resolutionNote || req.resolutionAction || "Resolved";
          statusBadge = `<span class="font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-emerald/20 text-emerald ring-1 ring-emerald/40 font-bold">APPROVED (${escapeHtml(resLabel)})</span>`;
        } else if (req.status === "REJECTED") {
          statusBadge = `<span class="font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-crimson/20 text-crimson ring-1 ring-crimson/40 font-bold">REJECTED</span>`;
        }

        const emailInfo = req.emailDelivery
          ? `${escapeHtml(req.emailDelivery.recipientEmail || "e24qdy2@gmail.com")} (${escapeHtml(req.emailDelivery.deliveryMethod || "SENT")})`
          : "e24qdy2@gmail.com";

        return `
          <div class="rounded-2xl bg-void/80 ring-1 ${req.status === "PENDING" ? "ring-amber/35" : "ring-white/[0.08]"} p-4 sm:p-5 space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono text-xs font-bold text-slate-300">${escapeHtml(req.id)}</span>
                ${typeBadge}
                ${statusBadge}
                <span class="font-mono text-xs font-extrabold text-alabaster bg-white/[0.06] px-2.5 py-0.5 rounded-lg">Device: ${escapeHtml(req.deviceId)}</span>
                <span class="font-mono text-[11px] text-slate-400">Sync: ${escapeHtml(req.syncKey)}</span>
              </div>
              <div class="text-[11px] font-mono text-slate-400">
                ${new Date(req.createdAt).toLocaleString("en-GB")}
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs bg-core/70 rounded-xl p-3 ring-1 ring-white/[0.05]">
              <div>
                <span class="text-slate-400">Contact:</span>
                <strong class="text-alabaster ml-1">${escapeHtml(req.contactName)}</strong>
              </div>
              <div>
                <span class="text-slate-400">Email:</span>
                <a href="mailto:${escapeHtml(req.contactEmail)}" class="font-mono text-cyan underline ml-1">${escapeHtml(req.contactEmail)}</a>
              </div>
              <div>
                <span class="text-slate-400">Phone / LINE:</span>
                <strong class="font-mono text-emerald ml-1">${escapeHtml(req.contactPhone)}</strong>
              </div>
              <div class="md:col-span-3 pt-1 border-t border-white/[0.05] text-slate-300">
                <span class="text-slate-400">Notes:</span>
                <span class="ml-1">${escapeHtml(req.message || "-")}</span>
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div class="text-[11px] font-mono text-slate-400">
                Email Notification: <span class="text-emerald">${emailInfo}</span>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-req-id="${escapeHtml(req.id)}"
                  data-req-action="APPROVE_PURCHASE_ACTIVATE"
                  class="req-resolve-btn rounded-full bg-cyan/20 hover:bg-cyan/30 ring-1 ring-cyan/45 px-3 py-1 text-[11px] font-mono font-bold text-cyan"
                >
                  ✓ Approve &amp; Activate PRO
                </button>
                <button
                  type="button"
                  data-req-id="${escapeHtml(req.id)}"
                  data-req-action="APPROVE_EXTEND_14"
                  class="req-resolve-btn rounded-full bg-emerald/15 hover:bg-emerald/25 ring-1 ring-emerald/35 px-3 py-1 text-[11px] font-mono font-semibold text-emerald"
                >
                  + Approve Extend +14d
                </button>
                <button
                  type="button"
                  data-req-id="${escapeHtml(req.id)}"
                  data-req-action="APPROVE_EXTEND_7"
                  class="req-resolve-btn rounded-full bg-amber/15 hover:bg-amber/25 ring-1 ring-amber/35 px-3 py-1 text-[11px] font-mono text-amber"
                >
                  + Approve Extend +7d
                </button>
                <button
                  type="button"
                  data-req-id="${escapeHtml(req.id)}"
                  data-req-action="REJECT"
                  class="req-resolve-btn rounded-full bg-crimson/15 hover:bg-crimson/25 ring-1 ring-crimson/35 px-3 py-1 text-[11px] font-mono text-crimson"
                >
                  ✕ Reject
                </button>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    reqListEl.querySelectorAll(".req-resolve-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const requestId = btn.getAttribute("data-req-id");
        const action = btn.getAttribute("data-req-action");
        const res = await fetch("/api/admin/requests/resolve", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ requestId, action })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          state.summary = data.summary;
          state.devices = data.devices;
          state.customerRequests = data.customerRequests || [];
          state.emailLogs = data.emailLogs || state.emailLogs;
          state.auditLogs = data.auditLogs;
          renderDashboard();
          showToast(`Processed request ${requestId} (${action}) successfully.`);
        } else {
          showToast(data.error || "Unable to process request.");
        }
      });
    });
  }

  function renderEmailLogs() {
    const bodyEl = el("adminEmailLogsTableBody");
    if (!bodyEl) return;
    const logs = state.emailLogs || [];
    if (!logs.length) {
      bodyEl.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-slate-400">No email notification history yet.</td></tr>`;
      return;
    }
    bodyEl.innerHTML = logs
      .map(
        (m) => `
        <tr>
          <td class="py-2 pr-4 text-slate-400 whitespace-nowrap">${new Date(m.timestamp).toLocaleString("en-GB")}</td>
          <td class="py-2 pr-4 text-emerald font-semibold">${escapeHtml(m.to)}</td>
          <td class="py-2 pr-4 text-alabaster font-sans text-xs">${escapeHtml(m.subject)}</td>
          <td class="py-2 pr-4 text-cyan">${escapeHtml(m.deliveryMethod)}</td>
          <td class="py-2 text-slate-300 text-[11px]">${escapeHtml(m.spoolFile || "")} · ${escapeHtml(m.detail || "")}</td>
        </tr>
      `
      )
      .join("");
  }

  function drawDonutCanvas(canvasEl, slices) {
    if (!canvasEl) return;
    const ctx = canvasEl.getContext("2d");
    const w = canvasEl.width;
    const h = canvasEl.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const outerR = Math.min(w, h) / 2 - 6;
    const innerR = outerR * 0.62;

    const validSlices = (slices || []).filter((s) => Number(s.value || 0) > 0);
    const total = validSlices.reduce((acc, s) => acc + Number(s.value || 0), 0);

    if (total <= 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2, true);
      ctx.fillStyle = "rgba(148, 163, 184, 0.15)";
      ctx.fill();
      return;
    }

    let startAngle = -Math.PI / 2;
    validSlices.forEach((s) => {
      const val = Number(s.value || 0);
      const sweep = (val / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, startAngle, startAngle + sweep);
      ctx.arc(cx, cy, innerR, startAngle + sweep, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = s.color || "#06B6D4";
      ctx.fill();

      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#050608";
      ctx.stroke();

      startAngle += sweep;
    });
  }

  function renderDonutWithLegend(canvasId, legendId, centerId, slices) {
    const canvas = el(canvasId);
    const legend = el(legendId);
    const center = el(centerId);
    drawDonutCanvas(canvas, slices);

    const total = (slices || []).reduce((acc, s) => acc + Number(s.value || 0), 0);
    if (center) {
      center.textContent = String(total);
    }
    if (!legend) return;

    legend.innerHTML = (slices || [])
      .slice(0, 6)
      .map((s) => {
        const val = Number(s.value || 0);
        const pct = total > 0 ? Math.round((val / total) * 100) : 0;
        return `
          <div class="flex items-center justify-between gap-2 text-[11px]">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="w-2.5 h-2.5 rounded-sm shrink-0" style="background:${escapeHtml(s.color || "#06B6D4")}"></span>
              <span class="text-slate-300 truncate" title="${escapeHtml(s.label)}">${escapeHtml(s.label)}</span>
            </div>
            <span class="font-mono text-white font-semibold shrink-0">${val} <span class="text-slate-400">(${pct}%)</span></span>
          </div>
        `;
      })
      .join("");
  }

  function getActiveBiStackDataset(bi) {
    const mode = state.biStackMode || "TAG_BY_BIAS";
    const sb = bi?.stackedBars || {};

    if (mode === "SR_BY_TICKER") {
      return {
        title: "2. Watchlist Support (S1–S2–S3) vs Resistance (R1–R2–R3) Distance % from Live Price",
        unit: "%",
        series: [
          { key: "downsideS1", label: "S1 Buffer (ระยะสั้น)", color: "#34D399" },
          { key: "downsideS2", label: "S2 Step (ระยะกลาง)", color: "#10B981" },
          { key: "downsideS3", label: "S3 Floor (ระยะยาว)", color: "#059669" },
          { key: "upsideR1", label: "R1 Upside (ระยะสั้น)", color: "#FBBF24" },
          { key: "upsideR2", label: "R2 Target (ระยะกลาง)", color: "#F59E0B" },
          { key: "upsideR3", label: "R3 Stretch (ระยะยาว)", color: "#06B6D4" }
        ],
        rows: (sb.srByTicker || []).map((r) => ({
          label: r.symbol,
          sub: `R/R ${Number(r.riskRewardRatio || 1.5).toFixed(2)}x · ${r.bandLabel || "CHANNEL"}`,
          values: {
            downsideS1: Number(r.downsideS1 || 0),
            downsideS2: Math.max(0, Number(r.downsideS2 || 0) - Number(r.downsideS1 || 0)),
            downsideS3: Math.max(0, Number(r.downsideS3 || 0) - Number(r.downsideS2 || 0)),
            upsideR1: Number(r.upsideR1 || 0),
            upsideR2: Math.max(0, Number(r.upsideR2 || 0) - Number(r.upsideR1 || 0)),
            upsideR3: Math.max(0, Number(r.upsideR3 || 0) - Number(r.upsideR2 || 0))
          },
          rawValues: r
        }))
      };
    }

    if (mode === "USER_ASSETS") {
      return {
        title: "3. User SyncKey Profiles: Core Holdings vs Watchlist vs Active WebMemos",
        unit: "",
        series: [
          { key: "holdingsCount", label: "Core Holdings", color: "#10B981" },
          { key: "watchlistCount", label: "Watchlist Only", color: "#06B6D4" },
          { key: "memoCount", label: "Active WebMemos", color: "#F59E0B" }
        ],
        rows: (sb.userAssets || []).map((r) => ({
          label: r.syncKey,
          sub: `${r.portfolioCount || 1} Port · ${r.baseCurrency || "USD"}`,
          values: {
            holdingsCount: Number(r.holdingsCount || 0),
            watchlistCount: Number(r.watchlistCount || 0),
            memoCount: Number(r.memoCount || 0)
          }
        }))
      };
    }

    if (mode === "PORTFOLIO_MIX") {
      return {
        title: "4. Portfolio Category Breakdown: Core Holdings vs Watchlist vs Active WebMemos",
        unit: "",
        series: [
          { key: "holdings", label: "Core Holdings", color: "#10B981" },
          { key: "watchlist", label: "Watchlist", color: "#06B6D4" },
          { key: "memos", label: "WebMemos", color: "#A855F7" }
        ],
        rows: (sb.portfolioBreakdown || []).map((r) => ({
          label: r.category,
          sub: `Total ${Number(r.holdings || 0) + Number(r.watchlist || 0)} positions`,
          values: {
            holdings: Number(r.holdings || 0),
            watchlist: Number(r.watchlist || 0),
            memos: Number(r.memos || 0)
          }
        }))
      };
    }

    // Default: TAG_BY_BIAS
    return {
      title: "1. Hermes Research Posts by #Tag Topic & Tactical Bias (Stacked)",
      unit: "",
      series: [
        { key: "bullish", label: "Bullish", color: "#10B981" },
        { key: "accumulate", label: "Accumulate", color: "#06B6D4" },
        { key: "neutral", label: "Neutral", color: "#64748B" },
        { key: "defensive", label: "Defensive", color: "#F59E0B" },
        { key: "archived", label: "Archived/Hidden", color: "#F43F5E" }
      ],
      rows: (sb.tagByBias || []).map((r) => ({
        label: r.tag,
        sub: `${r.active || 0} Active · ${r.archived || 0} Archived`,
        values: {
          bullish: Number(r.bullish || 0),
          accumulate: Number(r.accumulate || 0),
          neutral: Number(r.neutral || 0),
          defensive: Number(r.defensive || 0),
          archived: Number(r.archived || 0)
        }
      }))
    };
  }

  function drawBiMultiBarCanvas(dataset) {
    const canvas = el("biStackedBarCanvas");
    if (!canvas || !dataset) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const rows = dataset.rows || [];
    const series = dataset.series || [];
    const layout = state.biChartLayout || "STACKED_V";

    if (!rows.length) {
      ctx.fillStyle = "#94A3B8";
      ctx.font = "12px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText("No quantitative series data available yet.", w / 2, h / 2);
      return;
    }

    if (layout === "STACKED_H") {
      // Horizontal stacked bars
      const padL = 135;
      const padR = 32;
      const padT = 18;
      const padB = 24;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;

      const maxRowTotal = Math.max(
        1,
        ...rows.map((r) => series.reduce((sum, s) => sum + Number(r.values[s.key] || 0), 0))
      );

      const rowStep = plotH / rows.length;
      const barH = Math.max(10, Math.min(24, rowStep * 0.62));

      rows.forEach((row, idx) => {
        const y = padT + idx * rowStep + (rowStep - barH) / 2;

        // Label
        ctx.fillStyle = "#E2E8F0";
        ctx.font = "bold 11px 'JetBrains Mono', monospace";
        ctx.textAlign = "right";
        ctx.fillText(String(row.label).slice(0, 16), padL - 10, y + barH * 0.72);

        // Track
        ctx.fillStyle = "rgba(255,255,255,0.04)";
        ctx.fillRect(padL, y, plotW, barH);

        let curX = padL;
        series.forEach((s) => {
          const val = Number(row.values[s.key] || 0);
          if (val <= 0) return;
          const segW = Math.max(2, (val / maxRowTotal) * plotW);
          ctx.fillStyle = s.color;
          ctx.fillRect(curX, y, segW, barH);
          curX += segW;
        });
      });
      return;
    }

    // Vertical Stacked Columns or Grouped Multi-Bars
    const padL = 44;
    const padR = 18;
    const padT = 20;
    const padB = 54;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const maxVal =
      layout === "GROUPED"
        ? Math.max(
            1,
            ...rows.flatMap((r) => series.map((s) => Number(r.values[s.key] || 0)))
          )
        : Math.max(
            1,
            ...rows.map((r) => series.reduce((sum, s) => sum + Number(r.values[s.key] || 0), 0))
          );

    // Grid lines
    ctx.strokeStyle = "rgba(148, 163, 184, 0.14)";
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const gy = padT + (plotH * g) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, gy);
      ctx.lineTo(w - padR, gy);
      ctx.stroke();

      const labelVal = ((4 - g) / 4) * maxVal;
      ctx.fillStyle = "#64748B";
      ctx.font = "10px 'JetBrains Mono', monospace";
      ctx.textAlign = "right";
      ctx.fillText(
        `${labelVal >= 10 ? Math.round(labelVal) : labelVal.toFixed(1)}${dataset.unit || ""}`,
        padL - 6,
        gy + 3
      );
    }

    const groupStep = plotW / rows.length;

    rows.forEach((row, idx) => {
      const groupX = padL + idx * groupStep;

      if (layout === "GROUPED") {
        const innerPad = Math.max(4, groupStep * 0.14);
        const availW = Math.max(8, groupStep - innerPad * 2);
        const subBarW = Math.max(3, availW / series.length - 1);

        series.forEach((s, sIdx) => {
          const val = Number(row.values[s.key] || 0);
          if (val <= 0) return;
          const bh = Math.max(2, (val / maxVal) * plotH);
          const bx = groupX + innerPad + sIdx * (subBarW + 1);
          const by = padT + plotH - bh;
          ctx.fillStyle = s.color;
          ctx.fillRect(bx, by, subBarW, bh);
        });
      } else {
        // STACKED_V
        const barW = Math.max(12, Math.min(44, groupStep * 0.56));
        const bx = groupX + (groupStep - barW) / 2;
        let curBottom = padT + plotH;

        series.forEach((s) => {
          const val = Number(row.values[s.key] || 0);
          if (val <= 0) return;
          const bh = Math.max(2, (val / maxVal) * plotH);
          curBottom -= bh;
          ctx.fillStyle = s.color;
          ctx.fillRect(bx, curBottom, barW, bh);
        });
      }

      // X-axis label
      ctx.save();
      ctx.translate(groupX + groupStep / 2, padT + plotH + 14);
      ctx.rotate(-0.22);
      ctx.fillStyle = "#CBD5E1";
      ctx.font = "bold 10px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText(String(row.label).slice(0, 14), 0, 0);
      ctx.restore();
    });
  }

  function renderBiDashboard() {
    const bi = state.biAnalytics;
    if (!bi) return;

    const kpis = bi.kpis || {};
    if (el("biLastGeneratedBadge") && bi.generatedAt) {
      el("biLastGeneratedBadge").textContent = `Updated ${new Date(bi.generatedAt).toLocaleTimeString("en-GB")}`;
    }

    if (el("biKpiTotalUsers")) el("biKpiTotalUsers").textContent = `${kpis.totalUsers ?? 0} Users`;
    if (el("biKpiTotalUsersSub")) {
      el("biKpiTotalUsersSub").textContent = `${kpis.totalPortfolios ?? 0} Portfolios · ${kpis.uniqueSymbolsCount ?? 0} Symbols`;
    }

    if (el("biKpiHoldingsWatchlist")) {
      el("biKpiHoldingsWatchlist").textContent = `${kpis.coreHoldingsCount ?? 0} / ${kpis.watchlistOnlyCount ?? 0}`;
    }
    if (el("biKpiHoldingsWatchlistSub")) {
      el("biKpiHoldingsWatchlistSub").textContent = `Core Holdings vs Watchlist (${kpis.totalPositions ?? 0} total)`;
    }

    if (el("biKpiMemoCoverage")) {
      el("biKpiMemoCoverage").textContent = `${kpis.memoCoveragePct ?? 0}%`;
    }
    if (el("biKpiMemoCoverageSub")) {
      el("biKpiMemoCoverageSub").textContent = `${kpis.activeMemoCount ?? 0} Memos · ${kpis.hermesDraftsApproved ?? 0} Approved Drafts`;
    }

    if (el("biKpiHermesPosts")) {
      el("biKpiHermesPosts").textContent = `${kpis.activeResearchPosts ?? 0} Active`;
    }
    if (el("biKpiHermesPostsSub")) {
      el("biKpiHermesPostsSub").textContent = `${kpis.archivedResearchPosts ?? 0} Archived · ${kpis.uniqueTagsCount ?? 0} #Tags`;
    }

    if (el("biKpiAvgUpsideR2")) {
      el("biKpiAvgUpsideR2").textContent = `+${Number(kpis.avgUpsideToR2Pct || 0).toFixed(1)}%`;
    }
    if (el("biKpiAvgUpsideR2Sub")) {
      el("biKpiAvgUpsideR2Sub").textContent = `Avg S1 Buffer: -${Number(kpis.avgDownsideToS1Pct || 0).toFixed(1)}%`;
    }

    if (el("biKpiRiskReward")) {
      el("biKpiRiskReward").textContent = `${Number(kpis.avgRiskRewardRatio || 1.5).toFixed(2)}x`;
    }
    if (el("biKpiRiskRewardSub")) {
      el("biKpiRiskRewardSub").textContent = `${kpis.pinnedResearchPosts ?? 0} Pinned · Auto-TTL ${bi.autoArchivePolicy?.autoArchiveDays ?? 21}d`;
    }

    // Highlight active perspective and layout buttons
    document.querySelectorAll("#biStackPerspectiveGroup [data-bi-stack-mode]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-bi-stack-mode") === state.biStackMode);
    });
    document.querySelectorAll("#biChartLayoutGroup [data-bi-chart-layout]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-bi-chart-layout") === state.biChartLayout);
    });

    const dataset = getActiveBiStackDataset(bi);
    if (el("biActiveStackTitle")) {
      el("biActiveStackTitle").textContent = dataset.title;
    }

    if (el("biStackedBarLegend")) {
      el("biStackedBarLegend").innerHTML = dataset.series
        .map(
          (s) => `
          <span class="inline-flex items-center gap-1.5 text-slate-300">
            <span class="w-2.5 h-2.5 rounded-sm" style="background:${escapeHtml(s.color)}"></span>
            <span>${escapeHtml(s.label)}</span>
          </span>
        `
        )
        .join("");
    }

    drawBiMultiBarCanvas(dataset);

    const tableSummary = el("biStackedBarTableSummary");
    if (tableSummary) {
      tableSummary.innerHTML = dataset.rows
        .map((row) => {
          const total = dataset.series.reduce((sum, s) => sum + Number(row.values[s.key] || 0), 0);
          return `
            <div class="p-2.5 rounded-xl bg-void/75 border border-white/[0.06] space-y-1.5">
              <div class="flex items-center justify-between gap-2 text-xs">
                <span class="font-mono font-bold text-white">${escapeHtml(row.label)}</span>
                <span class="font-mono text-[10px] text-cyan-300">${escapeHtml(row.sub || "")}</span>
              </div>
              <div class="h-2 rounded-full bg-white/[0.05] overflow-hidden flex">
                ${dataset.series
                  .map((s) => {
                    const val = Number(row.values[s.key] || 0);
                    if (val <= 0 || total <= 0) return "";
                    const wPct = Math.max(4, Math.round((val / total) * 100));
                    return `<div style="width:${wPct}%;background:${escapeHtml(s.color)}" title="${escapeHtml(s.label)}: ${val.toFixed ? val.toFixed(1) : val}${dataset.unit}"></div>`;
                  })
                  .join("")}
              </div>
              <div class="flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
                ${dataset.series
                  .map((s) => {
                    const val = Number(row.values[s.key] || 0);
                    if (val <= 0) return "";
                    return `<span><strong style="color:${escapeHtml(s.color)}">${escapeHtml(s.label.split(" ")[0])}:</strong> ${Number.isInteger(val) ? val : val.toFixed(1)}${dataset.unit}</span>`;
                  })
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
          `;
        })
        .join("");
    }

    // Render 3 Donut / Pie Charts
    const pies = bi.pieCharts || {};
    renderDonutWithLegend("biPieUsersCanvas", "biPieUsersLegend", "biPieUsersCenterValue", pies.userLicensePie || []);
    renderDonutWithLegend("biPieTopicsCanvas", "biPieTopicsLegend", "biPieTopicsCenterValue", pies.topicSharePie || []);
    renderDonutWithLegend("biPieSrZonesCanvas", "biPieSrZonesLegend", "biPieSrZonesCenterValue", pies.srPositioningPie || []);
  }

  function getFilteredCmsPosts() {
    const feed = state.researchFeed || {};
    const allPosts = Array.isArray(feed.allPosts) ? feed.allPosts : Array.isArray(feed.posts) ? feed.posts : [];
    const statusFilter = state.cmsStatusFilter || "ALL";
    const tagFilter = state.cmsTagFilter || "ALL";
    const q = (state.cmsSearchQuery || "").trim().toLowerCase();

    return allPosts.filter((p) => {
      if (statusFilter === "ACTIVE" && p.status !== "ACTIVE" && p.status !== "PUBLISHED") return false;
      if (statusFilter === "ARCHIVED" && p.status !== "ARCHIVED") return false;
      if (tagFilter !== "ALL") {
        const hasTag = (p.tags || []).some((t) => String(t).toLowerCase() === tagFilter.toLowerCase());
        if (!hasTag) return false;
      }
      if (!q) return true;
      const hay = `${p.id} ${p.symbol} ${p.name} ${p.title} ${p.summary} ${p.signalMemo} ${(p.tags || []).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function renderHermesCmsSection() {
    const feed = state.researchFeed || {};
    const allPosts = Array.isArray(feed.allPosts) ? feed.allPosts : Array.isArray(feed.posts) ? feed.posts : [];
    const policy = feed.policy || { autoArchiveEnabled: true, autoArchiveDays: 21 };
    const listContainer = el("cmsPostsListContainer");
    if (!listContainer) return;

    const activeCount = allPosts.filter((p) => p.status === "ACTIVE" || p.status === "PUBLISHED").length;
    const archivedCount = allPosts.filter((p) => p.status === "ARCHIVED").length;
    if (el("cmsTotalCountBadge")) {
      el("cmsTotalCountBadge").textContent = `${activeCount} Active · ${archivedCount} Archived/Hidden`;
    }

    if (el("cmsAutoArchiveEnabledToggle")) {
      el("cmsAutoArchiveEnabledToggle").checked = policy.autoArchiveEnabled !== false;
    }
    if (el("cmsAutoArchiveDaysInput")) {
      el("cmsAutoArchiveDaysInput").value = String(policy.autoArchiveDays || 21);
    }

    // Populate #Tag dropdown
    const tagSelect = el("cmsTagFilterSelect");
    if (tagSelect) {
      const tags = Array.isArray(feed.tagCloud) ? feed.tagCloud.map((t) => t.tag) : [];
      const currentVal = state.cmsTagFilter || "ALL";
      tagSelect.innerHTML = [
        `<option value="ALL">All #Tags (${tags.length})</option>`,
        ...tags.map(
          (t) => `<option value="${escapeHtml(t)}" ${t === currentVal ? "selected" : ""}>${escapeHtml(t)}</option>`
        )
      ].join("");
    }

    // Status filter buttons
    document.querySelectorAll("#cmsStatusFilterGroup [data-cms-status]").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-cms-status") === state.cmsStatusFilter);
    });

    // Filter posts
    const filtered = getFilteredCmsPosts();

    // Clean up selectedPostIds
    const validIds = new Set(allPosts.map((p) => p.id));
    for (const id of Array.from(state.selectedPostIds)) {
      if (!validIds.has(id)) state.selectedPostIds.delete(id);
    }

    const selCount = state.selectedPostIds.size;
    if (el("cmsSelectedPostsCountBadge")) {
      el("cmsSelectedPostsCountBadge").textContent = `${selCount} Selected`;
    }
    if (el("cmsSelectAllPostsCheck")) {
      el("cmsSelectAllPostsCheck").checked = filtered.length > 0 && filtered.every((p) => state.selectedPostIds.has(p.id));
    }
    if (el("cmsBulkArchiveBtn")) el("cmsBulkArchiveBtn").disabled = selCount === 0;
    if (el("cmsBulkRestoreBtn")) el("cmsBulkRestoreBtn").disabled = selCount === 0;
    if (el("cmsBulkDeleteBtn")) el("cmsBulkDeleteBtn").disabled = selCount === 0;

    if (!filtered.length) {
      listContainer.innerHTML = `
        <div class="rounded-2xl bg-void/60 p-6 text-center text-xs text-slate-400">
          No Hermes research cards match the current filter.
        </div>
      `;
      return;
    }

    listContainer.innerHTML = filtered
      .map((post) => {
        const isSelected = state.selectedPostIds.has(post.id);
        const isArchived = post.status === "ARCHIVED";
        const sr = post.supportResistance || { support: [], resistance: [] };
        const s1 = sr.support?.[0]?.price || 0;
        const s2 = sr.support?.[1]?.price || 0;
        const s3 = sr.support?.[2]?.price || 0;
        const r1 = sr.resistance?.[0]?.price || 0;
        const r2 = sr.resistance?.[1]?.price || 0;
        const r3 = sr.resistance?.[2]?.price || 0;

        const statusBadge = isArchived
          ? `<span class="font-mono text-[10px] px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40 font-bold">ARCHIVED / HIDDEN (${escapeHtml(post.archivedReason || "HIDDEN")})</span>`
          : `<span class="font-mono text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40 font-bold">ACTIVE ON FRONTPAGE</span>`;

        return `
          <div class="rounded-2xl bg-void/80 ring-1 ${isSelected ? "ring-cyan/50 bg-cyan/[0.04]" : isArchived ? "ring-amber/25 opacity-80" : "ring-white/[0.08]"} p-4 space-y-2.5 transition">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <input
                  type="checkbox"
                  data-select-post-id="${escapeHtml(post.id)}"
                  ${isSelected ? "checked" : ""}
                  class="cms-post-select-checkbox h-4 w-4 rounded border-white/25 bg-void text-cyan cursor-pointer"
                />
                <span class="font-mono text-sm font-extrabold text-white px-2.5 py-0.5 rounded-lg bg-white/[0.06]">${escapeHtml(post.symbol)}</span>
                ${statusBadge}
                ${
                  post.pinned
                    ? `<span class="font-mono text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">★ PINNED</span>`
                    : ""
                }
                <span class="font-mono text-[10px] px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300">${escapeHtml(post.bias || "NEUTRAL")} · ${Number(post.confidence || 80)}%</span>
                <span class="font-mono text-[11px] text-slate-400">By ${escapeHtml(post.author || "Hermes Agent")}</span>
              </div>
              <div class="text-[11px] font-mono text-slate-400">
                ID: <code class="text-slate-300">${escapeHtml(post.id)}</code> · Updated ${new Date(post.updatedAt || post.createdAt).toLocaleString("en-GB")}
              </div>
            </div>

            <div>
              <h4 class="text-sm font-bold text-white">${escapeHtml(post.title)}</h4>
              <p class="text-xs text-slate-300 mt-0.5">${escapeHtml(post.summary || post.signalMemo || "")}</p>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] font-mono bg-slate-950/80 rounded-xl p-2.5 border border-white/[0.05]">
              <div class="text-emerald-300">
                <strong>Support (แนวรับ 1-2-3):</strong> S1=${s1} (สั้น) · S2=${s2} (กลาง) · S3=${s3} (ยาว)
              </div>
              <div class="text-amber-300">
                <strong>Resistance (แนวต้าน 1-2-3):</strong> R1=${r1} (สั้น) · R2=${r2} (กลาง) · R3=${r3} (ยาว)
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div class="flex flex-wrap items-center gap-1">
                ${(post.tags || [])
                  .map(
                    (t) =>
                      `<span class="text-[10px] font-mono px-2 py-0.5 rounded bg-white/[0.05] text-cyan-300 border border-white/10">${escapeHtml(t)}</span>`
                  )
                  .join("")}
              </div>

              <div class="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  data-cms-post-id="${escapeHtml(post.id)}"
                  data-cms-action="EDIT"
                  class="cms-post-action-btn rounded-lg bg-cyan/20 hover:bg-cyan/30 ring-1 ring-cyan/40 px-2.5 py-1 text-[11px] font-mono font-semibold text-cyan"
                >
                  ✎ Edit S/R &amp; Post
                </button>
                <button
                  type="button"
                  data-cms-post-id="${escapeHtml(post.id)}"
                  data-cms-action="TOGGLE_PIN"
                  class="cms-post-action-btn rounded-lg bg-white/[0.06] hover:bg-white/[0.12] ring-1 ring-white/15 px-2.5 py-1 text-[11px] font-mono text-amber-300"
                >
                  ${post.pinned ? "★ Unpin" : "☆ Pin"}
                </button>
                ${
                  isArchived
                    ? `<button
                        type="button"
                        data-cms-post-id="${escapeHtml(post.id)}"
                        data-cms-action="RESTORE"
                        class="cms-post-action-btn rounded-lg bg-emerald/20 hover:bg-emerald/30 ring-1 ring-emerald/40 px-2.5 py-1 text-[11px] font-mono font-semibold text-emerald"
                      >
                        ↺ Restore (แสดงผล)
                      </button>`
                    : `<button
                        type="button"
                        data-cms-post-id="${escapeHtml(post.id)}"
                        data-cms-action="ARCHIVE"
                        class="cms-post-action-btn rounded-lg bg-amber/20 hover:bg-amber/30 ring-1 ring-amber/40 px-2.5 py-1 text-[11px] font-mono font-semibold text-amber"
                      >
                        📥 Archive / Hide (ซ่อน)
                      </button>`
                }
                <button
                  type="button"
                  data-cms-post-id="${escapeHtml(post.id)}"
                  data-cms-action="DELETE"
                  class="cms-post-action-btn rounded-lg bg-crimson/20 hover:bg-crimson/30 ring-1 ring-crimson/40 px-2.5 py-1 text-[11px] font-mono font-semibold text-crimson"
                >
                  🗑 Delete
                </button>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    listContainer.querySelectorAll(".cms-post-select-checkbox").forEach((chk) => {
      chk.addEventListener("change", () => {
        const pid = chk.getAttribute("data-select-post-id");
        if (!pid) return;
        if (chk.checked) state.selectedPostIds.add(pid);
        else state.selectedPostIds.delete(pid);
        renderHermesCmsSection();
      });
    });

    listContainer.querySelectorAll(".cms-post-action-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const postId = btn.getAttribute("data-cms-post-id");
        const action = btn.getAttribute("data-cms-action");
        if (!postId || !action) return;

        if (action === "EDIT") {
          const found = allPosts.find((p) => p.id === postId);
          if (found) populateCmsFormFromPost(found);
          return;
        }

        await executeCmsMutation({ action, postId });
      });
    });
  }

  function populateCmsFormFromPost(post) {
    if (!post) return;
    if (el("cmsFormHeading")) {
      el("cmsFormHeading").textContent = `Editing Card: ${post.symbol} (${post.id})`;
    }
    if (el("cmsPostIdInput")) el("cmsPostIdInput").value = post.id || "";
    if (el("cmsSymbolInput")) el("cmsSymbolInput").value = post.symbol || "";
    if (el("cmsNameInput")) el("cmsNameInput").value = post.name || "";
    if (el("cmsCurrencySelect")) el("cmsCurrencySelect").value = post.currency || "USD";
    if (el("cmsRefPriceInput")) el("cmsRefPriceInput").value = post.livePrice || post.referencePrice || "";
    if (el("cmsBiasSelect")) el("cmsBiasSelect").value = post.bias || "BULLISH";
    if (el("cmsConfidenceInput")) el("cmsConfidenceInput").value = post.confidence || 84;
    if (el("cmsAuthorInput")) el("cmsAuthorInput").value = post.author || "Hermes Agent";
    if (el("cmsTitleInput")) el("cmsTitleInput").value = post.title || "";
    if (el("cmsTagsInput")) el("cmsTagsInput").value = (post.tags || []).join(", ");
    if (el("cmsPinnedCheck")) el("cmsPinnedCheck").checked = Boolean(post.pinned);
    if (el("cmsSignalMemoInput")) el("cmsSignalMemoInput").value = post.signalMemo || "";
    if (el("cmsSummaryInput")) el("cmsSummaryInput").value = post.summary || "";

    const s = post.supportResistance?.support || [];
    const r = post.supportResistance?.resistance || [];
    if (el("cmsS1PriceInput")) el("cmsS1PriceInput").value = s[0]?.price ?? "";
    if (el("cmsS1NoteInput")) el("cmsS1NoteInput").value = s[0]?.note ?? "";
    if (el("cmsS2PriceInput")) el("cmsS2PriceInput").value = s[1]?.price ?? "";
    if (el("cmsS2NoteInput")) el("cmsS2NoteInput").value = s[1]?.note ?? "";
    if (el("cmsS3PriceInput")) el("cmsS3PriceInput").value = s[2]?.price ?? "";
    if (el("cmsS3NoteInput")) el("cmsS3NoteInput").value = s[2]?.note ?? "";

    if (el("cmsR1PriceInput")) el("cmsR1PriceInput").value = r[0]?.price ?? "";
    if (el("cmsR1NoteInput")) el("cmsR1NoteInput").value = r[0]?.note ?? "";
    if (el("cmsR2PriceInput")) el("cmsR2PriceInput").value = r[1]?.price ?? "";
    if (el("cmsR2NoteInput")) el("cmsR2NoteInput").value = r[1]?.note ?? "";
    if (el("cmsR3PriceInput")) el("cmsR3PriceInput").value = r[2]?.price ?? "";
    if (el("cmsR3NoteInput")) el("cmsR3NoteInput").value = r[2]?.note ?? "";

    el("cmsPostFormCard")?.scrollIntoView({ behavior: "smooth", block: "center" });
    showToast(`Loaded ${post.symbol} (${post.id}) into editor`);
  }

  function resetCmsForm() {
    if (el("cmsFormHeading")) {
      el("cmsFormHeading").textContent = "Create or Update Shared Support/Resistance 1–2–3 & Hermes Tagged Card";
    }
    if (el("cmsPostIdInput")) el("cmsPostIdInput").value = "";
    el("cmsPostForm")?.reset();
  }

  async function executeCmsMutation(payload, customToast = "") {
    const res = await fetch("/api/admin/research-posts", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      showToast(data.error || "CMS operation failed");
      return false;
    }
    if (data.researchFeed) state.researchFeed = data.researchFeed;
    if (data.biAnalytics) state.biAnalytics = data.biAnalytics;
    if (data.auditLogs) state.auditLogs = data.auditLogs;
    renderHermesControlSection();
    renderBiDashboard();
    renderHermesCmsSection();
    renderDashboard();
    showToast(customToast || `CMS action ${payload.action} completed`);
    return true;
  }

  function renderDashboard() {
    const s = state.summary || {};
    el("kpiTotalDevices").textContent = String(s.totalDevices ?? 0);
    el("kpiActivePaid").textContent = String(s.activePaid ?? 0);
    el("kpiActiveTrial").textContent = String(s.activeTrial ?? 0);
    el("kpiExpiredTrial").textContent = String(s.expiredTrial ?? 0);
    if (el("kpiPendingRequests")) {
      el("kpiPendingRequests").textContent = String(s.pendingRequests ?? 0);
    }

    renderHermesControlSection();
    renderBiDashboard();
    renderHermesCmsSection();

    const pwdStatusEl = el("pwdLastUpdatedText");
    if (pwdStatusEl) {
      const updatedStr = state.passwordUpdatedAt
        ? new Date(state.passwordUpdatedAt).toLocaleString("en-GB")
        : "-";
      pwdStatusEl.innerHTML = state.isDefaultPassword
        ? `Password Status: <span class="text-amber">Default Password</span> · Last updated ${escapeHtml(updatedStr)}`
        : `Password Status: <span class="text-emerald">Custom Password Configured</span> · Last updated ${escapeHtml(updatedStr)}`;
    }

    renderCustomerRequests();
    renderEmailLogs();

    const validIds = new Set((state.devices || []).map((d) => d.deviceId));
    for (const selectedId of Array.from(state.selectedDeviceIds)) {
      if (!validIds.has(selectedId)) {
        state.selectedDeviceIds.delete(selectedId);
      }
    }

    const updateSelectionToolbarUI = () => {
      const totalCount = (state.devices || []).length;
      const selectedCount = state.selectedDeviceIds.size;
      const selectAllCheck = el("selectAllDevicesCheck");
      const countBadge = el("selectedDevicesCountBadge");
      const bulkRemoveBtn = el("bulkRemoveKeysBtn");
      const bulkDeleteBtn = el("bulkDeleteDevicesBtn");

      if (selectAllCheck) {
        selectAllCheck.disabled = totalCount === 0;
        selectAllCheck.checked = totalCount > 0 && selectedCount === totalCount;
        selectAllCheck.indeterminate = selectedCount > 0 && selectedCount < totalCount;
      }
      if (countBadge) {
        countBadge.textContent = `${selectedCount} Selected`;
        countBadge.className =
          selectedCount > 0
            ? "font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-cyan/20 text-cyan ring-1 ring-cyan/40 font-semibold"
            : "font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-white/[0.06] text-slate-300";
      }
      if (bulkRemoveBtn) bulkRemoveBtn.disabled = selectedCount === 0;
      if (bulkDeleteBtn) bulkDeleteBtn.disabled = selectedCount === 0;
    };

    updateSelectionToolbarUI();

    const listEl = el("adminDevicesList");
    if (!state.devices.length) {
      listEl.innerHTML = `<div class="rounded-2xl bg-void/60 p-6 text-center text-xs text-slate-400">No registered devices yet.</div>`;
    } else {
      listEl.innerHTML = state.devices
        .map((d) => {
          const isSelected = state.selectedDeviceIds.has(d.deviceId);
          const hasKey = Boolean(d.issuedKey || d.activatedKey);
          const keyDisplay = hasKey
            ? `<code class="font-mono text-cyan font-semibold">${escapeHtml(d.activatedKey || d.issuedKey)}</code>`
            : `<span class="font-mono text-amber font-semibold">No Key (Revoked)</span>`;

          let badgeClass = "bg-emerald/15 text-emerald ring-1 ring-emerald/30";
          let badgeLabel = `TRIAL · ${d.remainingDays}d left`;
          if (d.status === "ACTIVE") {
            badgeClass = "bg-cyan/20 text-cyan ring-1 ring-cyan/40";
            badgeLabel = "PRO ACTIVATED";
          } else if (d.status === "EXPIRED") {
            badgeClass = "bg-crimson/20 text-crimson ring-1 ring-crimson/40";
            badgeLabel = "TRIAL 14D EXPIRED";
          }

          return `
            <div class="rounded-2xl bg-void/75 ring-1 ${isSelected ? "ring-cyan/50 bg-cyan/[0.04]" : "ring-white/[0.08]"} p-4 sm:p-5 space-y-3 transition-all">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-2.5">
                  <label class="inline-flex items-center cursor-pointer select-none" title="Select this device to manage or revoke its key">
                    <input
                      type="checkbox"
                      data-select-device-id="${escapeHtml(d.deviceId)}"
                      ${isSelected ? "checked" : ""}
                      class="device-select-checkbox h-4 w-4 rounded border-white/25 bg-void text-cyan focus:ring-cyan cursor-pointer"
                    />
                  </label>
                  <span class="font-mono text-sm sm:text-base font-extrabold text-alabaster">${escapeHtml(d.deviceId)}</span>
                  <span class="font-mono text-[11px] px-2.5 py-0.5 rounded-full font-semibold ${badgeClass}">${badgeLabel}</span>
                  <span class="font-mono text-[11px] px-2 py-0.5 rounded-lg bg-white/[0.05] text-slate-300">Sync: ${escapeHtml(d.syncKey)}</span>
                </div>
                <div class="text-[11px] font-mono text-slate-400">
                  Trial Expires: ${new Date(d.trialExpiresAt).toLocaleDateString("en-GB")}
                </div>
              </div>

              <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                <div>
                  <span>Device Label: <strong class="text-slate-200">${escapeHtml(d.label)}</strong></span>
                  <span class="mx-2 text-slate-600">|</span>
                  <span>Activation Key: ${keyDisplay}</span>
                </div>
                ${
                  hasKey
                    ? `<button
                        type="button"
                        data-copy-key="${escapeHtml(d.activatedKey || d.issuedKey)}"
                        class="copy-device-key-btn rounded-lg bg-white/[0.06] hover:bg-white/[0.12] px-2.5 py-1 font-mono text-[11px] text-cyan flex items-center gap-1"
                      >
                        <i class="ph-light ph-copy"></i>
                        <span>Copy Key</span>
                      </button>`
                    : ""
                }
              </div>

              <div class="pt-2 border-t border-white/[0.06] flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-dev-action="ACTIVATE"
                  data-dev-id="${escapeHtml(d.deviceId)}"
                  class="dev-action-btn rounded-full bg-cyan/20 hover:bg-cyan/30 ring-1 ring-cyan/40 px-3 py-1 text-[11px] font-mono font-semibold text-cyan"
                >
                  ✓ Activate Pro
                </button>
                <button
                  type="button"
                  data-dev-action="EXTEND_TRIAL"
                  data-dev-id="${escapeHtml(d.deviceId)}"
                  class="dev-action-btn rounded-full bg-emerald/15 hover:bg-emerald/25 ring-1 ring-emerald/30 px-3 py-1 text-[11px] font-mono text-emerald"
                >
                  + Extend Trial +14d
                </button>
                <button
                  type="button"
                  data-dev-action="RESET_TRIAL"
                  data-dev-id="${escapeHtml(d.deviceId)}"
                  class="dev-action-btn rounded-full bg-white/[0.06] hover:bg-white/[0.12] ring-1 ring-white/10 px-3 py-1 text-[11px] font-mono text-slate-300"
                >
                  Reset 14d Trial
                </button>
                <button
                  type="button"
                  data-dev-action="REMOVE_KEY"
                  data-dev-id="${escapeHtml(d.deviceId)}"
                  class="dev-action-btn rounded-full bg-amber/15 hover:bg-amber/25 ring-1 ring-amber/35 px-3 py-1 text-[11px] font-mono font-semibold text-amber"
                  title="Revoke only the Activation Key from this device"
                >
                  🔑 Remove Key
                </button>
                <button
                  type="button"
                  data-dev-action="DELETE"
                  data-dev-id="${escapeHtml(d.deviceId)}"
                  class="dev-action-btn rounded-full bg-crimson/20 hover:bg-crimson/30 ring-1 ring-crimson/40 px-3 py-1 text-[11px] font-mono font-semibold text-crimson"
                  title="Delete this device and its key from the system"
                >
                  🗑️ Delete Device
                </button>
                <button
                  type="button"
                  data-dev-action="EXPIRE_TRIAL"
                  data-dev-id="${escapeHtml(d.deviceId)}"
                  class="dev-action-btn rounded-full bg-crimson/15 hover:bg-crimson/25 ring-1 ring-crimson/30 px-3 py-1 text-[11px] font-mono text-crimson ml-auto"
                  title="Simulate 14-day trial expiration to test the lock screen (saharat.bun@icloud.com)"
                >
                  Simulate 14d Expired (Lock)
                </button>
              </div>
            </div>
          `;
        })
        .join("");

      listEl.querySelectorAll(".device-select-checkbox").forEach((chk) => {
        chk.addEventListener("change", () => {
          const did = chk.getAttribute("data-select-device-id");
          if (!did) return;
          if (chk.checked) {
            state.selectedDeviceIds.add(did);
          } else {
            state.selectedDeviceIds.delete(did);
          }
          renderDashboard();
        });
      });

      listEl.querySelectorAll(".copy-device-key-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const k = btn.getAttribute("data-copy-key");
          await navigator.clipboard.writeText(k);
          showToast(`Copied key ${k}`);
        });
      });

      listEl.querySelectorAll(".dev-action-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const deviceId = btn.getAttribute("data-dev-id");
          const action = btn.getAttribute("data-dev-action");
          const res = await fetch("/api/admin/devices/update", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ deviceId, action, days: 14 })
          });
          const data = await res.json();
          if (res.ok && data.ok) {
            if (action === "DELETE") {
              state.selectedDeviceIds.delete(deviceId);
            }
            state.summary = data.summary;
            state.devices = data.devices;
            state.customerRequests = data.customerRequests || state.customerRequests;
            state.auditLogs = data.auditLogs;
            renderDashboard();
            const actionLabel =
              action === "REMOVE_KEY"
                ? `Removed activation key from device ${deviceId}`
                : action === "DELETE"
                ? `Deleted device ${deviceId} from system`
                : `Updated device ${deviceId} (${action}) successfully`;
            showToast(actionLabel);
          } else {
            showToast(data.error || "Unable to update device status.");
          }
        });
      });
    }

    const auditBody = el("adminAuditTableBody");
    auditBody.innerHTML = (state.auditLogs || [])
      .map(
        (log) => `
        <tr>
          <td class="py-2 pr-4 text-slate-400 whitespace-nowrap">${new Date(log.timestamp).toLocaleString("en-GB")}</td>
          <td class="py-2 pr-4 text-emerald">${escapeHtml(log.actor)}</td>
          <td class="py-2 pr-4 text-cyan font-semibold">${escapeHtml(log.action)}</td>
          <td class="py-2 pr-4 text-alabaster">${escapeHtml(log.deviceId)}</td>
          <td class="py-2 text-slate-300 font-sans text-xs">${escapeHtml(log.detail)}</td>
        </tr>
      `
      )
      .join("");
  }

  function togglePasswordVisibility(inputEl, buttonEl) {
    if (!inputEl) return;
    const isPwd = inputEl.type === "password";
    inputEl.type = isPwd ? "text" : "password";
    const icon = buttonEl ? buttonEl.querySelector("i") : null;
    if (icon) {
      icon.className = isPwd ? "ph-light ph-eye-slash text-base" : "ph-light ph-eye text-base";
    }
  }

  function showChangePwdFeedback(message, isSuccess) {
    const box = el("changePwdFeedbackBox");
    if (!box) return;
    box.textContent = message;
    box.className = isSuccess
      ? "rounded-xl bg-emerald/15 ring-1 ring-emerald/35 px-3.5 py-2.5 text-xs text-emerald font-medium"
      : "rounded-xl bg-crimson/15 ring-1 ring-crimson/35 px-3.5 py-2.5 text-xs text-crimson font-medium";
  }

  function showEmailServiceFeedback(message, isSuccess) {
    const box = el("emailServiceFeedbackBox");
    if (!box) return;
    box.textContent = message;
    box.className = isSuccess
      ? "rounded-xl bg-emerald/15 ring-1 ring-emerald/35 px-3.5 py-2.5 text-xs text-emerald font-medium"
      : "rounded-xl bg-crimson/15 ring-1 ring-crimson/35 px-3.5 py-2.5 text-xs text-crimson font-medium";
  }

  function bindEvents() {
    // 1. Toggle eye button on Login Password field
    const toggleLoginBtn = el("toggleLoginPwdBtn");
    if (toggleLoginBtn) {
      toggleLoginBtn.addEventListener("click", () => {
        togglePasswordVisibility(el("adminPasswordInput"), toggleLoginBtn);
      });
    }

    // 2. Toggle eye buttons on Change Password fields
    document.querySelectorAll(".pwd-eye-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.getAttribute("data-toggle-target");
        togglePasswordVisibility(el(targetId), btn);
      });
    });

    // 3. Admin Password Login Submit
    const loginForm = el("adminPasswordLoginForm");
    if (loginForm) {
      loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = el("adminEmailInput").value.trim();
        const password = el("adminPasswordInput").value.trim();
        const errBox = el("loginErrorBox");
        if (errBox) errBox.classList.add("hidden");

        const res = await fetch("/api/admin/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          const msg = data.error || "Invalid administrator password.";
          if (errBox) {
            errBox.textContent = msg;
            errBox.classList.remove("hidden");
          }
          showToast(msg);
          return;
        }

        el("adminPasswordInput").value = "";
        state.token = data.token;
        state.lastActivityAt = Date.now();
        state.sessionExpiresAt = Number(data.expiresAt) || Date.now() + DEFAULT_SESSION_TTL_MS;
        if (data.idleTimeoutSec) {
          state.idleTimeoutMs = Math.max(60 * 1000, Number(data.idleTimeoutSec) * 1000);
        }
        try {
          sessionStorage.setItem("venu2_admin_token", data.token);
          sessionStorage.setItem("venu2_admin_last_active", String(state.lastActivityAt));
          sessionStorage.setItem("venu2_admin_expires_at", String(state.sessionExpiresAt));
        } catch (_) {}
        await checkSessionAndLoad();
        showToast(`Welcome Administrator ${data.email} (Auto-expiring secure session active)`);
      });
    }

    // 3b. Activity listeners for Idle Auto-Logout reset
    ["mousemove", "mousedown", "keydown", "touchstart", "click", "scroll"].forEach((evtName) => {
      window.addEventListener(evtName, recordAdminActivity, { passive: true });
    });

    // 3c. Select All & Bulk Key Removal / Deletion Toolbar
    el("selectAllDevicesCheck")?.addEventListener("change", (e) => {
      const checked = Boolean(e.target.checked);
      if (checked) {
        (state.devices || []).forEach((d) => state.selectedDeviceIds.add(d.deviceId));
      } else {
        state.selectedDeviceIds.clear();
      }
      renderDashboard();
    });

    const executeBulkDeviceAction = async (action) => {
      const selectedIds = Array.from(state.selectedDeviceIds);
      if (!selectedIds.length) {
        showToast("Please select at least 1 device.");
        return;
      }
      const res = await fetch("/api/admin/devices/update", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          action,
          deviceIds: selectedIds
        })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showToast(data.error || "Unable to process selected devices.");
        return;
      }
      state.selectedDeviceIds.clear();
      state.summary = data.summary;
      state.devices = data.devices;
      state.customerRequests = data.customerRequests || state.customerRequests;
      state.auditLogs = data.auditLogs;
      renderDashboard();
      if (action === "REMOVE_KEY") {
        showToast(`Removed Activation Keys from ${selectedIds.length} selected device(s).`);
      } else if (action === "DELETE") {
        showToast(`Deleted ${selectedIds.length} selected device(s) and their keys.`);
      }
    };

    el("bulkRemoveKeysBtn")?.addEventListener("click", () => executeBulkDeviceAction("REMOVE_KEY"));
    el("bulkDeleteDevicesBtn")?.addEventListener("click", () => executeBulkDeviceAction("DELETE"));

    // 4. Scroll to Change Admin Password Panel & Email Settings Panel
    el("scrollToChangePwdBtn")?.addEventListener("click", () => {
      const card = el("changePasswordCard");
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => el("currentAdminPwdInput")?.focus(), 350);
      }
    });

    el("scrollToEmailSettingsBtn")?.addEventListener("click", () => {
      const card = el("emailServiceCard");
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });

    // 5. Change Admin Password Form Submit (Requires Current Password Verification)
    const changePwdForm = el("changeAdminPasswordForm");
    if (changePwdForm) {
      changePwdForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const currentPassword = el("currentAdminPwdInput").value.trim();
        const newPassword = el("newAdminPwdInput").value.trim();
        const confirmPassword = el("confirmAdminPwdInput").value.trim();

        if (!currentPassword) {
          showChangePwdFeedback("Please enter your current password to verify your identity.", false);
          return;
        }
        if (newPassword.length < 6) {
          showChangePwdFeedback("New password must be at least 6 characters long.", false);
          return;
        }
        if (newPassword !== confirmPassword) {
          showChangePwdFeedback("New password and confirmation do not match.", false);
          return;
        }

        const res = await fetch("/api/admin/auth/change-password", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            currentPassword,
            newPassword,
            confirmPassword
          })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          const errMsg = data.error || "Unable to change password.";
          showChangePwdFeedback(errMsg, false);
          showToast(errMsg);
          return;
        }

        el("currentAdminPwdInput").value = "";
        el("newAdminPwdInput").value = "";
        el("confirmAdminPwdInput").value = "";

        state.passwordUpdatedAt = data.passwordUpdatedAt || new Date().toISOString();
        state.isDefaultPassword = Boolean(data.isDefaultPassword);
        if (data.auditLogs) state.auditLogs = data.auditLogs;
        if (data.summary) state.summary = data.summary;
        if (data.devices) state.devices = data.devices;

        renderAuthView();
        renderDashboard();
        showChangePwdFeedback("✓ Current password verified and administrator password updated.", true);
        showToast("Administrator password updated successfully.");
      });
    }

    // 6. SMTP Configuration Save & Test Email Dispatch
    const smtpForm = el("smtpConfigForm");
    if (smtpForm) {
      smtpForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const payload = {
          recipientEmail: el("smtpRecipientEmailInput")?.value.trim() || "e24qdy2@gmail.com",
          fromEmail: el("smtpFromEmailInput")?.value.trim() || "saharat.bun@icloud.com",
          smtpHost: el("smtpHostInput")?.value.trim() || "smtp.gmail.com",
          smtpPort: Number(el("smtpPortInput")?.value || 465),
          smtpSecure: Boolean(el("smtpSecureCheck")?.checked),
          smtpUser: el("smtpUserInput")?.value.trim() || "",
          smtpPass: el("smtpPassInput")?.value || ""
        };
        const res = await fetch("/api/admin/email/config", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          showEmailServiceFeedback(data.error || "Unable to save SMTP configuration.", false);
          return;
        }
        state.smtpConfig = data.smtpConfig;
        populateSmtpForm(data.smtpConfig);
        showEmailServiceFeedback(data.message || "SMTP configuration saved successfully.", true);
        showToast("SMTP configuration saved.");
      });
    }

    el("testSendEmailBtn")?.addEventListener("click", async () => {
      const recipientEmail = el("smtpRecipientEmailInput")?.value.trim() || "e24qdy2@gmail.com";
      showEmailServiceFeedback(`Sending test notification email to ${recipientEmail}...`, true);
      const res = await fetch("/api/admin/email/test", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ recipientEmail })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showEmailServiceFeedback(data.error || "Test email delivery failed.", false);
        showToast("Test email failed.");
        return;
      }
      state.emailLogs = data.emailLogs || state.emailLogs;
      renderEmailLogs();
      const method = data.delivery?.deliveryMethod || "SENT";
      const detail = data.delivery?.detail || "";
      showEmailServiceFeedback(`✓ Test email sent to ${recipientEmail} (${method}: ${detail})`, true);
      showToast(`Test email sent to ${recipientEmail}`);
    });

    // 7. Sign Out
    el("adminLogoutBtn").addEventListener("click", async () => {
      await performAutoLogout("");
      showToast("Signed out of Admin Portal.");
    });

    // 8. Refresh Dashboard
    el("refreshAdminBtn").addEventListener("click", async () => {
      await Promise.all([fetchDevicesData(), fetchEmailConfig(), fetchBiAndResearchPosts()]);
      showToast("Refreshed BI analytics, Hermes CMS posts, devices, and request queue.");
    });

    // 8b. Top Workspace Navigation Pills, Hermes Remote Control Buttons & Quick Create Hermes Post Button
    document.querySelectorAll("[data-admin-nav]").forEach((navBtn) => {
      navBtn.addEventListener("click", () => {
        const targetId = navBtn.getAttribute("data-admin-nav");
        document.querySelectorAll("[data-admin-nav]").forEach((b) => b.classList.remove("is-active", "active"));
        navBtn.classList.add("is-active", "active");
        const targetEl = el(targetId);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });

    el("hermesAutoPollToggle")?.addEventListener("change", (e) => {
      state.hermesAutoPoll = Boolean(e.target.checked);
      if (state.hermesAutoPoll) {
        startHermesStatusPoller();
        showToast("Enabled periodic Hermes connection check (every 8s).");
      } else {
        stopHermesStatusPoller();
        showToast("Paused periodic Hermes connection check.");
      }
    });

    el("btnPollHermesNow")?.addEventListener("click", async () => {
      await fetchHermesNodeStatus(false);
    });

    document.querySelectorAll("[data-hermes-cmd]").forEach((cmdBtn) => {
      cmdBtn.addEventListener("click", async () => {
        const action = cmdBtn.getAttribute("data-hermes-cmd");
        if (action) {
          await sendHermesRemoteCommand(action);
        }
      });
    });

    el("openNewHermesPostBtn")?.addEventListener("click", () => {
      resetCmsForm();
      const cmsSection = el("section-admin-hermes-cms") || el("adminSectionHermesCms");
      if (cmsSection) {
        cmsSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      setTimeout(() => el("cmsSymbolInput")?.focus(), 250);
    });

    // 8c. BI Multi-Angle Perspective & Stacked/Grouped Layout Switchers
    el("biStackPerspectiveGroup")?.querySelectorAll("[data-bi-stack-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.getAttribute("data-bi-stack-mode") || "userPortfolio";
        state.biStackPerspective = mode;
        el("biStackPerspectiveGroup").querySelectorAll("[data-bi-stack-mode]").forEach((b) => {
          const active = b.getAttribute("data-bi-stack-mode") === mode;
          b.className = active
            ? "bi-perspective-btn is-active px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald/20 text-emerald ring-1 ring-emerald/35"
            : "bi-perspective-btn px-3 py-1.5 rounded-lg text-[11px] font-semibold text-slate-300 hover:text-alabaster";
        });
        renderBiDashboard();
      });
    });

    el("biChartLayoutGroup")?.querySelectorAll("[data-bi-chart-layout]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const layout = btn.getAttribute("data-bi-chart-layout") || "stacked";
        state.biChartLayout = layout;
        el("biChartLayoutGroup").querySelectorAll("[data-bi-chart-layout]").forEach((b) => {
          const active = b.getAttribute("data-bi-chart-layout") === layout;
          b.className = active
            ? "bi-layout-btn is-active px-2.5 py-1.5 rounded-lg text-[11px] font-mono font-semibold bg-cyan/20 text-cyan ring-1 ring-cyan/35"
            : "bi-layout-btn px-2.5 py-1.5 rounded-lg text-[11px] font-mono text-slate-300 hover:text-alabaster";
        });
        renderBiDashboard();
      });
    });

    window.addEventListener("resize", () => {
      if (state.authenticated && state.biAnalytics) {
        drawBiMultiBarCanvas(getActiveBiStackDataset(), state.biChartLayout);
      }
    });

    // 8d. Auto-Archive Policy Controls
    el("cmsSavePolicyBtn")?.addEventListener("click", async () => {
      const enabled = Boolean(
        (el("cmsAutoArchiveEnabledToggle") || el("cmsAutoArchiveEnabledCheck"))?.checked
      );
      const ttlDays = Math.max(
        1,
        Math.min(
          365,
          Number((el("cmsAutoArchiveDaysInput") || el("cmsAutoArchiveTtlDaysInput"))?.value) || 21
        )
      );
      await executeCmsMutation(
        {
          action: "UPDATE_POLICY",
          policy: {
            autoArchiveEnabled: enabled,
            autoArchiveDays: ttlDays
          }
        },
        `Updated Auto-Archive policy (Enabled: ${enabled ? "ON" : "OFF"}, TTL: ${ttlDays} days)`
      );
    });

    el("cmsRunAutoArchiveSweepBtn")?.addEventListener("click", async () => {
      const ttlDays = Math.max(
        1,
        Math.min(
          365,
          Number((el("cmsAutoArchiveDaysInput") || el("cmsAutoArchiveTtlDaysInput"))?.value) || 21
        )
      );
      await executeCmsMutation(
        {
          action: "RUN_AUTO_ARCHIVE_SWEEP",
          autoArchiveDays: ttlDays,
          forceSweep: true
        },
        `Executed Auto-Archive sweep (cards older than ${ttlDays} days archived/hidden)`
      );
    });

    // 8e. Hermes CMS Create / Edit Post Form
    el("cmsSymbolInput")?.addEventListener("input", (e) => {
      const sym = String(e.target.value || "").trim().toUpperCase();
      const curSel = el("cmsCurrencySelect");
      if (curSel && sym.endsWith(".BK")) {
        curSel.value = "THB";
      }
    });

    el("cmsResetFormBtn")?.addEventListener("click", () => {
      resetCmsForm();
      showToast("Cleared Hermes S/R Post form.");
    });

    el("cmsPostForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const postId = (el("cmsPostIdInput") || el("cmsEditPostIdInput"))?.value.trim() || undefined;
      const symbol = (el("cmsSymbolInput")?.value || "").trim().toUpperCase();
      if (!symbol) {
        showToast("Please enter a ticker symbol (e.g. NVDA, ADVANC.BK).");
        return;
      }
      const tagsRaw = (el("cmsTagsInput")?.value || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const biasVal = (el("cmsBiasSelect") || el("cmsStanceSelect"))?.value || "BULLISH";
      const refPriceVal = Number(el("cmsRefPriceInput")?.value) || undefined;

      const postPayload = {
        id: postId,
        symbol,
        name: (el("cmsNameInput")?.value || "").trim() || undefined,
        currency: el("cmsCurrencySelect")?.value || (symbol.endsWith(".BK") ? "THB" : "USD"),
        referencePrice: refPriceVal,
        bias: biasVal,
        stance: biasVal,
        confidence: Number(el("cmsConfidenceInput")?.value) || 84,
        author: (el("cmsAuthorInput")?.value || "").trim() || "Hermes Agent",
        horizonFocus: el("cmsHorizonFocusSelect")?.value || "ALL",
        status: el("cmsStatusSelect")?.value || "PUBLISHED",
        pinned: Boolean(el("cmsPinnedCheck")?.checked),
        autoArchiveExempt: Boolean(el("cmsAutoArchiveExemptCheck")?.checked || el("cmsPinnedCheck")?.checked),
        title: (el("cmsTitleInput")?.value || "").trim(),
        signalMemo: (el("cmsSignalMemoInput")?.value || "").trim(),
        summary: (el("cmsSummaryInput")?.value || "").trim(),
        tags: tagsRaw,
        supports: [
          {
            rank: 1,
            horizon: "SHORT",
            label: "S1 (ระยะสั้น)",
            price: Number(el("cmsS1PriceInput")?.value) || 0,
            note: (el("cmsS1NoteInput")?.value || "").trim() || "Short-term pullback demand zone"
          },
          {
            rank: 2,
            horizon: "MEDIUM",
            label: "S2 (ระยะกลาง)",
            price: Number(el("cmsS2PriceInput")?.value) || 0,
            note: (el("cmsS2NoteInput")?.value || "").trim() || "Medium-term institutional base"
          },
          {
            rank: 3,
            horizon: "LONG",
            label: "S3 (ระยะยาว)",
            price: Number(el("cmsS3PriceInput")?.value) || 0,
            note: (el("cmsS3NoteInput")?.value || "").trim() || "Long-term structural valuation floor"
          }
        ],
        resistances: [
          {
            rank: 1,
            horizon: "SHORT",
            label: "R1 (ระยะสั้น)",
            price: Number(el("cmsR1PriceInput")?.value) || 0,
            note: (el("cmsR1NoteInput")?.value || "").trim() || "Short-term swing supply zone"
          },
          {
            rank: 2,
            horizon: "MEDIUM",
            label: "R2 (ระยะกลาง)",
            price: Number(el("cmsR2PriceInput")?.value) || 0,
            note: (el("cmsR2NoteInput")?.value || "").trim() || "Medium-term breakout target"
          },
          {
            rank: 3,
            horizon: "LONG",
            label: "R3 (ระยะยาว)",
            price: Number(el("cmsR3PriceInput")?.value) || 0,
            note: (el("cmsR3NoteInput")?.value || "").trim() || "Long-term fair-value ceiling"
          }
        ]
      };

      const ok = await executeCmsMutation(
        {
          action: "UPSERT",
          post: postPayload
        },
        postId
          ? `Updated Hermes S/R Post for ${symbol} (${postId})`
          : `Published new shared S/R 1-2-3 Post for ${symbol}`
      );
      if (ok) {
        const fb = el("cmsFormFeedbackBox");
        if (fb) {
          fb.textContent = `✓ Saved ${symbol} Support/Resistance 1-2-3 card (shared across all SyncKeys).`;
          fb.className = "rounded-xl bg-emerald/15 ring-1 ring-emerald/35 px-3.5 py-2 text-xs text-emerald font-medium";
        }
        resetCmsForm();
      }
    });

    // 8f. Hermes CMS Status / Tag / Search Filters & Bulk Actions
    el("cmsStatusFilterGroup")?.querySelectorAll("[data-cms-status]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const status = btn.getAttribute("data-cms-status") || "ALL";
        state.cmsStatusFilter = status;
        el("cmsStatusFilterGroup").querySelectorAll("[data-cms-status]").forEach((b) => {
          const active = b.getAttribute("data-cms-status") === status;
          b.className = active
            ? "cms-status-btn is-active px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold bg-emerald/20 text-emerald ring-1 ring-emerald/35"
            : "cms-status-btn px-2.5 py-1 rounded-lg text-[11px] font-mono text-slate-300 hover:text-alabaster";
        });
        renderHermesCmsSection();
      });
    });

    el("cmsTagFilterSelect")?.addEventListener("change", (e) => {
      state.cmsTagFilter = e.target.value || "ALL";
      renderHermesCmsSection();
    });

    el("cmsSearchInput")?.addEventListener("input", (e) => {
      state.cmsSearchQuery = e.target.value || "";
      renderHermesCmsSection();
    });

    el("cmsSelectAllPostsCheck")?.addEventListener("change", (e) => {
      const checked = Boolean(e.target.checked);
      if (checked) {
        getFilteredCmsPosts().forEach((p) => state.selectedPostIds.add(p.id));
      } else {
        state.selectedPostIds.clear();
      }
      renderHermesCmsSection();
    });

    const executeBulkCmsAction = async (action, label) => {
      const postIds = Array.from(state.selectedPostIds);
      if (!postIds.length) {
        showToast("Please select at least 1 Hermes post.");
        return;
      }
      await executeCmsMutation(
        { action, postIds },
        `${label} (${postIds.length} post(s))`
      );
    };

    el("cmsBulkArchiveBtn")?.addEventListener("click", () =>
      executeBulkCmsAction("ARCHIVE", "Archived/Hidden selected posts")
    );
    el("cmsBulkRestoreBtn")?.addEventListener("click", () =>
      executeBulkCmsAction("RESTORE", "Restored selected posts to Active")
    );
    el("cmsBulkDeleteBtn")?.addEventListener("click", () =>
      executeBulkCmsAction("DELETE", "Deleted selected posts")
    );

    // 9. Generate Per-Device Activation Key
    el("generateKeyForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const deviceId = el("genDeviceIdInput").value.trim().toUpperCase();
      const syncKey = el("genSyncKeyInput").value.trim().toUpperCase();
      const label = el("genLabelInput").value.trim();
      const autoActivate = el("genAutoActivateCheck").checked;

      const res = await fetch("/api/admin/devices/generate-key", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ deviceId, syncKey, label, autoActivate })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showToast(data.error || "Unable to generate activation key.");
        return;
      }
      state.lastGeneratedKey = data.activationKey;
      el("generatedKeyResultBox").classList.remove("hidden");
      el("generatedKeyText").textContent = data.activationKey;
      state.summary = data.summary;
      state.devices = data.devices;
      state.auditLogs = data.auditLogs;
      renderDashboard();
      showToast(`Generated key ${data.activationKey} for ${data.deviceId}`);
    });

    el("copyGeneratedKeyBtn").addEventListener("click", async () => {
      if (!state.lastGeneratedKey) return;
      await navigator.clipboard.writeText(state.lastGeneratedKey);
      showToast(`Copied key ${state.lastGeneratedKey}`);
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();
    await checkSessionAndLoad();
  });
})();
