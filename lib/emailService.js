const fs = require("fs");
const path = require("path");
const net = require("net");
const tls = require("tls");
const dns = require("dns");
const crypto = require("crypto");

const OWNER_EMAIL = "saharat.bun@icloud.com";
const NOTIFY_EMAIL = "e24qdy2@gmail.com";

const BASE_DIR = typeof __dirname !== "undefined" ? __dirname : ".";

class EmailService {
  constructor(options = {}) {
    this.dataFile = options.dataFile || path.join(BASE_DIR, "..", "data", "licenses.json");
    this.outboxDir = options.outboxDir || path.join(BASE_DIR, "..", "data", "mail-outbox");
    this.ownerEmail = options.ownerEmail || OWNER_EMAIL;
    this.notifyEmail = options.notifyEmail || NOTIFY_EMAIL;
    this.skipNetworkInTest = Boolean(options.skipNetworkInTest);
    this.serverless = Boolean(options.serverless || options.getDb);
    this.getDb = typeof options.getDb === "function" ? options.getDb : null;
    this.onWriteDb = typeof options.onWriteDb === "function" ? options.onWriteDb : null;
    this._ensureOutboxDir();
  }

  _ensureOutboxDir() {
    if (this.serverless) return;
    if (!fs.existsSync(this.outboxDir)) {
      fs.mkdirSync(this.outboxDir, { recursive: true });
    }
  }

  _readDb() {
    if (this.getDb) {
      return this.getDb() || {};
    }
    try {
      if (fs.existsSync(this.dataFile)) {
        return JSON.parse(fs.readFileSync(this.dataFile, "utf8"));
      }
    } catch (e) {
      // ignore parse error
    }
    return {};
  }

  _writeDb(db) {
    if (this.serverless) {
      if (this.onWriteDb) {
        try {
          this.onWriteDb(db);
        } catch (_e) {}
      }
      return;
    }
    const dir = path.dirname(this.dataFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.dataFile, JSON.stringify(db, null, 2), "utf8");
  }

  getDefaultSmtpConfig() {
    return {
      smtpHost: process.env.MOAT_SMTP_HOST || "smtp.gmail.com",
      smtpPort: Number(process.env.MOAT_SMTP_PORT || 465),
      smtpSecure: process.env.MOAT_SMTP_SECURE !== undefined ? process.env.MOAT_SMTP_SECURE === "true" : true,
      smtpUser: process.env.MOAT_SMTP_USER || "",
      smtpPass: process.env.MOAT_SMTP_PASS || "",
      fromEmail: process.env.MOAT_SMTP_FROM || this.ownerEmail,
      recipientEmail: process.env.MOAT_NOTIFY_EMAIL || this.notifyEmail,
      enableSystemMailFallback: true,
      updatedAt: null
    };
  }

  getSmtpConfig(includeSecret = false) {
    const db = this._readDb();
    const defaults = this.getDefaultSmtpConfig();
    const saved = db.smtpConfig || {};
    const merged = {
      ...defaults,
      ...saved,
      recipientEmail: saved.recipientEmail || defaults.recipientEmail || this.notifyEmail,
      fromEmail: saved.fromEmail || defaults.fromEmail || this.ownerEmail
    };
    if (!includeSecret) {
      return {
        ...merged,
        smtpPass: merged.smtpPass ? "••••••••" : "",
        hasSmtpPass: Boolean(merged.smtpPass)
      };
    }
    return merged;
  }

  updateSmtpConfig(newConfig = {}) {
    const db = this._readDb();
    const current = this.getSmtpConfig(true);

    const updatedPass =
      newConfig.smtpPass !== undefined &&
      newConfig.smtpPass !== "••••••••" &&
      String(newConfig.smtpPass).trim() !== ""
        ? String(newConfig.smtpPass).trim()
        : newConfig.clearPassword
        ? ""
        : current.smtpPass;

    const updated = {
      smtpHost: String(newConfig.smtpHost ?? current.smtpHost ?? "smtp.gmail.com").trim(),
      smtpPort: Number(newConfig.smtpPort ?? current.smtpPort ?? 465) || 465,
      smtpSecure:
        newConfig.smtpSecure !== undefined ? Boolean(newConfig.smtpSecure) : Boolean(current.smtpSecure),
      smtpUser: String(newConfig.smtpUser ?? current.smtpUser ?? "").trim(),
      smtpPass: updatedPass,
      fromEmail: String(newConfig.fromEmail || current.fromEmail || this.ownerEmail).trim(),
      recipientEmail: String(newConfig.recipientEmail || current.recipientEmail || this.notifyEmail).trim(),
      enableSystemMailFallback:
        newConfig.enableSystemMailFallback !== undefined
          ? Boolean(newConfig.enableSystemMailFallback)
          : true,
      updatedAt: new Date().toISOString()
    };

    db.smtpConfig = updated;
    this._writeDb(db);
    return this.getSmtpConfig(false);
  }

  listEmailLogs(limit = 30) {
    const db = this._readDb();
    const logs = Array.isArray(db.emailLogs) ? db.emailLogs : [];
    return logs.slice(0, limit);
  }

  /**
   * Low-level RFC-5321 SMTP client over TLS (465) or TCP/STARTTLS (25 / 587)
   */
  _sendRawSmtp({ host, port, secure, user, pass, from, to, rawMime, timeoutMs = 4500 }) {
    return new Promise((resolve, reject) => {
      let socket = null;
      let finished = false;
      let buffer = "";
      let step = 0;

      const done = (err, info) => {
        if (finished) return;
        finished = true;
        try {
          if (socket) socket.destroy();
        } catch (_) {}
        if (err) reject(err);
        else resolve(info);
      };

      const timer = setTimeout(() => {
        done(new Error(`SMTP timeout (${host}:${port})`));
      }, timeoutMs);

      const sendLine = (line) => {
        if (socket && !socket.destroyed) {
          socket.write(line + "\r\n");
        }
      };

      const handleResponse = (code, fullText) => {
        if (code >= 400) {
          clearTimeout(timer);
          return done(new Error(`SMTP ${code}: ${fullText.trim()}`));
        }

        if (step === 0 && code === 220) {
          step = 1;
          sendLine("EHLO moat.readybyte.top");
        } else if (step === 1 && code === 250) {
          if (user && pass) {
            step = 2;
            sendLine("AUTH LOGIN");
          } else {
            step = 4;
            sendLine(`MAIL FROM:<${from}>`);
          }
        } else if (step === 2 && code === 334) {
          step = 3;
          sendLine(Buffer.from(String(user), "utf8").toString("base64"));
        } else if (step === 3 && code === 334) {
          step = 35;
          sendLine(Buffer.from(String(pass), "utf8").toString("base64"));
        } else if (step === 35 && code === 235) {
          step = 4;
          sendLine(`MAIL FROM:<${from}>`);
        } else if (step === 4 && code === 250) {
          step = 5;
          sendLine(`RCPT TO:<${to}>`);
        } else if (step === 5 && (code === 250 || code === 251)) {
          step = 6;
          sendLine("DATA");
        } else if (step === 6 && code === 354) {
          step = 7;
          const safeData = rawMime.replace(/\r?\n\./g, "\r\n..");
          sendLine(safeData + "\r\n.");
        } else if (step === 7 && code === 250) {
          step = 8;
          sendLine("QUIT");
          clearTimeout(timer);
          done(null, { accepted: true, response: fullText.trim() });
        }
      };

      const onData = (chunk) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        let multiLine = "";
        for (const line of lines) {
          if (!line) continue;
          multiLine += line + "\n";
          // Multi-line SMTP responses have a hyphen at index 3 (e.g., "250-PIPELINING"), final line has space ("250 OK")
          if (line.length >= 3 && (line[3] === " " || line.length === 3)) {
            const code = parseInt(line.slice(0, 3), 10);
            const full = multiLine;
            multiLine = "";
            if (!Number.isNaN(code)) {
              handleResponse(code, full);
            }
          }
        }
      };

      try {
        if (secure) {
          socket = tls.connect(
            { host, port, servername: host, rejectUnauthorized: false },
            () => {}
          );
        } else {
          socket = net.connect({ host, port });
        }
        socket.on("data", onData);
        socket.on("error", (err) => {
          clearTimeout(timer);
          done(err);
        });
        socket.on("close", () => {
          clearTimeout(timer);
          if (!finished) {
            done(new Error("SMTP connection closed unexpectedly"));
          }
        });
      } catch (err) {
        clearTimeout(timer);
        done(err);
      }
    });
  }

  _buildMimeMessage({ from, to, replyTo, subject, bodyText }) {
    const msgId = `<${crypto.randomBytes(8).toString("hex")}@moat.readybyte.top>`;
    const dateHeader = new Date().toUTCString();
    const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
    const headers = [
      `From: "GarminMoat System" <${from}>`,
      `To: <${to}>`,
      replyTo ? `Reply-To: <${replyTo}>` : null,
      `Subject: ${encodedSubject}`,
      `Date: ${dateHeader}`,
      `Message-ID: ${msgId}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit"
    ]
      .filter(Boolean)
      .join("\r\n");

    return `${headers}\r\n\r\n${bodyText}`;
  }

  async sendEmail({ subject, bodyText, replyTo, requestType = "SYSTEM_ALERT", requestId = "-", deviceId = "-" }) {
    const cfg = this.getSmtpConfig(true);
    const to = cfg.recipientEmail || this.notifyEmail;
    const from = cfg.fromEmail || this.ownerEmail;
    const mailId = "MAIL-" + crypto.randomBytes(3).toString("hex").toUpperCase();
    const timestamp = new Date().toISOString();

    const rawMime = this._buildMimeMessage({
      from,
      to,
      replyTo: replyTo || this.ownerEmail,
      subject,
      bodyText
    });

    // Always write a copy to data/mail-outbox/<mailId>.eml for guaranteed auditability when on local FS
    if (!this.serverless) {
      this._ensureOutboxDir();
      const emlFile = path.join(this.outboxDir, `${mailId}.eml`);
      try {
        fs.writeFileSync(emlFile, rawMime, "utf8");
      } catch (_) {}
    }

    let transport = "SYSTEM_OUTBOX_SPOOL";
    let status = "QUEUED_OUTBOX";
    let detail = `Saved to System Mail Outbox (${mailId}.eml) for ${to}`;
    let deliveredLive = false;

    if (!this.skipNetworkInTest && !this.serverless) {
      // 1. Try Authenticated SMTP if smtpHost & smtpUser & smtpPass are configured
      if (cfg.smtpHost && cfg.smtpUser && cfg.smtpPass) {
        try {
          const smtpRes = await this._sendRawSmtp({
            host: cfg.smtpHost,
            port: Number(cfg.smtpPort) || 465,
            secure: Boolean(cfg.smtpSecure),
            user: cfg.smtpUser,
            pass: cfg.smtpPass,
            from: cfg.smtpUser.includes("@") ? cfg.smtpUser : from,
            to,
            rawMime,
            timeoutMs: 5500
          });
          transport = `SMTP_AUTH (${cfg.smtpHost}:${cfg.smtpPort})`;
          status = "SENT_SMTP";
          detail = `Delivered via Authenticated SMTP (${cfg.smtpHost}) -> ${to} [${smtpRes.response}]`;
          deliveredLive = true;
        } catch (smtpErr) {
          detail = `SMTP Auth attempt failed (${smtpErr.message}); falling back to System Mail MX`;
        }
      }

      // 2. If not yet delivered and system mail fallback is enabled, try Direct MX delivery to recipient domain
      if (!deliveredLive && cfg.enableSystemMailFallback) {
        try {
          const domain = to.split("@")[1] || "gmail.com";
          const mxRecords = await dns.promises.resolveMx(domain).catch(() => [
            { exchange: "gmail-smtp-in.l.google.com", priority: 5 }
          ]);
          const sortedMx = mxRecords.sort((a, b) => a.priority - b.priority);
          const mxHost = sortedMx[0]?.exchange || "gmail-smtp-in.l.google.com";

          const mxRes = await this._sendRawSmtp({
            host: mxHost,
            port: 25,
            secure: false,
            user: "",
            pass: "",
            from: `noreply@readybyte.top`,
            to,
            rawMime,
            timeoutMs: 3500
          });
          transport = `DIRECT_MX_SYSTEM_MAIL (${mxHost}:25)`;
          status = "SENT_SYSTEM_MX";
          detail = `Delivered via Direct MX System Mail (${mxHost}:25) -> ${to} [${mxRes.response}]`;
          deliveredLive = true;
        } catch (mxErr) {
          transport = "SYSTEM_OUTBOX_SPOOL";
          status = "QUEUED_OUTBOX";
          detail = `Recorded in System Mail Outbox (${mailId}.eml) for ${to} (Configure SMTP App Password in Admin Portal for instant external relay: ${mxErr.message})`;
        }
      }
    } else if (this.serverless) {
      transport = "CLOUDFLARE_EDGE_OUTBOX";
      status = "QUEUED_OUTBOX";
      detail = `Recorded in Cloudflare Edge Outbox (${mailId}) for ${to}`;
    }

    const logEntry = {
      id: mailId,
      timestamp,
      to,
      from,
      replyTo: replyTo || this.ownerEmail,
      subject,
      bodyText,
      requestType,
      requestId,
      deviceId,
      transport,
      status,
      deliveredLive,
      emlFile: `${mailId}.eml`,
      detail
    };

    const db = this._readDb();
    if (!Array.isArray(db.emailLogs)) db.emailLogs = [];
    db.emailLogs.unshift(logEntry);
    if (db.emailLogs.length > 100) {
      db.emailLogs = db.emailLogs.slice(0, 100);
    }
    this._writeDb(db);

    return {
      ok: true,
      mailId,
      to,
      recipientEmail: to,
      from,
      status,
      transport,
      deliveredLive,
      detail,
      log: logEntry
    };
  }

  async sendCustomerRequestEmail(requestRecord) {
    const isPurchase = requestRecord.requestType === "PURCHASE_LICENSE";
    const typeLabel = isPurchase
      ? "PRO License Purchase Request"
      : `Trial Key Extension Request (+${requestRecord.requestedExtendDays || 7} Days)`;

    const subject = `[GarminMoat] ${typeLabel} - Device ${requestRecord.deviceId} (${requestRecord.contactName || requestRecord.contactEmail})`;
    const bodyText = [
      "==========================================================",
      `GARMINMOAT SYSTEM NOTIFICATION -> ${this.notifyEmail}`,
      "==========================================================",
      `Request ID       : ${requestRecord.id}`,
      `Request Type     : ${typeLabel}`,
      `Submitted At     : ${requestRecord.createdAt}`,
      `Device ID        : ${requestRecord.deviceId}`,
      `Sync Key         : ${requestRecord.syncKey || "VENU2-88"}`,
      "----------------------------------------------------------",
      "Customer Contact Information:",
      `Contact Name     : ${requestRecord.contactName || "-"}`,
      `Contact Email    : ${requestRecord.contactEmail || "-"}`,
      `Phone / LINE     : ${requestRecord.contactPhone || "-"}`,
      `Additional Notes : ${requestRecord.message || "-"}`,
      "----------------------------------------------------------",
      `System Owner     : ${this.ownerEmail}`,
      "Approve in 1 click at Admin Portal: https://admin-moat.readybyte.top",
      "=========================================================="
    ].join("\n");

    return this.sendEmail({
      subject,
      bodyText,
      replyTo: requestRecord.contactEmail || this.ownerEmail,
      requestType: requestRecord.requestType,
      requestId: requestRecord.id,
      deviceId: requestRecord.deviceId
    });
  }

  async sendTestEmail(customNote = "") {
    const cfg = this.getSmtpConfig(false);
    const subject = `[GarminMoat] SMTP / System Mail Test -> ${cfg.recipientEmail}`;
    const bodyText = [
      "==========================================================",
      "GARMINMOAT SMTP / SYSTEM MAIL TEST MESSAGE",
      "==========================================================",
      `Test Timestamp       : ${new Date().toISOString()}`,
      `System Owner Email   : ${this.ownerEmail}`,
      `Notification Target  : ${cfg.recipientEmail}`,
      `Configured SMTP Host : ${cfg.smtpHost}:${cfg.smtpPort} (Secure: ${cfg.smtpSecure})`,
      `Note                 : ${customNote || "Triggered from Admin Portal (https://admin-moat.readybyte.top)"}`,
      "=========================================================="
    ].join("\n");

    return this.sendEmail({
      subject,
      bodyText,
      replyTo: this.ownerEmail,
      requestType: "SMTP_TEST",
      requestId: "TEST",
      deviceId: "-"
    });
  }
}

module.exports = {
  EmailService,
  OWNER_EMAIL,
  NOTIFY_EMAIL
};
