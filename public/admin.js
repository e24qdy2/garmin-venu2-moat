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
      await Promise.all([fetchDevicesData(), fetchEmailConfig()]);
    } else {
      state.authenticated = false;
      stopSessionWatchdog();
    }
    renderAuthView();
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
    if (data.admin) {
      state.isDefaultPassword = Boolean(data.admin.isDefaultPassword);
      state.passwordUpdatedAt = data.admin.passwordUpdatedAt || state.passwordUpdatedAt;
    }
    renderDashboard();
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

  function renderDashboard() {
    const s = state.summary || {};
    el("kpiTotalDevices").textContent = String(s.totalDevices ?? 0);
    el("kpiActivePaid").textContent = String(s.activePaid ?? 0);
    el("kpiActiveTrial").textContent = String(s.activeTrial ?? 0);
    el("kpiExpiredTrial").textContent = String(s.expiredTrial ?? 0);
    if (el("kpiPendingRequests")) {
      el("kpiPendingRequests").textContent = String(s.pendingRequests ?? 0);
    }

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
      await Promise.all([fetchDevicesData(), fetchEmailConfig()]);
      showToast("Refreshed latest devices and customer request queue.");
    });

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
