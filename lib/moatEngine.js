const {
  COMPATIBLE_GARMIN_DEVICES,
  getGarminDeviceById
} = require("./garminDevices");

const DEFAULT_WATCH_SETTINGS = {
  autoSwipeEnabled: true,
  autoSwipeSec: 5,
  alwaysOnDisplay: false,
  sortByPctOrder: "ASC", // "ASC" (ติดลบ -> กำไร) | "DESC" (กำไร -> ติดลบ) | "NONE" (ลำดับเดิม)
  sortByPctMetric: "DAY", // "DAY" (% Change วันนี้) | "TOTAL" (% กำไร/ขาดทุนรวม)
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

// Deterministic realistic fallback generator if offline or rate-limited
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

// In-memory cache for Yahoo Finance chart/quote data (30s TTL)
const marketCache = new Map();
const CACHE_TTL_MS = 30 * 1000;

function clearMarketCache() {
  marketCache.clear();
}

function defaultNormalizeDeviceId(raw) {
  const cleaned = String(raw || "V2-88VENU20")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
  return cleaned || "V2-88VENU20";
}

function defaultNormalizeKey(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}

function sanitizeWatchSettings(raw = {}, fallback = DEFAULT_WATCH_SETTINGS, licenseMgr = null) {
  const normDeviceId =
    licenseMgr && typeof licenseMgr.normalizeDeviceId === "function"
      ? (v) => licenseMgr.normalizeDeviceId(v)
      : defaultNormalizeDeviceId;
  const normKey =
    licenseMgr && typeof licenseMgr.normalizeKey === "function"
      ? (v) => licenseMgr.normalizeKey(v)
      : defaultNormalizeKey;

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
  const deviceId = normDeviceId(raw.deviceId || fallback.deviceId || "V2-88VENU20");
  const watchModelObj = getGarminDeviceById(raw.watchModel || fallback.watchModel || "venu2");
  const watchModel = watchModelObj ? watchModelObj.id : "venu2";
  const activationKey = normKey(
    raw.activationKey !== undefined && String(raw.activationKey).trim() !== ""
      ? raw.activationKey
      : fallback.activationKey || ""
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

/**
 * Derives an isolated per-profile Garmin Device ID from a Sync Key so that
 * new users on the web or Garmin Connect IQ Store never collide on "V2-88VENU20".
 */
function deriveDeviceIdForSyncKey(syncKey, licenseMgr) {
  const key = String(syncKey || "VENU2-88").trim().toUpperCase();
  if (!key || key === "VENU2-88") {
    return "V2-88VENU20";
  }
  const normDeviceId =
    licenseMgr && typeof licenseMgr.normalizeDeviceId === "function"
      ? (v) => licenseMgr.normalizeDeviceId(v)
      : (v) => {
          const clean = String(v || "")
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9-]/g, "");
          return clean || "V2-88VENU20";
        };
  if (key.startsWith("V2-") || key.startsWith("GM-")) {
    return normDeviceId(key);
  }
  const alnum = key.replace(/[^A-Z0-9]/g, "");
  if (alnum.length >= 4) {
    return normDeviceId(`V2-${alnum.slice(0, 8)}`);
  }
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) & 0x7fffffff;
  }
  const suffix = (alnum + hash.toString(36).toUpperCase() + "00000000").slice(0, 8);
  return normDeviceId(`V2-${suffix}`);
}

/**
 * Creates a newly cloned portfolio profile for a Sync Key with an isolated Device ID
 * and clean license state (preventing new users from inheriting V2-88VENU20).
 */
function createIsolatedProfile(syncKey, templateProfile, licenseMgr) {
  const key = String(syncKey || "VENU2-88").trim().toUpperCase() || "VENU2-88";
  const cloned = JSON.parse(JSON.stringify(templateProfile || {}));
  const isolatedDeviceId = deriveDeviceIdForSyncKey(key, licenseMgr);
  const rawWatchSettings = cloned.watchSettings || {};
  cloned.syncKey = key;
  cloned.updatedAt = new Date().toISOString();
  cloned.watchSettings = sanitizeWatchSettings(
    {
      ...rawWatchSettings,
      deviceId: key === "VENU2-88" ? rawWatchSettings.deviceId || "V2-88VENU20" : isolatedDeviceId,
      activationKey: key === "VENU2-88" ? rawWatchSettings.activationKey || "" : ""
    },
    {
      ...DEFAULT_WATCH_SETTINGS,
      deviceId: isolatedDeviceId
    },
    licenseMgr
  );
  return cloned;
}

/**
 * Ensures an existing profile's watchSettings has an isolated deviceId (fixing any
 * non-VENU2-88 profile that previously inherited "V2-88VENU20").
 */
function ensureIsolatedProfileSettings(profile, licenseMgr) {
  if (!profile || typeof profile !== "object") return false;
  const key = String(profile.syncKey || "VENU2-88").trim().toUpperCase();
  const isolatedDeviceId = deriveDeviceIdForSyncKey(key, licenseMgr);
  let changed = false;
  if (!profile.watchSettings) {
    profile.watchSettings = sanitizeWatchSettings(
      { deviceId: isolatedDeviceId, activationKey: "" },
      { ...DEFAULT_WATCH_SETTINGS, deviceId: isolatedDeviceId },
      licenseMgr
    );
    return true;
  }
  if (key !== "VENU2-88" && profile.watchSettings.deviceId === "V2-88VENU20") {
    profile.watchSettings.deviceId = isolatedDeviceId;
    profile.watchSettings.activationKey = "";
    changed = true;
  }
  const sanitized = sanitizeWatchSettings(
    profile.watchSettings,
    { ...DEFAULT_WATCH_SETTINGS, deviceId: isolatedDeviceId },
    licenseMgr
  );
  if (JSON.stringify(sanitized) !== JSON.stringify(profile.watchSettings)) {
    profile.watchSettings = sanitized;
    changed = true;
  }
  return changed;
}

/**
 * Resolves the target profile for a watch request (/api/watch?key=...&did=...).
 * Supports auto-SyncKey (when watch syncKey is empty/AUTO and falls back to hardware deviceId)
 * as well as matching an existing web profile that bound watchSettings.deviceId to this watch.
 */
function resolveWatchProfile(store, rawSyncKey, rawDeviceId, getOrCreateFn, licenseMgr) {
  const normDeviceId =
    licenseMgr && typeof licenseMgr.normalizeDeviceId === "function"
      ? (v) => licenseMgr.normalizeDeviceId(v)
      : (v) => String(v || "").trim().toUpperCase();
  const cleanDid = rawDeviceId ? normDeviceId(rawDeviceId) : "";
  let key = String(rawSyncKey || "").trim().toUpperCase();
  if (!key || key === "AUTO") {
    key = cleanDid || "VENU2-88";
  }
  if (store && store[key]) {
    return getOrCreateFn(key);
  }
  if (store && cleanDid && cleanDid !== "V2-88VENU20") {
    for (const existingKey of Object.keys(store)) {
      const candidate = store[existingKey];
      if (candidate?.watchSettings?.deviceId && normDeviceId(candidate.watchSettings.deviceId) === cleanDid) {
        return getOrCreateFn(existingKey);
      }
    }
  }
  return getOrCreateFn(key);
}

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

function normalizePortfoliosInput(rawPortfolios, fallbackPortfolios = []) {
  if (!Array.isArray(rawPortfolios)) return fallbackPortfolios;
  return rawPortfolios.map((p, idx) => {
    const rawList = Array.isArray(p.holdings) ? p.holdings : Array.isArray(p.items) ? p.items : [];
    return {
      id: p.id || `port-${idx + 1}`,
      name: String(p.name || `Portfolio ${idx + 1}`).slice(0, 28),
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
  });
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

// Default cross-runtime JSON fetcher (works in both Node 18+ and Cloudflare Workers)
async function defaultFetchJson(targetUrl) {
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

async function fetchSymbolMarketData(symbol, opts = {}) {
  const sym = String(symbol || "AAPL").trim().toUpperCase();
  const bypassCache = Boolean(opts.bypassCache);
  const fetchJson = typeof opts.fetchJson === "function" ? opts.fetchJson : defaultFetchJson;

  if (!bypassCache) {
    const cached = marketCache.get(sym);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  try {
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=3mo&interval=1d`;
    const json = await fetchJson(chartUrl);
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
    if (!bypassCache) {
      marketCache.set(sym, { ts: Date.now(), data });
    }
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
    if (!bypassCache) {
      marketCache.set(sym, { ts: Date.now(), data });
    }
    return data;
  }
}

async function buildEnrichedPayload(profile, queryOpts = {}, deps = {}) {
  const licenseMgr = deps.licenseManager;
  const onSyncWatchSettings = deps.onSyncWatchSettings;
  const fetchQuote =
    typeof deps.fetchQuote === "function"
      ? deps.fetchQuote
      : (sym) => fetchSymbolMarketData(sym, { fetchJson: deps.fetchJson });

  const defaultProfileDeviceId = deriveDeviceIdForSyncKey(profile.syncKey, licenseMgr);
  const watchSettings = sanitizeWatchSettings(
    profile.watchSettings,
    { ...DEFAULT_WATCH_SETTINGS, deviceId: defaultProfileDeviceId },
    licenseMgr
  );
  const profileDeviceId = licenseMgr.normalizeDeviceId(watchSettings.deviceId || defaultProfileDeviceId);
  const effectiveDeviceId = licenseMgr.normalizeDeviceId(queryOpts.deviceId || profileDeviceId);
  const fallbackKey = effectiveDeviceId === profileDeviceId ? watchSettings.activationKey : "";
  const effectiveActivationKey = licenseMgr.normalizeKey(queryOpts.activationKey || fallbackKey || "");
  const effectiveWatchModel = getGarminDeviceById(queryOpts.watchModel || watchSettings.watchModel || "venu2");

  // Evaluate 14-day trial & per-device activation status
  const licenseStatus = licenseMgr.evaluateDeviceLicense(effectiveDeviceId, {
    syncKey: profile.syncKey,
    providedKey: effectiveActivationKey
  });

  // Persist updated deviceId or activatedKey back into profile watchSettings if changed via storage seam
  if (
    profile.watchSettings.deviceId !== effectiveDeviceId ||
    (licenseStatus.full.activatedKey && profile.watchSettings.activationKey !== licenseStatus.full.activatedKey)
  ) {
    const nextSettings = {
      ...watchSettings,
      deviceId: effectiveDeviceId,
      activationKey: licenseStatus.full.activatedKey || watchSettings.activationKey
    };
    profile.watchSettings = nextSettings;
    if (typeof onSyncWatchSettings === "function") {
      onSyncWatchSettings(profile.syncKey, nextSettings);
    }
  }

  // Collect all unique symbols + USD/THB exchange rate
  const allSymbols = new Set(["THB=X"]);
  for (const p of profile.portfolios || []) {
    for (const h of p.holdings || p.items || []) {
      if (h.symbol) allSymbols.add(h.symbol.trim().toUpperCase());
    }
  }

  const quoteEntries = await Promise.all(
    Array.from(allSymbols).map(async (sym) => [sym, await fetchQuote(sym)])
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
      // Use public-safe license representation (never leak unactivated issuedKey to public web responses)
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
    // Ultra-compact payload tailored for Garmin Connect IQ memory budget (<12KB across 260x260 to 454x454 watches)
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

module.exports = {
  DEFAULT_WATCH_SETTINGS,
  SECURITY_HEADERS,
  FALLBACK_BASE,
  NON_EARNINGS_SYMBOLS,
  KNOWN_EARNINGS_DATES,
  clearMarketCache,
  sanitizeWatchSettings,
  deriveDeviceIdForSyncKey,
  createIsolatedProfile,
  ensureIsolatedProfileSettings,
  resolveWatchProfile,
  normalizeEarningsDate,
  resolveEarningsDateForSymbol,
  normalizePortfoliosInput,
  computeRsi14,
  computeTechnicals,
  defaultFetchJson,
  fetchSymbolMarketData,
  buildEnrichedPayload
};
