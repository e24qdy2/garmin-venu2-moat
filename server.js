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
  getGarminDeviceById,
  provisionConnectIqDevices
} = require("./lib/garminDevices");

// Ensure Connect IQ device definitions exist for all 2024-2026 supported watches
try {
  provisionConnectIqDevices();
} catch (_) {
  // Ignore if Connect IQ SDK directory is not installed on host
}

const PORT = process.env.PORT || 3880;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "portfolios.json");
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
  const deviceId = licenseManager.normalizeDeviceId(raw.deviceId || fallback.deviceId || "V2-88VENU20");
  const watchModelObj = getGarminDeviceById(raw.watchModel || fallback.watchModel || "venu2");
  const watchModel = watchModelObj ? watchModelObj.id : "venu2";
  const activationKey = licenseManager.normalizeKey(raw.activationKey !== undefined ? raw.activationKey : fallback.activationKey || "");
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

function getOrCreateProfile(syncKey) {
  const key = (syncKey || "VENU2-88").trim().toUpperCase();
  const store = readStore();
  let dirty = false;
  if (!store[key]) {
    store[key] = JSON.parse(JSON.stringify(DEFAULT_DATA["VENU2-88"]));
    store[key].syncKey = key;
    store[key].updatedAt = new Date().toISOString();
    dirty = true;
  }
  if (!store[key].watchSettings) {
    store[key].watchSettings = { ...DEFAULT_WATCH_SETTINGS };
    dirty = true;
  } else {
    store[key].watchSettings = sanitizeWatchSettings(store[key].watchSettings);
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

// In-memory cache for Yahoo Finance chart/quote data (30s TTL)
const marketCache = new Map();
const CACHE_TTL_MS = 30 * 1000;

function fetchJsonHttps(targetUrl) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      targetUrl,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
          "Accept": "application/json"
        },
        timeout: 6500
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(body));
            } catch (err) {
              reject(err);
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
  });
}

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
  } catch (err) {
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
  const profileDeviceId = licenseManager.normalizeDeviceId(watchSettings.deviceId || "V2-88VENU20");
  const effectiveDeviceId = licenseManager.normalizeDeviceId(queryOpts.deviceId || profileDeviceId);
  const fallbackKey = effectiveDeviceId === profileDeviceId ? watchSettings.activationKey : "";
  const effectiveActivationKey = licenseManager.normalizeKey(queryOpts.activationKey || fallbackKey || "");
  const effectiveWatchModel = getGarminDeviceById(queryOpts.watchModel || watchSettings.watchModel || "venu2");

  // Evaluate 14-day trial & per-device activation status
  const licenseStatus = licenseManager.evaluateDeviceLicense(effectiveDeviceId, {
    syncKey: profile.syncKey,
    providedKey: effectiveActivationKey
  });

  // Persist updated deviceId or activatedKey back into profile watchSettings if changed
  if (
    profile.watchSettings.deviceId !== effectiveDeviceId ||
    (licenseStatus.full.activatedKey && profile.watchSettings.activationKey !== licenseStatus.full.activatedKey)
  ) {
    const store = readStore();
    if (store[profile.syncKey]) {
      store[profile.syncKey].watchSettings = {
        ...watchSettings,
        deviceId: effectiveDeviceId,
        activationKey: licenseStatus.full.activatedKey || watchSettings.activationKey
      };
      writeStore(store);
      profile.watchSettings = store[profile.syncKey].watchSettings;
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

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://unpkg.com https://cdn.jsdelivr.net https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com https://cdn.jsdelivr.net; font-src 'self' https://fonts.gstatic.com https://unpkg.com https://cdn.jsdelivr.net data:; img-src 'self' data: https:; connect-src 'self' https://cloudflareinsights.com https://*.cloudflareinsights.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'"
};

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

  // 1. GET /api/portfolio?key=VENU2-88 (Full Web Companion + Watch Preview Payload)
  if (pathname === "/api/portfolio" && req.method === "GET") {
    const syncKey = parsedUrl.query.key || "VENU2-88";
    const profile = getOrCreateProfile(syncKey);
    const payload = await buildEnrichedPayload(profile, {
      deviceId: parsedUrl.query.did,
      activationKey: parsedUrl.query.akey,
      watchModel: parsedUrl.query.model
    });
    return sendJson(res, 200, payload);
  }

  // 2. PUT /api/portfolio (Save updated portfolios, holdings, memos, baseCurrency, watchSettings)
  if (pathname === "/api/portfolio" && (req.method === "PUT" || req.method === "POST")) {
    try {
      const body = await parseBody(req);
      const syncKey = (body.syncKey || "VENU2-88").trim().toUpperCase();
      const store = readStore();
      const existing = getOrCreateProfile(syncKey);
      const mergedWatchSettings = sanitizeWatchSettings(body.watchSettings || {}, existing.watchSettings);

      const normalizedPortfolios = Array.isArray(body.portfolios)
        ? body.portfolios.map((p, idx) => {
            const rawList = Array.isArray(p.holdings) ? p.holdings : Array.isArray(p.items) ? p.items : [];
            return {
              id: p.id || `port-${idx + 1}`,
              name: p.name || `Portfolio ${idx + 1}`,
              currency: p.currency || "USD",
              holdings: rawList.map((h) => ({
                symbol: String(h.symbol || "AAPL").trim().toUpperCase(),
                name: h.name || h.symbol || "",
                currency: h.currency || p.currency || "USD",
                shares: Number(h.shares ?? 0),
                avgCost: Number(h.avgCost ?? 0),
                targetPrice: Number(h.targetPrice ?? 0),
                stopPrice: Number(h.stopPrice ?? 0),
                alertDir: h.alertDir || (Number(h.stopPrice) > 0 && !Number(h.targetPrice) ? "BELOW" : "ABOVE"),
                earningsDate: normalizeEarningsDate(h.earningsDate),
                memo: String(h.memo !== undefined ? h.memo : h.note || "").slice(0, 140)
              }))
            };
          })
        : existing.portfolios;

      store[syncKey] = {
        syncKey,
        baseCurrency: body.baseCurrency === "USD" ? "USD" : "THB",
        updatedAt: new Date().toISOString(),
        watchSettings: mergedWatchSettings,
        portfolios: normalizedPortfolios
      };
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
    marketCache.clear();
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
    const syncKey = pathKey || parsedUrl.query.key || "VENU2-88";
    const profile = getOrCreateProfile(syncKey);
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
          ? `ส่งคำขอต่ออายุทดลองใช้ (+${created.request.requestedExtendDays} วัน) เรียบร้อยแล้ว! ระบบได้แจ้งเตือนไปยัง ${emailNotification.to} แล้ว`
          : `ส่งคำขอซื้อ License ถาวร (PRO) เรียบร้อยแล้ว! ระบบได้ส่งข้อมูลติดต่อกลับไปยัง ${emailNotification.to} แล้ว`,
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
    return sendAdminJson(req, res, 200, {
      ...auth,
      ...meta,
      ownerEmail: OWNER_EMAIL,
      notifyEmail: NOTIFY_EMAIL,
      trialDays: TRIAL_DAYS,
      host: hostHeader
    });
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
        const cookieFlags = [
          `__moat_admin_session=${encodeURIComponent(result.token)}`,
          "HttpOnly",
          "Path=/",
          "Max-Age=43200",
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
      return sendAdminJson(req, res, 200, {
        ok: true,
        admin: { ...auth, ...meta },
        ...licenseManager.listDevices(),
        compatibleDevices: COMPATIBLE_GARMIN_DEVICES,
        smtpConfig: emailService.getSmtpConfig(false)
      });
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
          message: "บันทึกการตั้งค่า SMTP / System Mail เรียบร้อยแล้ว",
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
          message: `ส่งอีเมลทดสอบไปยัง ${mailResult.to} เรียบร้อยแล้ว (${mailResult.status})`,
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

    if (pathname === "/api/admin/devices/update" && req.method === "POST") {
      try {
        const body = await parseBody(req);
        const updated = licenseManager.adminUpdateDevice(body.deviceId, body.action, {
          days: body.days,
          label: body.label,
          notes: body.notes,
          syncKey: body.syncKey,
          actor: auth.email
        });
        if (!updated.ok) {
          return sendAdminJson(req, res, 400, updated);
        }

        // Sync activationKey removal if expired/revoked/reset so profile reflects state immediately
        const act = String(body.action || "").toUpperCase();
        if (act === "EXPIRE_TRIAL" || act === "REVOKE" || act === "RESET_TRIAL") {
          const store = readStore();
          for (const prof of Object.values(store)) {
            if (
              prof.watchSettings &&
              (prof.watchSettings.deviceId === updated.deviceId ||
                licenseManager.verifyActivationKey(updated.deviceId, prof.watchSettings.activationKey))
            ) {
              prof.watchSettings.activationKey = "";
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
    console.log(`[Venu2Moat] Server running at http://localhost:${PORT}`);
    console.log(`[Venu2Moat] Garmin Connect IQ Watch API: http://localhost:${PORT}/api/watch?key=VENU2-88`);
    console.log(`[Venu2Moat] Compatible Garmin Watches: ${COMPATIBLE_GARMIN_DEVICES.length} models (2024-2026)`);
    console.log(`[Venu2Moat] Admin Portal (Subdomain): http://localhost:${PORT}/admin (https://admin-moat.readybyte.top)`);
  });
}

module.exports = {
  createAppServer,
  handleRequest,
  licenseManager,
  emailService,
  COMPATIBLE_GARMIN_DEVICES
};
