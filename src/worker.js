import licenseMod from "../lib/licenseManager.js";
import emailMod from "../lib/emailService.js";
import garminMod from "../lib/garminDevices.js";
import moatEngineMod from "../lib/moatEngine.js";
import seedMod from "./seedData.js";

const { LicenseManager, OWNER_EMAIL, NOTIFY_EMAIL, TRIAL_DAYS } = licenseMod;
const { EmailService } = emailMod;
const { COMPATIBLE_GARMIN_DEVICES } = garminMod;
const {
  DEFAULT_WATCH_SETTINGS,
  SECURITY_HEADERS,
  FALLBACK_BASE,
  clearMarketCache,
  sanitizeWatchSettings: sanitizeWatchSettingsCore,
  deriveDeviceIdForSyncKey,
  createIsolatedProfile,
  ensureIsolatedProfileSettings,
  resolveWatchProfile,
  normalizePortfoliosInput,
  defaultFetchJson,
  fetchSymbolMarketData,
  buildEnrichedPayload: buildEnrichedPayloadCore
} = moatEngineMod;
const { INITIAL_PORTFOLIOS_STORE, INITIAL_LICENSES_STORE } = seedMod;

// In-memory state per Worker isolate, hydrated from D1 or KV if bound, or seeded from INITIAL_*_STORE
let runtimePortfoliosStore = null;
let runtimeLicensesStore = null;
let runtimeHydrated = false;
let licenseManagerInstance = null;
let emailServiceInstance = null;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

async function ensureStoreHydrated(env) {
  if (runtimeHydrated && runtimePortfoliosStore && runtimeLicensesStore && licenseManagerInstance && emailServiceInstance) {
    return;
  }

  let loadedPortfolios = null;
  let loadedLicenses = null;

  // 1. Try Cloudflare D1 binding (`env.DB`)
  if (env && env.DB && typeof env.DB.prepare === "function") {
    try {
      await env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)"
      ).run();
      const pRow = await env.DB.prepare("SELECT value FROM kv_store WHERE key = ?").bind("portfolios").first();
      const lRow = await env.DB.prepare("SELECT value FROM kv_store WHERE key = ?").bind("licenses").first();
      if (pRow && pRow.value) loadedPortfolios = JSON.parse(pRow.value);
      if (lRow && lRow.value) loadedLicenses = JSON.parse(lRow.value);
    } catch (_) {
      // Fallback to KV or seed data
    }
  }

  // 2. Try Cloudflare KV binding (`env.MOAT_KV`)
  if ((!loadedPortfolios || !loadedLicenses) && env && env.MOAT_KV && typeof env.MOAT_KV.get === "function") {
    try {
      if (!loadedPortfolios) {
        const pRaw = await env.MOAT_KV.get("portfolios");
        if (pRaw) loadedPortfolios = JSON.parse(pRaw);
      }
      if (!loadedLicenses) {
        const lRaw = await env.MOAT_KV.get("licenses");
        if (lRaw) loadedLicenses = JSON.parse(lRaw);
      }
    } catch (_) {
      // Fallback to seed data
    }
  }

  runtimePortfoliosStore = loadedPortfolios || deepClone(INITIAL_PORTFOLIOS_STORE);
  runtimeLicensesStore = loadedLicenses || deepClone(INITIAL_LICENSES_STORE);

  // Repair default adminAuth if a previous cold start without explicit ADMIN_INITIAL_PASSWORD overwrote the seed hash
  if (
    runtimeLicensesStore &&
    runtimeLicensesStore.adminAuth &&
    runtimeLicensesStore.adminAuth.isDefaultPassword &&
    INITIAL_LICENSES_STORE.adminAuth &&
    runtimeLicensesStore.adminAuth.passwordHash !== INITIAL_LICENSES_STORE.adminAuth.passwordHash &&
    !(env && env.ADMIN_INITIAL_PASSWORD)
  ) {
    runtimeLicensesStore.adminAuth = deepClone(INITIAL_LICENSES_STORE.adminAuth);
    await persistKey(env, "licenses", runtimeLicensesStore);
  }

  // Persist initial seed into D1/KV if it wasn't there yet
  if (!loadedPortfolios) {
    await persistKey(env, "portfolios", runtimePortfoliosStore);
  }
  if (!loadedLicenses) {
    await persistKey(env, "licenses", runtimeLicensesStore);
  }

  const secret =
    (env && env.LICENSE_HMAC_SECRET) ||
    (typeof process !== "undefined" && process.env && process.env.LICENSE_HMAC_SECRET) ||
    "VENU2-MOAT-PROD-HMAC-2026-SAHARAT-READYBYTE-TOP";

  const defaultAdminPassword =
    (env && env.ADMIN_INITIAL_PASSWORD) ||
    (typeof process !== "undefined" && process.env && process.env.ADMIN_INITIAL_PASSWORD) ||
    "";

  licenseManagerInstance = new LicenseManager({
    serverless: true,
    memoryDb: runtimeLicensesStore,
    secret,
    defaultAdminPassword: defaultAdminPassword || undefined,
    onWriteDb: (updatedDb) => {
      runtimeLicensesStore = updatedDb;
    }
  });

  emailServiceInstance = new EmailService({
    serverless: true,
    ownerEmail: OWNER_EMAIL,
    notifyEmail: NOTIFY_EMAIL,
    getDb: () => licenseManagerInstance.readDb(),
    onWriteDb: (updatedDb) => {
      licenseManagerInstance.writeDb(updatedDb);
    }
  });

  runtimeHydrated = true;
}

async function persistKey(env, key, valueObj) {
  const serialized = JSON.stringify(valueObj);
  const now = new Date().toISOString();
  if (env && env.DB && typeof env.DB.prepare === "function") {
    try {
      await env.DB.prepare(
        "INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      )
        .bind(key, serialized, now)
        .run();
    } catch (_) {
      // Ignore D1 errors
    }
  }
  if (env && env.MOAT_KV && typeof env.MOAT_KV.put === "function") {
    try {
      await env.MOAT_KV.put(key, serialized);
    } catch (_) {
      // Ignore KV errors
    }
  }
}

async function flushStores(env, ctx) {
  const promise = Promise.all([
    persistKey(env, "portfolios", runtimePortfoliosStore),
    persistKey(env, "licenses", licenseManagerInstance ? licenseManagerInstance.readDb() : runtimeLicensesStore)
  ]);
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(promise);
  } else {
    await promise;
  }
}

function sanitizeWatchSettings(raw = {}, fallback = DEFAULT_WATCH_SETTINGS) {
  return sanitizeWatchSettingsCore(raw, fallback, licenseManagerInstance);
}

function getOrCreateProfile(syncKey) {
  const key = (syncKey || "VENU2-88").trim().toUpperCase();
  if (!runtimePortfoliosStore[key]) {
    const template = runtimePortfoliosStore["VENU2-88"] || INITIAL_PORTFOLIOS_STORE["VENU2-88"];
    runtimePortfoliosStore[key] = createIsolatedProfile(key, template, licenseManagerInstance);
  }
  ensureIsolatedProfileSettings(runtimePortfoliosStore[key], licenseManagerInstance);
  return runtimePortfoliosStore[key];
}

// Rate limiter per Worker isolate
const rateLimitBuckets = new Map();
function getClientIpFromHeaders(headers) {
  const cfIp = headers["cf-connecting-ip"];
  if (cfIp) return String(cfIp).trim();
  const xff = headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return "127.0.0.1";
}

function checkRateLimit(headers, bucketName, maxRequests = 20, windowMs = 5 * 60 * 1000) {
  const ip = getClientIpFromHeaders(headers);
  const key = `${bucketName}:${ip}`;
  const now = Date.now();
  const entry = rateLimitBuckets.get(key);
  if (!entry || now >= entry.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }
  entry.count += 1;
  if (entry.count > maxRequests) {
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return { allowed: false, retryAfterSec };
  }
  return { allowed: true, remaining: maxRequests - entry.count };
}

// Deep Module Delegation: Market Data, Technicals (SMA20/RSI14/BB), Earnings & 8KB Garmin Payload -> lib/moatEngine.js
async function buildEnrichedPayload(profile, queryOpts = {}) {
  return buildEnrichedPayloadCore(profile, queryOpts, {
    licenseManager: licenseManagerInstance,
    onSyncWatchSettings: (syncKey, nextSettings) => {
      if (runtimePortfoliosStore[syncKey]) {
        runtimePortfoliosStore[syncKey].watchSettings = nextSettings;
      }
    }
  });
}

function getAllowedAdminOrigin(headers) {
  const origin = String(headers["origin"] || "").trim();
  if (!origin) return "";
  try {
    const u = new URL(origin);
    if (
      u.hostname === "moat.readybyte.top" ||
      u.hostname === "admin-moat.readybyte.top" ||
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname.endsWith(".workers.dev")
    ) {
      return origin;
    }
  } catch (_) {
    // invalid origin
  }
  return "";
}

function jsonResponse(status, data, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token, X-Admin-Email",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "CDN-Cache-Control": "no-store",
      "Cloudflare-CDN-Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

function adminJsonResponse(reqHeaders, status, data, extraHeaders = {}) {
  const allowedOrigin = getAllowedAdminOrigin(reqHeaders);
  const corsHeaders = allowedOrigin
    ? {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Credentials": "true",
        Vary: "Origin"
      }
    : {};
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token, X-Admin-Email",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

async function parseRequestBody(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error("Invalid JSON body");
  }
}

export default {
  async fetch(request, env, ctx) {
    await ensureStoreHydrated(env);

    const urlObj = new URL(request.url);
    const pathname = urlObj.pathname;
    const query = Object.fromEntries(urlObj.searchParams.entries());
    const reqHeaders = {};
    request.headers.forEach((v, k) => {
      reqHeaders[k.toLowerCase()] = v;
    });
    const reqCompat = { headers: reqHeaders };
    const hostHeader = String(reqHeaders["host"] || urlObj.host || "").toLowerCase();
    const isAdminSubdomain = hostHeader.startsWith("admin-moat.");

    if (request.method === "OPTIONS") {
      if (pathname.startsWith("/api/admin/")) {
        return adminJsonResponse(reqHeaders, 200, { ok: true });
      }
      return jsonResponse(200, { ok: true });
    }

    if (pathname === "/favicon.ico" && request.method === "GET") {
      const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#0b1120"/><path d="M12 44 L24 30 L34 36 L52 18" stroke="#10b981" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="52" cy="18" r="4" fill="#34d399"/></svg>`;
      return new Response(svgIcon, {
        status: 200,
        headers: {
          ...SECURITY_HEADERS,
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=86400"
        }
      });
    }

    // 1. HEALTH & COMPATIBLE GARMIN DEVICES API
    if (pathname === "/api/health" && request.method === "GET") {
      return jsonResponse(200, {
        ok: true,
        service: "GarminMoat Portfolio Server",
        runtime: "cloudflare-workers",
        version: "2.3.0",
        trialDays: TRIAL_DAYS,
        compatibleDevicesCount: COMPATIBLE_GARMIN_DEVICES.length,
        timestamp: new Date().toISOString()
      });
    }

    if ((pathname === "/api/garmin/devices" || pathname === "/api/devices/compatible") && request.method === "GET") {
      return jsonResponse(200, {
        ok: true,
        count: COMPATIBLE_GARMIN_DEVICES.length,
        devices: COMPATIBLE_GARMIN_DEVICES
      });
    }

    // 2. GET FULL ENRICHED PORTFOLIO (For Web App + Simulator)
    if (pathname === "/api/portfolio" && request.method === "GET") {
      const syncKey = query.key || "VENU2-88";
      const profile = getOrCreateProfile(syncKey);
      const payload = await buildEnrichedPayload(profile, {
        deviceId: query.did || query.deviceId,
        activationKey: query.akey || query.licenseKey,
        watchModel: query.model || query.watchModel
      });
      await flushStores(env, ctx);
      return jsonResponse(200, payload);
    }

    // 2B. POST /api/refresh (Clear cache and return fresh quotes)
    if (pathname === "/api/refresh" && request.method === "POST") {
      const body = await parseRequestBody(request).catch(() => ({}));
      const syncKey = (body.syncKey || query.key || "VENU2-88").trim().toUpperCase();
      clearMarketCache();
      const profile = getOrCreateProfile(syncKey);
      const payload = await buildEnrichedPayload(profile);
      await flushStores(env, ctx);
      return jsonResponse(200, payload);
    }

    // 3. GET ULTRA-COMPACT GARMIN WATCH PAYLOAD
    if ((pathname === "/api/watch" || pathname.startsWith("/api/watch/")) && request.method === "GET") {
      const pathKey = pathname.startsWith("/api/watch/") ? pathname.replace("/api/watch/", "") : "";
      const rawSyncKey = pathKey || query.key || "";
      const rawDid = query.did || query.deviceId;
      const profile = resolveWatchProfile(
        runtimePortfoliosStore,
        rawSyncKey,
        rawDid,
        getOrCreateProfile,
        licenseManagerInstance
      );
      const payload = await buildEnrichedPayload(profile, {
        deviceId: rawDid,
        activationKey: query.akey || query.lkey || query.licenseKey,
        watchModel: query.model || query.mdl || query.watchModel
      });
      await flushStores(env, ctx);
      return jsonResponse(200, payload.watch);
    }

    // 4. SAVE / UPDATE PORTFOLIO & WATCH SETTINGS FROM WEB APP
    if (pathname === "/api/portfolio" && (request.method === "PUT" || request.method === "POST")) {
      try {
        const body = await parseRequestBody(request);
        const syncKey = (body.syncKey || query.key || "VENU2-88").trim().toUpperCase();
        const existing = getOrCreateProfile(syncKey);
        const nextWatchSettings = sanitizeWatchSettings(
          body.watchSettings || {},
          existing.watchSettings || DEFAULT_WATCH_SETTINGS
        );

        const normalizedPortfolios = normalizePortfoliosInput(body.portfolios, existing.portfolios);

        runtimePortfoliosStore[syncKey] = {
          syncKey,
          baseCurrency: body.baseCurrency === "USD" ? "USD" : "THB",
          updatedAt: new Date().toISOString(),
          watchSettings: nextWatchSettings,
          portfolios: normalizedPortfolios
        };
        const boundDid = nextWatchSettings.deviceId;
        if (boundDid && boundDid !== "V2-88VENU20" && boundDid !== syncKey && runtimePortfoliosStore[boundDid]) {
          runtimePortfoliosStore[boundDid] = {
            ...runtimePortfoliosStore[syncKey],
            syncKey: boundDid,
            watchSettings: {
              ...nextWatchSettings,
              activationKey: runtimePortfoliosStore[boundDid].watchSettings?.activationKey || nextWatchSettings.activationKey
            }
          };
        }
        const payload = await buildEnrichedPayload(runtimePortfoliosStore[syncKey], {
          deviceId: nextWatchSettings.deviceId,
          activationKey: nextWatchSettings.activationKey,
          watchModel: nextWatchSettings.watchModel
        });
        await flushStores(env, ctx);
        return jsonResponse(200, payload);
      } catch (err) {
        return jsonResponse(400, { error: err.message });
      }
    }

    // 5. QUOTE / SYMBOL LOOKUP FOR WEB FORM
    if (pathname === "/api/quote" && request.method === "GET") {
      const symbol = query.symbol || "NVDA";
      const data = await fetchSymbolMarketData(symbol);
      return jsonResponse(200, data);
    }

    // 5B. YAHOO FINANCE LIVE TICKER AUTOCOMPLETE SEARCH
    if (pathname === "/api/search" && request.method === "GET") {
      const q = String(query.q || "").trim();
      if (!q) {
        return jsonResponse(200, { results: [] });
      }
      try {
        const searchUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`;
        const json = await defaultFetchJson(searchUrl);
        const results = (json.quotes || [])
          .filter((item) => item.symbol && (item.quoteType === "EQUITY" || item.quoteType === "ETF" || item.quoteType === "CRYPTOCURRENCY" || item.quoteType === "INDEX" || item.quoteType === "MUTUALFUND"))
          .slice(0, 8)
          .map((item) => ({
            symbol: item.symbol,
            name: item.shortname || item.longname || item.symbol,
            exchange: item.exchDisp || item.exchange || "",
            type: item.quoteType || "EQUITY",
            currency: String(item.symbol).endsWith(".BK") ? "THB" : "USD"
          }));
        return jsonResponse(200, { results });
      } catch (_) {
        const qUpper = q.toUpperCase();
        const fallbackMatches = Object.entries(FALLBACK_BASE)
          .filter(([sym, info]) => sym.includes(qUpper) || info.name.toUpperCase().includes(qUpper))
          .slice(0, 6)
          .map(([sym, info]) => ({
            symbol: sym,
            name: info.name,
            exchange: sym.endsWith(".BK") ? "SET" : "NASDAQ/NYSE",
            type: "EQUITY",
            currency: info.currency
          }));
        return jsonResponse(200, { results: fallbackMatches });
      }
    }

    // 6. DEVICE LICENSE ACTIVATION & STATUS API (Customer-facing)
    if (pathname === "/api/device/activate" && request.method === "POST") {
      const rl = checkRateLimit(reqHeaders, "device_activate", 15, 5 * 60 * 1000);
      if (!rl.allowed) {
        return jsonResponse(
          429,
          { ok: false, error: `Too many activation attempts. Please wait ${rl.retryAfterSec}s.` },
          { "Retry-After": String(rl.retryAfterSec) }
        );
      }
      try {
        const body = await parseRequestBody(request);
        const syncKey = String(body.syncKey || "VENU2-88").trim().toUpperCase();
        const profile = getOrCreateProfile(syncKey);
        const deviceId = licenseManagerInstance.normalizeDeviceId(body.deviceId || profile.watchSettings.deviceId);
        const activationKey = licenseManagerInstance.normalizeKey(body.activationKey || "");

        const result = licenseManagerInstance.activateDevice(deviceId, activationKey, {
          syncKey,
          actor: "web-companion",
          label: body.label || ""
        });
        if (!result.ok) {
          await flushStores(env, ctx);
          return jsonResponse(400, result);
        }

        const effectiveActivatedKey = result.activatedKey || result.license?.activatedKey || activationKey;
        if (runtimePortfoliosStore[syncKey]) {
          runtimePortfoliosStore[syncKey].watchSettings = sanitizeWatchSettings(
            {
              ...runtimePortfoliosStore[syncKey].watchSettings,
              deviceId,
              activationKey: effectiveActivatedKey
            },
            runtimePortfoliosStore[syncKey].watchSettings
          );
        }

        const payload = await buildEnrichedPayload(getOrCreateProfile(syncKey), {
          deviceId,
          activationKey: effectiveActivatedKey
        });
        await flushStores(env, ctx);
        return jsonResponse(200, {
          ok: true,
          message: result.message,
          license: licenseManagerInstance.toPublicLicenseState(result.license),
          payload
        });
      } catch (err) {
        return jsonResponse(400, { ok: false, error: err.message });
      }
    }

    if (pathname === "/api/device/status" && request.method === "GET") {
      const syncKey = String(query.key || "VENU2-88").trim().toUpperCase();
      const profile = getOrCreateProfile(syncKey);
      const deviceId = licenseManagerInstance.normalizeDeviceId(
        query.did || query.deviceId || profile.watchSettings.deviceId
      );
      const activationKey = licenseManagerInstance.normalizeKey(
        query.akey || query.licenseKey || profile.watchSettings.activationKey || ""
      );
      const evaluated = licenseManagerInstance.evaluateDeviceLicense(deviceId, {
        syncKey,
        providedKey: activationKey
      });
      await flushStores(env, ctx);
      return jsonResponse(200, {
        watch: evaluated.watch,
        full: evaluated.public,
        public: evaluated.public
      });
    }

    // 6B. CUSTOMER REQUESTS (Trial Extension / Buy PRO License) + Email Notification
    if ((pathname === "/api/license/request" || pathname === "/api/device/request") && request.method === "POST") {
      const rl = checkRateLimit(reqHeaders, "device_request", 10, 5 * 60 * 1000);
      if (!rl.allowed) {
        return jsonResponse(
          429,
          { ok: false, error: `Too many requests. Please wait ${rl.retryAfterSec}s before submitting again.` },
          { "Retry-After": String(rl.retryAfterSec) }
        );
      }
      try {
        const body = await parseRequestBody(request);
        const syncKey = String(body.syncKey || "VENU2-88").trim().toUpperCase();
        const profile = getOrCreateProfile(syncKey);
        const deviceId = licenseManagerInstance.normalizeDeviceId(body.deviceId || profile.watchSettings.deviceId);

        const created = licenseManagerInstance.createCustomerRequest({
          ...body,
          deviceId,
          syncKey
        });
        if (!created.ok) {
          await flushStores(env, ctx);
          return jsonResponse(400, created);
        }

        const emailNotification = await emailServiceInstance.sendCustomerRequestEmail(created.request);
        const isTrialExtend = created.request.requestType === "TRIAL_EXTEND";
        await flushStores(env, ctx);

        return jsonResponse(200, {
          ok: true,
          message: isTrialExtend
            ? `ส่งคำขอต่ออายุทดลองใช้ (+${created.request.requestedExtendDays} วัน) เรียบร้อยแล้ว! ระบบได้แจ้งเตือนไปยัง ${emailNotification.to} แล้ว`
            : `ส่งคำขอซื้อ License ถาวร (PRO) เรียบร้อยแล้ว! ระบบได้ส่งข้อมูลติดต่อกลับไปยัง ${emailNotification.to} แล้ว`,
          request: created.request,
          device: licenseManagerInstance.toPublicLicenseState(created.device),
          emailNotification,
          emailDelivery: emailNotification
        });
      } catch (err) {
        return jsonResponse(400, { ok: false, error: err.message });
      }
    }

    // 7. ADMIN PORTAL API
    if (pathname === "/api/admin/session" && request.method === "GET") {
      const auth = licenseManagerInstance.verifyAdminRequest(reqCompat);
      const meta = licenseManagerInstance.getAdminAuthMeta({ includeSensitive: auth.authenticated });
      return adminJsonResponse(reqHeaders, 200, {
        ...auth,
        ...meta,
        ownerEmail: OWNER_EMAIL,
        notifyEmail: NOTIFY_EMAIL,
        trialDays: TRIAL_DAYS,
        host: hostHeader
      });
    }

    if (pathname === "/api/admin/auth/login" && request.method === "POST") {
      try {
        const body = await parseRequestBody(request);
        const clientIp = getClientIpFromHeaders(reqHeaders);
        const result = licenseManagerInstance.loginAdminWithPassword(
          body.email || OWNER_EMAIL,
          body.password,
          { ip: clientIp }
        );
        await flushStores(env, ctx);
        if (result.ok && result.token) {
          const cookieFlags = [
            `__moat_admin_session=${encodeURIComponent(result.token)}`,
            "HttpOnly",
            "Path=/",
            "Max-Age=43200",
            "SameSite=Strict"
          ];
          if (urlObj.protocol === "https:" || reqHeaders["x-forwarded-proto"] === "https" || hostHeader.endsWith(".readybyte.top")) {
            cookieFlags.push("Secure");
          }
          return adminJsonResponse(reqHeaders, 200, result, {
            "Set-Cookie": cookieFlags.join("; ")
          });
        }
        const status = result.lockedOut ? 429 : 401;
        const extra = result.lockedOut && result.retryAfterSec ? { "Retry-After": String(result.retryAfterSec) } : {};
        return adminJsonResponse(reqHeaders, status, result, extra);
      } catch (err) {
        return adminJsonResponse(reqHeaders, 400, { ok: false, error: err.message });
      }
    }

    if (pathname === "/api/admin/auth/logout" && request.method === "POST") {
      licenseManagerInstance.logoutAdminSession(reqCompat);
      await flushStores(env, ctx);
      return adminJsonResponse(
        reqHeaders,
        200,
        { ok: true, message: "Logged out of Admin session" },
        {
          "Set-Cookie": "__moat_admin_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict"
        }
      );
    }

    if (pathname === "/api/admin/auth/request-otp" && request.method === "POST") {
      try {
        const body = await parseRequestBody(request);
        const result = licenseManagerInstance.requestAdminOtp(body.email || OWNER_EMAIL);
        await flushStores(env, ctx);
        return adminJsonResponse(reqHeaders, result.ok ? 200 : 403, result);
      } catch (err) {
        return adminJsonResponse(reqHeaders, 400, { ok: false, error: err.message });
      }
    }

    if (pathname === "/api/admin/auth/verify-otp" && request.method === "POST") {
      try {
        const body = await parseRequestBody(request);
        const result = licenseManagerInstance.verifyAdminOtp(body.email || OWNER_EMAIL, body.code);
        await flushStores(env, ctx);
        return adminJsonResponse(reqHeaders, result.ok ? 200 : 401, result);
      } catch (err) {
        return adminJsonResponse(reqHeaders, 400, { ok: false, error: err.message });
      }
    }

    if (pathname.startsWith("/api/admin/")) {
      const auth = licenseManagerInstance.verifyAdminRequest(reqCompat);
      if (!auth.authenticated) {
        return adminJsonResponse(reqHeaders, 401, {
          ok: false,
          error: `Admin authentication required (${OWNER_EMAIL})`,
          ownerEmail: OWNER_EMAIL
        });
      }

      if (pathname === "/api/admin/auth/change-password" && request.method === "POST") {
        try {
          const body = await parseRequestBody(request);
          const result = licenseManagerInstance.changeAdminPassword(
            auth.email || OWNER_EMAIL,
            body.currentPassword,
            body.newPassword,
            body.confirmPassword
          );
          await flushStores(env, ctx);
          if (!result.ok) {
            return adminJsonResponse(reqHeaders, 400, result);
          }
          return adminJsonResponse(reqHeaders, 200, {
            ...result,
            ...licenseManagerInstance.listDevices(),
            smtpConfig: emailServiceInstance.getSmtpConfig(false)
          });
        } catch (err) {
          return adminJsonResponse(reqHeaders, 400, { ok: false, error: err.message });
        }
      }

      if (pathname === "/api/admin/devices" && request.method === "GET") {
        const meta = licenseManagerInstance.getAdminAuthMeta({ includeSensitive: true });
        return adminJsonResponse(reqHeaders, 200, {
          ok: true,
          admin: { ...auth, ...meta },
          ...licenseManagerInstance.listDevices(),
          compatibleDevices: COMPATIBLE_GARMIN_DEVICES,
          smtpConfig: emailServiceInstance.getSmtpConfig(false)
        });
      }

      if (pathname === "/api/admin/requests/resolve" && request.method === "POST") {
        try {
          const body = await parseRequestBody(request);
          if (!body.requestId || !body.action) {
            return adminJsonResponse(reqHeaders, 400, { ok: false, error: "requestId and action are required" });
          }
          const resolved = licenseManagerInstance.resolveCustomerRequest(body.requestId, body.action, {
            note: body.note,
            actor: auth.email || OWNER_EMAIL
          });
          if (!resolved.ok) {
            await flushStores(env, ctx);
            return adminJsonResponse(reqHeaders, 400, resolved);
          }

          if (
            String(body.action).toUpperCase() === "APPROVE_PURCHASE_ACTIVATE" &&
            resolved.deviceUpdate &&
            resolved.deviceUpdate.activationKey
          ) {
            const syncKey = String(resolved.request?.syncKey || "VENU2-88").trim().toUpperCase();
            if (runtimePortfoliosStore[syncKey]) {
              runtimePortfoliosStore[syncKey].watchSettings = sanitizeWatchSettings(
                {
                  ...runtimePortfoliosStore[syncKey].watchSettings,
                  deviceId: resolved.deviceUpdate.deviceId,
                  activationKey: resolved.deviceUpdate.activationKey
                },
                runtimePortfoliosStore[syncKey].watchSettings
              );
            }
          }

          await flushStores(env, ctx);
          return adminJsonResponse(reqHeaders, 200, {
            ...resolved,
            ...licenseManagerInstance.listDevices(),
            smtpConfig: emailServiceInstance.getSmtpConfig(false)
          });
        } catch (err) {
          return adminJsonResponse(reqHeaders, 400, { ok: false, error: err.message });
        }
      }

      if (pathname === "/api/admin/email/config" && request.method === "GET") {
        return adminJsonResponse(reqHeaders, 200, {
          ok: true,
          smtpConfig: emailServiceInstance.getSmtpConfig(false),
          emailLogs: emailServiceInstance.listEmailLogs(30)
        });
      }

      if (pathname === "/api/admin/email/config" && request.method === "POST") {
        try {
          const body = await parseRequestBody(request);
          const smtpConfig = emailServiceInstance.updateSmtpConfig(body);
          await flushStores(env, ctx);
          return adminJsonResponse(reqHeaders, 200, {
            ok: true,
            message: "บันทึกการตั้งค่า SMTP / System Mail เรียบร้อยแล้ว",
            smtpConfig,
            emailLogs: emailServiceInstance.listEmailLogs(30)
          });
        } catch (err) {
          return adminJsonResponse(reqHeaders, 400, { ok: false, error: err.message });
        }
      }

      if (pathname === "/api/admin/email/test" && request.method === "POST") {
        try {
          const body = await parseRequestBody(request);
          if (body.smtpConfig && typeof body.smtpConfig === "object") {
            emailServiceInstance.updateSmtpConfig(body.smtpConfig);
          }
          const mailResult = await emailServiceInstance.sendTestEmail(body.note);
          await flushStores(env, ctx);
          return adminJsonResponse(reqHeaders, 200, {
            ok: true,
            message: `ส่งอีเมลทดสอบไปยัง ${mailResult.to} เรียบร้อยแล้ว (${mailResult.status})`,
            mailResult,
            delivery: mailResult,
            smtpConfig: emailServiceInstance.getSmtpConfig(false),
            emailLogs: emailServiceInstance.listEmailLogs(30)
          });
        } catch (err) {
          return adminJsonResponse(reqHeaders, 400, { ok: false, error: err.message });
        }
      }

      if (pathname === "/api/admin/devices/generate-key" && request.method === "POST") {
        try {
          const body = await parseRequestBody(request);
          if (!body.deviceId) {
            return adminJsonResponse(reqHeaders, 400, { ok: false, error: "deviceId is required" });
          }
          const issued = licenseManagerInstance.issueDeviceKey(body.deviceId, {
            syncKey: body.syncKey || "VENU2-88",
            label: body.label,
            notes: body.notes,
            autoActivate: Boolean(body.autoActivate),
            actor: auth.email
          });

          if (body.autoActivate) {
            const syncKey = String(body.syncKey || "VENU2-88").trim().toUpperCase();
            if (runtimePortfoliosStore[syncKey]) {
              runtimePortfoliosStore[syncKey].watchSettings = sanitizeWatchSettings(
                {
                  ...runtimePortfoliosStore[syncKey].watchSettings,
                  deviceId: issued.deviceId,
                  activationKey: issued.activationKey
                },
                runtimePortfoliosStore[syncKey].watchSettings
              );
            }
          }

          await flushStores(env, ctx);
          return adminJsonResponse(reqHeaders, 200, {
            ...issued,
            ...licenseManagerInstance.listDevices()
          });
        } catch (err) {
          return adminJsonResponse(reqHeaders, 400, { ok: false, error: err.message });
        }
      }

      if (pathname === "/api/admin/devices/update" && request.method === "POST") {
        try {
          const body = await parseRequestBody(request);
          const updated = licenseManagerInstance.adminUpdateDevice(body.deviceId, body.action, {
            days: body.days,
            label: body.label,
            notes: body.notes,
            syncKey: body.syncKey,
            actor: auth.email
          });
          if (!updated.ok) {
            await flushStores(env, ctx);
            return adminJsonResponse(reqHeaders, 400, updated);
          }

          const act = String(body.action || "").toUpperCase();
          if (act === "EXPIRE_TRIAL" || act === "REVOKE" || act === "RESET_TRIAL") {
            for (const prof of Object.values(runtimePortfoliosStore)) {
              if (
                prof.watchSettings &&
                (prof.watchSettings.deviceId === updated.deviceId ||
                  licenseManagerInstance.verifyActivationKey(updated.deviceId, prof.watchSettings.activationKey))
              ) {
                prof.watchSettings.activationKey = "";
              }
            }
          } else if (act === "ACTIVATE" && updated.device) {
            for (const prof of Object.values(runtimePortfoliosStore)) {
              if (prof.watchSettings && prof.watchSettings.deviceId === updated.deviceId) {
                prof.watchSettings.activationKey = updated.device.activatedKey;
              }
            }
          }

          await flushStores(env, ctx);
          return adminJsonResponse(reqHeaders, 200, {
            ...updated,
            ...licenseManagerInstance.listDevices()
          });
        } catch (err) {
          return adminJsonResponse(reqHeaders, 400, { ok: false, error: err.message });
        }
      }
    }

    // 8. STATIC FILE SERVING VIA CLOUDFLARE ASSETS BINDING (`env.ASSETS`)
    let assetPath = pathname;
    if (pathname === "/" || pathname === "/index.html") {
      assetPath = isAdminSubdomain ? "/admin.html" : "/index.html";
    } else if (pathname === "/admin" || pathname === "/admin/") {
      assetPath = "/admin.html";
    }

    if (env && env.ASSETS && typeof env.ASSETS.fetch === "function") {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = assetPath;
      const assetReq = new Request(assetUrl.toString(), request);
      const assetRes = await env.ASSETS.fetch(assetReq);
      const newHeaders = new Headers(assetRes.headers);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
        newHeaders.set(k, v);
      }
      newHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
      newHeaders.set("CDN-Cache-Control", "no-store");
      newHeaders.set("Cloudflare-CDN-Cache-Control", "no-store");
      return new Response(assetRes.body, {
        status: assetRes.status,
        headers: newHeaders
      });
    }

    return new Response("Not Found", {
      status: 404,
      headers: {
        ...SECURITY_HEADERS,
        "Content-Type": "text/plain; charset=utf-8"
      }
    });
  }
};
