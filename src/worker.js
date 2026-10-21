import licenseMod from "../lib/licenseManager.js";
import emailMod from "../lib/emailService.js";
import garminMod from "../lib/garminDevices.js";
import seedMod from "./seedData.js";

const { LicenseManager, OWNER_EMAIL, NOTIFY_EMAIL, TRIAL_DAYS } = licenseMod;
const { EmailService } = emailMod;
const { COMPATIBLE_GARMIN_DEVICES, getGarminDeviceById } = garminMod;
const { INITIAL_PORTFOLIOS_STORE, INITIAL_LICENSES_STORE } = seedMod;

const DEFAULT_WATCH_SETTINGS = {
  autoSwipeEnabled: true,
  autoSwipeSec: 5,
  alwaysOnDisplay: false,
  sortByPctOrder: "ASC",
  sortByPctMetric: "DAY",
  deviceId: "V2-88VENU20",
  watchModel: "venu2",
  activationKey: ""
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com https://cdn.jsdelivr.net https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com https://cdn.jsdelivr.net; font-src 'self' https://fonts.gstatic.com https://unpkg.com https://cdn.jsdelivr.net data:; img-src 'self' data: https:; connect-src 'self' https://cloudflareinsights.com https://*.cloudflareinsights.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'"
};

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
  const autoSwipeEnabled =
    raw.autoSwipeEnabled !== undefined ? Boolean(raw.autoSwipeEnabled) : Boolean(fallback.autoSwipeEnabled ?? true);
  const parsedSec = Number(raw.autoSwipeSec !== undefined ? raw.autoSwipeSec : fallback.autoSwipeSec || 5);
  const autoSwipeSec = Number.isFinite(parsedSec) ? Math.max(2, Math.min(120, Math.round(parsedSec))) : 5;
  const alwaysOnDisplay =
    raw.alwaysOnDisplay !== undefined ? Boolean(raw.alwaysOnDisplay) : Boolean(fallback.alwaysOnDisplay ?? false);
  const rawSortOrder = String(
    raw.sortByPctOrder !== undefined ? raw.sortByPctOrder : fallback.sortByPctOrder || "ASC"
  )
    .trim()
    .toUpperCase();
  const sortByPctOrder = ["ASC", "DESC", "NONE"].includes(rawSortOrder) ? rawSortOrder : "ASC";
  const rawSortMetric = String(
    raw.sortByPctMetric !== undefined ? raw.sortByPctMetric : fallback.sortByPctMetric || "DAY"
  )
    .trim()
    .toUpperCase();
  const sortByPctMetric = ["DAY", "TOTAL"].includes(rawSortMetric) ? rawSortMetric : "DAY";
  const deviceId = licenseManagerInstance.normalizeDeviceId(raw.deviceId || fallback.deviceId || "V2-88VENU20");
  const watchModelObj = getGarminDeviceById(raw.watchModel || fallback.watchModel || "venu2");
  const watchModel = watchModelObj ? watchModelObj.id : "venu2";
  const activationKey = licenseManagerInstance.normalizeKey(
    raw.activationKey !== undefined ? raw.activationKey : fallback.activationKey || ""
  );
  return {
    autoSwipeEnabled,
    autoSwipeSec,
    alwaysOnDisplay,
    sortByPctOrder,
    sortByPctMetric,
    deviceId,
    watchModel,
    activationKey
  };
}

function getOrCreateProfile(syncKey) {
  const key = (syncKey || "VENU2-88").trim().toUpperCase();
  if (!runtimePortfoliosStore[key]) {
    const template = runtimePortfoliosStore["VENU2-88"] || INITIAL_PORTFOLIOS_STORE["VENU2-88"];
    runtimePortfoliosStore[key] = deepClone(template);
    runtimePortfoliosStore[key].syncKey = key;
    runtimePortfoliosStore[key].updatedAt = new Date().toISOString();
  }
  if (!runtimePortfoliosStore[key].watchSettings) {
    runtimePortfoliosStore[key].watchSettings = { ...DEFAULT_WATCH_SETTINGS };
  } else {
    runtimePortfoliosStore[key].watchSettings = sanitizeWatchSettings(runtimePortfoliosStore[key].watchSettings);
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

// Market data cache (30s TTL so every 60s watch/web auto-refresh fetches live Yahoo quotes)
const marketCache = new Map();
const CACHE_TTL_MS = 30 * 1000;

async function fetchJsonHttps(targetUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  try {
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
        Accept: "application/json"
      },
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const FALLBACK_BASE = {
  "NVDA": { price: 138.60, prevClose: 134.80, dayHigh: 139.90, dayLow: 135.10, currency: "USD", name: "NVIDIA Corp" },
  "MSFT": { price: 428.50, prevClose: 424.10, dayHigh: 430.80, dayLow: 423.20, currency: "USD", name: "Microsoft Corp" },
  "AAPL": { price: 231.20, prevClose: 229.40, dayHigh: 232.90, dayLow: 228.70, currency: "USD", name: "Apple Inc" },
  "GOOGL": { price: 181.40, prevClose: 179.10, dayHigh: 182.75, dayLow: 178.60, currency: "USD", name: "Alphabet Inc" },
  "BRK-B": { price: 454.80, prevClose: 452.00, dayHigh: 456.50, dayLow: 451.10, currency: "USD", name: "Berkshire Hathaway B" },
  "ADVANC.BK": { price: 284.00, prevClose: 281.00, dayHigh: 286.00, dayLow: 280.00, currency: "THB", name: "Advanced Info Service" },
  "DELTA.BK": { price: 129.50, prevClose: 126.00, dayHigh: 131.00, dayLow: 125.50, currency: "THB", name: "Delta Electronics Thai" },
  "PTTEP.BK": { price: 126.50, prevClose: 128.00, dayHigh: 128.50, dayLow: 125.50, currency: "THB", name: "PTT Exploration" },
  "BDMS.BK": { price: 28.75, prevClose: 28.50, dayHigh: 29.00, dayLow: 28.25, currency: "THB", name: "Bangkok Dusit Med" },
  "BTC-USD": { price: 89450.00, prevClose: 87920.00, dayHigh: 90200.00, dayLow: 87450.00, currency: "USD", name: "Bitcoin USD" },
  "SCHD": { price: 29.15, prevClose: 28.98, dayHigh: 29.32, dayLow: 28.90, currency: "USD", name: "Schwab US Dividend ETF" },
  "QQQ": { price: 508.40, prevClose: 504.10, dayHigh: 510.20, dayLow: 503.40, currency: "USD", name: "Invesco QQQ Trust" },
  "THB=X": { price: 34.45, prevClose: 34.52, dayHigh: 34.60, dayLow: 34.35, currency: "THB", name: "USD/THB" }
};

const NON_EARNINGS_SYMBOLS = new Set([
  "BTC-USD",
  "ETH-USD",
  "SOL-USD",
  "SCHD",
  "QQQ",
  "VOO",
  "SPY",
  "IVV",
  "VTI",
  "THB=X",
  "GC=F",
  "SI=F",
  "CL=F"
]);

const KNOWN_EARNINGS_DATES = {
  "NVDA": "17/11/26",
  "MSFT": "28/10/26",
  "AAPL": "02/11/26",
  "GOOGL": "28/10/26",
  "GOOG": "28/10/26",
  "TSM": "14/01/27",
  "AMZN": "29/10/26",
  "META": "21/10/26",
  "TSLA": "21/10/26",
  "AVGO": "09/12/26",
  "AMD": "03/11/26",
  "NFLX": "19/01/27",
  "ORCL": "14/12/26",
  "PLTR": "02/11/26",
  "LLY": "29/10/26",
  "ASTS": "09/11/26",
  "BABA": "24/11/26",
  "CEG": "09/11/26",
  "CIFR": "02/11/26",
  "CRWV": "11/11/26",
  "EOSE": "05/11/26",
  "IREN": "05/11/26",
  "LITE": "05/11/26",
  "LRCX": "21/10/26",
  "MELI": "04/11/26",
  "NBIS": "10/11/26",
  "NET": "05/11/26",
  "NVO": "04/11/26",
  "OKLO": "10/11/26",
  "ONDS": "12/11/26",
  "PANW": "19/11/26",
  "RKLB": "09/11/26",
  "SOFI": "27/10/26",
  "SPGI": "27/10/26",
  "TEM": "02/11/26",
  "TMDX": "29/10/26",
  "WDC": "22/10/26",
  "BRK-B": "07/11/26",
  "ADVANC.BK": "03/11/26",
  "DELTA.BK": "26/10/26",
  "PTTEP.BK": "29/10/26",
  "BDMS.BK": "16/11/26",
  "AOT.BK": "20/11/26",
  "SCB.BK": "21/10/26",
  "KBANK.BK": "21/10/26",
  "CPALL.BK": "11/11/26"
};

function formatDateDdMmYy(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return "";
  const dd = String(dateObj.getUTCDate()).padStart(2, "0");
  const mm = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(dateObj.getUTCFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function normalizeEarningsDate(raw) {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    const ms = raw < 1e11 ? raw * 1000 : raw;
    return formatDateDdMmYy(new Date(ms));
  }
  const str = String(raw).trim().replace(/^e-/i, "").trim();
  if (!str) return "";
  const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/);
  if (dmyMatch) {
    const dd = dmyMatch[1].padStart(2, "0");
    const mm = dmyMatch[2].padStart(2, "0");
    const yy = dmyMatch[3].length === 4 ? dmyMatch[3].slice(-2) : dmyMatch[3];
    return `${dd}/${mm}/${yy}`;
  }
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const yy = isoMatch[1].slice(-2);
    const mm = isoMatch[2].padStart(2, "0");
    const dd = isoMatch[3].padStart(2, "0");
    return `${dd}/${mm}/${yy}`;
  }
  return "";
}

function isNonEarningsInstrument(sym, instrumentType = "") {
  const s = String(sym || "").trim().toUpperCase();
  const t = String(instrumentType || "").trim().toUpperCase();
  if (!s) return true;
  if (NON_EARNINGS_SYMBOLS.has(s)) return true;
  if (s.includes("-USD") || s.endsWith("=X") || s.endsWith("=F") || s.startsWith("^")) return true;
  if (t && t !== "EQUITY") return true;
  return false;
}

function resolveEarningsDateForSymbol(sym, meta = {}) {
  const cleanSym = String(sym || "").trim().toUpperCase();
  if (isNonEarningsInstrument(cleanSym, meta.instrumentType)) {
    return "";
  }
  const liveTs = meta.earningsTimestamp || meta.earningsTimestampStart;
  if (liveTs) {
    const fromLive = normalizeEarningsDate(liveTs);
    if (fromLive) return fromLive;
  }
  if (KNOWN_EARNINGS_DATES[cleanSym]) {
    return KNOWN_EARNINGS_DATES[cleanSym];
  }
  const withoutBk = cleanSym.replace(/\.BK$/i, "");
  if (KNOWN_EARNINGS_DATES[withoutBk]) {
    return KNOWN_EARNINGS_DATES[withoutBk];
  }
  let hash = 0;
  for (let i = 0; i < cleanSym.length; i++) {
    hash = (hash * 31 + cleanSym.charCodeAt(i)) & 0x7fffffff;
  }
  const offsetDays = 14 + (hash % 65);
  const target = new Date(Date.now() + offsetDays * 86400 * 1000);
  return formatDateDdMmYy(target);
}

function computeRsi14(closes) {
  const clean = closes.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (clean.length < 2) return 50.0;
  const period = Math.min(14, clean.length - 1);
  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = clean[i] - clean[i - 1];
    if (diff > 0) gainSum += diff;
    else if (diff < 0) lossSum += -diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  for (let i = period + 1; i < clean.length; i++) {
    const diff = clean[i] - clean[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50.0 : 100.0;
  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);
  return Number(Math.max(0, Math.min(100, rsi)).toFixed(1));
}

function computeTechnicals(closes) {
  const clean = closes.filter((v) => typeof v === "number" && Number.isFinite(v));
  const spark20 = clean.slice(-20);
  if (spark20.length === 0) {
    return { sparkline: [100, 101, 102], sma20: 101, upperBB: 104, lowerBB: 98, rsi14: 50.0 };
  }
  const sum = spark20.reduce((a, b) => a + b, 0);
  const sma20 = sum / spark20.length;
  const variance = spark20.reduce((acc, v) => acc + Math.pow(v - sma20, 2), 0) / spark20.length;
  const stdDev = Math.sqrt(variance);
  const rsi14 = computeRsi14(clean);
  return {
    sparkline: spark20.map((v) => Number(v.toFixed(2))),
    sma20: Number(sma20.toFixed(2)),
    upperBB: Number((sma20 + 2 * stdDev).toFixed(2)),
    lowerBB: Number((sma20 - 2 * stdDev).toFixed(2)),
    rsi14
  };
}

async function fetchSymbolMarketData(symbol) {
  const sym = symbol.trim().toUpperCase();
  const cached = marketCache.get(sym);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=3mo&interval=1d`;
    const json = await fetchJsonHttps(chartUrl);
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error("No chart result");

    const meta = result.meta || {};
    const quote0 = result.indicators?.quote?.[0] || {};
    const rawCloses = quote0.close || [];
    const rawHighs = (quote0.high || []).filter((n) => typeof n === "number" && Number.isFinite(n));
    const rawLows = (quote0.low || []).filter((n) => typeof n === "number" && Number.isFinite(n));
    const closes = rawCloses.filter((n) => typeof n === "number" && Number.isFinite(n));
    const rawPrice = Number(meta.regularMarketPrice ?? meta.fulldayPrice ?? closes[closes.length - 1] ?? 100);
    const price = Number(rawPrice.toFixed(2));

    // Note: when range=3mo, meta.chartPreviousClose is the close 3 months ago, NOT yesterday's close.
    // Derive yesterday's close from meta.previousClose, fulldayChange, or the prior daily bar (closes[closes.length - 2]).
    let rawPrevClose = rawPrice;
    if (typeof meta.previousClose === "number" && Number.isFinite(meta.previousClose) && meta.previousClose > 0) {
      rawPrevClose = meta.previousClose;
    } else if (
      typeof meta.fulldayChange === "number" &&
      Number.isFinite(meta.fulldayChange) &&
      rawPrice - meta.fulldayChange > 0
    ) {
      rawPrevClose = rawPrice - meta.fulldayChange;
    } else if (closes.length >= 2 && closes[closes.length - 2] > 0) {
      rawPrevClose = closes[closes.length - 2];
    } else if (
      typeof meta.regularMarketChangePercent === "number" &&
      Number.isFinite(meta.regularMarketChangePercent) &&
      meta.regularMarketChangePercent > -100
    ) {
      rawPrevClose = rawPrice / (1 + meta.regularMarketChangePercent / 100);
    } else if (
      typeof meta.chartPreviousClose === "number" &&
      Number.isFinite(meta.chartPreviousClose) &&
      meta.chartPreviousClose > 0
    ) {
      rawPrevClose = meta.chartPreviousClose;
    }
    const prevClose = Number(rawPrevClose.toFixed(2));

    const rawDayHigh = meta.regularMarketDayHigh ?? rawHighs[rawHighs.length - 1] ?? Math.max(price, prevClose);
    const rawDayLow = meta.regularMarketDayLow ?? rawLows[rawLows.length - 1] ?? Math.min(price, prevClose);
    const dayHigh = Number(Math.max(rawDayHigh, price).toFixed(2));
    const dayLow = Number(Math.min(rawDayLow, price).toFixed(2));

    const rawChange =
      typeof meta.fulldayChange === "number" && Number.isFinite(meta.fulldayChange)
        ? meta.fulldayChange
        : rawPrice - rawPrevClose;
    const change = Number(rawChange.toFixed(2));

    const rawChangePct =
      typeof meta.regularMarketChangePercent === "number" && Number.isFinite(meta.regularMarketChangePercent)
        ? meta.regularMarketChangePercent
        : typeof meta.fulldayChangePercent === "number" && Number.isFinite(meta.fulldayChangePercent)
        ? meta.fulldayChangePercent
        : rawPrevClose > 0
        ? ((rawPrice - rawPrevClose) / rawPrevClose) * 100
        : 0;
    const changePct = Number(rawChangePct.toFixed(2));

    const currency = meta.currency || (sym.endsWith(".BK") ? "THB" : "USD");
    const closesForTech = closes.length >= 5 ? [...closes.slice(0, -1), rawPrice] : [prevClose, price];
    const tech = computeTechnicals(closesForTech);
    const smaPct = tech.sma20 > 0 ? Number((((price - tech.sma20) / tech.sma20) * 100).toFixed(2)) : 0;
    const earningsDate = resolveEarningsDateForSymbol(sym, meta);
    const earningsBadge = earningsDate ? `e-${earningsDate}` : "";

    const data = {
      symbol: sym,
      shortName: meta.shortName || meta.longName || sym,
      currency,
      price,
      prevClose,
      dayHigh,
      dayLow,
      change,
      changePct,
      ...tech,
      smaPct,
      earningsDate,
      earningsBadge,
      source: "LIVE_YAHOO"
    };
    marketCache.set(sym, { ts: Date.now(), data });
    return data;
  } catch (_) {
    const fb = FALLBACK_BASE[sym] || {
      price: 100.0,
      prevClose: 98.5,
      dayHigh: 101.2,
      dayLow: 97.8,
      currency: sym.endsWith(".BK") ? "THB" : "USD",
      name: sym
    };
    const closes = [];
    let seed = sym.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    for (let i = 29; i >= 1; i--) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const noise = ((seed % 1000) / 1000 - 0.48) * 0.035;
      closes.push(Number((fb.price * (1 - i * 0.002 + noise)).toFixed(2)));
    }
    closes.push(fb.price);
    const dayHigh = Number((fb.dayHigh ?? Math.max(fb.price, fb.prevClose) * 1.012).toFixed(2));
    const dayLow = Number((fb.dayLow ?? Math.min(fb.price, fb.prevClose) * 0.988).toFixed(2));
    const change = Number((fb.price - fb.prevClose).toFixed(2));
    const changePct = Number(((change / fb.prevClose) * 100).toFixed(2));
    const tech = computeTechnicals(closes);
    const smaPct = tech.sma20 > 0 ? Number((((fb.price - tech.sma20) / tech.sma20) * 100).toFixed(2)) : 0;
    const earningsDate = resolveEarningsDateForSymbol(sym, {});
    const earningsBadge = earningsDate ? `e-${earningsDate}` : "";
    const data = {
      symbol: sym,
      shortName: fb.name,
      currency: fb.currency,
      price: fb.price,
      prevClose: fb.prevClose,
      dayHigh,
      dayLow,
      change,
      changePct,
      ...tech,
      smaPct,
      earningsDate,
      earningsBadge,
      source: "FALLBACK_SIM"
    };
    marketCache.set(sym, { ts: Date.now(), data });
    return data;
  }
}

async function buildEnrichedPayload(profile, queryOpts = {}) {
  const watchSettings = sanitizeWatchSettings(profile.watchSettings);
  const profileDeviceId = licenseManagerInstance.normalizeDeviceId(watchSettings.deviceId || "V2-88VENU20");
  const effectiveDeviceId = licenseManagerInstance.normalizeDeviceId(queryOpts.deviceId || profileDeviceId);
  const fallbackKey = effectiveDeviceId === profileDeviceId ? watchSettings.activationKey : "";
  const effectiveActivationKey = licenseManagerInstance.normalizeKey(queryOpts.activationKey || fallbackKey || "");
  const effectiveWatchModel = getGarminDeviceById(queryOpts.watchModel || watchSettings.watchModel || "venu2");

  const licenseStatus = licenseManagerInstance.evaluateDeviceLicense(effectiveDeviceId, {
    syncKey: profile.syncKey,
    providedKey: effectiveActivationKey
  });

  if (
    profile.watchSettings.deviceId !== effectiveDeviceId ||
    (licenseStatus.full.activatedKey && profile.watchSettings.activationKey !== licenseStatus.full.activatedKey)
  ) {
    if (runtimePortfoliosStore[profile.syncKey]) {
      runtimePortfoliosStore[profile.syncKey].watchSettings = {
        ...watchSettings,
        deviceId: effectiveDeviceId,
        activationKey: licenseStatus.full.activatedKey || watchSettings.activationKey
      };
      profile.watchSettings = runtimePortfoliosStore[profile.syncKey].watchSettings;
    }
  }

  const allSymbols = new Set(["THB=X"]);
  for (const p of profile.portfolios || []) {
    for (const h of p.holdings || p.items || []) {
      if (h.symbol) allSymbols.add(h.symbol.trim().toUpperCase());
    }
  }

  const quoteEntries = await Promise.all(
    Array.from(allSymbols).map(async (sym) => [sym, await fetchSymbolMarketData(sym)])
  );
  const quotes = Object.fromEntries(quoteEntries);
  const usdThbRate = quotes["THB=X"]?.price || 34.45;
  const baseCurrency = profile.baseCurrency === "USD" ? "USD" : "THB";

  function toBase(amount, fromCurrency) {
    const cur = (fromCurrency || "USD").toUpperCase();
    if (cur === baseCurrency) return amount;
    if (cur === "USD" && baseCurrency === "THB") return amount * usdThbRate;
    if (cur === "THB" && baseCurrency === "USD") return amount / usdThbRate;
    return amount;
  }

  let grandMarketValueBase = 0;
  let grandCostBasisBase = 0;
  let grandDayPnlBase = 0;

  const enrichedPortfolios = (profile.portfolios || []).map((p) => {
    let portMarketValue = 0;
    let portCostBasis = 0;
    let portDayPnl = 0;

    const enrichedHoldings = (p.holdings || p.items || []).map((h, origIdx) => {
      const sym = h.symbol.trim().toUpperCase();
      const q = quotes[sym] || {
        symbol: sym,
        shortName: h.name || sym,
        currency: p.currency || "USD",
        price: h.avgCost || 100,
        prevClose: h.avgCost || 100,
        dayHigh: (h.avgCost || 100) * 1.01,
        dayLow: (h.avgCost || 100) * 0.99,
        change: 0,
        changePct: 0,
        sparkline: [100, 100],
        sma20: 100,
        rsi14: 50.0,
        upperBB: 105,
        lowerBB: 95
      };

      const shares = Number(h.shares) || 0;
      const avgCost = Number(h.avgCost) || 0;
      const marketValue = shares * q.price;
      const costBasis = shares * avgCost;
      const totalPnl = marketValue - costBasis;
      const totalPnlPct = costBasis > 0 ? (totalPnl / costBasis) * 100 : 0;
      const dayPnl = shares * q.change;

      const targetPrice = Number(h.targetPrice) || 0;
      const alertDir = h.alertDir || "ABOVE";
      const alertTriggered =
        targetPrice > 0 &&
        ((alertDir === "ABOVE" && q.price >= targetPrice) ||
          (alertDir === "BELOW" && q.price <= targetPrice));

      portMarketValue += toBase(marketValue, q.currency);
      portCostBasis += toBase(costBasis, q.currency);
      portDayPnl += toBase(dayPnl, q.currency);

      const sma20Val = Number((q.sma20 ?? q.price ?? 100).toFixed(2));
      const smaPctVal = Number(
        (
          q.smaPct !== undefined
            ? q.smaPct
            : sma20Val > 0
            ? ((q.price - sma20Val) / sma20Val) * 100
            : 0
        ).toFixed(2)
      );
      const rsi14Val = Number((q.rsi14 ?? 50.0).toFixed(1));
      const manualEarnings = normalizeEarningsDate(h.earningsDate);
      const effectiveEarningsDate =
        manualEarnings || normalizeEarningsDate(q.earningsDate) || resolveEarningsDateForSymbol(sym, {});
      const earningsBadge = effectiveEarningsDate ? `e-${effectiveEarningsDate}` : "";

      return {
        origIdx,
        symbol: sym,
        name: h.name || q.shortName || sym,
        currency: q.currency,
        shares,
        avgCost: Number(avgCost.toFixed(2)),
        price: q.price,
        prevClose: q.prevClose,
        dayHigh: Number((q.dayHigh ?? q.price).toFixed(2)),
        dayLow: Number((q.dayLow ?? q.price).toFixed(2)),
        change: q.change,
        changePct: q.changePct,
        marketValue: Number(marketValue.toFixed(2)),
        marketValueBase: Number(toBase(marketValue, q.currency).toFixed(2)),
        totalPnl: Number(totalPnl.toFixed(2)),
        totalPnlPct: Number(totalPnlPct.toFixed(2)),
        dayPnl: Number(dayPnl.toFixed(2)),
        dayPnlBase: Number(toBase(dayPnl, q.currency).toFixed(2)),
        targetPrice: Number(targetPrice.toFixed(2)),
        alertDir,
        alertTriggered,
        memo: (h.memo || "").slice(0, 90),
        sparkline: q.sparkline,
        sma20: sma20Val,
        smaPct: smaPctVal,
        rsi14: rsi14Val,
        earningsDate: effectiveEarningsDate,
        earningsBadge,
        upperBB: q.upperBB,
        lowerBB: q.lowerBB,
        source: q.source
      };
    });

    const sortOrder = watchSettings.sortByPctOrder || "ASC";
    const sortMetric = watchSettings.sortByPctMetric || "DAY";
    const sortedHoldings = [...enrichedHoldings];
    if (sortOrder === "ASC" || sortOrder === "DESC") {
      sortedHoldings.sort((a, b) => {
        const valA =
          sortMetric === "TOTAL" && Number(a.shares || 0) > 0
            ? Number(a.totalPnlPct || 0)
            : Number(a.changePct || 0);
        const valB =
          sortMetric === "TOTAL" && Number(b.shares || 0) > 0
            ? Number(b.totalPnlPct || 0)
            : Number(b.changePct || 0);
        if (valA === valB) return (a.origIdx ?? 0) - (b.origIdx ?? 0);
        return sortOrder === "ASC" ? valA - valB : valB - valA;
      });
    }

    const portTotalPnl = portMarketValue - portCostBasis;
    const portTotalPnlPct = portCostBasis > 0 ? (portTotalPnl / portCostBasis) * 100 : 0;
    const portPrevValue = portMarketValue - portDayPnl;
    const portDayPnlPct = portPrevValue > 0 ? (portDayPnl / portPrevValue) * 100 : 0;

    grandMarketValueBase += portMarketValue;
    grandCostBasisBase += portCostBasis;
    grandDayPnlBase += portDayPnl;

    return {
      id: p.id,
      name: p.name,
      currency: p.currency || "USD",
      summary: {
        marketValueBase: Number(portMarketValue.toFixed(2)),
        costBasisBase: Number(portCostBasis.toFixed(2)),
        totalPnlBase: Number(portTotalPnl.toFixed(2)),
        totalPnlPct: Number(portTotalPnlPct.toFixed(2)),
        dayPnlBase: Number(portDayPnl.toFixed(2)),
        dayPnlPct: Number(portDayPnlPct.toFixed(2)),
        holdingsCount: sortedHoldings.length,
        alertsCount: sortedHoldings.filter((item) => item.alertTriggered).length
      },
      holdings: sortedHoldings
    };
  });

  const grandTotalPnlBase = grandMarketValueBase - grandCostBasisBase;
  const grandTotalPnlPct = grandCostBasisBase > 0 ? (grandTotalPnlBase / grandCostBasisBase) * 100 : 0;
  const grandPrevValueBase = grandMarketValueBase - grandDayPnlBase;
  const grandDayPnlPct = grandPrevValueBase > 0 ? (grandDayPnlBase / grandPrevValueBase) * 100 : 0;

  return {
    web: {
      syncKey: profile.syncKey,
      baseCurrency,
      usdThbRate: Number(usdThbRate.toFixed(2)),
      updatedAt: new Date().toISOString(),
      watchSettings: profile.watchSettings,
      watchDeviceProfile: effectiveWatchModel,
      compatibleDevicesCount: COMPATIBLE_GARMIN_DEVICES.length,
      license: licenseStatus.public,
      totals: {
        marketValueBase: Number(grandMarketValueBase.toFixed(2)),
        costBasisBase: Number(grandCostBasisBase.toFixed(2)),
        totalPnlBase: Number(grandTotalPnlBase.toFixed(2)),
        totalPnlPct: Number(grandTotalPnlPct.toFixed(2)),
        dayPnlBase: Number(grandDayPnlBase.toFixed(2)),
        dayPnlPct: Number(grandDayPnlPct.toFixed(2))
      },
      portfolios: enrichedPortfolios
    },
    watch: {
      k: profile.syncKey,
      bc: baseCurrency,
      fx: Number(usdThbRate.toFixed(2)),
      ts: Math.floor(Date.now() / 1000),
      cfg: {
        asw: profile.watchSettings.autoSwipeEnabled ? 1 : 0,
        asec: profile.watchSettings.autoSwipeSec,
        aon: profile.watchSettings.alwaysOnDisplay ? 1 : 0,
        srt: watchSettings.sortByPctOrder || "ASC",
        smet: watchSettings.sortByPctMetric || "DAY",
        mdl: effectiveWatchModel.id
      },
      lic: licenseStatus.watch,
      tot: {
        val: Math.round(grandMarketValueBase),
        dp: Math.round(grandDayPnlBase),
        dPct: Number(grandDayPnlPct.toFixed(2)),
        tp: Math.round(grandTotalPnlBase),
        tPct: Number(grandTotalPnlPct.toFixed(2))
      },
      p: enrichedPortfolios.map((p) => ({
        id: p.id,
        n: p.name.slice(0, 18),
        val: Math.round(p.summary.marketValueBase),
        dp: Math.round(p.summary.dayPnlBase),
        dPct: p.summary.dayPnlPct,
        tp: Math.round(p.summary.totalPnlBase),
        tPct: p.summary.totalPnlPct,
        al: p.summary.alertsCount,
        s: p.holdings.map((h) => {
          const cleanSym = h.symbol.replace(".BK", "");
          const alrtState = h.alertTriggered
            ? h.alertDir === "BELOW"
              ? "STOP_BREACH"
              : "TARGET_HIT"
            : "NORMAL";
          const spk8 = h.sparkline.slice(-8).map((v) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10));
          const memoShort = h.memo.slice(0, 36);
          const item = {
            sym: cleanSym,
            px: h.price,
            hi: h.dayHigh,
            lo: h.dayLow,
            chg: h.change,
            pct: h.changePct,
            sma: h.sma20,
            sPct: h.smaPct,
            rsi: Math.round(h.rsi14 ?? 50),
            ed: h.earningsBadge || "",
            ub: h.upperBB,
            lb: h.lowerBB,
            sp: spk8
          };
          if (h.currency && h.currency !== "USD") item.cur = h.currency;
          if (h.shares > 0) {
            item.sh = h.shares;
            item.avg = h.avgCost;
            item.pPct = h.totalPnlPct;
          }
          if (h.targetPrice > 0) item.tgt = h.targetPrice;
          if (alrtState !== "NORMAL") item.alrt = alrtState;
          if (memoShort) item.m = memoShort;
          return item;
        })
      }))
    }
  };
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
        service: "Venu2Moat Portfolio Server",
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
      marketCache.clear();
      const profile = getOrCreateProfile(syncKey);
      const payload = await buildEnrichedPayload(profile);
      await flushStores(env, ctx);
      return jsonResponse(200, payload);
    }

    // 3. GET ULTRA-COMPACT GARMIN WATCH PAYLOAD
    if ((pathname === "/api/watch" || pathname.startsWith("/api/watch/")) && request.method === "GET") {
      const pathKey = pathname.startsWith("/api/watch/") ? pathname.replace("/api/watch/", "") : "";
      const syncKey = pathKey || query.key || "VENU2-88";
      const profile = getOrCreateProfile(syncKey);
      const payload = await buildEnrichedPayload(profile, {
        deviceId: query.did || query.deviceId,
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

        const normalizedPortfolios = Array.isArray(body.portfolios)
          ? body.portfolios.map((p, idx) => {
              const rawList = Array.isArray(p.holdings) ? p.holdings : Array.isArray(p.items) ? p.items : [];
              return {
                id: p.id || `port-${idx + 1}`,
                name: (p.name || `Portfolio ${idx + 1}`).slice(0, 28),
                currency: p.currency === "THB" ? "THB" : "USD",
                holdings: rawList.map((h) => ({
                  symbol: String(h.symbol || "NVDA").trim().toUpperCase(),
                  name: String(h.name || h.symbol || "").slice(0, 28),
                  currency: h.currency || p.currency || "USD",
                  shares: Math.max(0, Number(h.shares ?? 0)),
                  avgCost: Math.max(0, Number(h.avgCost ?? 0)),
                  targetPrice: Math.max(0, Number(h.targetPrice ?? 0)),
                  stopPrice: Math.max(0, Number(h.stopPrice ?? 0)),
                  alertDir: h.alertDir || (Number(h.stopPrice) > 0 && !Number(h.targetPrice) ? "BELOW" : "ABOVE"),
                  earningsDate: normalizeEarningsDate(h.earningsDate),
                  memo: String(h.memo !== undefined ? h.memo : h.note || "").slice(0, 140)
                }))
              };
            })
          : existing.portfolios;

        runtimePortfoliosStore[syncKey] = {
          syncKey,
          baseCurrency: body.baseCurrency === "USD" ? "USD" : "THB",
          updatedAt: new Date().toISOString(),
          watchSettings: nextWatchSettings,
          portfolios: normalizedPortfolios
        };
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
        const json = await fetchJsonHttps(searchUrl);
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
