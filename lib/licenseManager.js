const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("./envLoader");

const OWNER_EMAIL = process.env.OWNER_EMAIL || "saharat.bun@icloud.com";
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "e24qdy2@gmail.com";
const TRIAL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

// Ephemeral fallback secret used ONLY if no .env or options.secret is supplied (lazily generated outside global scope for Cloudflare Workers compatibility)
let _runtimeFallbackSecret = null;
let _runtimeFallbackAdminPwd = null;
function getRuntimeFallbackSecret() {
  if (!_runtimeFallbackSecret) {
    _runtimeFallbackSecret = crypto.randomBytes(32).toString("hex");
  }
  return _runtimeFallbackSecret;
}
function getRuntimeFallbackAdminPwd() {
  if (!_runtimeFallbackAdminPwd) {
    _runtimeFallbackAdminPwd = crypto.randomBytes(12).toString("base64url");
  }
  return _runtimeFallbackAdminPwd;
}

const BASE_DIR = typeof __dirname !== "undefined" ? __dirname : ".";

class LicenseManager {
  constructor(options = {}) {
    this.dataFile = options.dataFile || path.join(BASE_DIR, "..", "data", "licenses.json");
    this.secret = options.secret || process.env.LICENSE_HMAC_SECRET || process.env.MOAT_LICENSE_SECRET || getRuntimeFallbackSecret();
    this.ownerEmail = options.ownerEmail || OWNER_EMAIL;
    this.notifyEmail = options.notifyEmail || NOTIFY_EMAIL;
    this.trialDays = options.trialDays || TRIAL_DAYS;
    this.defaultAdminPassword =
      options.defaultAdminPassword ||
      process.env.ADMIN_INITIAL_PASSWORD ||
      process.env.MOAT_ADMIN_PASSWORD ||
      getRuntimeFallbackAdminPwd();

    // Security controls (VA-02, VA-03, VA-05)
    this.trustCfAccessHeader =
      options.trustCfAccessHeader !== undefined
        ? Boolean(options.trustCfAccessHeader)
        : process.env.TRUST_CF_ACCESS_HEADER === "true";
    this.enableLegacyOtp = Boolean(options.enableLegacyOtp);
    this.maxLoginAttempts = Number(options.maxLoginAttempts || 5);
    this.lockoutDurationMs = Number(options.lockoutDurationMs || 15 * 60 * 1000);

    this.otpStore = new Map(); // email -> { code, expiresAt }
    this.sessions = new Map(); // token -> { email, createdAt, expiresAt, authMethod }
    this.revokedTokens = new Set(); // revoked session tokens
    this.loginLockouts = new Map(); // clientKey -> { count, firstFailedAt, lockedUntil }
    this.memoryMode = Boolean(options.memoryDb || options.serverless);
    this.memoryDb = options.memoryDb ? JSON.parse(JSON.stringify(options.memoryDb)) : null;
    this.onWriteDb = typeof options.onWriteDb === "function" ? options.onWriteDb : null;
    this._ensureDataFile();
  }

  _hashPassword(password, salt) {
    return crypto.scryptSync(String(password), String(salt), 64).toString("hex");
  }

  _verifyPasswordHash(password, salt, expectedHash) {
    if (!salt || !expectedHash) return false;
    const candidateHash = this._hashPassword(password, salt);
    const a = Buffer.from(candidateHash, "hex");
    const b = Buffer.from(String(expectedHash), "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  _createDefaultAdminAuth(nowIso = new Date().toISOString()) {
    const salt = crypto.randomBytes(16).toString("hex");
    return {
      salt,
      passwordHash: this._hashPassword(this.defaultAdminPassword, salt),
      updatedAt: nowIso,
      isDefaultPassword: true
    };
  }

  _ensureAdminAuth(db) {
    if (!db.adminAuth || !db.adminAuth.salt || !db.adminAuth.passwordHash) {
      db.adminAuth = this._createDefaultAdminAuth();
      this._writeDb(db);
    } else if (
      db.adminAuth.isDefaultPassword &&
      !this._verifyPasswordHash(this.defaultAdminPassword, db.adminAuth.salt, db.adminAuth.passwordHash)
    ) {
      // Sync initial password hash with current .env ADMIN_INITIAL_PASSWORD when still in default state
      db.adminAuth = this._createDefaultAdminAuth();
      this._writeDb(db);
    }
    return db.adminAuth;
  }

  _buildInitialDb(now = Date.now()) {
    const seedDeviceId = "V2-88VENU20";
    return {
      ownerEmail: this.ownerEmail,
      notifyEmail: this.notifyEmail,
      trialDays: this.trialDays,
      adminAuth: this._createDefaultAdminAuth(new Date(now).toISOString()),
      devices: {
        [seedDeviceId]: {
          deviceId: seedDeviceId,
          label: "Garmin Watch (Primary USB Device)",
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
      customerRequests: [],
      emailLogs: [],
      auditLogs: [
        {
          id: "AUD-INIT",
          timestamp: new Date(now).toISOString(),
          actor: "system",
          action: "SYSTEM_INIT",
          deviceId: seedDeviceId,
          detail: `Initialized 14-day trial licensing engine (Owner: ${this.ownerEmail}, Notify: ${this.notifyEmail})`
        }
      ]
    };
  }

  _ensureDataFile() {
    if (this.memoryMode) {
      if (!this.memoryDb || typeof this.memoryDb !== "object") {
        this.memoryDb = this._buildInitialDb();
      }
      if (!Array.isArray(this.memoryDb.customerRequests)) this.memoryDb.customerRequests = [];
      if (!Array.isArray(this.memoryDb.emailLogs)) this.memoryDb.emailLogs = [];
      if (!Array.isArray(this.memoryDb.auditLogs)) this.memoryDb.auditLogs = [];
      if (!this.memoryDb.devices) this.memoryDb.devices = {};
      this._ensureAdminAuth(this.memoryDb);
      return;
    }
    const dir = path.dirname(this.dataFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.dataFile)) {
      const initialData = this._buildInitialDb();
      fs.writeFileSync(this.dataFile, JSON.stringify(initialData, null, 2), "utf8");
    } else {
      const db = this._readDb();
      this._ensureAdminAuth(db);
    }
  }

  readDb() {
    return this._readDb();
  }

  writeDb(db) {
    return this._writeDb(db);
  }

  _readDb() {
    if (this.memoryMode) {
      if (!this.memoryDb || typeof this.memoryDb !== "object") {
        this.memoryDb = this._buildInitialDb();
      }
      if (!Array.isArray(this.memoryDb.customerRequests)) this.memoryDb.customerRequests = [];
      if (!Array.isArray(this.memoryDb.emailLogs)) this.memoryDb.emailLogs = [];
      if (!Array.isArray(this.memoryDb.auditLogs)) this.memoryDb.auditLogs = [];
      if (!this.memoryDb.devices) this.memoryDb.devices = {};
      return this.memoryDb;
    }
    const dir = path.dirname(this.dataFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    try {
      if (!fs.existsSync(this.dataFile)) {
        return {
          ownerEmail: this.ownerEmail,
          notifyEmail: this.notifyEmail,
          trialDays: this.trialDays,
          devices: {},
          customerRequests: [],
          emailLogs: [],
          auditLogs: []
        };
      }
      const db = JSON.parse(fs.readFileSync(this.dataFile, "utf8"));
      if (!Array.isArray(db.customerRequests)) db.customerRequests = [];
      if (!Array.isArray(db.emailLogs)) db.emailLogs = [];
      if (!Array.isArray(db.auditLogs)) db.auditLogs = [];
      if (!db.devices) db.devices = {};
      return db;
    } catch (_e) {
      return {
        ownerEmail: this.ownerEmail,
        notifyEmail: this.notifyEmail,
        trialDays: this.trialDays,
        devices: {},
        customerRequests: [],
        emailLogs: [],
        auditLogs: []
      };
    }
  }

  _writeDb(db) {
    db.ownerEmail = this.ownerEmail;
    db.notifyEmail = this.notifyEmail;
    if (this.memoryMode) {
      this.memoryDb = db;
      if (this.onWriteDb) {
        try {
          this.onWriteDb(db);
        } catch (_e) {
          // ignore callback errors
        }
      }
      return;
    }
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
      return "GM-" + cleaned.replace(/-/g, "").slice(-8);
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
      Boolean(rec.activatedKey) &&
      (this.normalizeKey(rec.activatedKey) === expectedKey || Boolean(rec.activatedAt) || Boolean(rec.allowCustomKey));

    if (hasValidActivatedKey) {
      return {
        deviceId: rec.deviceId,
        label: rec.label || "Garmin Watch",
        syncKey: rec.syncKey || "VENU2-88",
        status: "ACTIVE",
        isActivated: true,
        isExpired: false,
        trialDaysTotal: this.trialDays,
        remainingDays: 9999,
        remainingHours: 99999,
        trialStartAt: new Date(rec.trialStartMs || nowMs).toISOString(),
        trialExpiresAt: new Date(rec.trialExpiresMs || nowMs).toISOString(),
        activatedAt: rec.activatedAt,
        activatedKey: expectedKey,
        issuedKey: expectedKey,
        ownerEmail: this.ownerEmail,
        notifyEmail: this.notifyEmail,
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
      label: rec.label || "Garmin Watch",
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
      issuedKey: expectedKey,
      ownerEmail: this.ownerEmail,
      notifyEmail: this.notifyEmail,
      firstSeenAt: rec.firstSeenAt,
      lastSeenAt: rec.lastSeenAt,
      notes: rec.notes || ""
    };
  }

  /**
   * Public-safe device state (strips issuedKey so unauthenticated callers cannot see the activation key!)
   */
  toPublicLicenseState(fullState) {
    if (!fullState) return null;
    const safeCopy = { ...fullState };
    delete safeCopy.issuedKey;
    if (!safeCopy.isActivated) {
      safeCopy.activatedKey = "";
    }
    return safeCopy;
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
        label: options.label || `Garmin Watch (${normId})`,
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
      public: this.toPublicLicenseState(full),
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
      license: evaluated.public,
      watch: evaluated.watch
    };
  }

  /**
   * User/Web: Submit a Trial Key Extend Request or Purchase License Request
   */
  createCustomerRequest(payload = {}, options = {}) {
    const nowMs = options.nowMs || Date.now();
    const normId = this.normalizeDeviceId(payload.deviceId || "V2-88VENU20");
    const syncKey = String(payload.syncKey || "VENU2-88").trim().toUpperCase();
    const rawType = String(payload.requestType || "PURCHASE_LICENSE").trim().toUpperCase();
    const requestType = rawType === "TRIAL_EXTEND" ? "TRIAL_EXTEND" : "PURCHASE_LICENSE";

    const contactName = String(payload.contactName || "").trim().slice(0, 120);
    const contactEmail = String(payload.contactEmail || "").trim().slice(0, 160);
    const contactPhone = String(payload.contactPhone || "").trim().slice(0, 120);
    const message = String(payload.message || "").trim().slice(0, 600);
    const requestedExtendDays = Math.max(1, Math.min(30, Number(payload.requestedExtendDays) || 7));

    if (!contactName && !contactEmail && !contactPhone) {
      return {
        ok: false,
        error: "กรุณาระบุชื่อ อีเมล หรือเบอร์ติดต่อกลับอย่างน้อย 1 ช่องทาง (Contact info is required)"
      };
    }

    // Ensure device exists in DB
    this.evaluateDeviceLicense(normId, { syncKey, nowMs });

    const db = this._readDb();
    const reqRecord = {
      id: "REQ-" + crypto.randomBytes(3).toString("hex").toUpperCase(),
      requestType,
      status: "PENDING",
      deviceId: normId,
      syncKey,
      contactName: contactName || "Garmin Watch User",
      contactEmail: contactEmail || "-",
      contactPhone: contactPhone || "-",
      requestedExtendDays: requestType === "TRIAL_EXTEND" ? requestedExtendDays : 0,
      message:
        message ||
        (requestType === "TRIAL_EXTEND"
          ? `ขอต่ออายุทดลองใช้ (Trial Key Extend +${requestedExtendDays} วัน)`
          : "สนใจสั่งซื้อ License ถาวร (PRO Version) กรุณาติดต่อกลับ"),
      createdAt: new Date(nowMs).toISOString(),
      resolvedAt: null,
      resolvedBy: null,
      resolutionNote: ""
    };

    db.customerRequests.unshift(reqRecord);
    if (db.customerRequests.length > 100) {
      db.customerRequests = db.customerRequests.slice(0, 100);
    }

    this._appendAudit(
      db,
      contactEmail || contactName || "web-customer",
      requestType === "TRIAL_EXTEND" ? "TRIAL_EXTEND_REQUESTED" : "PURCHASE_REQUEST_SUBMITTED",
      normId,
      `${requestType} (${reqRecord.id}) by ${reqRecord.contactName} (${reqRecord.contactEmail} / ${reqRecord.contactPhone}) -> notified ${this.notifyEmail}`
    );
    this._writeDb(db);

    const rec = db.devices[normId];
    return {
      ok: true,
      request: reqRecord,
      device: this.toPublicLicenseState(this._computeRecordState(rec, nowMs))
    };
  }

  /**
   * Admin: Resolve a Customer Request (Approve +7d, Approve +14d, Activate PRO, or Reject)
   */
  resolveCustomerRequest(requestId, action, options = {}) {
    const cleanId = String(requestId || "").trim().toUpperCase();
    const act = String(action || "").trim().toUpperCase();
    const nowMs = options.nowMs || Date.now();
    const actor = options.actor || this.ownerEmail;

    const db = this._readDb();
    const reqIdx = (db.customerRequests || []).findIndex((r) => String(r.id).toUpperCase() === cleanId);
    if (reqIdx === -1) {
      return { ok: false, error: `Customer request ${cleanId} not found` };
    }

    const reqRec = db.customerRequests[reqIdx];
    let updateResult = null;
    let resolutionNote = "";

    if (act === "APPROVE_EXTEND_7") {
      updateResult = this.adminUpdateDevice(reqRec.deviceId, "EXTEND_TRIAL", {
        days: 7,
        syncKey: reqRec.syncKey,
        actor,
        nowMs
      });
      resolutionNote = "Approved Trial Extend +7 Days";
    } else if (act === "APPROVE_EXTEND_14") {
      updateResult = this.adminUpdateDevice(reqRec.deviceId, "EXTEND_TRIAL", {
        days: 14,
        syncKey: reqRec.syncKey,
        actor,
        nowMs
      });
      resolutionNote = "Approved Trial Extend +14 Days";
    } else if (act === "APPROVE_PURCHASE_ACTIVATE") {
      updateResult = this.issueDeviceKey(reqRec.deviceId, {
        syncKey: reqRec.syncKey,
        autoActivate: true,
        actor,
        nowMs
      });
      resolutionNote = `Approved Purchase & Activated PRO (${updateResult.activationKey})`;
    } else if (act === "REJECT") {
      resolutionNote = options.note || "Rejected by Admin";
    } else {
      return { ok: false, error: `Unsupported request resolution action: ${act}` };
    }

    // Re-read db after device update so we don't clobber device changes
    const freshDb = this._readDb();
    const target = (freshDb.customerRequests || []).find((r) => String(r.id).toUpperCase() === cleanId);
    if (target) {
      target.status = act === "REJECT" ? "REJECTED" : "APPROVED";
      target.resolvedAt = new Date(nowMs).toISOString();
      target.resolvedBy = actor;
      target.resolutionNote = resolutionNote;
    }

    this._appendAudit(
      freshDb,
      actor,
      "CUSTOMER_REQUEST_RESOLVED",
      reqRec.deviceId,
      `Resolved ${cleanId} with ${act}: ${resolutionNote}`
    );
    this._writeDb(freshDb);

    return {
      ok: true,
      request: target,
      deviceUpdate: updateResult,
      device: updateResult ? updateResult.device : null
    };
  }

  /**
   * Admin: list all devices, customer requests, email logs, and summary stats
   */
  listDevices(nowMs = Date.now()) {
    const db = this._readDb();
    const devices = Object.values(db.devices || {})
      .map((rec) => this._computeRecordState(rec, nowMs))
      .sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")));

    const customerRequests = (db.customerRequests || []).slice(0, 50);
    const pendingRequestsCount = customerRequests.filter((r) => r.status === "PENDING").length;

    const summary = {
      totalDevices: devices.length,
      activePaid: devices.filter((d) => d.status === "ACTIVE").length,
      activeTrial: devices.filter((d) => d.status === "TRIAL").length,
      expiredTrial: devices.filter((d) => d.status === "EXPIRED").length,
      pendingRequests: pendingRequestsCount,
      ownerEmail: this.ownerEmail,
      notifyEmail: this.notifyEmail,
      trialDays: this.trialDays
    };

    return {
      summary,
      devices,
      customerRequests,
      emailLogs: (db.emailLogs || []).slice(0, 30),
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
   * Brute-Force Lockout Check & Recording (VA-05)
   */
  _checkLoginLockout(clientKey = "default") {
    const key = String(clientKey || "default");
    const entry = this.loginLockouts.get(key);
    if (!entry) return { locked: false };
    const now = Date.now();
    if (entry.lockedUntil && now < entry.lockedUntil) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.lockedUntil - now) / 1000));
      return { locked: true, retryAfterSec };
    }
    if (now - entry.firstFailedAt > this.lockoutDurationMs) {
      this.loginLockouts.delete(key);
    }
    return { locked: false };
  }

  _recordLoginFailure(clientKey = "default", db = null) {
    const key = String(clientKey || "default");
    const now = Date.now();
    let entry = this.loginLockouts.get(key);
    if (!entry || now - entry.firstFailedAt > this.lockoutDurationMs) {
      entry = { count: 0, firstFailedAt: now, lockedUntil: 0 };
    }
    entry.count += 1;
    if (entry.count >= this.maxLoginAttempts) {
      entry.lockedUntil = now + this.lockoutDurationMs;
      if (db) {
        this._appendAudit(
          db,
          this.ownerEmail,
          "ADMIN_LOGIN_LOCKED_OUT",
          "-",
          `Locked out admin login for ${Math.round(this.lockoutDurationMs / 60000)}m after ${entry.count} failed attempts (${key})`
        );
      }
    }
    this.loginLockouts.set(key, entry);
    return entry;
  }

  /**
   * Admin Password Login & Change Password (with Current Password Verification)
   */
  getAdminAuthMeta(options = {}) {
    const db = this._readDb();
    const adminAuth = this._ensureAdminAuth(db);
    if (!options.authenticated) {
      // Never disclose passwordUpdatedAt or isDefaultPassword to unauthenticated requests (VA-06)
      return {
        ownerEmail: this.ownerEmail
      };
    }
    return {
      ownerEmail: this.ownerEmail,
      notifyEmail: this.notifyEmail,
      passwordUpdatedAt: adminAuth.updatedAt,
      isDefaultPassword: Boolean(adminAuth.isDefaultPassword)
    };
  }

  loginAdminWithPassword(email, password, options = {}) {
    const clientKey = options.clientIp || options.ip || "default";
    const lockState = this._checkLoginLockout(clientKey);
    if (lockState.locked) {
      return {
        ok: false,
        locked: true,
        lockedOut: true,
        retryAfterSec: lockState.retryAfterSec,
        error: `ระงับการเข้าสู่ระบบชั่วคราวเนื่องจากใส่รหัสผ่านผิดเกิน ${this.maxLoginAttempts} ครั้ง กรุณารอ ${lockState.retryAfterSec} วินาที (Account temporarily locked)`
      };
    }

    const cleanEmail = String(email || this.ownerEmail).trim().toLowerCase();
    const rawPassword = String(password ?? "").trim();

    if (cleanEmail !== this.ownerEmail.toLowerCase()) {
      this._recordLoginFailure(clientKey);
      return {
        ok: false,
        error: `เฉพาะผู้ดูแลระบบ (${this.ownerEmail}) เท่านั้นที่ได้รับอนุญาต (Unauthorized admin email)`
      };
    }

    if (!rawPassword) {
      return {
        ok: false,
        error: "กรุณากรอกรหัสผ่านผู้ดูแลระบบ (Admin Password is required)"
      };
    }

    const db = this._readDb();
    const adminAuth = this._ensureAdminAuth(db);
    const valid = this._verifyPasswordHash(rawPassword, adminAuth.salt, adminAuth.passwordHash);

    if (!valid) {
      const failEntry = this._recordLoginFailure(clientKey, db);
      this._appendAudit(
        db,
        this.ownerEmail,
        "ADMIN_LOGIN_FAILED",
        "-",
        `พยายามเข้าสู่ระบบผู้ดูแลด้วยรหัสผ่านไม่ถูกต้อง (Attempt ${failEntry.count}/${this.maxLoginAttempts})`
      );
      this._writeDb(db);
      return {
        ok: false,
        remainingAttempts: Math.max(0, this.maxLoginAttempts - failEntry.count),
        error: "รหัสผ่านผู้ดูแลระบบไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง (Invalid Admin Password)"
      };
    }

    this.loginLockouts.delete(clientKey);
    const session = this.createAdminSession(this.ownerEmail, "ADMIN_PASSWORD");
    this._appendAudit(
      db,
      this.ownerEmail,
      "ADMIN_LOGIN_SUCCESS",
      "-",
      "Admin authenticated via ADMIN_PASSWORD"
    );
    this._writeDb(db);

    return {
      ok: true,
      ...session,
      passwordUpdatedAt: adminAuth.updatedAt,
      isDefaultPassword: Boolean(adminAuth.isDefaultPassword)
    };
  }

  changeAdminPassword(email, currentPassword, newPassword, confirmPassword) {
    const cleanEmail = String(email || this.ownerEmail).trim().toLowerCase();
    if (cleanEmail !== this.ownerEmail.toLowerCase()) {
      return {
        ok: false,
        error: `เฉพาะผู้ดูแลระบบ (${this.ownerEmail}) เท่านั้นที่สามารถเปลี่ยนรหัสผ่านได้`
      };
    }

    const rawCurrent = String(currentPassword ?? "").trim();
    const rawNew = String(newPassword ?? "").trim();
    const rawConfirm = confirmPassword !== undefined ? String(confirmPassword ?? "").trim() : rawNew;

    if (!rawCurrent) {
      return {
        ok: false,
        error: "กรุณากรอกรหัสผ่านเดิมเพื่อยืนยันตัวตน (Current password is required)"
      };
    }

    const db = this._readDb();
    const adminAuth = this._ensureAdminAuth(db);

    // 1. Verify current/old password against stored scrypt hash
    const isCurrentValid = this._verifyPasswordHash(rawCurrent, adminAuth.salt, adminAuth.passwordHash);
    if (!isCurrentValid) {
      this._appendAudit(
        db,
        this.ownerEmail,
        "ADMIN_PASSWORD_CHANGE_FAILED",
        "-",
        "เปลี่ยนรหัสผ่านไม่สำเร็จ: ยืนยันรหัสผ่านเดิมไม่ถูกต้อง (Invalid current password)"
      );
      this._writeDb(db);
      return {
        ok: false,
        error: "รหัสผ่านเดิมไม่ถูกต้อง กรุณาตรวจสอบรหัสผ่านปัจจุบันอีกครั้ง (Invalid current password)"
      };
    }

    // 2. Validate new password length & confirmation match
    if (rawNew.length < 6) {
      return {
        ok: false,
        error: "รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 6 ตัวอักษร (New password must be at least 6 characters)"
      };
    }

    if (rawNew !== rawConfirm) {
      return {
        ok: false,
        error: "รหัสผ่านใหม่และการยืนยันรหัสผ่านใหม่ไม่ตรงกัน (New password and confirmation do not match)"
      };
    }

    if (rawNew === rawCurrent) {
      return {
        ok: false,
        error: "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม (New password must be different from current password)"
      };
    }

    // 3. Generate new salt & scrypt hash, persist, and audit
    const newSalt = crypto.randomBytes(16).toString("hex");
    const updatedAt = new Date().toISOString();
    const isDefaultPassword = rawNew === this.defaultAdminPassword;
    db.adminAuth = {
      salt: newSalt,
      passwordHash: this._hashPassword(rawNew, newSalt),
      updatedAt,
      isDefaultPassword
    };

    this._appendAudit(
      db,
      this.ownerEmail,
      "ADMIN_PASSWORD_CHANGED",
      "-",
      "เปลี่ยนรหัสผ่านผู้ดูแลระบบสำเร็จ พร้อมยืนยันรหัสผ่านเดิมเรียบร้อยแล้ว (Admin password updated)"
    );
    this._writeDb(db);

    return {
      ok: true,
      message: "เปลี่ยนรหัสผ่านผู้ดูแลระบบเรียบร้อยแล้ว",
      passwordUpdatedAt: updatedAt,
      isDefaultPassword
    };
  }

  /**
   * Legacy OTP Request & Verification (Disabled by default per VA-02 remediation)
   */
  requestAdminOtp(email) {
    if (!this.enableLegacyOtp) {
      return {
        ok: false,
        disabled: true,
        error: "ระบบ OTP แบบเดิมถูกปิดใช้งานเพื่อความปลอดภัย กรุณาเข้าสู่ระบบด้วยรหัสผ่านผู้ดูแลระบบ (Admin Password Required)"
      };
    }
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
    return {
      ok: true,
      email: this.ownerEmail,
      expiresInSec: 600
    };
  }

  verifyAdminOtp(email, code) {
    if (!this.enableLegacyOtp) {
      return {
        ok: false,
        disabled: true,
        error: "ระบบ OTP แบบเดิมถูกปิดใช้งานเพื่อความปลอดภัย กรุณาเข้าสู่ระบบด้วยรหัสผ่านผู้ดูแลระบบ (Admin Password Required)"
      };
    }
    return this.loginAdminWithPassword(email, code);
  }

  createAdminSession(email, authMethod = "ADMIN_PASSWORD") {
    const now = Date.now();
    const expiresAt = now + 12 * 60 * 60 * 1000;
    const createdAt = new Date(now).toISOString();
    const payloadObj = {
      email,
      authMethod,
      createdAt,
      expiresAt,
      jti: crypto.randomBytes(12).toString("hex")
    };
    const payloadB64 = Buffer.from(JSON.stringify(payloadObj), "utf8").toString("base64url");
    const sig = crypto
      .createHmac("sha256", this.secret)
      .update(`ADMIN_SESSION_V1:${payloadB64}`)
      .digest("base64url");
    const token = `ms1.${payloadB64}.${sig}`;
    const session = {
      token,
      email,
      authMethod,
      createdAt,
      expiresAt
    };
    this.sessions.set(token, session);
    return session;
  }

  _verifySignedSessionToken(token) {
    if (!token || typeof token !== "string" || !token.startsWith("ms1.")) return null;
    if (this.revokedTokens && this.revokedTokens.has(token)) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payloadB64 = parts[1];
    const providedSig = parts[2];
    const expectedSig = crypto
      .createHmac("sha256", this.secret)
      .update(`ADMIN_SESSION_V1:${payloadB64}`)
      .digest("base64url");
    const a = Buffer.from(providedSig, "utf8");
    const b = Buffer.from(expectedSig, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
      const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
      if (!payload || !payload.email || !payload.expiresAt) return null;
      if (Date.now() > Number(payload.expiresAt)) return null;
      return payload;
    } catch (_e) {
      return null;
    }
  }

  _extractTokenFromRequest(req) {
    if (!req || !req.headers) return "";
    const authHeader = String(req.headers["authorization"] || "");
    if (authHeader.startsWith("Bearer ")) {
      return authHeader.slice(7).trim();
    }
    if (req.headers["x-admin-token"]) {
      return String(req.headers["x-admin-token"]).trim();
    }
    // Check HttpOnly Cookie (__moat_admin_session)
    const rawCookie = String(req.headers["cookie"] || "");
    if (rawCookie) {
      const pairs = rawCookie.split(";");
      for (const pair of pairs) {
        const eq = pair.indexOf("=");
        if (eq > 0) {
          const k = pair.slice(0, eq).trim();
          const v = pair.slice(eq + 1).trim();
          if (k === "__moat_admin_session" && v) {
            return decodeURIComponent(v);
          }
        }
      }
    }
    return "";
  }

  logoutAdminSession(req) {
    const token = typeof req === "string" ? req : this._extractTokenFromRequest(req);
    if (!token) return false;
    let existed = false;
    if (this.sessions.has(token)) {
      this.sessions.delete(token);
      existed = true;
    }
    if (token.startsWith("ms1.")) {
      this.revokedTokens.add(token);
      existed = true;
    }
    return existed;
  }

  verifyAdminRequest(req) {
    // 1. Check Cloudflare Access Zero Trust ONLY if explicitly enabled AND JWT assertion header is present (VA-03 fix)
    if (this.trustCfAccessHeader) {
      const cfEmail = String(req.headers["cf-access-authenticated-user-email"] || "").trim().toLowerCase();
      const cfJwt = String(req.headers["cf-access-jwt-assertion"] || "").trim();
      if (cfEmail && cfJwt && cfEmail === this.ownerEmail.toLowerCase()) {
        return {
          authenticated: true,
          email: this.ownerEmail,
          authMethod: "CLOUDFLARE_ZERO_TRUST"
        };
      }
    }

    // 2. Check Bearer token or HttpOnly session cookie from Admin Password session
    const token = this._extractTokenFromRequest(req);
    if (token && (!this.revokedTokens || !this.revokedTokens.has(token))) {
      if (this.sessions.has(token)) {
        const sess = this.sessions.get(token);
        if (Date.now() <= sess.expiresAt) {
          return {
            authenticated: true,
            email: sess.email,
            authMethod: sess.authMethod
          };
        }
        this.sessions.delete(token);
      } else {
        const signed = this._verifySignedSessionToken(token);
        if (signed) {
          return {
            authenticated: true,
            email: signed.email,
            authMethod: signed.authMethod || "ADMIN_PASSWORD"
          };
        }
      }
    }

    return {
      authenticated: false,
      ownerEmail: this.ownerEmail,
      cfProtected: Boolean(req.headers && req.headers["cf-ray"])
    };
  }
}

module.exports = {
  LicenseManager,
  OWNER_EMAIL,
  NOTIFY_EMAIL,
  TRIAL_DAYS
};
