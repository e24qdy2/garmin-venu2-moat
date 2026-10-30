const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");
const { loadEnvFile } = require("./lib/envLoader");

// Load environment variables from .env before initializing security/license modules
loadEnvFile();

const { LicenseManager, OWNER_EMAIL, NOTIFY_EMAIL, TRIAL_DAYS } = require("./lib/licenseManager");
const { EmailService } = require("./lib/emailService");
const {
  COMPATIBLE_GARMIN_DEVICES,
  provisionConnectIqDevices
} = require("./lib/garminDevices");
const {
  DEFAULT_WATCH_SETTINGS,
  SECURITY_HEADERS,
  clearMarketCache,
  sanitizeWatchSettings: sanitizeWatchSettingsCore,
  deriveDeviceIdForSyncKey,
  createIsolatedProfile,
  ensureIsolatedProfileSettings,
  resolveWatchProfile,
  normalizeEarningsDate,
  normalizePortfoliosInput,
  fetchSymbolMarketData,
  buildEnrichedPayload: buildEnrichedPayloadCore
} = require("./lib/moatEngine");
const {
  reconcileWebPortfolioSave,
  createIntegrationStoreAdapter,
  resolveIntegrationConfig,
  verifyIntegrationAuth,
  handleIntegrationRequest
} = require("./lib/webMemoIntegration");
const {
  buildInitialSeedStore,
  buildPublicResearchFeedPayload,
  buildAdminBiAnalytics,
  mutateResearchStore,
  syncApprovedWebMemoToResearchStore
} = require("./lib/researchFeedManager");
const {
  createDefaultHermesNodeState,
  normalizeHermesNodeState,
  buildHermesNodeStatusPayload,
  recordHermesNodeHeartbeat,
  enqueueHermesCommand,
  recordHermesCommandResult,
  runHermesFunctionalDiagnostics
} = require("./lib/hermesNodeManager");

// Ensure Connect IQ device definitions exist for all 2024-2026 supported watches
try {
  provisionConnectIqDevices();
} catch (_) {
  // Ignore if Connect IQ SDK directory is not installed on host
}

const PORT = process.env.PORT || 3880;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "portfolios.json");
const DRAFTS_FILE = path.join(DATA_DIR, "webmemo_drafts.json");
const RESEARCH_FILE = path.join(DATA_DIR, "research_feed.json");
const HERMES_NODE_FILE = path.join(DATA_DIR, "hermes_node_state.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const licenseManager = new LicenseManager({
  dataFile: path.join(DATA_DIR, "licenses.json")
});

const emailService = new EmailService({
  dataFile: path.join(DATA_DIR, "licenses.json"),
  outboxDir: path.join(DATA_DIR, "mail-outbox"),
  ownerEmail: OWNER_EMAIL,
  notifyEmail: NOTIFY_EMAIL
});

// Ensure data directory and initial seed portfolio exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DEFAULT_DATA = {
  "VENU2-88": {
    syncKey: "VENU2-88",
    baseCurrency: "THB",
    updatedAt: new Date().toISOString(),
    watchSettings: { ...DEFAULT_WATCH_SETTINGS },
    portfolios: [
      {
        id: "us-moat",
        name: "US Wide Moat",
        currency: "USD",
        holdings: [
          { symbol: "NVDA", name: "NVIDIA Corp", shares: 40, avgCost: 92.50, targetPrice: 155.00, alertDir: "ABOVE", memo: "Blackwell DC ramp | Hold core" },
          { symbol: "MSFT", name: "Microsoft", shares: 25, avgCost: 380.00, targetPrice: 465.00, alertDir: "ABOVE", memo: "Azure AI moat | Accumulate < 410" },
          { symbol: "AAPL", name: "Apple Inc", shares: 55, avgCost: 188.00, targetPrice: 245.00, alertDir: "ABOVE", memo: "Ecosystem cashflow | Trim @ 250" },
          { symbol: "GOOGL", name: "Alphabet Inc", shares: 60, avgCost: 152.00, targetPrice: 205.00, alertDir: "ABOVE", memo: "Search + Cloud margin expansion" },
          { symbol: "BRK-B", name: "Berkshire B", shares: 20, avgCost: 405.00, targetPrice: 480.00, alertDir: "ABOVE", memo: "Fortress T-Bill cash reserve" }
        ]
      },
      {
        id: "thai-set",
        name: "Thai SET Dividend",
        currency: "THB",
        holdings: [
          { symbol: "ADVANC.BK", name: "AIS Telecom", shares: 1500, avgCost: 214.00, targetPrice: 295.00, alertDir: "ABOVE", memo: "Yield 4.2% | Defensive cashcow" },
          { symbol: "DELTA.BK", name: "Delta Elec", shares: 1000, avgCost: 84.50, targetPrice: 140.00, alertDir: "ABOVE", memo: "AI server power supply" },
          { symbol: "PTTEP.BK", name: "PTT Explor", shares: 2000, avgCost: 148.00, targetPrice: 130.00, alertDir: "BELOW", memo: "Div > 6% | Hedge oil shock" },
          { symbol: "BDMS.BK", name: "Bangkok Dusit", shares: 4500, avgCost: 26.25, targetPrice: 31.00, alertDir: "ABOVE", memo: "Medical tourism moat" }
        ]
      },
      {
        id: "global-etf",
        name: "Global & Crypto",
        currency: "USD",
        holdings: [
          { symbol: "BTC-USD", name: "Bitcoin", shares: 0.35, avgCost: 58000.00, targetPrice: 100000.00, alertDir: "ABOVE", memo: "Cold storage digital gold" },
          { symbol: "SCHD", name: "US Div ETF", shares: 300, avgCost: 26.80, targetPrice: 31.00, alertDir: "ABOVE", memo: "DRIP dividend compounder" },
          { symbol: "QQQ", name: "Invesco QQQ", shares: 18, avgCost: 435.00, targetPrice: 540.00, alertDir: "ABOVE", memo: "Nasdaq-100 core index" }
        ]
      }
    ]
  }
};

function sanitizeWatchSettings(raw = {}, fallback = DEFAULT_WATCH_SETTINGS) {
  return sanitizeWatchSettingsCore(raw, fallback, licenseManager);
}

if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2), "utf8");
}

function readStore() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return { ...DEFAULT_DATA };
  }
}

function writeStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}

function readDraftsStore() {
  try {
    if (!fs.existsSync(DRAFTS_FILE)) return [];
    const raw = fs.readFileSync(DRAFTS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function writeDraftsStore(drafts) {
  fs.writeFileSync(DRAFTS_FILE, JSON.stringify(Array.isArray(drafts) ? drafts : [], null, 2), "utf8");
}

function readResearchStore() {
  try {
    if (!fs.existsSync(RESEARCH_FILE)) {
      const seeded = buildInitialSeedStore();
      fs.writeFileSync(RESEARCH_FILE, JSON.stringify(seeded, null, 2), "utf8");
      return seeded;
    }
    const raw = fs.readFileSync(RESEARCH_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.posts)) {
      return parsed;
    }
    const seeded = buildInitialSeedStore();
    fs.writeFileSync(RESEARCH_FILE, JSON.stringify(seeded, null, 2), "utf8");
    return seeded;
  } catch (_) {
    return buildInitialSeedStore();
  }
}

function writeResearchStore(researchStore) {
  fs.writeFileSync(RESEARCH_FILE, JSON.stringify(researchStore, null, 2), "utf8");
}

function readHermesNodeState() {
  try {
    if (!fs.existsSync(HERMES_NODE_FILE)) {
      const seeded = createDefaultHermesNodeState();
      fs.writeFileSync(HERMES_NODE_FILE, JSON.stringify(seeded, null, 2), "utf8");
      return seeded;
    }
    const raw = fs.readFileSync(HERMES_NODE_FILE, "utf8");
    return normalizeHermesNodeState(JSON.parse(raw));
  } catch (_) {
    return createDefaultHermesNodeState();
  }
}

function writeHermesNodeState(nodeState) {
  fs.writeFileSync(HERMES_NODE_FILE, JSON.stringify(normalizeHermesNodeState(nodeState), null, 2), "utf8");
}

function buildNodeIntegrationStore() {
  return createIntegrationStoreAdapter({
    getMemoryPortfolios: () => readStore(),
    setMemoryPortfolios: (next) => writeStore(next),
    getMemoryDrafts: () => readDraftsStore(),
    setMemoryDrafts: (next) => writeDraftsStore(next)
  });
}

function getOrCreateProfile(syncKey) {
  const key = (syncKey || "VENU2-88").trim().toUpperCase();
  const store = readStore();
  let dirty = false;
  if (!store[key]) {
    store[key] = createIsolatedProfile(key, DEFAULT_DATA["VENU2-88"], licenseManager);
    dirty = true;
  }
  if (ensureIsolatedProfileSettings(store[key], licenseManager)) {
    dirty = true;
  }
  if (dirty) {
    writeStore(store);
  }
  return store[key];
}

// In-memory rate limiter for public endpoints
const rateLimitBuckets = new Map();
function getClientIp(req) {
  const cfIp = req?.headers?.["cf-connecting-ip"];
  if (cfIp) return String(cfIp).trim();
  const xff = req?.headers?.["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return String(req?.socket?.remoteAddress || "127.0.0.1");
}

function checkRateLimit(req, bucketName, maxRequests = 20, windowMs = 5 * 60 * 1000) {
  const ip = getClientIp(req);
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

async function buildEnrichedPayload(profile, queryOpts = {}) {
  return buildEnrichedPayloadCore(profile, queryOpts, {
    licenseManager,
    onSyncWatchSettings: (syncKey, nextSettings) => {
      const store = readStore();
      if (store[syncKey]) {
        store[syncKey].watchSettings = nextSettings;
        writeStore(store);
      }
    }
  });
}

function sendJson(res, status, obj, extraHeaders = {}) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token",
    ...extraHeaders
  });
  res.end(JSON.stringify(obj));
}

function sendAdminJson(req, res, status, obj, extraHeaders = {}) {
  const origin = String(req?.headers?.origin || "");
  const allowedOrigin =
    origin &&
    (origin.includes("readybyte.top") ||
      origin.startsWith("http://localhost") ||
      origin.startsWith("http://127.0.0.1"))
      ? origin
      : "https://admin-moat.readybyte.top";

  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache",
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token",
    ...extraHeaders
  });
  res.end(JSON.stringify(obj));
}

const MAX_BODY_BYTES = 256 * 1024;

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        req.destroy();
        return reject(new Error("Payload too large"));
      }
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".prg": "application/octet-stream"
};

async function handleRequest(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname || "/";
  const hostHeader = String(req.headers.host || "").toLowerCase();
  const isAdminSubdomain = hostHeader.startsWith("admin-moat.");

  if (req.method === "OPTIONS") {
    if (pathname.startsWith("/api/admin/")) {
      return sendAdminJson(req, res, 200, { ok: true });
    }
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === "/favicon.ico" && req.method === "GET") {
    const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#0b1120"/><path d="M12 44 L24 30 L34 36 L52 18" stroke="#10b981" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="52" cy="18" r="4" fill="#34d399"/></svg>`;
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400"
    });
    return res.end(svgIcon);
  }

  // 0. GET /api/devices/compatible (2024-2026 Compatible Garmin Watches Catalog)
  if (pathname === "/api/devices/compatible" && req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      count: COMPATIBLE_GARMIN_DEVICES.length,
      devices: COMPATIBLE_GARMIN_DEVICES
    });
  }

  // 0b. SCOPED WEBMEMO & RESEARCH FEED INTEGRATION API (Hermes Agent + Discord Approval)
  if (pathname === "/api/integration" || pathname.startsWith("/api/integration/")) {
    let body = {};
    if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
      try {
        body = await parseBody(req);
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message, code: "INVALID_JSON" });
      }
    }

    if (pathname === "/api/integration/research-posts") {
      const portfoliosStore = readStore();
      const researchStore = readResearchStore();
      const cfg = resolveIntegrationConfig(process.env);
      const authCheck = verifyIntegrationAuth(req.headers || {}, cfg, portfoliosStore);
      if (!authCheck.ok) {
        return sendJson(res, authCheck.status, {
          ok: false,
          code: authCheck.code,
          error: authCheck.error
        });
      }

      const query = parsedUrl.query || {};
      if (req.method === "GET") {
        const feedPayload = buildPublicResearchFeedPayload({
          researchStore,
          portfoliosStore,
          syncKey: "VENU2-88",
          tagFilter: query.tag,
          symbolFilter: query.symbol,
          includeArchived: query.includeArchived === "1" || query.includeArchived === "true"
        });
        if (feedPayload.sweep && feedPayload.sweep.dirty) {
          writeResearchStore(researchStore);
        }
        return sendJson(res, 200, feedPayload);
      }

      if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
        const mutRes = mutateResearchStore(
          researchStore,
          {
            ...body,
            action: body.action || "UPSERT",
            source: body.source || "HERMES_AGENT",
            author: body.author || "Hermes Quant Research Agent"
          },
          { actor: "hermes-agent" }
        );
        if (!mutRes.ok) {
          return sendJson(res, mutRes.status || 400, mutRes);
        }
        writeResearchStore(researchStore);
        const feedPayload = buildPublicResearchFeedPayload({
          researchStore,
          portfoliosStore,
          syncKey: "VENU2-88"
        });
        return sendJson(res, mutRes.status || 200, {
          ...mutRes,
          summary: feedPayload.summary,
          policy: feedPayload.policy
        });
      }
    }

    if (pathname.startsWith("/api/integration/hermes-node")) {
      const portfoliosStore = readStore();
      const cfg = resolveIntegrationConfig(process.env);
      const authCheck = verifyIntegrationAuth(req.headers || {}, cfg, portfoliosStore);
      if (!authCheck.ok) {
        return sendJson(res, authCheck.status, {
          ok: false,
          code: authCheck.code,
          error: authCheck.error
        });
      }

      const nodeState = readHermesNodeState();
      if (pathname === "/api/integration/hermes-node/status" && req.method === "GET") {
        return sendJson(res, 200, buildHermesNodeStatusPayload(nodeState));
      }

      if (pathname === "/api/integration/hermes-node/heartbeat" && req.method === "POST") {
        const hbRes = recordHermesNodeHeartbeat(nodeState, body);
        writeHermesNodeState(hbRes.state);
        return sendJson(res, 200, {
          ok: true,
          nextCommand: hbRes.nextCommand,
          nodeStatus: buildHermesNodeStatusPayload(hbRes.state)
        });
      }

      if (pathname === "/api/integration/hermes-node/command-result" && req.method === "POST") {
        const cmdRes = recordHermesCommandResult(nodeState, body);
        writeHermesNodeState(cmdRes.state);
        return sendJson(res, 200, {
          ok: cmdRes.ok,
          command: cmdRes.command,
          nodeStatus: buildHermesNodeStatusPayload(cmdRes.state)
        });
      }
    }

    const result = await handleIntegrationRequest({
      method: req.method,
      pathname,
      query: parsedUrl.query || {},
      headers: req.headers || {},
      body,
      env: process.env,
      store: buildNodeIntegrationStore()
    });
    if (result) {
      if (result.body && result.body.ok && result.body.decision === "APPROVED" && result.body.readback) {
        const researchStore = readResearchStore();
        const rb = result.body.readback;
        const draftObj = result.body.draft || {};
        const syncedPost = syncApprovedWebMemoToResearchStore(researchStore, {
          symbol: rb.symbol || draftObj.symbol,
          portfolioId: rb.portfolioId || draftObj.portfolioId,
          memo: rb.memo || draftObj.proposedMemo,
          analysisSummary: draftObj.analysisSummary || "",
          memoRevision: rb.memoRevision,
          updatedAt: rb.memoUpdatedAt,
          draftId: draftObj.draftId
        });
        if (syncedPost) {
          writeResearchStore(researchStore);
          result.body.readback.researchPostSynced = true;
          result.body.readback.researchPostId = syncedPost.id;
        }
      }
      return sendJson(res, result.status, result.body, result.headers || {});
    }
  }

  // 0c. GET SHARED RESEARCH FEED & WATCHLIST SUPPORT/RESISTANCE 1-2-3 (Accessible by all SyncKeys)
  if (pathname === "/api/research-feed" && req.method === "GET") {
    const query = parsedUrl.query || {};
    const syncKey = String(query.key || "VENU2-88").trim().toUpperCase();
    getOrCreateProfile(syncKey);
    const portfoliosStore = readStore();
    const researchStore = readResearchStore();
    const feedPayload = buildPublicResearchFeedPayload({
      researchStore,
      portfoliosStore,
      syncKey,
      tagFilter: query.tag,
      symbolFilter: query.symbol,
      includeArchived: query.includeArchived === "1" || query.includeArchived === "true"
    });
    if (feedPayload.sweep && feedPayload.sweep.dirty) {
      writeResearchStore(researchStore);
    }
    return sendJson(res, 200, feedPayload);
  }

  // 1. GET /api/portfolio?key=VENU2-88 (Full Web Companion + Watch Preview Payload)
  if (pathname === "/api/portfolio" && req.method === "GET") {
    const syncKey = parsedUrl.query.key || "VENU2-88";
    const profile = getOrCreateProfile(syncKey);
    const payload = await buildEnrichedPayload(profile, {
      deviceId: parsedUrl.query.did,
      activationKey: parsedUrl.query.akey,
      watchModel: parsedUrl.query.model
    });
    const researchStore = readResearchStore();
    const researchFeed = buildPublicResearchFeedPayload({
      researchStore,
      portfoliosStore: readStore(),
      syncKey
    });
    if (researchFeed.sweep && researchFeed.sweep.dirty) {
      writeResearchStore(researchStore);
    }
    payload.researchFeed = researchFeed;
    return sendJson(res, 200, payload);
  }

  // 2. PUT /api/portfolio (Save updated portfolios, holdings, memos, baseCurrency, watchSettings)
  if (pathname === "/api/portfolio" && (req.method === "PUT" || req.method === "POST")) {
    try {
      const body = await parseBody(req);
      const syncKey = (body.syncKey || "VENU2-88").trim().toUpperCase();
      const existing = getOrCreateProfile(syncKey);
      const store = readStore();
      const mergedWatchSettings = sanitizeWatchSettings(body.watchSettings || {}, existing.watchSettings);

      const normalizedPortfolios = normalizePortfoliosInput(body.portfolios, existing.portfolios);
      const reconciled = reconcileWebPortfolioSave({
        currentServerPortfolios: existing.portfolios,
        normalizedClientPortfolios: normalizedPortfolios,
        rawClientPortfolios: body.portfolios
      });

      store[syncKey] = {
        syncKey,
        baseCurrency: body.baseCurrency === "USD" ? "USD" : "THB",
        updatedAt: new Date().toISOString(),
        watchSettings: mergedWatchSettings,
        portfolios: reconciled.portfolios
      };
      // If user paired a physical Garmin Device ID (e.g. V2-XXXXXXXX) whose watch auto-syncs via its Device ID, keep that device profile in sync
      const boundDid = mergedWatchSettings.deviceId;
      if (boundDid && boundDid !== "V2-88VENU20" && boundDid !== syncKey && store[boundDid]) {
        store[boundDid] = {
          ...store[syncKey],
          syncKey: boundDid,
          watchSettings: {
            ...mergedWatchSettings,
            activationKey: store[boundDid].watchSettings?.activationKey || mergedWatchSettings.activationKey
          }
        };
      }
      writeStore(store);

      const payload = await buildEnrichedPayload(store[syncKey], {
        deviceId: mergedWatchSettings.deviceId,
        activationKey: mergedWatchSettings.activationKey,
        watchModel: mergedWatchSettings.watchModel
      });
      return sendJson(res, 200, payload);
    } catch (err) {
      return sendJson(res, 400, { error: "Invalid request payload", details: err.message });
    }
  }

  // 2b. POST /api/refresh (Clear cache and return fresh quotes)
  if (pathname === "/api/refresh" && req.method === "POST") {
    const body = await parseBody(req).catch(() => ({}));
    const syncKey = (body.syncKey || parsedUrl.query.key || "VENU2-88").trim().toUpperCase();
    clearMarketCache();
    const profile = getOrCreateProfile(syncKey);
    const payload = await buildEnrichedPayload(profile);
    return sendJson(res, 200, payload);
  }

  // 2c. GET /api/search?q=NVDA (Quick autocomplete catalog)
  if (pathname === "/api/search" && req.method === "GET") {
    const q = String(parsedUrl.query.q || "").trim().toUpperCase();
    const catalog = [
      { symbol: "NVDA", name: "NVIDIA Corp", currency: "USD", exchange: "NASDAQ" },
      { symbol: "MSFT", name: "Microsoft Corp", currency: "USD", exchange: "NASDAQ" },
      { symbol: "AAPL", name: "Apple Inc", currency: "USD", exchange: "NASDAQ" },
      { symbol: "GOOGL", name: "Alphabet Inc", currency: "USD", exchange: "NASDAQ" },
      { symbol: "AMZN", name: "Amazon.com Inc", currency: "USD", exchange: "NASDAQ" },
      { symbol: "META", name: "Meta Platforms", currency: "USD", exchange: "NASDAQ" },
      { symbol: "TSLA", name: "Tesla Inc", currency: "USD", exchange: "NASDAQ" },
      { symbol: "BRK-B", name: "Berkshire Hathaway B", currency: "USD", exchange: "NYSE" },
      { symbol: "TSM", name: "Taiwan Semiconductor", currency: "USD", exchange: "NYSE" },
      { symbol: "AVGO", name: "Broadcom Inc", currency: "USD", exchange: "NASDAQ" },
      { symbol: "SCHD", name: "Schwab US Dividend ETF", currency: "USD", exchange: "NYSE" },
      { symbol: "QQQ", name: "Invesco QQQ Trust", currency: "USD", exchange: "NASDAQ" },
      { symbol: "VOO", name: "Vanguard S&P 500 ETF", currency: "USD", exchange: "NYSE" },
      { symbol: "ADVANC.BK", name: "Advanced Info Service (AIS)", currency: "THB", exchange: "SET" },
      { symbol: "DELTA.BK", name: "Delta Electronics Thailand", currency: "THB", exchange: "SET" },
      { symbol: "PTTEP.BK", name: "PTT Exploration & Prod", currency: "THB", exchange: "SET" },
      { symbol: "BDMS.BK", name: "Bangkok Dusit Medical", currency: "THB", exchange: "SET" },
      { symbol: "AOT.BK", name: "Airports of Thailand", currency: "THB", exchange: "SET" },
      { symbol: "SCB.BK", name: "SCB X Public Co", currency: "THB", exchange: "SET" },
      { symbol: "KBANK.BK", name: "Kasikornbank", currency: "THB", exchange: "SET" },
      { symbol: "CPALL.BK", name: "CP ALL Public Co", currency: "THB", exchange: "SET" },
      { symbol: "BTC-USD", name: "Bitcoin USD", currency: "USD", exchange: "CRYPTO" },
      { symbol: "ETH-USD", name: "Ethereum USD", currency: "USD", exchange: "CRYPTO" },
      { symbol: "SOL-USD", name: "Solana USD", currency: "USD", exchange: "CRYPTO" },
      { symbol: "GC=F", name: "Gold Futures", currency: "USD", exchange: "COMEX" }
    ];
    const results = catalog.filter(
      (item) => item.symbol.includes(q) || item.name.toUpperCase().includes(q)
    ).slice(0, 6);
    return sendJson(res, 200, { results });
  }

  // 3. GET /api/watch?key=VENU2-88&did=V2-XXXX&akey=... (Compact JSON endpoint for Garmin Watch App)
  if ((pathname === "/api/watch" || pathname.startsWith("/api/watch/")) && req.method === "GET") {
    const pathKey = pathname.startsWith("/api/watch/") ? pathname.replace("/api/watch/", "") : "";
    const rawSyncKey = pathKey || parsedUrl.query.key || "";
    const profile = resolveWatchProfile(
      readStore(),
      rawSyncKey,
      parsedUrl.query.did,
      getOrCreateProfile,
      licenseManager
    );
    const payload = await buildEnrichedPayload(profile, {
      deviceId: parsedUrl.query.did,
      activationKey: parsedUrl.query.akey,
      watchModel: parsedUrl.query.model
    });
    return sendJson(res, 200, payload.watch);
  }

  // 4. GET /api/quote?symbol=TSLA (Quick symbol lookup when adding holding)
  if (pathname === "/api/quote" && req.method === "GET") {
    const sym = parsedUrl.query.symbol || "AAPL";
    const quote = await fetchSymbolMarketData(sym);
    return sendJson(res, 200, quote);
  }

  // 5. POST /api/device/activate (Activate a Garmin Device ID using an Admin-generated Activation Key)
  if (pathname === "/api/device/activate" && req.method === "POST") {
    const rl = checkRateLimit(req, "device_activate", 15, 5 * 60 * 1000);
    if (!rl.allowed) {
      return sendJson(
        res,
        429,
        { ok: false, error: `Too many activation attempts. Please wait ${rl.retryAfterSec}s.` },
        { "Retry-After": String(rl.retryAfterSec) }
      );
    }

    try {
      const body = await parseBody(req);
      const syncKey = String(body.syncKey || "VENU2-88").trim().toUpperCase();
      const profile = getOrCreateProfile(syncKey);
      const deviceId = licenseManager.normalizeDeviceId(body.deviceId || profile.watchSettings.deviceId);
      const activationKey = licenseManager.normalizeKey(body.activationKey || "");

      const result = licenseManager.activateDevice(deviceId, activationKey, {
        syncKey,
        actor: "web-companion"
      });
      if (!result.ok) {
        return sendJson(res, 400, result);
      }

      // Persist activated deviceId + key in the profile watchSettings
      const store = readStore();
      if (store[syncKey]) {
        store[syncKey].watchSettings = sanitizeWatchSettings(
          {
            ...store[syncKey].watchSettings,
            deviceId,
            activationKey: result.license.activatedKey
          },
          store[syncKey].watchSettings
        );
        writeStore(store);
      }

      const payload = await buildEnrichedPayload(getOrCreateProfile(syncKey), {
        deviceId,
        activationKey: result.license.activatedKey
      });
      return sendJson(res, 200, {
        ok: true,
        message: result.message,
        license: licenseManager.toPublicLicenseState(result.license),
        payload
      });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  }

  // 6. GET /api/device/status (Public device status check - strips unactivated issuedKey)
  if (pathname === "/api/device/status" && req.method === "GET") {
    const syncKey = String(parsedUrl.query.key || "VENU2-88").trim().toUpperCase();
    const profile = getOrCreateProfile(syncKey);
    const deviceId = licenseManager.normalizeDeviceId(parsedUrl.query.did || profile.watchSettings.deviceId);
    const evaluated = licenseManager.evaluateDeviceLicense(deviceId, {
      syncKey,
      providedKey: profile.watchSettings.activationKey
    });
    return sendJson(res, 200, {
      watch: evaluated.watch,
      full: evaluated.public,
      public: evaluated.public
    });
  }

  // 6b. POST /api/license/request (Request Trial Key Extend or Submit Purchase Request Form -> Emails e24qdy2@gmail.com)
  if (pathname === "/api/license/request" && req.method === "POST") {
    const rl = checkRateLimit(req, "license_request", 10, 10 * 60 * 1000);
    if (!rl.allowed) {
      return sendJson(
        res,
        429,
        { ok: false, error: `Too many requests. Please wait ${rl.retryAfterSec}s before submitting again.` },
        { "Retry-After": String(rl.retryAfterSec) }
      );
    }

    try {
      const body = await parseBody(req);
      const syncKey = String(body.syncKey || "VENU2-88").trim().toUpperCase();
      const profile = getOrCreateProfile(syncKey);
      const deviceId = licenseManager.normalizeDeviceId(body.deviceId || profile.watchSettings.deviceId);

      const created = licenseManager.createCustomerRequest({
        ...body,
        deviceId,
        syncKey
      });
      if (!created.ok) {
        return sendJson(res, 400, created);
      }

      const emailNotification = await emailService.sendCustomerRequestEmail(created.request);
      const isTrialExtend = created.request.requestType === "TRIAL_EXTEND";

      return sendJson(res, 200, {
        ok: true,
        message: isTrialExtend
          ? `Trial extension request (+${created.request.requestedExtendDays} days) submitted! Notification sent to ${emailNotification.to}.`
          : `PRO License purchase request submitted! Contact details sent to ${emailNotification.to}.`,
        request: created.request,
        device: licenseManager.toPublicLicenseState(created.device),
        emailNotification,
        emailDelivery: emailNotification
      });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  }

  // =========================================================================
  // 7. ADMIN PORTAL API (https://admin-moat.readybyte.top / saharat.bun@icloud.com)
  // =========================================================================
  if (pathname === "/api/admin/session" && req.method === "GET") {
    const auth = licenseManager.verifyAdminRequest(req);
    const meta = licenseManager.getAdminAuthMeta({ includeSensitive: auth.authenticated });
    const extraHeaders =
      !auth.authenticated && String(req.headers["cookie"] || "").includes("__moat_admin_session=")
        ? { "Set-Cookie": "__moat_admin_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict" }
        : {};
    return sendAdminJson(
      req,
      res,
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

  if (pathname === "/api/admin/auth/login" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const clientIp = getClientIp(req);
      const result = licenseManager.loginAdminWithPassword(
        body.email || OWNER_EMAIL,
        body.password,
        { ip: clientIp }
      );
      if (result.ok && result.token) {
        const maxAgeSec = Math.max(60, Number(result.expiresInSec || 1800));
        const cookieFlags = [
          `__moat_admin_session=${encodeURIComponent(result.token)}`,
          "HttpOnly",
          "Path=/",
          `Max-Age=${maxAgeSec}`,
          "SameSite=Strict"
        ];
        if (req.headers["x-forwarded-proto"] === "https" || hostHeader.endsWith(".readybyte.top")) {
          cookieFlags.push("Secure");
        }
        return sendAdminJson(req, res, 200, result, {
          "Set-Cookie": cookieFlags.join("; ")
        });
      }
      const status = result.lockedOut ? 429 : 401;
      const extra = result.lockedOut && result.retryAfterSec ? { "Retry-After": String(result.retryAfterSec) } : {};
      return sendAdminJson(req, res, status, result, extra);
    } catch (err) {
      return sendAdminJson(req, res, 400, { ok: false, error: err.message });
    }
  }

  if (pathname === "/api/admin/auth/logout" && req.method === "POST") {
    licenseManager.logoutAdminSession(req);
    return sendAdminJson(
      req,
      res,
      200,
      { ok: true, message: "Logged out of Admin session" },
      {
        "Set-Cookie": "__moat_admin_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict"
      }
    );
  }

  if (pathname === "/api/admin/auth/request-otp" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const result = licenseManager.requestAdminOtp(body.email || OWNER_EMAIL);
      return sendAdminJson(req, res, result.ok ? 200 : 403, result);
    } catch (err) {
      return sendAdminJson(req, res, 400, { ok: false, error: err.message });
    }
  }

  if (pathname === "/api/admin/auth/verify-otp" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const result = licenseManager.verifyAdminOtp(body.email || OWNER_EMAIL, body.code);
      return sendAdminJson(req, res, result.ok ? 200 : 401, result);
    } catch (err) {
      return sendAdminJson(req, res, 400, { ok: false, error: err.message });
    }
  }

  if (pathname.startsWith("/api/admin/")) {
    const auth = licenseManager.verifyAdminRequest(req);
    if (!auth.authenticated) {
      return sendAdminJson(req, res, 401, {
        ok: false,
        error: `Admin authentication required (${OWNER_EMAIL})`,
        ownerEmail: OWNER_EMAIL
      });
    }

    if (pathname === "/api/admin/auth/change-password" && req.method === "POST") {
      try {
        const body = await parseBody(req);
        const result = licenseManager.changeAdminPassword(
          auth.email || OWNER_EMAIL,
          body.currentPassword,
          body.newPassword,
          body.confirmPassword
        );
        if (!result.ok) {
          return sendAdminJson(req, res, 400, result);
        }
        return sendAdminJson(req, res, 200, {
          ...result,
          ...licenseManager.listDevices(),
          smtpConfig: emailService.getSmtpConfig(false)
        });
      } catch (err) {
        return sendAdminJson(req, res, 400, { ok: false, error: err.message });
      }
    }

    if (pathname === "/api/admin/devices" && req.method === "GET") {
      const meta = licenseManager.getAdminAuthMeta({ includeSensitive: true });
      const portfoliosStore = readStore();
      const researchStore = readResearchStore();
      const nodeState = readHermesNodeState();
      const licensesData = licenseManager.listDevices();
      const draftsList = readDraftsStore();
      const researchFeed = buildPublicResearchFeedPayload({
        researchStore,
        portfoliosStore,
        syncKey: "VENU2-88",
        includeArchived: true
      });
      const biAnalytics = buildAdminBiAnalytics({
        portfoliosStore,
        licensesData,
        draftsList,
        researchStore
      });
      if (researchFeed.sweep && researchFeed.sweep.dirty) {
        writeResearchStore(researchStore);
      }
      return sendAdminJson(req, res, 200, {
        ok: true,
        admin: { ...auth, ...meta },
        ...licensesData,
        compatibleDevices: COMPATIBLE_GARMIN_DEVICES,
        smtpConfig: emailService.getSmtpConfig(false),
        researchFeed,
        biAnalytics,
        hermesNode: buildHermesNodeStatusPayload(nodeState)
      });
    }

    if (pathname === "/api/admin/bi-dashboard" && req.method === "GET") {
      const portfoliosStore = readStore();
      const researchStore = readResearchStore();
      const nodeState = readHermesNodeState();
      const licensesData = licenseManager.listDevices();
      const draftsList = readDraftsStore();
      const biAnalytics = buildAdminBiAnalytics({
        portfoliosStore,
        licensesData,
        draftsList,
        researchStore
      });
      const researchFeed = buildPublicResearchFeedPayload({
        researchStore,
        portfoliosStore,
        syncKey: "VENU2-88",
        includeArchived: true
      });
      if (researchFeed.sweep && researchFeed.sweep.dirty) {
        writeResearchStore(researchStore);
      }
      return sendAdminJson(req, res, 200, {
        ok: true,
        biAnalytics,
        researchFeed,
        hermesNode: buildHermesNodeStatusPayload(nodeState)
      });
    }

    if (pathname === "/api/admin/hermes-node/status" && req.method === "GET") {
      const nodeState = readHermesNodeState();
      return sendAdminJson(req, res, 200, buildHermesNodeStatusPayload(nodeState));
    }

    if (pathname === "/api/admin/hermes-node/diagnostics" && req.method === "POST") {
      try {
        const portfoliosStore = readStore();
        const researchStore = readResearchStore();
        const nodeState = readHermesNodeState();
        const licensesData = licenseManager.listDevices();
        const draftsList = readDraftsStore();
        const integrationConfig = resolveIntegrationConfig(process.env);
        const report = await runHermesFunctionalDiagnostics({
          nodeState,
          portfoliosStore,
          researchStore,
          licensesData,
          draftsList,
          integrationConfig,
          buildPublicResearchFeedPayload,
          buildAdminBiAnalytics
        });
        writeHermesNodeState(nodeState);
        return sendAdminJson(req, res, 200, {
          ok: true,
          report,
          nodeStatus: buildHermesNodeStatusPayload(nodeState)
        });
      } catch (err) {
        return sendAdminJson(req, res, 400, { ok: false, error: err.message });
      }
    }

    if (pathname === "/api/admin/hermes-node/command" && req.method === "POST") {
      try {
        const body = await parseBody(req);
        const action = String(body.action || "").trim().toUpperCase();
        const portfoliosStore = readStore();
        const researchStore = readResearchStore();
        let nodeState = readHermesNodeState();
        let diagnosticReport = null;

        if (action === "TEST_ALL_FUNCTIONS") {
          const licensesData = licenseManager.listDevices();
          const draftsList = readDraftsStore();
          const integrationConfig = resolveIntegrationConfig(process.env);
          diagnosticReport = await runHermesFunctionalDiagnostics({
            nodeState,
            portfoliosStore,
            researchStore,
            licensesData,
            draftsList,
            integrationConfig,
            buildPublicResearchFeedPayload,
            buildAdminBiAnalytics
          });
        }

        const enq = enqueueHermesCommand(
          nodeState,
          { action, reason: body.reason || "" },
          { actor: auth.email || OWNER_EMAIL }
        );
        if (!enq.ok) {
          return sendAdminJson(req, res, enq.status || 400, enq);
        }
        nodeState = enq.state;
        writeHermesNodeState(nodeState);
        return sendAdminJson(req, res, 200, {
          ok: true,
          command: enq.command,
          diagnosticReport,
          nodeStatus: buildHermesNodeStatusPayload(nodeState)
        });
      } catch (err) {
        return sendAdminJson(req, res, 400, { ok: false, error: err.message });
      }
    }

    if (pathname === "/api/admin/research-posts" && req.method === "GET") {
      const query = parsedUrl.query || {};
      const portfoliosStore = readStore();
      const researchStore = readResearchStore();
      const researchFeed = buildPublicResearchFeedPayload({
        researchStore,
        portfoliosStore,
        syncKey: "VENU2-88",
        tagFilter: query.tag,
        symbolFilter: query.symbol,
        includeArchived: true
      });
      const licensesData = licenseManager.listDevices();
      const draftsList = readDraftsStore();
      const biAnalytics = buildAdminBiAnalytics({
        portfoliosStore,
        licensesData,
        draftsList,
        researchStore
      });
      if (researchFeed.sweep && researchFeed.sweep.dirty) {
        writeResearchStore(researchStore);
      }
      return sendAdminJson(req, res, 200, {
        ok: true,
        researchFeed,
        biAnalytics
      });
    }

    if (
      pathname === "/api/admin/research-posts" &&
      (req.method === "POST" || req.method === "PUT" || req.method === "DELETE")
    ) {
      try {
        const body = await parseBody(req);
        const portfoliosStore = readStore();
        const researchStore = readResearchStore();
        const action =
          req.method === "DELETE"
            ? "DELETE"
            : body.action || "UPSERT";
        const mutRes = mutateResearchStore(
          researchStore,
          { ...body, action },
          { actor: auth.email || OWNER_EMAIL }
        );
        if (!mutRes.ok) {
          return sendAdminJson(req, res, mutRes.status || 400, mutRes);
        }
        writeResearchStore(researchStore);
        const researchFeed = buildPublicResearchFeedPayload({
          researchStore,
          portfoliosStore,
          syncKey: "VENU2-88",
          includeArchived: true
        });
        const licensesData = licenseManager.listDevices();
        const draftsList = readDraftsStore();
        const biAnalytics = buildAdminBiAnalytics({
          portfoliosStore,
          licensesData,
          draftsList,
          researchStore
        });
        return sendAdminJson(req, res, mutRes.status || 200, {
          ...mutRes,
          posts: researchFeed.posts,
          researchFeed,
          biAnalytics
        });
      } catch (err) {
        return sendAdminJson(req, res, 400, { ok: false, error: err.message });
      }
    }

    if (pathname === "/api/admin/requests/resolve" && req.method === "POST") {
      try {
        const body = await parseBody(req);
        if (!body.requestId || !body.action) {
          return sendAdminJson(req, res, 400, { ok: false, error: "requestId and action are required" });
        }
        const resolved = licenseManager.resolveCustomerRequest(body.requestId, body.action, {
          note: body.note,
          actor: auth.email || OWNER_EMAIL
        });
        if (!resolved.ok) {
          return sendAdminJson(req, res, 400, resolved);
        }

        // If approved purchase & activated PRO, sync key to portfolio profile watchSettings
        if (
          String(body.action).toUpperCase() === "APPROVE_PURCHASE_ACTIVATE" &&
          resolved.deviceUpdate &&
          resolved.deviceUpdate.activationKey
        ) {
          const syncKey = String(resolved.request?.syncKey || "VENU2-88").trim().toUpperCase();
          const store = readStore();
          if (store[syncKey]) {
            store[syncKey].watchSettings = sanitizeWatchSettings(
              {
                ...store[syncKey].watchSettings,
                deviceId: resolved.deviceUpdate.deviceId,
                activationKey: resolved.deviceUpdate.activationKey
              },
              store[syncKey].watchSettings
            );
            writeStore(store);
          }
        }

        return sendAdminJson(req, res, 200, {
          ...resolved,
          ...licenseManager.listDevices(),
          smtpConfig: emailService.getSmtpConfig(false)
        });
      } catch (err) {
        return sendAdminJson(req, res, 400, { ok: false, error: err.message });
      }
    }

    if (pathname === "/api/admin/email/config" && req.method === "GET") {
      return sendAdminJson(req, res, 200, {
        ok: true,
        smtpConfig: emailService.getSmtpConfig(false),
        emailLogs: emailService.listEmailLogs(30)
      });
    }

    if (pathname === "/api/admin/email/config" && req.method === "POST") {
      try {
        const body = await parseBody(req);
        const smtpConfig = emailService.updateSmtpConfig(body);
        return sendAdminJson(req, res, 200, {
          ok: true,
          message: "SMTP / System Mail configuration saved successfully.",
          smtpConfig,
          emailLogs: emailService.listEmailLogs(30)
        });
      } catch (err) {
        return sendAdminJson(req, res, 400, { ok: false, error: err.message });
      }
    }

    if (pathname === "/api/admin/email/test" && req.method === "POST") {
      try {
        const body = await parseBody(req);
        if (body.smtpConfig && typeof body.smtpConfig === "object") {
          emailService.updateSmtpConfig(body.smtpConfig);
        }
        const mailResult = await emailService.sendTestEmail(body.note);
        return sendAdminJson(req, res, 200, {
          ok: true,
          message: `Test email sent to ${mailResult.to} (${mailResult.status})`,
          mailResult,
          delivery: mailResult,
          smtpConfig: emailService.getSmtpConfig(false),
          emailLogs: emailService.listEmailLogs(30)
        });
      } catch (err) {
        return sendAdminJson(req, res, 400, { ok: false, error: err.message });
      }
    }

    if (pathname === "/api/admin/devices/generate-key" && req.method === "POST") {
      try {
        const body = await parseBody(req);
        if (!body.deviceId) {
          return sendAdminJson(req, res, 400, { ok: false, error: "deviceId is required" });
        }
        const issued = licenseManager.issueDeviceKey(body.deviceId, {
          syncKey: body.syncKey || "VENU2-88",
          label: body.label,
          notes: body.notes,
          autoActivate: Boolean(body.autoActivate),
          actor: auth.email
        });

        // If autoActivate is set and matches the profile's device, also sync to portfolio profile
        if (body.autoActivate) {
          const syncKey = String(body.syncKey || "VENU2-88").trim().toUpperCase();
          const store = readStore();
          if (store[syncKey]) {
            store[syncKey].watchSettings = sanitizeWatchSettings(
              {
                ...store[syncKey].watchSettings,
                deviceId: issued.deviceId,
                activationKey: issued.activationKey
              },
              store[syncKey].watchSettings
            );
            writeStore(store);
          }
        }

        return sendAdminJson(req, res, 200, {
          ...issued,
          ...licenseManager.listDevices()
        });
      } catch (err) {
        return sendAdminJson(req, res, 400, { ok: false, error: err.message });
      }
    }

    if (
      (pathname === "/api/admin/devices/update" || pathname === "/api/admin/devices/remove-keys") &&
      req.method === "POST"
    ) {
      try {
        const body = await parseBody(req);
        const action =
          pathname === "/api/admin/devices/remove-keys"
            ? body.action || "REMOVE_KEY"
            : body.action;
        const updated = licenseManager.adminUpdateDevice(body.deviceId, action, {
          deviceIds: body.deviceIds,
          days: body.days,
          label: body.label,
          notes: body.notes,
          syncKey: body.syncKey,
          actor: auth.email
        });
        if (!updated.ok) {
          return sendAdminJson(req, res, 400, updated);
        }

        // Sync activationKey removal if expired/revoked/reset/removed/deleted so profile reflects state immediately
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
          const store = readStore();
          for (const prof of Object.values(store)) {
            for (const tid of targetIds) {
              if (
                prof.watchSettings &&
                (prof.watchSettings.deviceId === tid ||
                  licenseManager.verifyActivationKey(tid, prof.watchSettings.activationKey))
              ) {
                prof.watchSettings.activationKey = "";
              }
            }
          }
          writeStore(store);
        } else if (act === "ACTIVATE" && updated.device) {
          const store = readStore();
          for (const prof of Object.values(store)) {
            if (prof.watchSettings && prof.watchSettings.deviceId === updated.deviceId) {
              prof.watchSettings.activationKey = updated.device.activatedKey;
            }
          }
          writeStore(store);
        }

        return sendAdminJson(req, res, 200, {
          ...updated,
          ...licenseManager.listDevices()
        });
      } catch (err) {
        return sendAdminJson(req, res, 400, { ok: false, error: err.message });
      }
    }
  }

  // Static file serving (with subdomain routing for admin-moat.readybyte.top)
  let safePath;
  if (pathname === "/" || pathname === "/index.html") {
    safePath = isAdminSubdomain ? "/admin.html" : "/index.html";
  } else if (pathname === "/admin") {
    safePath = "/admin.html";
  } else if (pathname === "/privacy" || pathname === "/privacy/") {
    safePath = "/privacy.html";
  } else {
    safePath = pathname;
  }

  const filePath = path.join(PUBLIC_DIR, path.normalize(safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, SECURITY_HEADERS);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not Found");
    }
    const ext = path.extname(filePath).toLowerCase();
    const isDynamicAsset = [".html", ".js", ".css", ".json"].includes(ext);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      ...(isDynamicAsset
        ? {
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
            Pragma: "no-cache",
            Expires: "0",
            "CDN-Cache-Control": "no-store",
            "Cloudflare-CDN-Cache-Control": "no-store"
          }
        : {})
    });
    res.end(content);
  });
}

function createAppServer() {
  return http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      sendJson(res, 500, { error: "Internal Server Error", details: err.message });
    });
  });
}

if (require.main === module) {
  const server = createAppServer();
  server.listen(PORT, () => {
    console.log(`[GarminMoat] Server running at http://localhost:${PORT}`);
    console.log(`[GarminMoat] Garmin Connect IQ Watch API: http://localhost:${PORT}/api/watch?key=VENU2-88`);
    console.log(`[GarminMoat] Compatible Garmin Watches: ${COMPATIBLE_GARMIN_DEVICES.length} models (2024-2026)`);
    console.log(`[GarminMoat] Admin Portal (Subdomain): http://localhost:${PORT}/admin (https://admin-moat.readybyte.top)`);
  });
}

module.exports = {
  createAppServer,
  handleRequest,
  licenseManager,
  emailService,
  COMPATIBLE_GARMIN_DEVICES
};
