const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const OWNER_EMAIL = "saharat.bun@icloud.com";
const NOTIFY_EMAIL = "e24qdy2@gmail.com";
const TRIAL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SECRET = process.env.MOAT_LICENSE_SECRET || "venu2moat-saharat-bun-hmac-2026-secret-key";
const DEFAULT_ADMIN_PASSWORD = process.env.MOAT_ADMIN_PASSWORD || "MOAT-888888";

class LicenseManager {
  constructor(options = {}) {
    this.dataFile = options.dataFile || path.join(__dirname, "..", "data", "licenses.json");
    this.secret = options.secret || DEFAULT_SECRET;
    this.ownerEmail = options.ownerEmail || OWNER_EMAIL;
    this.notifyEmail = options.notifyEmail || NOTIFY_EMAIL;
    this.trialDays = options.trialDays || TRIAL_DAYS;
    this.defaultAdminPassword = options.defaultAdminPassword || DEFAULT_ADMIN_PASSWORD;
    this.otpStore = new Map(); // email -> { code, expiresAt }
    this.sessions = new Map(); // token -> { email, createdAt, expiresAt, authMethod }
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
    }
    return db.adminAuth;
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
        notifyEmail: this.notifyEmail,
        trialDays: this.trialDays,
        adminAuth: this._createDefaultAdminAuth(new Date(now).toISOString()),
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
      fs.writeFileSync(this.dataFile, JSON.stringify(initialData, null, 2), "utf8");
    }
  }

  _readDb() {
    this._ensureDataFile();
    try {
      const db = JSON.parse(fs.readFileSync(this.dataFile, "utf8"));
      if (!Array.isArray(db.customerRequests)) db.customerRequests = [];
      if (!Array.isArray(db.emailLogs)) db.emailLogs = [];
      if (!Array.isArray(db.auditLogs)) db.auditLogs = [];
      if (!db.devices) db.devices = {};
      return db;
    } catch (e) {
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
      notifyEmail: this.notifyEmail,
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
   * User/Web: Submit a Trial Key Extend Request or Purchase License Request
   */
  createCustomerRequest(payload = {}, options = {}) {
    const nowMs = options.nowMs || Date.now();
    const normId = this.normalizeDeviceId(payload.deviceId || "V2-88VENU20");
    const syncKey = String(payload.syncKey || "VENU2-88").trim().toUpperCase();
    const rawType = String(payload.requestType || "PURCHASE_LICENSE").trim().toUpperCase();
    const requestType = rawType === "TRIAL_EXTEND" ? "TRIAL_EXTEND" : "PURCHASE_LICENSE";

    const contactName = String(payload.contactName || "").trim();
    const contactEmail = String(payload.contactEmail || "").trim();
    const contactPhone = String(payload.contactPhone || "").trim();
    const message = String(payload.message || "").trim();
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
      contactName: contactName || "Garmin Venu 2 User",
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
      device: this._computeRecordState(rec, nowMs)
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
      deviceUpdate: updateResult
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
   * Admin Password Login & Change Password (with Current Password Verification)
   */
  getAdminAuthMeta() {
    const db = this._readDb();
    const adminAuth = this._ensureAdminAuth(db);
    return {
      ownerEmail: this.ownerEmail,
      notifyEmail: this.notifyEmail,
      passwordUpdatedAt: adminAuth.updatedAt,
      isDefaultPassword: Boolean(adminAuth.isDefaultPassword)
    };
  }

  loginAdminWithPassword(email, password) {
    const cleanEmail = String(email || this.ownerEmail).trim().toLowerCase();
    const rawPassword = String(password ?? "").trim();

    if (cleanEmail !== this.ownerEmail.toLowerCase()) {
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
      this._appendAudit(
        db,
        this.ownerEmail,
        "ADMIN_LOGIN_FAILED",
        "-",
        "พยายามเข้าสู่ระบบผู้ดูแลด้วยรหัสผ่านไม่ถูกต้อง (Invalid Admin Password)"
      );
      this._writeDb(db);
      return {
        ok: false,
        error: "รหัสผ่านผู้ดูแลระบบไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง (Invalid Admin Password)"
      };
    }

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
    db.adminAuth = {
      salt: newSalt,
      passwordHash: this._hashPassword(rawNew, newSalt),
      updatedAt,
      isDefaultPassword: rawNew === this.defaultAdminPassword
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
      isDefaultPassword: db.adminAuth.isDefaultPassword
    };
  }

  /**
   * Legacy OTP Request & Verification (retained for backward API compatibility)
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
      otpCode: code,
      expiresInSec: 600
    };
  }

  verifyAdminOtp(email, code) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanCode = String(code || "").trim();
    if (cleanEmail !== this.ownerEmail.toLowerCase()) {
      return { ok: false, error: `Only ${this.ownerEmail} can access Venu2Moat Admin.` };
    }

    const db = this._readDb();
    const adminAuth = this._ensureAdminAuth(db);
    const isPasswordMatch = this._verifyPasswordHash(cleanCode, adminAuth.salt, adminAuth.passwordHash);

    const stored = this.otpStore.get(cleanEmail);
    const isValidOtp = stored && Date.now() <= stored.expiresAt && stored.code === cleanCode;

    if (!isValidOtp && !isPasswordMatch) {
      return { ok: false, error: "Invalid password or OTP code." };
    }

    this.otpStore.delete(cleanEmail);
    const session = this.createAdminSession(this.ownerEmail, isPasswordMatch ? "ADMIN_PASSWORD" : "OTP_VERIFIED");
    this._appendAudit(db, this.ownerEmail, "ADMIN_LOGIN_SUCCESS", "-", `Admin authenticated via ${session.authMethod}`);
    this._writeDb(db);

    return {
      ok: true,
      ...session
    };
  }

  createAdminSession(email, authMethod = "ADMIN_PASSWORD") {
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
        authMethod: "CLOUDFLARE_ZERO_TRUST"
      };
    }

    // 2. Check Bearer token from Admin Password session
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
      notifyEmail: this.notifyEmail,
      cfProtected: Boolean(req.headers["cf-ray"])
    };
  }
}

module.exports = {
  LicenseManager,
  OWNER_EMAIL,
  NOTIFY_EMAIL,
  TRIAL_DAYS,
  DEFAULT_ADMIN_PASSWORD
};
