const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const OWNER_EMAIL = "saharabu@scg.com";
const TRIAL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SECRET = process.env.MOAT_LICENSE_SECRET || "venu2moat-scg-saharabu-hmac-2026-secret-key";

class LicenseManager {
  constructor(options = {}) {
    this.dataFile = options.dataFile || path.join(__dirname, "..", "data", "licenses.json");
    this.secret = options.secret || DEFAULT_SECRET;
    this.ownerEmail = options.ownerEmail || OWNER_EMAIL;
    this.trialDays = options.trialDays || TRIAL_DAYS;
    this.otpStore = new Map(); // email -> { code, expiresAt }
    this.sessions = new Map(); // token -> { email, createdAt, expiresAt, authMethod }
    this._ensureDataFile();
  }

  _ensureDataFile() {
    const dir = path.dirname(this.dataFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.dataFile)) {
      const now = Date.now();
      const seedDeviceId = "V2-88VENU20";
      const initialData = {
        ownerEmail: this.ownerEmail,
        trialDays: this.trialDays,
        devices: {
          [seedDeviceId]: {
            deviceId: seedDeviceId,
            label: "Garmin Venu 2 (Primary USB Watch)",
            syncKey: "VENU2-88",
            status: "TRIAL",
            firstSeenAt: new Date(now).toISOString(),
            lastSeenAt: new Date(now).toISOString(),
            trialStartMs: now,
            trialExpiresMs: now + this.trialDays * DAY_MS,
            activatedKey: "",
            activatedAt: null,
            issuedKey: this.generateActivationKey(seedDeviceId),
            notes: "Auto-enrolled 14-day free trial"
          }
        },
        auditLogs: [
          {
            id: "AUD-INIT",
            timestamp: new Date(now).toISOString(),
            actor: "system",
            action: "SYSTEM_INIT",
            deviceId: seedDeviceId,
            detail: `Initialized 14-day trial licensing engine (Owner: ${this.ownerEmail})`
          }
        ]
      };
      fs.writeFileSync(this.dataFile, JSON.stringify(initialData, null, 2), "utf8");
    }
  }

  _readDb() {
    this._ensureDataFile();
    try {
      return JSON.parse(fs.readFileSync(this.dataFile, "utf8"));
    } catch (e) {
      return { ownerEmail: this.ownerEmail, trialDays: this.trialDays, devices: {}, auditLogs: [] };
    }
  }

  _writeDb(db) {
    fs.writeFileSync(this.dataFile, JSON.stringify(db, null, 2), "utf8");
  }

  _appendAudit(db, actor, action, deviceId, detail) {
    if (!Array.isArray(db.auditLogs)) db.auditLogs = [];
    db.auditLogs.unshift({
      id: "AUD-" + crypto.randomBytes(3).toString("hex").toUpperCase(),
      timestamp: new Date().toISOString(),
      actor: actor || this.ownerEmail,
      action,
      deviceId: deviceId || "-",
      detail
    });
    if (db.auditLogs.length > 100) {
      db.auditLogs = db.auditLogs.slice(0, 100);
    }
  }

  normalizeDeviceId(rawId) {
    const cleaned = String(rawId || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "");
    if (!cleaned) return "V2-88VENU20";
    if (cleaned.length > 20) {
      return "V2-" + cleaned.replace(/-/g, "").slice(-8);
    }
    return cleaned;
  }

  normalizeKey(rawKey) {
    return String(rawKey || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "");
  }

  /**
   * Generates a deterministic per-deviceId activation key: MOAT-XXXX-XXXX-XXXX
   */
  generateActivationKey(deviceId) {
    const normId = this.normalizeDeviceId(deviceId);
    const hmac = crypto
      .createHmac("sha256", this.secret)
      .update(`VENU2MOAT:LICENSE:${normId}`)
      .digest("hex")
      .toUpperCase();
    // Map hex to readable alphanumeric chars (avoiding ambiguous 0/O, 1/I)
    const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let chars = "";
    for (let i = 0; i < 12; i++) {
      const byteVal = parseInt(hmac.slice(i * 2, i * 2 + 2), 16);
      chars += alphabet[byteVal % alphabet.length];
    }
    return `MOAT-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
  }

  verifyActivationKey(deviceId, candidateKey) {
    const normId = this.normalizeDeviceId(deviceId);
    const normCandidate = this.normalizeKey(candidateKey);
    if (!normCandidate) return false;
    const expected = this.generateActivationKey(normId);
    if (normCandidate === expected) return true;

    const db = this._readDb();
    const rec = db.devices[normId];
    if (rec && rec.issuedKey && this.normalizeKey(rec.issuedKey) === normCandidate && rec.allowCustomKey) {
      return true;
    }
    return false;
  }

  _computeRecordState(rec, nowMs = Date.now()) {
    const expectedKey = this.generateActivationKey(rec.deviceId);
    const hasValidActivatedKey =
      rec.status === "ACTIVE" &&
      rec.activatedKey &&
      (this.normalizeKey(rec.activatedKey) === expectedKey || rec.allowCustomKey);

    if (hasValidActivatedKey) {
      return {
        deviceId: rec.deviceId,
        label: rec.label || "Garmin Venu 2",
        syncKey: rec.syncKey || "VENU2-88",
        status: "ACTIVE",
        isActivated: true,
        isExpired: false,
        trialDaysTotal: this.trialDays,
        remainingDays: 9999,
        remainingHours: 99999,
        trialStartAt: new Date(rec.trialStartMs).toISOString(),
        trialExpiresAt: new Date(rec.trialExpiresMs).toISOString(),
        activatedAt: rec.activatedAt,
        activatedKey: rec.activatedKey,
        issuedKey: rec.issuedKey || expectedKey,
        ownerEmail: this.ownerEmail,
        firstSeenAt: rec.firstSeenAt,
        lastSeenAt: rec.lastSeenAt,
        notes: rec.notes || ""
      };
    }

    const msLeft = (rec.trialExpiresMs || 0) - nowMs;
    const isExpired = rec.status === "EXPIRED" || rec.status === "REVOKED" || msLeft <= 0;
    const remainingDays = isExpired ? 0 : Math.max(0, Math.ceil(msLeft / DAY_MS));
    const remainingHours = isExpired ? 0 : Math.max(0, Math.ceil(msLeft / (60 * 60 * 1000)));
    const effectiveStatus = isExpired ? "EXPIRED" : "TRIAL";

    return {
      deviceId: rec.deviceId,
      label: rec.label || "Garmin Venu 2",
      syncKey: rec.syncKey || "VENU2-88",
      status: effectiveStatus,
      isActivated: false,
      isExpired,
      trialDaysTotal: this.trialDays,
      remainingDays,
      remainingHours,
      trialStartAt: new Date(rec.trialStartMs || nowMs).toISOString(),
      trialExpiresAt: new Date(rec.trialExpiresMs || nowMs).toISOString(),
      activatedAt: null,
      activatedKey: "",
      issuedKey: rec.issuedKey || expectedKey,
      ownerEmail: this.ownerEmail,
      firstSeenAt: rec.firstSeenAt,
      lastSeenAt: rec.lastSeenAt,
      notes: rec.notes || ""
    };
  }

  /**
   * Evaluates (and registers on first sight) a device's license/trial state.
   */
  evaluateDeviceLicense(deviceId, options = {}) {
    const normId = this.normalizeDeviceId(deviceId);
    const nowMs = options.nowMs || Date.now();
    const syncKey = String(options.syncKey || "VENU2-88").trim().toUpperCase();
    const providedKey = this.normalizeKey(options.providedKey || "");
    const db = this._readDb();

    let rec = db.devices[normId];
    let dirty = false;

    if (!rec) {
      rec = {
        deviceId: normId,
        label: options.label || `Garmin Venu 2 (${normId})`,
        syncKey,
        status: "TRIAL",
        firstSeenAt: new Date(nowMs).toISOString(),
        lastSeenAt: new Date(nowMs).toISOString(),
        trialStartMs: nowMs,
        trialExpiresMs: nowMs + this.trialDays * DAY_MS,
        activatedKey: "",
        activatedAt: null,
        issuedKey: this.generateActivationKey(normId),
        notes: `14-day trial started via syncKey ${syncKey}`
      };
      db.devices[normId] = rec;
      this._appendAudit(
        db,
        "watch-sync",
        "TRIAL_STARTED",
        normId,
        `Registered new device ${normId} on 14-day trial (SyncKey: ${syncKey})`
      );
      dirty = true;
    } else {
      if (syncKey && rec.syncKey !== syncKey) {
        rec.syncKey = syncKey;
        dirty = true;
      }
      rec.lastSeenAt = new Date(nowMs).toISOString();
      dirty = true;
    }

    // If watch or profile supplied a valid activation key and device isn't active yet
    if (providedKey && rec.status !== "ACTIVE" && rec.status !== "REVOKED") {
      const expectedKey = this.generateActivationKey(normId);
      if (providedKey === expectedKey) {
        rec.status = "ACTIVE";
        rec.activatedKey = expectedKey;
        rec.activatedAt = new Date(nowMs).toISOString();
        this._appendAudit(
          db,
          "device-key",
          "DEVICE_ACTIVATED",
          normId,
          `Device ${normId} activated via valid activation key ${expectedKey}`
        );
        dirty = true;
      }
    }

    if (dirty) {
      this._writeDb(db);
    }

    const full = this._computeRecordState(rec, nowMs);
    const compactWatchLicense = {
      did: full.deviceId,
      st: full.status, // "TRIAL" | "ACTIVE" | "EXPIRED"
      days: full.remainingDays,
      exp: full.isExpired ? 1 : 0,
      own: this.ownerEmail,
      msg: full.isExpired
        ? `Trial 14d expired. Contact ${this.ownerEmail}`
        : full.isActivated
        ? "PRO Activated"
        : `Trial: ${full.remainingDays}d left`
    };

    return {
      full,
      watch: compactWatchLicense
    };
  }

  /**
   * User/Web activation endpoint handler
   */
  activateDevice(deviceId, activationKey, options = {}) {
    const normId = this.normalizeDeviceId(deviceId);
    const normKey = this.normalizeKey(activationKey);
    const nowMs = options.nowMs || Date.now();

    // Ensure record exists first
    this.evaluateDeviceLicense(normId, { syncKey: options.syncKey, nowMs });

    const expectedKey = this.generateActivationKey(normId);
    if (normKey !== expectedKey) {
      return {
        ok: false,
        error: `Invalid Activation Code for Device ID ${normId}. Please contact ${this.ownerEmail} for a valid key.`
      };
    }

    const db = this._readDb();
    const rec = db.devices[normId];
    rec.status = "ACTIVE";
    rec.activatedKey = expectedKey;
    rec.activatedAt = new Date(nowMs).toISOString();
    rec.issuedKey = expectedKey;
    rec.lastSeenAt = new Date(nowMs).toISOString();
    if (options.syncKey) rec.syncKey = String(options.syncKey).trim().toUpperCase();

    this._appendAudit(
      db,
      options.actor || "web-user",
      "DEVICE_ACTIVATED",
      normId,
      `Activated device ${normId} with key ${expectedKey}`
    );
    this._writeDb(db);

    const evaluated = this.evaluateDeviceLicense(normId, { syncKey: rec.syncKey, nowMs });
    return {
      ok: true,
      message: `Device ${normId} is now permanently activated!`,
      license: evaluated.full,
      watch: evaluated.watch
    };
  }

  /**
   * Admin: list all devices and summary stats
   */
  listDevices(nowMs = Date.now()) {
    const db = this._readDb();
    const devices = Object.values(db.devices || {})
      .map((rec) => this._computeRecordState(rec, nowMs))
      .sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")));

    const summary = {
      totalDevices: devices.length,
      activePaid: devices.filter((d) => d.status === "ACTIVE").length,
      activeTrial: devices.filter((d) => d.status === "TRIAL").length,
      expiredTrial: devices.filter((d) => d.status === "EXPIRED").length,
      ownerEmail: this.ownerEmail,
      trialDays: this.trialDays
    };

    return {
      summary,
      devices,
      auditLogs: (db.auditLogs || []).slice(0, 50)
    };
  }

  /**
   * Admin: generate or pre-register a deviceId and return its activation key
   */
  issueDeviceKey(deviceId, options = {}) {
    const normId = this.normalizeDeviceId(deviceId);
    const nowMs = options.nowMs || Date.now();
    const syncKey = String(options.syncKey || "VENU2-88").trim().toUpperCase();

    // Ensure record exists
    this.evaluateDeviceLicense(normId, {
      syncKey,
      label: options.label,
      nowMs
    });

    const db = this._readDb();
    const rec = db.devices[normId];
    const activationKey = this.generateActivationKey(normId);
    rec.issuedKey = activationKey;
    if (options.label) rec.label = options.label;
    if (options.notes !== undefined) rec.notes = options.notes;
    if (options.syncKey) rec.syncKey = syncKey;

    if (options.autoActivate) {
      rec.status = "ACTIVE";
      rec.activatedKey = activationKey;
      rec.activatedAt = new Date(nowMs).toISOString();
    }

    this._appendAudit(
      db,
      options.actor || this.ownerEmail,
      options.autoActivate ? "KEY_GENERATED_AND_ACTIVATED" : "KEY_GENERATED",
      normId,
      `Generated key ${activationKey} for device ${normId}${options.autoActivate ? " (auto-activated)" : ""}`
    );
    this._writeDb(db);

    return {
      ok: true,
      deviceId: normId,
      activationKey,
      device: this._computeRecordState(rec, nowMs)
    };
  }

  /**
   * Admin: update device lifecycle state (ACTIVATE, EXPIRE_TRIAL, RESET_TRIAL, EXTEND_TRIAL, DELETE)
   */
  adminUpdateDevice(deviceId, action, options = {}) {
    const normId = this.normalizeDeviceId(deviceId);
    const nowMs = options.nowMs || Date.now();
    this.evaluateDeviceLicense(normId, { syncKey: options.syncKey, nowMs });

    const db = this._readDb();
    const rec = db.devices[normId];
    if (!rec) {
      return { ok: false, error: `Device ${normId} not found` };
    }

    const act = String(action || "").toUpperCase();
    const expectedKey = this.generateActivationKey(normId);

    if (act === "ACTIVATE") {
      rec.status = "ACTIVE";
      rec.activatedKey = expectedKey;
      rec.issuedKey = expectedKey;
      rec.activatedAt = new Date(nowMs).toISOString();
      this._appendAudit(db, options.actor || this.ownerEmail, "ADMIN_ACTIVATE", normId, `Admin activated device ${normId}`);
    } else if (act === "EXPIRE_TRIAL" || act === "REVOKE") {
      rec.status = "EXPIRED";
      rec.activatedKey = "";
      rec.activatedAt = null;
      rec.trialExpiresMs = nowMs - 1000;
      this._appendAudit(
        db,
        options.actor || this.ownerEmail,
        "ADMIN_EXPIRE_TRIAL",
        normId,
        `Admin expired/revoked device ${normId} (triggers 14d expired lock screen)`
      );
    } else if (act === "RESET_TRIAL") {
      rec.status = "TRIAL";
      rec.activatedKey = "";
      rec.activatedAt = null;
      rec.trialStartMs = nowMs;
      rec.trialExpiresMs = nowMs + this.trialDays * DAY_MS;
      this._appendAudit(
        db,
        options.actor || this.ownerEmail,
        "ADMIN_RESET_TRIAL",
        normId,
        `Admin reset 14-day trial for device ${normId}`
      );
    } else if (act === "EXTEND_TRIAL") {
      const addDays = Math.max(1, Number(options.days) || 14);
      const baseMs = Math.max(nowMs, rec.trialExpiresMs || nowMs);
      rec.status = "TRIAL";
      rec.activatedKey = "";
      rec.activatedAt = null;
      rec.trialExpiresMs = baseMs + addDays * DAY_MS;
      this._appendAudit(
        db,
        options.actor || this.ownerEmail,
        "ADMIN_EXTEND_TRIAL",
        normId,
        `Admin extended trial by +${addDays} days for device ${normId}`
      );
    } else if (act === "DELETE") {
      delete db.devices[normId];
      this._appendAudit(db, options.actor || this.ownerEmail, "ADMIN_DELETE_DEVICE", normId, `Deleted device ${normId}`);
      this._writeDb(db);
      return { ok: true, deleted: true, deviceId: normId };
    } else {
      return { ok: false, error: `Unsupported action: ${act}` };
    }

    if (options.label) rec.label = options.label;
    if (options.notes !== undefined) rec.notes = options.notes;
    rec.lastSeenAt = new Date(nowMs).toISOString();
    this._writeDb(db);

    return {
      ok: true,
      deviceId: normId,
      device: this._computeRecordState(rec, nowMs)
    };
  }

  /**
   * Admin OTP Request & Verification for saharabu@scg.com + Cloudflare Access Integration
   */
  requestAdminOtp(email) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (cleanEmail !== this.ownerEmail.toLowerCase()) {
      return {
        ok: false,
        error: `Unauthorized admin email. Only ${this.ownerEmail} is permitted.`
      };
    }
    const code = String(crypto.randomInt(100000, 999999));
    const expiresAt = Date.now() + 10 * 60 * 1000;
    this.otpStore.set(cleanEmail, { code, expiresAt });

    const db = this._readDb();
    this._appendAudit(db, cleanEmail, "ADMIN_OTP_ISSUED", "-", `Issued 6-digit Admin OTP for ${cleanEmail}`);
    this._writeDb(db);

    return {
      ok: true,
      email: this.ownerEmail,
      otpCode: code, // Exposed for local/Cloudflare Zero Trust companion verification
      expiresInSec: 600
    };
  }

  verifyAdminOtp(email, code) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanCode = String(code || "").trim();
    if (cleanEmail !== this.ownerEmail.toLowerCase()) {
      return { ok: false, error: `Only ${this.ownerEmail} can access Venu2Moat Admin.` };
    }

    const stored = this.otpStore.get(cleanEmail);
    const masterPin = process.env.MOAT_ADMIN_PIN || "SCG-888888";
    const isValidOtp = stored && Date.now() <= stored.expiresAt && stored.code === cleanCode;
    const isMasterPin = cleanCode === masterPin;

    if (!isValidOtp && !isMasterPin) {
      return { ok: false, error: "Invalid or expired OTP code." };
    }

    this.otpStore.delete(cleanEmail);
    const session = this.createAdminSession(this.ownerEmail, isValidOtp ? "OTP_VERIFIED" : "ADMIN_PASSKEY");
    const db = this._readDb();
    this._appendAudit(db, this.ownerEmail, "ADMIN_LOGIN_SUCCESS", "-", `Admin authenticated via ${session.authMethod}`);
    this._writeDb(db);

    return {
      ok: true,
      ...session
    };
  }

  createAdminSession(email, authMethod = "CLOUDFLARE_OTP") {
    const token = crypto.randomBytes(24).toString("hex");
    const now = Date.now();
    const session = {
      token,
      email,
      authMethod,
      createdAt: new Date(now).toISOString(),
      expiresAt: now + 12 * 60 * 60 * 1000
    };
    this.sessions.set(token, session);
    return session;
  }

  verifyAdminRequest(req) {
    // 1. Check Cloudflare Access Zero Trust Authenticated Email Header
    const cfEmail = String(req.headers["cf-access-authenticated-user-email"] || "").trim().toLowerCase();
    if (cfEmail && cfEmail === this.ownerEmail.toLowerCase()) {
      return {
        authenticated: true,
        email: this.ownerEmail,
        authMethod: "CLOUDFLARE_ACCESS_OTP"
      };
    }

    // 2. Check Bearer token from Admin OTP session
    const authHeader = String(req.headers["authorization"] || "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : String(req.headers["x-admin-token"] || "").trim();
    if (token && this.sessions.has(token)) {
      const sess = this.sessions.get(token);
      if (Date.now() <= sess.expiresAt) {
        return {
          authenticated: true,
          email: sess.email,
          authMethod: sess.authMethod
        };
      }
      this.sessions.delete(token);
    }

    return {
      authenticated: false,
      ownerEmail: this.ownerEmail,
      cfProtected: Boolean(req.headers["cf-ray"])
    };
  }
}

module.exports = {
  LicenseManager,
  OWNER_EMAIL,
  TRIAL_DAYS
};
