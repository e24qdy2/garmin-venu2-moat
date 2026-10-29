import licenseMod from "../lib/licenseManager.js";
import emailMod from "../lib/emailService.js";
import garminMod from "../lib/garminDevices.js";
import moatEngineMod from "../lib/moatEngine.js";
import webMemoIntegrationMod from "../lib/webMemoIntegration.js";
import researchFeedMod from "../lib/researchFeedManager.js";
import hermesNodeMod from "../lib/hermesNodeManager.js";
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
const {
  reconcileWebPortfolioSave,
  createIntegrationStoreAdapter,
  resolveIntegrationConfig,
  verifyIntegrationAuth,
  handleIntegrationRequest
} = webMemoIntegrationMod;
const {
  buildInitialSeedStore,
  buildPublicResearchFeedPayload,
  buildAdminBiAnalytics,
  mutateResearchStore
} = researchFeedMod;
const {
  createDefaultHermesNodeState,
  normalizeHermesNodeState,
  buildHermesNodeStatusPayload,
  recordHermesNodeHeartbeat,
  enqueueHermesCommand,
  recordHermesCommandResult,
  runHermesFunctionalDiagnostics
} = hermesNodeMod;
const { INITIAL_PORTFOLIOS_STORE, INITIAL_LICENSES_STORE } = seedMod;

// In-memory state per Worker isolate, hydrated from D1 or KV if bound, or seeded from INITIAL_*_STORE
let runtimePortfoliosStore = null;
let runtimeLicensesStore = null;
let runtimeResearchStore = null;
let runtimeHermesNodeState = null;
let runtimeDraftsStore = [];
let runtimePortfoliosDirty = false;
let runtimeHydrated = false;
let licenseManagerInstance = null;
let emailServiceInstance = null;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

async function ensureStoreHydrated(env) {
  if (runtimeHydrated && runtimePortfoliosStore && runtimeLicensesStore && runtimeResearchStore && licenseManagerInstance && emailServiceInstance) {
    return;
  }

  let loadedPortfolios = null;
  let loadedLicenses = null;
  let loadedResearch = null;

  // 1. Try Cloudflare D1 binding (`env.DB`)
  if (env && env.DB && typeof env.DB.prepare === "function") {
    try {
      await env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)"
      ).run();
      const pRow = await env.DB.prepare("SELECT value FROM kv_store WHERE key = ?").bind("portfolios").first();
      const lRow = await env.DB.prepare("SELECT value FROM kv_store WHERE key = ?").bind("licenses").first();
      const rRow = await env.DB.prepare("SELECT value FROM kv_store WHERE key = ?").bind("research_feed").first();
      if (pRow && pRow.value) loadedPortfolios = JSON.parse(pRow.value);
      if (lRow && lRow.value) loadedLicenses = JSON.parse(lRow.value);
      if (rRow && rRow.value) loadedResearch = JSON.parse(rRow.value);
    } catch (_) {
      // Fallback to KV or seed data
    }
  }

  // 2. Try Cloudflare KV binding (`env.MOAT_KV`)
  if ((!loadedPortfolios || !loadedLicenses || !loadedResearch) && env && env.MOAT_KV && typeof env.MOAT_KV.get === "function") {
    try {
      if (!loadedPortfolios) {
        const pRaw = await env.MOAT_KV.get("portfolios");
        if (pRaw) loadedPortfolios = JSON.parse(pRaw);
      }
      if (!loadedLicenses) {
        const lRaw = await env.MOAT_KV.get("licenses");
        if (lRaw) loadedLicenses = JSON.parse(lRaw);
      }
      if (!loadedResearch) {
        const rRaw = await env.MOAT_KV.get("research_feed");
        if (rRaw) loadedResearch = JSON.parse(rRaw);
      }
    } catch (_) {
      // Fallback to seed data
    }
  }

  runtimePortfoliosStore = loadedPortfolios || deepClone(INITIAL_PORTFOLIOS_STORE);
  runtimeLicensesStore = loadedLicenses || deepClone(INITIAL_LICENSES_STORE);
  runtimeResearchStore = loadedResearch && Array.isArray(loadedResearch.posts) ? loadedResearch : buildInitialSeedStore();
  if (!runtimeHermesNodeState) {
    runtimeHermesNodeState = createDefaultHermesNodeState();
  }

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
  if (!loadedResearch) {
    await persistKey(env, "research_feed", runtimeResearchStore);
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

async function refreshPortfoliosFromD1(env) {
  if (env && env.DB && typeof env.DB.prepare === "function") {
    try {
      const pRow = await env.DB.prepare("SELECT value FROM kv_store WHERE key = ?").bind("portfolios").first();
      if (pRow && pRow.value) {
        runtimePortfoliosStore = JSON.parse(pRow.value);
      }
    } catch (_) {
      // Keep existing runtimePortfoliosStore on transient read error
    }
  }
}

async function refreshResearchStoreFromD1(env) {
  if (env && env.DB && typeof env.DB.prepare === "function") {
    try {
      const rRow = await env.DB.prepare("SELECT value FROM kv_store WHERE key = ?").bind("research_feed").first();
      if (rRow && rRow.value) {
        const parsed = JSON.parse(rRow.value);
        if (parsed && Array.isArray(parsed.posts)) {
          runtimeResearchStore = parsed;
        }
      }
    } catch (_) {
      // Keep existing runtimeResearchStore on transient read error
    }
  }
  if (!runtimeResearchStore || !Array.isArray(runtimeResearchStore.posts)) {
    runtimeResearchStore = buildInitialSeedStore();
  }
}

async function refreshHermesNodeStateFromD1(env) {
  if (env && env.DB && typeof env.DB.prepare === "function") {
    try {
      const hRow = await env.DB.prepare("SELECT value FROM kv_store WHERE key = ?").bind("hermes_node_state_v1").first();
      if (hRow && hRow.value) {
        runtimeHermesNodeState = normalizeHermesNodeState(JSON.parse(hRow.value));
        return runtimeHermesNodeState;
      }
    } catch (_) {
      // Keep existing runtimeHermesNodeState on transient read error
    }
  }
  if (!runtimeHermesNodeState) {
    runtimeHermesNodeState = createDefaultHermesNodeState();
  } else {
    runtimeHermesNodeState = normalizeHermesNodeState(runtimeHermesNodeState);
  }
  return runtimeHermesNodeState;
}

function buildIntegrationStore(env) {
  return createIntegrationStoreAdapter({
    env,
    getMemoryPortfolios: () => runtimePortfoliosStore,
    setMemoryPortfolios: (next) => {
      runtimePortfoliosStore = next;
    },
    getMemoryDrafts: () => runtimeDraftsStore,
    setMemoryDrafts: (next) => {
      runtimeDraftsStore = next;
    }
  });
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

async function flushStores(env, ctx, { includePortfolios = true, includeResearch = false } = {}) {
  const tasks = [
    persistKey(env, "licenses", licenseManagerInstance ? licenseManagerInstance.readDb() : runtimeLicensesStore)
  ];
  if (includePortfolios) {
    tasks.unshift(persistKey(env, "portfolios", runtimePortfoliosStore));
  }
  if (includeResearch && runtimeResearchStore) {
    tasks.push(persistKey(env, "research_feed", runtimeResearchStore));
  }
  runtimePortfoliosDirty = false;
  const promise = Promise.all(tasks);
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
    runtimePortfoliosDirty = true;
  }
  if (ensureIsolatedProfileSettings(runtimePortfoliosStore[key], licenseManagerInstance)) {
    runtimePortfoliosDirty = true;
  }
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
        runtimePortfoliosDirty = true;
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

    // 1B. SCOPED WEBMEMO & RESEARCH FEED INTEGRATION API (Hermes Agent + Discord Approval)
    if (pathname === "/api/integration" || pathname.startsWith("/api/integration/")) {
      let body = {};
      if (request.method === "POST" || request.method === "PUT" || request.method === "PATCH") {
        try {
          body = await parseRequestBody(request);
        } catch (err) {
          return jsonResponse(400, { ok: false, error: err.message, code: "INVALID_JSON" });
        }
      }

      // Hermes Agent Research Posts & Support/Resistance 1-2-3 Publishing Endpoint
      if (pathname === "/api/integration/research-posts") {
        await refreshPortfoliosFromD1(env);
        await refreshResearchStoreFromD1(env);
        const cfg = resolveIntegrationConfig(env);
        const authCheck = verifyIntegrationAuth(reqHeaders, cfg, runtimePortfoliosStore);
        if (!authCheck.ok) {
          return jsonResponse(authCheck.status, {
            ok: false,
            code: authCheck.code,
            error: authCheck.error
          });
        }

        if (request.method === "GET") {
          const feedPayload = buildPublicResearchFeedPayload({
            researchStore: runtimeResearchStore,
            portfoliosStore: runtimePortfoliosStore,
            syncKey: "VENU2-88",
            tagFilter: query.tag,
            symbolFilter: query.symbol,
            includeArchived: query.includeArchived === "1" || query.includeArchived === "true"
          });
          if (feedPayload.sweep && feedPayload.sweep.dirty) {
            await persistKey(env, "research_feed", runtimeResearchStore);
          }
          return jsonResponse(200, feedPayload);
        }

        if (request.method === "POST" || request.method === "PUT" || request.method === "PATCH") {
          const mutRes = mutateResearchStore(
            runtimeResearchStore,
            {
              ...body,
              action: body.action || "UPSERT",
              source: body.source || "HERMES_AGENT",
              author: body.author || "Hermes Quant Research Agent"
            },
            { actor: "hermes-agent" }
          );
          if (!mutRes.ok) {
            return jsonResponse(mutRes.status || 400, mutRes);
          }
          await persistKey(env, "research_feed", runtimeResearchStore);
          const feedPayload = buildPublicResearchFeedPayload({
            researchStore: runtimeResearchStore,
            portfoliosStore: runtimePortfoliosStore,
            syncKey: "VENU2-88"
          });
          return jsonResponse(mutRes.status || 200, {
            ...mutRes,
            summary: feedPayload.summary,
            policy: feedPayload.policy
          });
        }
      }

      // Hermes Pi Node Live Heartbeat & Remote Control Agent Endpoints
      if (pathname.startsWith("/api/integration/hermes-node")) {
        await refreshPortfoliosFromD1(env);
        await refreshHermesNodeStateFromD1(env);
        const cfg = resolveIntegrationConfig(env);
        const authCheck = verifyIntegrationAuth(reqHeaders, cfg, runtimePortfoliosStore);
        if (!authCheck.ok) {
          return jsonResponse(authCheck.status, {
            ok: false,
            code: authCheck.code,
            error: authCheck.error
          });
        }

        if (pathname === "/api/integration/hermes-node/status" && request.method === "GET") {
          return jsonResponse(200, buildHermesNodeStatusPayload(runtimeHermesNodeState));
        }

        if (pathname === "/api/integration/hermes-node/heartbeat" && request.method === "POST") {
          const hbRes = recordHermesNodeHeartbeat(runtimeHermesNodeState, body);
          runtimeHermesNodeState = hbRes.state;
          await persistKey(env, "hermes_node_state_v1", runtimeHermesNodeState);
          return jsonResponse(200, {
            ok: true,
            nextCommand: hbRes.nextCommand,
            nodeStatus: buildHermesNodeStatusPayload(runtimeHermesNodeState)
          });
        }

        if (pathname === "/api/integration/hermes-node/command-result" && request.method === "POST") {
          const cmdRes = recordHermesCommandResult(runtimeHermesNodeState, body);
          runtimeHermesNodeState = cmdRes.state;
          await persistKey(env, "hermes_node_state_v1", runtimeHermesNodeState);
          return jsonResponse(200, {
            ok: cmdRes.ok,
            command: cmdRes.command,
            nodeStatus: buildHermesNodeStatusPayload(runtimeHermesNodeState)
          });
        }
      }

      const integrationStore = buildIntegrationStore(env);
      const result = await handleIntegrationRequest({
        method: request.method,
        pathname,
        query,
        headers: reqHeaders,
        body,
        env,
        store: integrationStore
      });
      if (result) {
        return jsonResponse(result.status, result.body, result.headers || {});
      }
    }

    // 1C. GET SHARED RESEARCH FEED & WATCHLIST SUPPORT/RESISTANCE 1-2-3 (Accessible by all SyncKeys)
    if (pathname === "/api/research-feed" && request.method === "GET") {
      await refreshPortfoliosFromD1(env);
      await refreshResearchStoreFromD1(env);
      runtimePortfoliosDirty = false;
      const syncKey = String(query.key || "VENU2-88").trim().toUpperCase();
      getOrCreateProfile(syncKey);
      const feedPayload = buildPublicResearchFeedPayload({
        researchStore: runtimeResearchStore,
        portfoliosStore: runtimePortfoliosStore,
        syncKey,
        tagFilter: query.tag,
        symbolFilter: query.symbol,
        includeArchived: query.includeArchived === "1" || query.includeArchived === "true"
      });
      await flushStores(env, ctx, {
        includePortfolios: runtimePortfoliosDirty,
        includeResearch: Boolean(feedPayload.sweep && feedPayload.sweep.dirty)
      });
      return jsonResponse(200, feedPayload);
    }

    // 2. GET FULL ENRICHED PORTFOLIO (For Web App + Simulator)
    if (pathname === "/api/portfolio" && request.method === "GET") {
      await refreshPortfoliosFromD1(env);
      await refreshResearchStoreFromD1(env);
      runtimePortfoliosDirty = false;
      const syncKey = query.key || "VENU2-88";
      const profile = getOrCreateProfile(syncKey);
      const payload = await buildEnrichedPayload(profile, {
        deviceId: query.did || query.deviceId,
        activationKey: query.akey || query.licenseKey,
        watchModel: query.model || query.watchModel
      });
      const researchFeed = buildPublicResearchFeedPayload({
        researchStore: runtimeResearchStore,
        portfoliosStore: runtimePortfoliosStore,
        syncKey
      });
      payload.researchFeed = researchFeed;
      await flushStores(env, ctx, {
        includePortfolios: runtimePortfoliosDirty,
        includeResearch: Boolean(researchFeed.sweep && researchFeed.sweep.dirty)
      });
      return jsonResponse(200, payload);
    }

    // 2B. POST /api/refresh (Clear cache and return fresh quotes)
    if (pathname === "/api/refresh" && request.method === "POST") {
      await refreshPortfoliosFromD1(env);
      await refreshResearchStoreFromD1(env);
      runtimePortfoliosDirty = false;
      const body = await parseRequestBody(request).catch(() => ({}));
      const syncKey = (body.syncKey || query.key || "VENU2-88").trim().toUpperCase();
      clearMarketCache();
      const profile = getOrCreateProfile(syncKey);
      const payload = await buildEnrichedPayload(profile);
      const researchFeed = buildPublicResearchFeedPayload({
        researchStore: runtimeResearchStore,
        portfoliosStore: runtimePortfoliosStore,
        syncKey
      });
      payload.researchFeed = researchFeed;
      await flushStores(env, ctx, {
        includePortfolios: runtimePortfoliosDirty,
        includeResearch: Boolean(researchFeed.sweep && researchFeed.sweep.dirty)
      });
      return jsonResponse(200, payload);
    }

    // 3. GET ULTRA-COMPACT GARMIN WATCH PAYLOAD
    if ((pathname === "/api/watch" || pathname.startsWith("/api/watch/")) && request.method === "GET") {
      await refreshPortfoliosFromD1(env);
      runtimePortfoliosDirty = false;
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
      await flushStores(env, ctx, { includePortfolios: runtimePortfoliosDirty });
      return jsonResponse(200, payload.watch);
    }

    // 4. SAVE / UPDATE PORTFOLIO & WATCH SETTINGS FROM WEB APP
    if (pathname === "/api/portfolio" && (request.method === "PUT" || request.method === "POST")) {
      try {
        const body = await parseRequestBody(request);
        const syncKey = (body.syncKey || query.key || "VENU2-88").trim().toUpperCase();
        const integrationStore = buildIntegrationStore(env);

        let savedProfile = null;
        let savedWatchSettings = null;
        let casSuccess = false;

        for (let attempt = 0; attempt < 3; attempt++) {
          const snapshot = await integrationStore.readPortfoliosSnapshot();
          runtimePortfoliosStore = snapshot.store;
          const existing = getOrCreateProfile(syncKey);
          const nextWatchSettings = sanitizeWatchSettings(
            body.watchSettings || {},
            existing.watchSettings || DEFAULT_WATCH_SETTINGS
          );

          const normalizedPortfolios = normalizePortfoliosInput(body.portfolios, existing.portfolios);
          const reconciled = reconcileWebPortfolioSave({
            currentServerPortfolios: existing.portfolios,
            normalizedClientPortfolios: normalizedPortfolios,
            rawClientPortfolios: body.portfolios
          });

          const nextStore = deepClone(runtimePortfoliosStore);
          nextStore[syncKey] = {
            syncKey,
            baseCurrency: body.baseCurrency === "USD" ? "USD" : "THB",
            updatedAt: new Date().toISOString(),
            watchSettings: nextWatchSettings,
            portfolios: reconciled.portfolios
          };
          const boundDid = nextWatchSettings.deviceId;
          if (boundDid && boundDid !== "V2-88VENU20" && boundDid !== syncKey && nextStore[boundDid]) {
            nextStore[boundDid] = {
              ...nextStore[syncKey],
              syncKey: boundDid,
              watchSettings: {
                ...nextWatchSettings,
                activationKey: nextStore[boundDid].watchSettings?.activationKey || nextWatchSettings.activationKey
              }
            };
          }

          const casWrite = await integrationStore.casWritePortfoliosSnapshot(snapshot.raw, nextStore);
          if (casWrite && casWrite.ok) {
            runtimePortfoliosStore = nextStore;
            savedProfile = runtimePortfoliosStore[syncKey];
            savedWatchSettings = nextWatchSettings;
            casSuccess = true;
            break;
          }
        }

        if (!casSuccess || !savedProfile) {
          return jsonResponse(409, {
            error: "Concurrent portfolio update conflict; please retry save.",
            code: "PORTFOLIO_CAS_CONFLICT"
          });
        }

        const payload = await buildEnrichedPayload(savedProfile, {
          deviceId: savedWatchSettings.deviceId,
          activationKey: savedWatchSettings.activationKey,
          watchModel: savedWatchSettings.watchModel
        });
        await flushStores(env, ctx, { includePortfolios: false });
        if (env && env.MOAT_KV && typeof env.MOAT_KV.put === "function") {
          await env.MOAT_KV.put("portfolios", JSON.stringify(runtimePortfoliosStore)).catch(() => {});
        }
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
            ? `Trial extension request (+${created.request.requestedExtendDays} days) submitted! Notification sent to ${emailNotification.to}.`
            : `PRO License purchase request submitted! Contact details sent to ${emailNotification.to}.`,
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
      const extraHeaders =
        !auth.authenticated && String(reqHeaders["cookie"] || "").includes("__moat_admin_session=")
          ? { "Set-Cookie": "__moat_admin_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict" }
          : {};
      return adminJsonResponse(
        reqHeaders,
        200,
        {
          ...auth,
          ...meta,
          ownerEmail: OWNER_EMAIL,
          notifyEmail: NOTIFY_EMAIL,
          trialDays: TRIAL_DAYS,
          host: hostHeader
        },
        extraHeaders
      );
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
          const maxAgeSec = Math.max(60, Number(result.expiresInSec || 1800));
          const cookieFlags = [
            `__moat_admin_session=${encodeURIComponent(result.token)}`,
            "HttpOnly",
            "Path=/",
            `Max-Age=${maxAgeSec}`,
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
        await refreshPortfoliosFromD1(env);
        await refreshResearchStoreFromD1(env);
        await refreshHermesNodeStateFromD1(env);
        const meta = licenseManagerInstance.getAdminAuthMeta({ includeSensitive: true });
        const licensesData = licenseManagerInstance.listDevices();
        const draftsList = await buildIntegrationStore(env).listDrafts({ accountId: "owner", limit: 200 }).catch(() => []);
        const researchFeed = buildPublicResearchFeedPayload({
          researchStore: runtimeResearchStore,
          portfoliosStore: runtimePortfoliosStore,
          syncKey: "VENU2-88",
          includeArchived: true
        });
        const biAnalytics = buildAdminBiAnalytics({
          portfoliosStore: runtimePortfoliosStore,
          licensesData,
          draftsList,
          researchStore: runtimeResearchStore
        });
        if (researchFeed.sweep && researchFeed.sweep.dirty) {
          await persistKey(env, "research_feed", runtimeResearchStore);
        }
        return adminJsonResponse(reqHeaders, 200, {
          ok: true,
          admin: { ...auth, ...meta },
          ...licensesData,
          compatibleDevices: COMPATIBLE_GARMIN_DEVICES,
          smtpConfig: emailServiceInstance.getSmtpConfig(false),
          researchFeed,
          biAnalytics,
          hermesNode: buildHermesNodeStatusPayload(runtimeHermesNodeState)
        });
      }

      if (pathname === "/api/admin/bi-dashboard" && request.method === "GET") {
        await refreshPortfoliosFromD1(env);
        await refreshResearchStoreFromD1(env);
        await refreshHermesNodeStateFromD1(env);
        const licensesData = licenseManagerInstance.listDevices();
        const draftsList = await buildIntegrationStore(env).listDrafts({ accountId: "owner", limit: 200 }).catch(() => []);
        const biAnalytics = buildAdminBiAnalytics({
          portfoliosStore: runtimePortfoliosStore,
          licensesData,
          draftsList,
          researchStore: runtimeResearchStore
        });
        const researchFeed = buildPublicResearchFeedPayload({
          researchStore: runtimeResearchStore,
          portfoliosStore: runtimePortfoliosStore,
          syncKey: "VENU2-88",
          includeArchived: true
        });
        if (researchFeed.sweep && researchFeed.sweep.dirty) {
          await persistKey(env, "research_feed", runtimeResearchStore);
        }
        return adminJsonResponse(reqHeaders, 200, {
          ok: true,
          biAnalytics,
          researchFeed,
          hermesNode: buildHermesNodeStatusPayload(runtimeHermesNodeState)
        });
      }

      if (pathname === "/api/admin/hermes-node/status" && request.method === "GET") {
        await refreshHermesNodeStateFromD1(env);
        return adminJsonResponse(reqHeaders, 200, buildHermesNodeStatusPayload(runtimeHermesNodeState));
      }

      if (pathname === "/api/admin/hermes-node/diagnostics" && request.method === "POST") {
        try {
          await refreshPortfoliosFromD1(env);
          await refreshResearchStoreFromD1(env);
          await refreshHermesNodeStateFromD1(env);
          const licensesData = licenseManagerInstance.listDevices();
          const draftsList = await buildIntegrationStore(env).listDrafts({ accountId: "owner", limit: 200 }).catch(() => []);
          const integrationConfig = resolveIntegrationConfig(env);
          const report = await runHermesFunctionalDiagnostics({
            nodeState: runtimeHermesNodeState,
            portfoliosStore: runtimePortfoliosStore,
            researchStore: runtimeResearchStore,
            licensesData,
            draftsList,
            integrationConfig,
            buildPublicResearchFeedPayload,
            buildAdminBiAnalytics
          });
          await persistKey(env, "hermes_node_state_v1", runtimeHermesNodeState);
          return adminJsonResponse(reqHeaders, 200, {
            ok: true,
            report,
            nodeStatus: buildHermesNodeStatusPayload(runtimeHermesNodeState)
          });
        } catch (err) {
          return adminJsonResponse(reqHeaders, 400, { ok: false, error: err.message });
        }
      }

      if (pathname === "/api/admin/hermes-node/command" && request.method === "POST") {
        try {
          await refreshPortfoliosFromD1(env);
          await refreshResearchStoreFromD1(env);
          await refreshHermesNodeStateFromD1(env);
          const body = await parseRequestBody(request);
          const action = String(body.action || "").trim().toUpperCase();
          let diagnosticReport = null;

          if (action === "TEST_ALL_FUNCTIONS") {
            const licensesData = licenseManagerInstance.listDevices();
            const draftsList = await buildIntegrationStore(env).listDrafts({ accountId: "owner", limit: 200 }).catch(() => []);
            const integrationConfig = resolveIntegrationConfig(env);
            diagnosticReport = await runHermesFunctionalDiagnostics({
              nodeState: runtimeHermesNodeState,
              portfoliosStore: runtimePortfoliosStore,
              researchStore: runtimeResearchStore,
              licensesData,
              draftsList,
              integrationConfig,
              buildPublicResearchFeedPayload,
              buildAdminBiAnalytics
            });
          }

          const enq = enqueueHermesCommand(
            runtimeHermesNodeState,
            { action, reason: body.reason || "" },
            { actor: auth.email || OWNER_EMAIL }
          );
          if (!enq.ok) {
            return adminJsonResponse(reqHeaders, enq.status || 400, enq);
          }
          runtimeHermesNodeState = enq.state;
          await persistKey(env, "hermes_node_state_v1", runtimeHermesNodeState);
          return adminJsonResponse(reqHeaders, 200, {
            ok: true,
            command: enq.command,
            diagnosticReport,
            nodeStatus: buildHermesNodeStatusPayload(runtimeHermesNodeState)
          });
        } catch (err) {
          return adminJsonResponse(reqHeaders, 400, { ok: false, error: err.message });
        }
      }

      if (pathname === "/api/admin/research-posts" && request.method === "GET") {
        await refreshPortfoliosFromD1(env);
        await refreshResearchStoreFromD1(env);
        const researchFeed = buildPublicResearchFeedPayload({
          researchStore: runtimeResearchStore,
          portfoliosStore: runtimePortfoliosStore,
          syncKey: "VENU2-88",
          tagFilter: query.tag,
          symbolFilter: query.symbol,
          includeArchived: true
        });
        const licensesData = licenseManagerInstance.listDevices();
        const draftsList = await buildIntegrationStore(env).listDrafts({ accountId: "owner", limit: 200 }).catch(() => []);
        const biAnalytics = buildAdminBiAnalytics({
          portfoliosStore: runtimePortfoliosStore,
          licensesData,
          draftsList,
          researchStore: runtimeResearchStore
        });
        if (researchFeed.sweep && researchFeed.sweep.dirty) {
          await persistKey(env, "research_feed", runtimeResearchStore);
        }
        return adminJsonResponse(reqHeaders, 200, {
          ok: true,
          researchFeed,
          biAnalytics
        });
      }

      if (
        pathname === "/api/admin/research-posts" &&
        (request.method === "POST" || request.method === "PUT" || request.method === "DELETE")
      ) {
        try {
          await refreshPortfoliosFromD1(env);
          await refreshResearchStoreFromD1(env);
          const body = await parseRequestBody(request);
          const action =
            request.method === "DELETE"
              ? "DELETE"
              : body.action || "UPSERT";
          const mutRes = mutateResearchStore(
            runtimeResearchStore,
            { ...body, action },
            { actor: auth.email || OWNER_EMAIL }
          );
          if (!mutRes.ok) {
            return adminJsonResponse(reqHeaders, mutRes.status || 400, mutRes);
          }
          await persistKey(env, "research_feed", runtimeResearchStore);
          const researchFeed = buildPublicResearchFeedPayload({
            researchStore: runtimeResearchStore,
            portfoliosStore: runtimePortfoliosStore,
            syncKey: "VENU2-88",
            includeArchived: true
          });
          const licensesData = licenseManagerInstance.listDevices();
          const draftsList = await buildIntegrationStore(env).listDrafts({ accountId: "owner", limit: 200 }).catch(() => []);
          const biAnalytics = buildAdminBiAnalytics({
            portfoliosStore: runtimePortfoliosStore,
            licensesData,
            draftsList,
            researchStore: runtimeResearchStore
          });
          return adminJsonResponse(reqHeaders, mutRes.status || 200, {
            ...mutRes,
            posts: researchFeed.posts,
            researchFeed,
            biAnalytics
          });
        } catch (err) {
          return adminJsonResponse(reqHeaders, 400, { ok: false, error: err.message });
        }
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
            message: "SMTP / System Mail configuration saved successfully.",
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
            message: `Test email sent to ${mailResult.to} (${mailResult.status})`,
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

      if (
        (pathname === "/api/admin/devices/update" || pathname === "/api/admin/devices/remove-keys") &&
        request.method === "POST"
      ) {
        try {
          const body = await parseRequestBody(request);
          const action =
            pathname === "/api/admin/devices/remove-keys"
              ? body.action || "REMOVE_KEY"
              : body.action;
          const updated = licenseManagerInstance.adminUpdateDevice(body.deviceId, action, {
            deviceIds: body.deviceIds,
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

          const act = String(action || "").toUpperCase();
          const targetIds = Array.isArray(updated.deviceIds)
            ? updated.deviceIds
            : [updated.deviceId].filter(Boolean);
          if (
            act === "EXPIRE_TRIAL" ||
            act === "REVOKE" ||
            act === "RESET_TRIAL" ||
            act === "REMOVE_KEY" ||
            act === "DELETE"
          ) {
            for (const prof of Object.values(runtimePortfoliosStore)) {
              for (const tid of targetIds) {
                if (
                  prof.watchSettings &&
                  (prof.watchSettings.deviceId === tid ||
                    licenseManagerInstance.verifyActivationKey(tid, prof.watchSettings.activationKey))
                ) {
                  prof.watchSettings.activationKey = "";
                }
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
    } else if (pathname === "/privacy" || pathname === "/privacy/") {
      assetPath = "/privacy.html";
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
