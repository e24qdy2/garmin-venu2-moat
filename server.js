const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");
const { LicenseManager, OWNER_EMAIL, NOTIFY_EMAIL, TRIAL_DAYS } = require("./lib/licenseManager");
const { EmailService } = require("./lib/emailService");

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
  deviceId: "V2-88VENU20",
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
  const deviceId = licenseManager.normalizeDeviceId(raw.deviceId || fallback.deviceId || "V2-88VENU20");
  const activationKey = licenseManager.normalizeKey(raw.activationKey !== undefined ? raw.activationKey : fallback.activationKey || "");
  return {
    autoSwipeEnabled,
    autoSwipeSec,
    alwaysOnDisplay,
    deviceId,
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

// In-memory cache for Yahoo Finance chart/quote data (60s TTL)
const marketCache = new Map();
const CACHE_TTL_MS = 60 * 1000;

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
  "NVDA": { price: 138.60, prevClose: 134.80, currency: "USD", name: "NVIDIA Corp" },
  "MSFT": { price: 428.50, prevClose: 424.10, currency: "USD", name: "Microsoft Corp" },
  "AAPL": { price: 231.20, prevClose: 229.40, currency: "USD", name: "Apple Inc" },
  "GOOGL": { price: 181.40, prevClose: 179.10, currency: "USD", name: "Alphabet Inc" },
  "BRK-B": { price: 454.80, prevClose: 452.00, currency: "USD", name: "Berkshire Hathaway B" },
  "ADVANC.BK": { price: 284.00, prevClose: 281.00, currency: "THB", name: "Advanced Info Service" },
  "DELTA.BK": { price: 129.50, prevClose: 126.00, currency: "THB", name: "Delta Electronics Thai" },
  "PTTEP.BK": { price: 126.50, prevClose: 128.00, currency: "THB", name: "PTT Exploration" },
  "BDMS.BK": { price: 28.75, prevClose: 28.50, currency: "THB", name: "Bangkok Dusit Med" },
  "BTC-USD": { price: 89450.00, prevClose: 87920.00, currency: "USD", name: "Bitcoin USD" },
  "SCHD": { price: 29.15, prevClose: 28.98, currency: "USD", name: "Schwab US Dividend ETF" },
  "QQQ": { price: 508.40, prevClose: 504.10, currency: "USD", name: "Invesco QQQ Trust" },
  "THB=X": { price: 34.45, prevClose: 34.52, currency: "THB", name: "USD/THB" }
};

function computeTechnicals(closes) {
  const clean = closes.filter((v) => typeof v === "number" && Number.isFinite(v));
  const spark20 = clean.slice(-20);
  if (spark20.length === 0) {
    return { sparkline: [100, 101, 102], sma20: 101, upperBB: 104, lowerBB: 98 };
  }
  const sum = spark20.reduce((a, b) => a + b, 0);
  const sma20 = sum / spark20.length;
  const variance = spark20.reduce((acc, v) => acc + Math.pow(v - sma20, 2), 0) / spark20.length;
  const stdDev = Math.sqrt(variance);
  return {
    sparkline: spark20.map((v) => Number(v.toFixed(2))),
    sma20: Number(sma20.toFixed(2)),
    upperBB: Number((sma20 + 2 * stdDev).toFixed(2)),
    lowerBB: Number((sma20 - 2 * stdDev).toFixed(2))
  };
}

async function fetchSymbolMarketData(symbol) {
  const sym = symbol.trim().toUpperCase();
  const cached = marketCache.get(sym);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1mo&interval=1d`;
    const json = await fetchJsonHttps(chartUrl);
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error("No chart result");

    const meta = result.meta || {};
    const rawCloses = result.indicators?.quote?.[0]?.close || [];
    const closes = rawCloses.filter((n) => typeof n === "number" && Number.isFinite(n));
    const price = Number((meta.regularMarketPrice ?? closes[closes.length - 1] ?? 100).toFixed(2));
    const prevClose = Number((meta.chartPreviousClose ?? meta.previousClose ?? closes[closes.length - 2] ?? price).toFixed(2));
    const change = Number((price - prevClose).toFixed(2));
    const changePct = prevClose > 0 ? Number(((change / prevClose) * 100).toFixed(2)) : 0;
    const currency = meta.currency || (sym.endsWith(".BK") ? "THB" : "USD");
    const tech = computeTechnicals(closes.length >= 5 ? closes : [prevClose, price]);

    const data = {
      symbol: sym,
      shortName: meta.shortName || meta.longName || sym,
      currency,
      price,
      prevClose,
      change,
      changePct,
      ...tech,
      source: "LIVE_YAHOO"
    };
    marketCache.set(sym, { ts: Date.now(), data });
    return data;
  } catch (err) {
    const fb = FALLBACK_BASE[sym] || {
      price: 100.0,
      prevClose: 98.5,
      currency: sym.endsWith(".BK") ? "THB" : "USD",
      name: sym
    };
    const closes = [];
    let seed = sym.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    for (let i = 19; i >= 1; i--) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const noise = ((seed % 1000) / 1000 - 0.48) * 0.035;
      closes.push(Number((fb.price * (1 - i * 0.002 + noise)).toFixed(2)));
    }
    closes.push(fb.price);
    const change = Number((fb.price - fb.prevClose).toFixed(2));
    const changePct = Number(((change / fb.prevClose) * 100).toFixed(2));
    const tech = computeTechnicals(closes);
    const data = {
      symbol: sym,
      shortName: fb.name,
      currency: fb.currency,
      price: fb.price,
      prevClose: fb.prevClose,
      change,
      changePct,
      ...tech,
      source: "FALLBACK_SIM"
    };
    marketCache.set(sym, { ts: Date.now(), data });
    return data;
  }
}

async function buildEnrichedPayload(profile, queryOpts = {}) {
  const watchSettings = sanitizeWatchSettings(profile.watchSettings);
  const effectiveDeviceId = licenseManager.normalizeDeviceId(queryOpts.deviceId || watchSettings.deviceId || "V2-88VENU20");
  const effectiveActivationKey = licenseManager.normalizeKey(queryOpts.activationKey || watchSettings.activationKey || "");

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
    for (const h of p.holdings || []) {
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

    const enrichedHoldings = (p.holdings || []).map((h) => {
      const sym = h.symbol.trim().toUpperCase();
      const q = quotes[sym] || {
        symbol: sym,
        shortName: h.name || sym,
        currency: p.currency || "USD",
        price: h.avgCost || 100,
        prevClose: h.avgCost || 100,
        change: 0,
        changePct: 0,
        sparkline: [100, 100],
        sma20: 100,
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

      return {
        symbol: sym,
        name: h.name || q.shortName || sym,
        currency: q.currency,
        shares,
        avgCost: Number(avgCost.toFixed(2)),
        price: q.price,
        prevClose: q.prevClose,
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
        sma20: q.sma20,
        upperBB: q.upperBB,
        lowerBB: q.lowerBB,
        source: q.source
      };
    });

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
        holdingsCount: enrichedHoldings.length,
        alertsCount: enrichedHoldings.filter((item) => item.alertTriggered).length
      },
      holdings: enrichedHoldings
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
      license: licenseStatus.full,
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
    // Ultra-compact payload tailored for Garmin Venu 2 Connect IQ memory budget (<12KB)
    watch: {
      k: profile.syncKey,
      bc: baseCurrency,
      fx: Number(usdThbRate.toFixed(2)),
      ts: Math.floor(Date.now() / 1000),
      cfg: {
        asw: profile.watchSettings.autoSwipeEnabled ? 1 : 0,
        asec: profile.watchSettings.autoSwipeSec,
        aon: profile.watchSettings.alwaysOnDisplay ? 1 : 0
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
          const spk14 = h.sparkline.slice(-14);
          const memoShort = h.memo.slice(0, 48);
          return {
            s: cleanSym,
            sym: cleanSym,
            n: h.name.slice(0, 14),
            cur: h.currency,
            p: h.price,
            px: h.price,
            c: h.changePct,
            pct: h.changePct,
            sh: h.shares,
            ac: h.avgCost,
            avg: h.avgCost,
            mv: Math.round(h.marketValueBase),
            dp: Math.round(h.dayPnlBase),
            tp: Math.round(h.totalPnl),
            tPct: h.totalPnlPct,
            pPct: h.totalPnlPct,
            tg: h.targetPrice,
            tgt: h.targetPrice,
            ad: h.alertDir === "BELOW" ? "B" : "A",
            at: h.alertTriggered ? 1 : 0,
            alrt: alrtState,
            m: memoShort,
            note: memoShort,
            sp: spk14,
            spk: spk14,
            sma: h.sma20,
            ub: h.upperBB,
            lb: h.lowerBB
          };
        })
      }))
    }
  };
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Token"
  });
  res.end(JSON.stringify(obj));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
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
  if (req.method === "OPTIONS") {
    return sendJson(res, 200, { ok: true });
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname || "/";
  const hostHeader = String(req.headers.host || "").toLowerCase();
  const isAdminSubdomain = hostHeader.startsWith("admin-moat.");

  // 1. GET /api/portfolio?key=VENU2-88 (Full Web Companion + Watch Preview Payload)
  if (pathname === "/api/portfolio" && req.method === "GET") {
    const syncKey = parsedUrl.query.key || "VENU2-88";
    const profile = getOrCreateProfile(syncKey);
    const payload = await buildEnrichedPayload(profile, {
      deviceId: parsedUrl.query.did,
      activationKey: parsedUrl.query.akey
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
        activationKey: mergedWatchSettings.activationKey
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

  // 3. GET /api/watch?key=VENU2-88&did=V2-XXXX&akey=... (Compact JSON endpoint for Garmin Venu 2 Watch App)
  if ((pathname === "/api/watch" || pathname.startsWith("/api/watch/")) && req.method === "GET") {
    const pathKey = pathname.startsWith("/api/watch/") ? pathname.replace("/api/watch/", "") : "";
    const syncKey = pathKey || parsedUrl.query.key || "VENU2-88";
    const profile = getOrCreateProfile(syncKey);
    const payload = await buildEnrichedPayload(profile, {
      deviceId: parsedUrl.query.did,
      activationKey: parsedUrl.query.akey
    });
    return sendJson(res, 200, payload.watch);
  }

  // 4. GET /api/quote?symbol=TSLA (Quick symbol lookup when adding holding)
  if (pathname === "/api/quote" && req.method === "GET") {
    const sym = parsedUrl.query.symbol || "AAPL";
    const quote = await fetchSymbolMarketData(sym);
    return sendJson(res, 200, quote);
  }

  // 5. POST /api/device/activate (Activate a Garmin Venu 2 Device ID using an Admin-generated Activation Key)
  if (pathname === "/api/device/activate" && req.method === "POST") {
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
        license: result.license,
        payload
      });
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  }

  // 6. GET /api/device/status
  if (pathname === "/api/device/status" && req.method === "GET") {
    const syncKey = String(parsedUrl.query.key || "VENU2-88").trim().toUpperCase();
    const profile = getOrCreateProfile(syncKey);
    const deviceId = licenseManager.normalizeDeviceId(parsedUrl.query.did || profile.watchSettings.deviceId);
    const evaluated = licenseManager.evaluateDeviceLicense(deviceId, {
      syncKey,
      providedKey: profile.watchSettings.activationKey
    });
    return sendJson(res, 200, evaluated);
  }

  // 6b. POST /api/license/request (Request Trial Key Extend or Submit Purchase Request Form -> Emails e24qdy2@gmail.com)
  if (pathname === "/api/license/request" && req.method === "POST") {
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
        device: created.device,
        emailNotification
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
    const meta = licenseManager.getAdminAuthMeta();
    return sendJson(res, 200, {
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
      const result = licenseManager.loginAdminWithPassword(body.email || OWNER_EMAIL, body.password);
      return sendJson(res, result.ok ? 200 : 401, result);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  }

  if (pathname === "/api/admin/auth/request-otp" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const result = licenseManager.requestAdminOtp(body.email || OWNER_EMAIL);
      return sendJson(res, result.ok ? 200 : 403, result);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  }

  if (pathname === "/api/admin/auth/verify-otp" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const result = licenseManager.verifyAdminOtp(body.email || OWNER_EMAIL, body.code);
      return sendJson(res, result.ok ? 200 : 401, result);
    } catch (err) {
      return sendJson(res, 400, { ok: false, error: err.message });
    }
  }

  if (pathname.startsWith("/api/admin/")) {
    const auth = licenseManager.verifyAdminRequest(req);
    if (!auth.authenticated) {
      return sendJson(res, 401, {
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
          return sendJson(res, 400, result);
        }
        return sendJson(res, 200, {
          ...result,
          ...licenseManager.listDevices(),
          smtpConfig: emailService.getSmtpConfig(false)
        });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message });
      }
    }

    if (pathname === "/api/admin/devices" && req.method === "GET") {
      const meta = licenseManager.getAdminAuthMeta();
      return sendJson(res, 200, {
        ok: true,
        admin: { ...auth, ...meta },
        ...licenseManager.listDevices(),
        smtpConfig: emailService.getSmtpConfig(false)
      });
    }

    if (pathname === "/api/admin/requests/resolve" && req.method === "POST") {
      try {
        const body = await parseBody(req);
        if (!body.requestId || !body.action) {
          return sendJson(res, 400, { ok: false, error: "requestId and action are required" });
        }
        const resolved = licenseManager.resolveCustomerRequest(body.requestId, body.action, {
          note: body.note,
          actor: auth.email || OWNER_EMAIL
        });
        if (!resolved.ok) {
          return sendJson(res, 400, resolved);
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

        return sendJson(res, 200, {
          ...resolved,
          ...licenseManager.listDevices(),
          smtpConfig: emailService.getSmtpConfig(false)
        });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message });
      }
    }

    if (pathname === "/api/admin/email/config" && req.method === "GET") {
      return sendJson(res, 200, {
        ok: true,
        smtpConfig: emailService.getSmtpConfig(false),
        emailLogs: emailService.listEmailLogs(30)
      });
    }

    if (pathname === "/api/admin/email/config" && req.method === "POST") {
      try {
        const body = await parseBody(req);
        const smtpConfig = emailService.updateSmtpConfig(body);
        return sendJson(res, 200, {
          ok: true,
          message: "บันทึกการตั้งค่า SMTP / System Mail เรียบร้อยแล้ว",
          smtpConfig,
          emailLogs: emailService.listEmailLogs(30)
        });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message });
      }
    }

    if (pathname === "/api/admin/email/test" && req.method === "POST") {
      try {
        const body = await parseBody(req);
        if (body.smtpConfig && typeof body.smtpConfig === "object") {
          emailService.updateSmtpConfig(body.smtpConfig);
        }
        const mailResult = await emailService.sendTestEmail(body.note);
        return sendJson(res, 200, {
          ok: true,
          message: `ส่งอีเมลทดสอบไปยัง ${mailResult.to} เรียบร้อยแล้ว (${mailResult.status})`,
          mailResult,
          smtpConfig: emailService.getSmtpConfig(false),
          emailLogs: emailService.listEmailLogs(30)
        });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message });
      }
    }

    if (pathname === "/api/admin/devices/generate-key" && req.method === "POST") {
      try {
        const body = await parseBody(req);
        if (!body.deviceId) {
          return sendJson(res, 400, { ok: false, error: "deviceId is required" });
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

        return sendJson(res, 200, {
          ...issued,
          ...licenseManager.listDevices()
        });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message });
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
          return sendJson(res, 400, updated);
        }

        // Sync activationKey removal if expired/revoked/reset so profile reflects state immediately
        const act = String(body.action || "").toUpperCase();
        if (act === "EXPIRE_TRIAL" || act === "REVOKE" || act === "RESET_TRIAL") {
          const store = readStore();
          for (const prof of Object.values(store)) {
            if (prof.watchSettings && prof.watchSettings.deviceId === updated.deviceId) {
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

        return sendJson(res, 200, {
          ...updated,
          ...licenseManager.listDevices()
        });
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err.message });
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
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not Found");
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
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
    console.log(`[Venu2Moat] Garmin Venu 2 Watch API: http://localhost:${PORT}/api/watch?key=VENU2-88`);
    console.log(`[Venu2Moat] Admin Portal (Subdomain): http://localhost:${PORT}/admin (https://admin-moat.readybyte.top)`);
  });
}

module.exports = {
  createAppServer,
  handleRequest,
  licenseManager,
  emailService
};
