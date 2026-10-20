/* Venu2Moat Admin Portal — Admin Password Login, Change Password, Customer Requests Approval Queue, SMTP / System Mail (e24qdy2@gmail.com) & Per-Device Activation Key Manager */

(() => {
  const state = {
    token: localStorage.getItem("venu2_admin_token") || "",
    authenticated: false,
    adminEmail: "saharat.bun@icloud.com",
    notifyEmail: "e24qdy2@gmail.com",
    authMethod: "",
    passwordUpdatedAt: "",
    isDefaultPassword: true,
    summary: null,
    devices: [],
    customerRequests: [],
    emailLogs: [],
    smtpConfig: null,
    auditLogs: [],
    lastGeneratedKey: ""
  };

  const el = (id) => document.getElementById(id);

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
    const res = await fetch("/api/admin/session", { headers: authHeaders() });
    const data = await res.json();
    state.isDefaultPassword = Boolean(data.isDefaultPassword);
    state.passwordUpdatedAt = data.passwordUpdatedAt || "";
    if (data.notifyEmail) state.notifyEmail = data.notifyEmail;

    if (data.authenticated) {
      state.authenticated = true;
      state.adminEmail = data.email || "saharat.bun@icloud.com";
      state.authMethod = data.authMethod || "ADMIN_PASSWORD";
      await Promise.all([fetchDevicesData(), fetchEmailConfig()]);
    } else {
      state.authenticated = false;
    }
    renderAuthView();
  }

  async function fetchDevicesData() {
    const res = await fetch("/api/admin/devices", { headers: authHeaders() });
    if (res.status === 401) {
      state.authenticated = false;
      localStorage.removeItem("venu2_admin_token");
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
        ? `ตั้งรหัสผ่านไว้แล้ว (${cfg.smtpPassMasked}) — เว้นว่างหากไม่ต้องการเปลี่ยน`
        : "กรอก App Password 16 หลัก (ถ้าใช้ SMTP Auth)";
    }
  }

  function renderAuthView() {
    const gate = el("adminLoginGate");
    const dash = el("adminDashboardContent");
    const pill = el("adminAuthStatusPill");
    const logoutBtn = el("adminLogoutBtn");
    const hintBox = el("defaultPasswordHintBox");

    if (hintBox) {
      if (state.isDefaultPassword) {
        hintBox.classList.remove("hidden");
      } else {
        hintBox.classList.add("hidden");
      }
    }

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
      reqListEl.innerHTML = `<div class="rounded-2xl bg-void/60 p-6 text-center text-xs text-slate-400">ยังไม่มีคำขอต่ออายุทดลองใช้ (Trial Extend) หรือคำขอซื้อ License จากลูกค้า</div>`;
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
          statusBadge = `<span class="font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-emerald/20 text-emerald ring-1 ring-emerald/40 font-bold">APPROVED (${escapeHtml(req.resolutionAction || "")})</span>`;
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
                ${new Date(req.createdAt).toLocaleString("th-TH")}
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs bg-core/70 rounded-xl p-3 ring-1 ring-white/[0.05]">
              <div>
                <span class="text-slate-400">ผู้ติดต่อ:</span>
                <strong class="text-alabaster ml-1">${escapeHtml(req.contactName)}</strong>
              </div>
              <div>
                <span class="text-slate-400">Email:</span>
                <a href="mailto:${escapeHtml(req.contactEmail)}" class="font-mono text-cyan underline ml-1">${escapeHtml(req.contactEmail)}</a>
              </div>
              <div>
                <span class="text-slate-400">โทร / LINE:</span>
                <strong class="font-mono text-emerald ml-1">${escapeHtml(req.contactPhone)}</strong>
              </div>
              <div class="md:col-span-3 pt-1 border-t border-white/[0.05] text-slate-300">
                <span class="text-slate-400">ความประสงค์:</span>
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
          showToast(`ดำเนินการคำขอ ${requestId} (${action}) สำเร็จ`);
        } else {
          showToast(data.error || "ไม่สามารถดำเนินการคำขอได้");
        }
      });
    });
  }

  function renderEmailLogs() {
    const bodyEl = el("adminEmailLogsTableBody");
    if (!bodyEl) return;
    const logs = state.emailLogs || [];
    if (!logs.length) {
      bodyEl.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-slate-400">ยังไม่มีประวัติการส่งอีเมลแจ้งเตือน</td></tr>`;
      return;
    }
    bodyEl.innerHTML = logs
      .map(
        (m) => `
        <tr>
          <td class="py-2 pr-4 text-slate-400 whitespace-nowrap">${new Date(m.timestamp).toLocaleString("th-TH")}</td>
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
        ? new Date(state.passwordUpdatedAt).toLocaleString("th-TH")
        : "-";
      pwdStatusEl.innerHTML = state.isDefaultPassword
        ? `สถานะรหัสผ่าน: <span class="text-amber">ใช้รหัสผ่านเริ่มต้น (Default)</span> · อัปเดตล่าสุด ${escapeHtml(updatedStr)}`
        : `สถานะรหัสผ่าน: <span class="text-emerald">ตั้งค่ารหัสผ่านส่วนตัวแล้ว (Custom Password)</span> · อัปเดตล่าสุด ${escapeHtml(updatedStr)}`;
    }

    renderCustomerRequests();
    renderEmailLogs();

    const listEl = el("adminDevicesList");
    if (!state.devices.length) {
      listEl.innerHTML = `<div class="rounded-2xl bg-void/60 p-6 text-center text-xs text-slate-400">ยังไม่มีอุปกรณ์ในระบบ</div>`;
    } else {
      listEl.innerHTML = state.devices
        .map((d) => {
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
            <div class="rounded-2xl bg-void/75 ring-1 ring-white/[0.08] p-4 sm:p-5 space-y-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-center gap-2.5">
                  <span class="font-mono text-sm sm:text-base font-extrabold text-alabaster">${escapeHtml(d.deviceId)}</span>
                  <span class="font-mono text-[11px] px-2.5 py-0.5 rounded-full font-semibold ${badgeClass}">${badgeLabel}</span>
                  <span class="font-mono text-[11px] px-2 py-0.5 rounded-lg bg-white/[0.05] text-slate-300">Sync: ${escapeHtml(d.syncKey)}</span>
                </div>
                <div class="text-[11px] font-mono text-slate-400">
                  หมดอายุทดลอง: ${new Date(d.trialExpiresAt).toLocaleDateString("th-TH")}
                </div>
              </div>

              <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                <div>
                  <span>ชื่อเครื่อง: <strong class="text-slate-200">${escapeHtml(d.label)}</strong></span>
                  <span class="mx-2 text-slate-600">|</span>
                  <span>รหัสประจำเครื่องนี้: <code class="font-mono text-cyan font-semibold">${escapeHtml(d.issuedKey)}</code></span>
                </div>
                <button
                  type="button"
                  data-copy-key="${escapeHtml(d.issuedKey)}"
                  class="copy-device-key-btn rounded-lg bg-white/[0.06] hover:bg-white/[0.12] px-2.5 py-1 font-mono text-[11px] text-cyan flex items-center gap-1"
                >
                  <i class="ph-light ph-copy"></i>
                  <span>Copy Key</span>
                </button>
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
                  + ต่อเวลาทดลอง 14 วัน
                </button>
                <button
                  type="button"
                  data-dev-action="RESET_TRIAL"
                  data-dev-id="${escapeHtml(d.deviceId)}"
                  class="dev-action-btn rounded-full bg-white/[0.06] hover:bg-white/[0.12] ring-1 ring-white/10 px-3 py-1 text-[11px] font-mono text-slate-300"
                >
                  รีเซ็ต Trial 14 วันใหม่
                </button>
                <button
                  type="button"
                  data-dev-action="EXPIRE_TRIAL"
                  data-dev-id="${escapeHtml(d.deviceId)}"
                  class="dev-action-btn rounded-full bg-crimson/15 hover:bg-crimson/25 ring-1 ring-crimson/30 px-3 py-1 text-[11px] font-mono text-crimson ml-auto"
                  title="จำลองสถานะหมดเวลาทดลอง 14 วัน เพื่อทดสอบหน้าจอล็อกให้ติดต่อ saharat.bun@icloud.com"
                >
                  Simulate 14d Expired (Lock)
                </button>
              </div>
            </div>
          `;
        })
        .join("");

      listEl.querySelectorAll(".copy-device-key-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const k = btn.getAttribute("data-copy-key");
          await navigator.clipboard.writeText(k);
          showToast(`คัดลอกรหัส ${k} แล้ว`);
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
            state.summary = data.summary;
            state.devices = data.devices;
            state.customerRequests = data.customerRequests || state.customerRequests;
            state.auditLogs = data.auditLogs;
            renderDashboard();
            showToast(`อัปเดตสถานะเครื่อง ${deviceId} (${action}) สำเร็จ`);
          } else {
            showToast(data.error || "ไม่สามารถอัปเดตสถานะได้");
          }
        });
      });
    }

    const auditBody = el("adminAuditTableBody");
    auditBody.innerHTML = (state.auditLogs || [])
      .map(
        (log) => `
        <tr>
          <td class="py-2 pr-4 text-slate-400 whitespace-nowrap">${new Date(log.timestamp).toLocaleString("th-TH")}</td>
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
          const msg = data.error || "รหัสผ่านผู้ดูแลระบบไม่ถูกต้อง";
          if (errBox) {
            errBox.textContent = msg;
            errBox.classList.remove("hidden");
          }
          showToast(msg);
          return;
        }

        el("adminPasswordInput").value = "";
        state.token = data.token;
        localStorage.setItem("venu2_admin_token", data.token);
        await checkSessionAndLoad();
        showToast(`ยินดีต้อนรับผู้ดูแลระบบ ${data.email}`);
      });
    }

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
          showChangePwdFeedback("กรุณากรอกรหัสผ่านเดิมเพื่อยืนยันตัวตน", false);
          return;
        }
        if (newPassword.length < 6) {
          showChangePwdFeedback("รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 6 ตัวอักษร", false);
          return;
        }
        if (newPassword !== confirmPassword) {
          showChangePwdFeedback("รหัสผ่านใหม่และการยืนยันรหัสผ่านใหม่ไม่ตรงกัน", false);
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
          const errMsg = data.error || "ไม่สามารถเปลี่ยนรหัสผ่านได้";
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
        showChangePwdFeedback("✓ ยืนยันรหัสเดิมและเปลี่ยนรหัสผ่านผู้ดูแลระบบใหม่เรียบร้อยแล้ว", true);
        showToast("เปลี่ยนรหัสผ่านผู้ดูแลระบบสำเร็จ");
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
          showEmailServiceFeedback(data.error || "ไม่สามารถบันทึกตั้งค่า SMTP ได้", false);
          return;
        }
        state.smtpConfig = data.smtpConfig;
        populateSmtpForm(data.smtpConfig);
        showEmailServiceFeedback(data.message || "บันทึกการตั้งค่า SMTP สำเร็จ", true);
        showToast("บันทึกการตั้งค่า SMTP เรียบร้อยแล้ว");
      });
    }

    el("testSendEmailBtn")?.addEventListener("click", async () => {
      const recipientEmail = el("smtpRecipientEmailInput")?.value.trim() || "e24qdy2@gmail.com";
      showEmailServiceFeedback(`กำลังทดสอบส่งอีเมลแจ้งเตือนไปที่ ${recipientEmail}...`, true);
      const res = await fetch("/api/admin/email/test", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ recipientEmail })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        showEmailServiceFeedback(data.error || "การทดสอบส่งอีเมลล้มเหลว", false);
        showToast("ทดสอบส่งอีเมลไม่สำเร็จ");
        return;
      }
      state.emailLogs = data.emailLogs || state.emailLogs;
      renderEmailLogs();
      const method = data.delivery?.deliveryMethod || "SENT";
      const detail = data.delivery?.detail || "";
      showEmailServiceFeedback(`✓ ทดสอบส่งอีเมลไปที่ ${recipientEmail} สำเร็จ (${method}: ${detail})`, true);
      showToast(`ส่งอีเมลทดสอบไปที่ ${recipientEmail} สำเร็จ`);
    });

    // 7. Sign Out
    el("adminLogoutBtn").addEventListener("click", () => {
      state.token = "";
      state.authenticated = false;
      localStorage.removeItem("venu2_admin_token");
      renderAuthView();
      showToast("ออกจากระบบ Admin แล้ว");
    });

    // 8. Refresh Dashboard
    el("refreshAdminBtn").addEventListener("click", async () => {
      await Promise.all([fetchDevicesData(), fetchEmailConfig()]);
      showToast("อัปเดตข้อมูลอุปกรณ์และคิวคำขอล่าสุดแล้ว");
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
        showToast(data.error || "ไม่สามารถสร้างรหัส Activate ได้");
        return;
      }
      state.lastGeneratedKey = data.activationKey;
      el("generatedKeyResultBox").classList.remove("hidden");
      el("generatedKeyText").textContent = data.activationKey;
      state.summary = data.summary;
      state.devices = data.devices;
      state.auditLogs = data.auditLogs;
      renderDashboard();
      showToast(`สร้างรหัส ${data.activationKey} สำหรับ ${data.deviceId} สำเร็จ`);
    });

    el("copyGeneratedKeyBtn").addEventListener("click", async () => {
      if (!state.lastGeneratedKey) return;
      await navigator.clipboard.writeText(state.lastGeneratedKey);
      showToast(`คัดลอกรหัส ${state.lastGeneratedKey} แล้ว`);
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bindEvents();
    await checkSessionAndLoad();
  });
})();
