/**
 * ============================================================================
 * MoatWatch Shared Support/Resistance (S1-S2-S3 / R1-R2-R3) & Hermes Research
 * Feed Manager + Admin BI Quantitative Analytics Engine
 * ============================================================================
 *
 * Capabilities:
 * 1. Shared Watchlist Support/Resistance (Level 1 Short-term, Level 2 Medium-term,
 *    Level 3 Long-term: ระยะสั้น-กลาง-ยาว) & Hermes Tagged Analyst Posts visible
 *    across ALL SyncKeys.
 * 2. Auto-Archive / Auto-Hide engine for aging cards (configurable TTL in days,
 *    with pin exemption) so the frontpage stays clean and uncluttered.
 * 3. Full Admin CMS operations: Create, Edit, Archive/Hide, Restore, Pin/Unpin,
 *    Delete (single & bulk), and Auto-Archive policy management.
 * 4. Multi-angle BI & Quantitative Analytics aggregator for Admin Dashboard
 *    (Users/SyncKeys, Topics/Tags, WebMemos/Drafts, S/R 1-2-3 Quant Metrics).
 */

const { FALLBACK_BASE } = require("./moatEngine");

const DEFAULT_AUTO_ARCHIVE_DAYS = 21;
const MIN_AUTO_ARCHIVE_DAYS = 1;
const MAX_AUTO_ARCHIVE_DAYS = 365;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function roundPrice(val, currency = "USD") {
  const num = Number(val);
  if (!Number.isFinite(num) || num <= 0) return 0;
  if (num >= 1000) return Math.round(num * 100) / 100;
  if (num >= 10) return Math.round(num * 100) / 100;
  return Math.round(num * 1000) / 1000;
}

function normalizeTag(rawTag) {
  const clean = String(rawTag || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_\-\u0E00-\u0E7F]/g, "");
  if (!clean) return "";
  return `#${clean}`;
}

function normalizeTagsList(rawTags) {
  let list = [];
  if (Array.isArray(rawTags)) {
    list = rawTags;
  } else if (typeof rawTags === "string") {
    list = rawTags.split(/[,;\s]+/).filter(Boolean);
  }
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const t = normalizeTag(item);
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out.length > 0 ? out.slice(0, 8) : ["#WatchlistQuant"];
}

const DEFAULT_TAG_PALETTE = [
  "#38bdf8",
  "#a78bfa",
  "#10b981",
  "#60a5fa",
  "#f59e0b",
  "#34d399",
  "#818cf8",
  "#c084fc",
  "#2dd4bf",
  "#fbbf24",
  "#f472b6",
  "#94a3b8"
];

function createDefaultTagRegistry(nowIso = new Date().toISOString()) {
  const defaults = [
    {
      tag: "#SupportResistance",
      color: "#38bdf8",
      category: "TECHNICAL",
      description: "วิเคราะห์แนวรับ 1-2-3 และแนวต้าน 1-2-3 (S1–S3 / R1–R3)",
      pinned: true,
      hidden: false
    },
    {
      tag: "#HermesDaily",
      color: "#a78bfa",
      category: "HERMES",
      description: "บทวิเคราะห์ประจำวันจาก Hermes Quant Research Agent",
      pinned: true,
      hidden: false
    },
    {
      tag: "#DiscordApproved",
      color: "#10b981",
      category: "APPROVAL",
      description: "WebMemo และสัญญาณที่เจ้าของอนุมัติผ่าน Discord",
      pinned: true,
      hidden: false
    },
    {
      tag: "#AI-Infra",
      color: "#60a5fa",
      category: "SECTOR",
      description: "โครงสร้างพื้นฐาน AI, GPU, Foundry และ Hyperscale Data Center",
      pinned: true,
      hidden: false
    },
    {
      tag: "#Earnings",
      color: "#f59e0b",
      category: "CATALYST",
      description: "เกาะติดงบการเงิน รายได้ กำไร และ Guidance รายไตรมาส",
      pinned: false,
      hidden: false
    },
    {
      tag: "#Moat",
      color: "#34d399",
      category: "FUNDAMENTAL",
      description: "หุ้นที่มีป้อมปราการทางธุรกิจแข็งแกร่ง (Wide/Narrow Moat)",
      pinned: false,
      hidden: false
    },
    {
      tag: "#Semiconductor",
      color: "#818cf8",
      category: "SECTOR",
      description: "อุตสาหกรรมเซมิคอนดักเตอร์และชิปประมวลผล",
      pinned: false,
      hidden: false
    },
    {
      tag: "#SpaceMoat",
      color: "#c084fc",
      category: "SECTOR",
      description: "เทคโนโลยีอวกาศ ดาวเทียม Direct-to-Cell และระบบขนส่งอวกาศ",
      pinned: false,
      hidden: false
    },
    {
      tag: "#CleanEnergy",
      color: "#2dd4bf",
      category: "SECTOR",
      description: "พลังงานสะอาด ระบบกักเก็บพลังงาน และโครงข่ายไฟฟ้า",
      pinned: false,
      hidden: false
    },
    {
      tag: "#THB-Dividend",
      color: "#fbbf24",
      category: "DIVIDEND",
      description: "หุ้นปันผลเด่นตลาดหลักทรัพย์แห่งประเทศไทย (SET / THB)",
      pinned: false,
      hidden: false
    },
    {
      tag: "#WatchlistQuant",
      color: "#94a3b8",
      category: "QUANT",
      description: "หุ้นใน Watchlist ที่คำนวณกรอบแนวรับ/ต้านเชิงปริมาณ",
      pinned: false,
      hidden: false
    }
  ];
  return defaults.map((item) => ({
    ...item,
    label: item.tag.replace(/^#/, ""),
    createdAt: nowIso,
    updatedAt: nowIso
  }));
}

function normalizeTagRegistryEntry(raw = {}, index = 0, nowIso = new Date().toISOString()) {
  const cleanTag = normalizeTag(raw.tag || raw.name || raw.label || "");
  if (!cleanTag) return null;
  const fallbackColor = DEFAULT_TAG_PALETTE[index % DEFAULT_TAG_PALETTE.length];
  const rawColor = String(raw.color || "").trim();
  const color = /^#[0-9a-fA-F]{3,8}$/.test(rawColor) ? rawColor : fallbackColor;
  const category = String(raw.category || "GENERAL")
    .trim()
    .toUpperCase()
    .slice(0, 32);
  return {
    tag: cleanTag,
    label: cleanTag.replace(/^#/, ""),
    color,
    category: category || "GENERAL",
    description: String(raw.description || "").trim().slice(0, 200),
    pinned: Boolean(raw.pinned),
    hidden: Boolean(raw.hidden),
    createdAt: raw.createdAt || nowIso,
    updatedAt: raw.updatedAt || nowIso
  };
}

function ensureTagRegistry(store, nowMs = Date.now()) {
  const nowIso = new Date(nowMs).toISOString();
  if (!store || typeof store !== "object") return createDefaultTagRegistry(nowIso);

  const rawRegistry =
    Array.isArray(store.tagRegistry) && store.tagRegistry.length > 0
      ? store.tagRegistry
      : createDefaultTagRegistry(nowIso);

  const byLower = new Map();
  rawRegistry.forEach((item, idx) => {
    const norm = normalizeTagRegistryEntry(item, idx, nowIso);
    if (norm && !byLower.has(norm.tag.toLowerCase())) {
      byLower.set(norm.tag.toLowerCase(), norm);
    }
  });

  // Also ensure any tag currently attached to posts is registered in the registry
  const posts = Array.isArray(store.posts) ? store.posts : [];
  for (const p of posts) {
    for (const rawT of p.tags || []) {
      const cleanT = normalizeTag(rawT);
      if (cleanT && !byLower.has(cleanT.toLowerCase())) {
        const idx = byLower.size;
        byLower.set(
          cleanT.toLowerCase(),
          normalizeTagRegistryEntry(
            {
              tag: cleanT,
              category: "AUTO_DISCOVERED",
              description: "แท็กที่สร้างจากบทวิเคราะห์ของ Hermes / Admin",
              pinned: false,
              hidden: false
            },
            idx,
            p.updatedAt || p.publishedAt || nowIso
          )
        );
      } else if (cleanT) {
        // Canonicalize post tag casing to match registry entry if needed
        const regEntry = byLower.get(cleanT.toLowerCase());
        if (regEntry && Array.isArray(p.tags)) {
          p.tags = p.tags.map((pt) =>
            normalizeTag(pt).toLowerCase() === cleanT.toLowerCase() ? regEntry.tag : pt
          );
        }
      }
    }
  }

  store.tagRegistry = Array.from(byLower.values());
  return store.tagRegistry;
}

/**
 * Computes quantitative Support 1-2-3 & Resistance 1-2-3 (Short / Medium / Long)
 * for any stock given a reference price.
 */
function buildQuantSupportResistanceLevels(symbol, referencePrice, customLevels = {}) {
  const sym = String(symbol || "NVDA").trim().toUpperCase();
  const fallbackQuote = FALLBACK_BASE[sym] || { price: 100, currency: "USD" };
  const ref = Number(referencePrice) > 0 ? Number(referencePrice) : Number(fallbackQuote.price || 100);
  const cur = sym.endsWith(".BK") ? "THB" : fallbackQuote.currency || "USD";

  // Volatility profile adjustment by asset class
  const isCrypto = sym.includes("-USD");
  const isHighBeta = ["TSLA", "PLTR", "ASTS", "RKLB", "OKLO", "CRWV", "IREN", "CIFR", "EOSE", "NBIS", "SMCI", "AMD"].includes(sym);
  const stepShort = isCrypto ? 0.045 : isHighBeta ? 0.042 : 0.028;
  const stepMed = isCrypto ? 0.105 : isHighBeta ? 0.095 : 0.068;
  const stepLong = isCrypto ? 0.195 : isHighBeta ? 0.175 : 0.125;

  const rawSup = customLevels.supportLevels || customLevels.support || {};
  const rawRes = customLevels.resistanceLevels || customLevels.resistance || {};
  const supArr = Array.isArray(customLevels.supports) ? customLevels.supports : [];
  const resArr = Array.isArray(customLevels.resistances) ? customLevels.resistances : [];

  const extractArrPrice = (arr, idx) => {
    const item = arr[idx];
    if (item === undefined || item === null) return undefined;
    if (typeof item === "number") return item > 0 ? item : undefined;
    if (typeof item === "object" && Number(item.price) > 0) return Number(item.price);
    return undefined;
  };
  const extractArrNote = (arr, idx) => {
    const item = arr[idx];
    if (item && typeof item === "object" && item.note) return String(item.note);
    return undefined;
  };

  const s1Price = roundPrice(
    customLevels.s1 ?? extractArrPrice(supArr, 0) ?? rawSup.s1?.price ?? rawSup.s1 ?? ref * (1 - stepShort),
    cur
  );
  const s2Price = roundPrice(
    customLevels.s2 ?? extractArrPrice(supArr, 1) ?? rawSup.s2?.price ?? rawSup.s2 ?? ref * (1 - stepMed),
    cur
  );
  const s3Price = roundPrice(
    customLevels.s3 ?? extractArrPrice(supArr, 2) ?? rawSup.s3?.price ?? rawSup.s3 ?? ref * (1 - stepLong),
    cur
  );

  const r1Price = roundPrice(
    customLevels.r1 ?? extractArrPrice(resArr, 0) ?? rawRes.r1?.price ?? rawRes.r1 ?? ref * (1 + stepShort * 1.15),
    cur
  );
  const r2Price = roundPrice(
    customLevels.r2 ?? extractArrPrice(resArr, 1) ?? rawRes.r2?.price ?? rawRes.r2 ?? ref * (1 + stepMed * 1.2),
    cur
  );
  const r3Price = roundPrice(
    customLevels.r3 ?? extractArrPrice(resArr, 2) ?? rawRes.r3?.price ?? rawRes.r3 ?? ref * (1 + stepLong * 1.25),
    cur
  );

  const supportLevels = {
    s1: {
      rank: 1,
      level: 1,
      code: "S1",
      label: "S1 (ระยะสั้น)",
      horizon: "SHORT",
      horizonTh: "ระยะสั้น (1–2 สัปดาห์)",
      horizonLabelTh: "ระยะสั้น (1–2 สัปดาห์)",
      horizonLabelEn: "Short-Term (EMA20 / Demand Pivot)",
      price: s1Price,
      note: String(
        customLevels.s1Note || extractArrNote(supArr, 0) || rawSup.s1?.note || "โซนรับระยะสั้น EMA-20 / จุดย่อรับไม้แรก"
      ).trim()
    },
    s2: {
      rank: 2,
      level: 2,
      code: "S2",
      label: "S2 (ระยะกลาง)",
      horizon: "MEDIUM",
      horizonTh: "ระยะกลาง (1–3 เดือน)",
      horizonLabelTh: "ระยะกลาง (1–3 เดือน)",
      horizonLabelEn: "Medium-Term (SMA50 / Institutional Base)",
      price: s2Price,
      note: String(
        customLevels.s2Note || extractArrNote(supArr, 1) || rawSup.s2?.note || "แนวรับระยะกลาง SMA-50 / โซนสะสมหลัก"
      ).trim()
    },
    s3: {
      rank: 3,
      level: 3,
      code: "S3",
      label: "S3 (ระยะยาว)",
      horizon: "LONG",
      horizonTh: "ระยะยาว (3–12 เดือน)",
      horizonLabelTh: "ระยะยาว (3–12 เดือน)",
      horizonLabelEn: "Long-Term (SMA200 / Deep Value Moat)",
      price: s3Price,
      note: String(
        customLevels.s3Note || extractArrNote(supArr, 2) || rawSup.s3?.note || "แนวรับระยะยาว SMA-200 / โซน Margin of Safety"
      ).trim()
    }
  };

  const resistanceLevels = {
    r1: {
      rank: 1,
      level: 1,
      code: "R1",
      label: "R1 (ระยะสั้น)",
      horizon: "SHORT",
      horizonTh: "ระยะสั้น (1–2 สัปดาห์)",
      horizonLabelTh: "ระยะสั้น (1–2 สัปดาห์)",
      horizonLabelEn: "Short-Term (Swing High / Upper BB)",
      price: r1Price,
      note: String(
        customLevels.r1Note || extractArrNote(resArr, 0) || rawRes.r1?.note || "แนวต้านระยะสั้น Upper Bollinger / ทดสอบโมเมนตัม"
      ).trim()
    },
    r2: {
      rank: 2,
      level: 2,
      code: "R2",
      label: "R2 (ระยะกลาง)",
      horizon: "MEDIUM",
      horizonTh: "ระยะกลาง (1–3 เดือน)",
      horizonLabelTh: "ระยะกลาง (1–3 เดือน)",
      horizonLabelEn: "Medium-Term (Breakout Target / Channel Top)",
      price: r2Price,
      note: String(
        customLevels.r2Note || extractArrNote(resArr, 1) || rawRes.r2?.note || "แนวต้านระยะกลาง โซนแบ่งทำกำไร / Breakout"
      ).trim()
    },
    r3: {
      rank: 3,
      level: 3,
      code: "R3",
      label: "R3 (ระยะยาว)",
      horizon: "LONG",
      horizonTh: "ระยะยาว (3–12 เดือน)",
      horizonLabelTh: "ระยะยาว (3–12 เดือน)",
      horizonLabelEn: "Long-Term (Fibonacci Extension / Valuation Ceiling)",
      price: r3Price,
      note: String(
        customLevels.r3Note || extractArrNote(resArr, 2) || rawRes.r3?.note || "เป้าหมายระยะยาวตาม Moat DCF / Fibo 161.8%"
      ).trim()
    }
  };

  const supports = [supportLevels.s1, supportLevels.s2, supportLevels.s3];
  const resistances = [resistanceLevels.r1, resistanceLevels.r2, resistanceLevels.r3];

  return {
    supportLevels,
    resistanceLevels,
    supports,
    resistances,
    supportResistance: {
      support: supports,
      resistance: resistances
    }
  };
}

/**
 * Computes quantitative risk/reward and positioning metrics for a card at a given livePrice.
 */
function computeCardQuantMetrics(card, livePriceOverride = null) {
  const refPrice = Number(card.referencePrice || 100);
  const currentPrice = Number(livePriceOverride) > 0 ? Number(livePriceOverride) : refPrice;

  const s1 = Number(card.supportLevels?.s1?.price ?? card.supports?.[0]?.price ?? currentPrice * 0.97);
  const s2 = Number(card.supportLevels?.s2?.price ?? card.supports?.[1]?.price ?? currentPrice * 0.93);
  const s3 = Number(card.supportLevels?.s3?.price ?? card.supports?.[2]?.price ?? currentPrice * 0.88);
  const r1 = Number(card.resistanceLevels?.r1?.price ?? card.resistances?.[0]?.price ?? currentPrice * 1.03);
  const r2 = Number(card.resistanceLevels?.r2?.price ?? card.resistances?.[1]?.price ?? currentPrice * 1.08);
  const r3 = Number(card.resistanceLevels?.r3?.price ?? card.resistances?.[2]?.price ?? currentPrice * 1.15);

  const distToS1Pct = currentPrice > 0 ? ((currentPrice - s1) / currentPrice) * 100 : 0;
  const distToS2Pct = currentPrice > 0 ? ((currentPrice - s2) / currentPrice) * 100 : 0;
  const distToS3Pct = currentPrice > 0 ? ((currentPrice - s3) / currentPrice) * 100 : 0;

  const downsideToS1Pct = currentPrice > 0 ? ((s1 - currentPrice) / currentPrice) * 100 : 0;
  const downsideToS2Pct = currentPrice > 0 ? ((s2 - currentPrice) / currentPrice) * 100 : 0;
  const downsideToS3Pct = currentPrice > 0 ? ((s3 - currentPrice) / currentPrice) * 100 : 0;

  const upsideToR1Pct = currentPrice > 0 ? ((r1 - currentPrice) / currentPrice) * 100 : 0;
  const upsideToR2Pct = currentPrice > 0 ? ((r2 - currentPrice) / currentPrice) * 100 : 0;
  const upsideToR3Pct = currentPrice > 0 ? ((r3 - currentPrice) / currentPrice) * 100 : 0;

  const downsideRisk = Math.max(0.5, Math.abs(distToS1Pct));
  const mediumReward = Math.max(0.5, Math.abs(upsideToR2Pct));
  const riskRewardRatio = Math.round((mediumReward / downsideRisk) * 100) / 100;

  const fullSpan = Math.max(0.01, r3 - s3);
  const rangePositionPct = Math.max(2, Math.min(98, Math.round(((currentPrice - s3) / fullSpan) * 100)));

  let tacticalZone = "MID_CHANNEL";
  let tacticalZoneLabel = "แกว่งตัวในกรอบกลาง (S1 ↔ R1)";
  if (currentPrice <= s2) {
    tacticalZone = "DEEP_ACCUMULATE";
    tacticalZoneLabel = "โซนสะสมระยะกลาง-ยาว (ใกล้ S2/S3)";
  } else if (currentPrice <= s1 * 1.012) {
    tacticalZone = "SHORT_SUPPORT_TEST";
    tacticalZoneLabel = "ทดสอบแนวรับระยะสั้น (S1)";
  } else if (currentPrice >= r2) {
    tacticalZone = "EXTENDED_BREAKOUT";
    tacticalZoneLabel = "ทะลุแนวต้านระยะกลาง (มุ่งหน้า R3)";
  } else if (currentPrice >= r1 * 0.99) {
    tacticalZone = "RESISTANCE_TEST";
    tacticalZoneLabel = "ทดสอบแนวต้านระยะสั้น (R1)";
  }

  const roundedLive = roundPrice(currentPrice, card.currency || "USD");

  return {
    currentPrice: roundedLive,
    livePrice: roundedLive,
    distToS1Pct: Math.round(distToS1Pct * 100) / 100,
    distToS2Pct: Math.round(distToS2Pct * 100) / 100,
    distToS3Pct: Math.round(distToS3Pct * 100) / 100,
    downsideToS1Pct: Math.round(downsideToS1Pct * 100) / 100,
    downsideToS2Pct: Math.round(downsideToS2Pct * 100) / 100,
    downsideToS3Pct: Math.round(downsideToS3Pct * 100) / 100,
    upsideToR1Pct: Math.round(upsideToR1Pct * 100) / 100,
    upsideToR2Pct: Math.round(upsideToR2Pct * 100) / 100,
    upsideToR3Pct: Math.round(upsideToR3Pct * 100) / 100,
    riskRewardRatio,
    rangePositionPct,
    positionInBandPct: rangePositionPct,
    tacticalZone,
    tacticalZoneLabel,
    zoneCode: tacticalZone,
    zoneLabel: tacticalZoneLabel,
    bandLabel: tacticalZoneLabel
  };
}

/**
 * Initial seeded Hermes Analyst & Watchlist Support/Resistance 1-2-3 Cards
 */
function buildInitialSeedStore(nowMs = Date.now()) {
  const iso = (offsetHours = 0) => new Date(nowMs + offsetHours * 3600 * 1000).toISOString();

  const rawCards = [
    {
      id: "hrp_nvda_blackwell_sr",
      symbol: "NVDA",
      name: "NVIDIA Corp.",
      currency: "USD",
      portfolioId: "us-moat",
      author: "Hermes Agent",
      source: "HERMES_ANALYST",
      topic: "Blackwell Rack Scale-Up & Hyperscaler CapEx Cycle",
      tags: ["#AI-Moat", "#Semiconductors", "#SupportResistance", "#WideMoat"],
      bias: "BULLISH",
      referencePrice: 138.6,
      s1: 133.5,
      s1Note: "EMA-20 ระยะสั้น / แนวรับย่อตัวในกรอบขาขึ้น",
      s2: 124.8,
      s2Note: "SMA-50 ระยะกลาง / โซนสะสมของสถาบันก่อนงบ",
      s3: 112.0,
      s3Note: "SMA-200 ระยะยาว / โซน Margin of Safety หลัก",
      r1: 144.0,
      r1Note: "แนวต้านระยะสั้น All-Time High ทดสอบแรงขาย",
      r2: 155.0,
      r2Note: "เป้าหมายระยะกลาง โซน Trim บางส่วนตามแผน WebMemo",
      r3: 172.0,
      r3Note: "เป้าหมายระยะยาวปีหน้าจาก Blackwell + Rubin Ramp",
      summary:
        "Hermes Daily Quant: โมเมนตัมคำสั่งซื้อ Blackwell GB200 จากกลุ่ม Cloud Hyperscaler ยังแข็งแกร่ง แนะนำถือ Core Moat และใช้ S1 ($133.5) / S2 ($124.8) เป็นจุดตั้งรับ ส่วน R2 ($155.0) เป็นจุดพิจารณาแบ่งทำกำไรบางส่วน",
      signals: [
        "RSI-14 ยืนโซนแข็งแกร่งเหนือ 58 โดยยังไม่เกิด Bearish Divergence",
        "สถาบันตั้ง Bid หนาแน่นที่โซน S2 ($124.8–$126.0)",
        "WebMemo ซิงก์ตรงกับเป้าหมาย $155 บนหน้าปัด Garmin"
      ],
      pinned: true,
      status: "PUBLISHED",
      autoArchiveDays: 21,
      createdAt: iso(-6)
    },
    {
      id: "hrp_msft_azure_sr",
      symbol: "MSFT",
      name: "Microsoft Corp.",
      currency: "USD",
      portfolioId: "us-moat",
      author: "Hermes Agent",
      source: "HERMES_ANALYST",
      topic: "Azure AI Capacity Unlock & Enterprise Copilot Monetization",
      tags: ["#CloudInfra", "#AI-Moat", "#AccumulateZone", "#SupportResistance"],
      bias: "ACCUMULATE",
      referencePrice: 428.5,
      s1: 416.0,
      s1Note: "แนวรับระยะสั้น โซนสะสมไม้แรกตาม WebMemo (<$418)",
      s2: 402.5,
      s2Note: "แนวรับระยะกลาง โซนฐานราคาไตรมาสก่อน",
      s3: 385.0,
      s3Note: "แนวรับระยะยาว SMA-200 / โซน Deep Value ของหุ้น Wide Moat",
      r1: 438.0,
      r1Note: "แนวต้านระยะสั้น กรอบบน Bollinger Band",
      r2: 465.0,
      r2Note: "แนวต้านระยะกลาง เป้าหมายหลักของรอบรายได้ Azure",
      r3: 495.0,
      r3Note: "แนวต้านระยะยาวจาก Operating Leverage ของ Copilot",
      summary:
        "Hermes Analyst Note: MSFT พักฐานสร้างกรอบสะสมที่แข็งแกร่ง ดาวน์ไซด์จำกัดบริเวณ S1 ($416) – S2 ($402.5) เหมาะสำหรับทยอยสะสมเพื่อถือยาวรอการเร่งตัวของ Azure AI ในครึ่งปีหลัง",
      signals: [
        "ราคาอยู่ใกล้โซนสะสม S1 ให้ Risk/Reward Ratio คุ้มค่า (>2.5x)",
        "กระแสเงินสดอิสระ (FCF) รองรับงบลงทุน AI Data Center ได้เต็มที่"
      ],
      pinned: true,
      status: "PUBLISHED",
      autoArchiveDays: 21,
      createdAt: iso(-12)
    },
    {
      id: "hrp_avgo_custom_asic",
      symbol: "AVGO",
      name: "Broadcom Inc.",
      currency: "USD",
      portfolioId: "us-moat",
      author: "Hermes Agent",
      source: "HERMES_ANALYST",
      topic: "Custom AI XPUs & Networking Switching Cycle",
      tags: ["#Semiconductors", "#AI-Moat", "#Breakout", "#SupportResistance"],
      bias: "BULLISH",
      referencePrice: 179.4,
      s1: 172.0,
      s1Note: "แนวรับระยะสั้น EMA-20 หลังการพักตัวระยะสั้น",
      s2: 161.5,
      s2Note: "แนวรับระยะกลาง ฐาน Breakout เดิม",
      s3: 146.0,
      s3Note: "แนวรับระยะยาว SMA-200 / โซนรับหลักหากตลาดปรับฐาน",
      r1: 186.5,
      r1Note: "แนวต้านระยะสั้น ทดสอบ High เดิม",
      r2: 202.0,
      r2Note: "แนวต้านระยะกลาง เป้าหมาย Channel ขาขึ้น",
      r3: 225.0,
      r3Note: "แนวต้านระยะยาวจากดีล Custom Silicon 3 รายใหญ่",
      summary:
        "Hermes Sector Watch: AVGO ได้อานิสงส์โดยตรงจาก Custom AI Accelerator (XPU) และ VMware Software Margin ที่ขยายตัวเร็วเกินคาด แนวรับ S1 ($172) แข็งแรงมาก",
      signals: [
        "รายได้ AI Networking เติบโตระดับ +40% YoY",
        "โครงสร้างราคาทำ Higher Low ต่อเนื่องเหนือ S2 ($161.5)"
      ],
      pinned: false,
      status: "PUBLISHED",
      autoArchiveDays: 21,
      createdAt: iso(-18)
    },
    {
      id: "hrp_tsm_cowos_moat",
      symbol: "TSM",
      name: "Taiwan Semiconductor",
      currency: "USD",
      portfolioId: "us-moat",
      author: "Hermes Agent",
      source: "HERMES_ANALYST",
      topic: "2nm (N2) & CoWoS Packaging Monopoly Pricing Power",
      tags: ["#Semiconductors", "#WideMoat", "#Earnings", "#SupportResistance"],
      bias: "BULLISH",
      referencePrice: 191.2,
      s1: 184.0,
      s1Note: "แนวรับระยะสั้น โซน Gap Support หลังประกาศงบ",
      s2: 173.5,
      s2Note: "แนวรับระยะกลาง SMA-50",
      s3: 158.0,
      s3Note: "แนวรับระยะยาว โซน Valuation P/E < 20x",
      r1: 198.5,
      r1Note: "แนวต้านระยะสั้น จิตวิทยา $200",
      r2: 214.0,
      r2Note: "แนวต้านระยะกลางจากการปรับเพิ่มคาดการณ์ Gross Margin",
      r3: 235.0,
      r3Note: "เป้าหมายระยะยาวจากกำลังการผลิต CoWoS ที่เพิ่มขึ้นเท่าตัว",
      summary:
        "Hermes Foundry Check: TSM มีอำนาจตั้งราคา (Pricing Power) สูงสุดในห่วงโซ่อุปทานชิปโลก การปรับขึ้นราคา N3/N5 และ CoWoS ช่วยหนุน Gross Margin ยืนเหนือ 57%",
      signals: [
        "ผูกขาดการผลิตชิป AI ชั้นนำทั้ง NVDA, AMD, AVGO และ AAPL",
        "แนวรับระยะสั้น S1 ($184) มีแรงซื้อกลับทุกครั้งที่ย่อทดสอบ"
      ],
      pinned: false,
      status: "PUBLISHED",
      autoArchiveDays: 21,
      createdAt: iso(-28)
    },
    {
      id: "hrp_asml_euv_cycle",
      symbol: "ASML",
      name: "ASML Holding",
      currency: "USD",
      portfolioId: "us-moat",
      author: "Hermes Agent",
      source: "HERMES_ANALYST",
      topic: "High-NA EUV Lithography Floor & Valuation Reset",
      tags: ["#Semiconductors", "#AccumulateZone", "#WideMoat", "#SupportResistance"],
      bias: "ACCUMULATE",
      referencePrice: 728.0,
      s1: 705.0,
      s1Note: "แนวรับระยะสั้น โซนสร้างฐานหลังข่าว Guidance",
      s2: 672.0,
      s2Note: "แนวรับระยะกลาง ฐานราคาสำคัญรอบปี 2024",
      s3: 625.0,
      s3Note: "แนวรับระยะยาว Deep Contrarian Value Zone",
      r1: 758.0,
      r1Note: "แนวต้านระยะสั้น โซน Gap Down เดิม",
      r2: 815.0,
      r2Note: "แนวต้านระยะกลาง SMA-50 / จุด Re-rating",
      r3: 895.0,
      r3Note: "เป้าหมายระยะยาวเมื่อคำสั่งซื้อ EUV รอบปี 2026 ฟื้นตัว",
      summary:
        "Hermes Contrarian Signal: ราคาหุ้น ASML ซึมซับปัจจัยลบด้านการเลื่อนรับมอบเครื่องของลูกค้าบางรายไปแล้ว โซน S1 ($705) – S2 ($672) เป็นจุดทยอยสะสมหุ้นผูกขาด EUV 100% ของโลก",
      signals: [
        "RSI ฟื้นตัวจากภาวะ Oversold (<32) พร้อม Volume สะสม",
        "ผูกขาดเทคโนโลยี High-NA EUV ไม่มีคู่แข่งทดแทนได้ในทศวรรษนี้"
      ],
      pinned: false,
      status: "PUBLISHED",
      autoArchiveDays: 21,
      createdAt: iso(-36)
    },
    {
      id: "hrp_meta_llama_ads",
      symbol: "META",
      name: "Meta Platforms",
      currency: "USD",
      portfolioId: "us-moat",
      author: "Hermes Agent",
      source: "HERMES_ANALYST",
      topic: "AI-Driven Ad Conversion & WhatsApp Business Monetization",
      tags: ["#AI-Moat", "#WideMoat", "#SupportResistance", "#Earnings"],
      bias: "BULLISH",
      referencePrice: 588.0,
      s1: 571.0,
      s1Note: "แนวรับระยะสั้น EMA-20",
      s2: 542.0,
      s2Note: "แนวรับระยะกลาง SMA-50 / โซนรับหลัก",
      s3: 498.0,
      s3Note: "แนวรับระยะยาว โซนฐานใหญ่ก่อนวิ่งรอบล่าสุด",
      r1: 605.0,
      r1Note: "แนวต้านระยะสั้น จิตวิทยา $600+",
      r2: 640.0,
      r2Note: "แนวต้านระยะกลาง เป้าหมายรอบงบไตรมาส",
      r3: 690.0,
      r3Note: "เป้าหมายระยะยาวจาก AI Agent บน WhatsApp/Instagram",
      summary:
        "Hermes AdTech Tracker: อัลกอริทึม AI แนะนำคอนเทนต์และโฆษณาของ META ช่วยดันทั้ง Engagement และราคาโฆษณาต่อหน่วย (Ad Price) แนวโน้มยังเป็น Uptrend ชัดเจนเหนือ S1 ($571)",
      signals: [
        "ROIC สูงกว่าค่าเฉลี่ยกลุ่ม Big Tech ต่อเนื่อง 4 ไตรมาส",
        "โซนรับ S1 ($571) ยืนได้อย่างแข็งแกร่ง"
      ],
      pinned: false,
      status: "PUBLISHED",
      autoArchiveDays: 21,
      createdAt: iso(-48)
    },
    {
      id: "hrp_pltr_aip_commercial",
      symbol: "PLTR",
      name: "Palantir Technologies",
      currency: "USD",
      portfolioId: "us-moat",
      author: "Hermes Agent",
      source: "HERMES_ANALYST",
      topic: "US Commercial AIP Bootcamps & Defense Operating System",
      tags: ["#AI-Moat", "#Breakout", "#HighBeta", "#SupportResistance"],
      bias: "NEUTRAL",
      referencePrice: 43.2,
      s1: 40.5,
      s1Note: "แนวรับระยะสั้น EMA-20 สำหรับสาย Momentum",
      s2: 36.8,
      s2Note: "แนวรับระยะกลาง SMA-50 (จุดปลอดภัยกว่าในการรับ)",
      s3: 31.2,
      s3Note: "แนวรับระยะยาว ฐานราคาหลังเข้าคำนวณ S&P 500",
      r1: 45.5,
      r1Note: "แนวต้านระยะสั้น ทดสอบจุดสูงสุดใหม่",
      r2: 50.0,
      r2Note: "แนวต้านระยะกลาง จิตวิทยา $50",
      r3: 58.0,
      r3Note: "แนวต้านระยะยาวหาก US Commercial โตเกิน +55% YoY",
      summary:
        "Hermes Valuation Alert: พื้นฐานด้าน AI Ontology และสัญญาภาครัฐแข็งแกร่งมาก แต่ Valuation ตึงตัวในระยะสั้น แนะนำไม่ไล่ราคาที่ R1 ($45.5) และรอจังหวะย่อหาแนวรับ S1 ($40.5) หรือ S2 ($36.8)",
      signals: [
        "Rule of 40 สูงถึงระดับ 64% สูงสุดในกลุ่ม Enterprise SaaS",
        "ระวังความผันผวนสูงก่อนประกาศงบ — ใช้ S1/S2 คุมความเสี่ยง"
      ],
      pinned: false,
      status: "PUBLISHED",
      autoArchiveDays: 14,
      createdAt: iso(-60)
    },
    {
      id: "hrp_amzn_aws_margin",
      symbol: "AMZN",
      name: "Amazon.com Inc.",
      currency: "USD",
      portfolioId: "us-moat",
      author: "Hermes Agent",
      source: "HERMES_ANALYST",
      topic: "AWS Re-Acceleration & North America Retail Robotics Margin",
      tags: ["#CloudInfra", "#WideMoat", "#AccumulateZone", "#SupportResistance"],
      bias: "ACCUMULATE",
      referencePrice: 189.5,
      s1: 183.5,
      s1Note: "แนวรับระยะสั้น โซนสะสมในกรอบ Sideway Up",
      s2: 175.0,
      s2Note: "แนวรับระยะกลาง SMA-100 / โซนรับไม้ใหญ่",
      s3: 162.0,
      s3Note: "แนวรับระยะยาว โซนฐานใหญ่ของรอบปี",
      r1: 196.0,
      r1Note: "แนวต้านระยะสั้น ทดสอบ High เดิมก่อนหน้า",
      r2: 212.0,
      r2Note: "แนวต้านระยะกลาง เป้าหมาย Breakout รอบใหม่",
      r3: 235.0,
      r3Note: "เป้าหมายระยะยาวจาก AWS + Prime Ad Revenue",
      summary:
        "Hermes Fundamental View: AMZN กำลังเก็บเกี่ยวผลตอบแทนจากการจัดคลังสินค้าแบบ Regionalization และ AWS Custom Trainium2 ชิป โซน S1 ($183.5) ให้แต้มต่อ Risk/Reward สูงมาก",
      signals: [
        "Operating Margin ของธุรกิจ Retail และ AWS ขยายตัวพร้อมกัน",
        "Upside ไปหา R2 ($212) คิดเป็น +11.8% เทียบกับระยะห่าง S1 เพียง 3.1%"
      ],
      pinned: false,
      status: "PUBLISHED",
      autoArchiveDays: 21,
      createdAt: iso(-72)
    },
    {
      id: "hrp_legacy_archived_sample",
      symbol: "NFLX",
      name: "Netflix Inc.",
      currency: "USD",
      portfolioId: "us-moat",
      author: "Hermes Agent",
      source: "HERMES_ANALYST",
      topic: "Pre-Q3 Ad-Tier Subscriber Preview (Archived Sample)",
      tags: ["#Earnings", "#SupportResistance", "#ArchivedCycle"],
      bias: "BULLISH",
      referencePrice: 695.0,
      s1: 675.0,
      s1Note: "แนวรับระยะสั้นก่อนประกาศงบ Q3",
      s2: 645.0,
      s2Note: "แนวรับระยะกลาง SMA-50",
      s3: 600.0,
      s3Note: "แนวรับระยะยาว",
      r1: 720.0,
      r1Note: "แนวต้านระยะสั้น",
      r2: 760.0,
      r2Note: "แนวต้านระยะกลาง",
      r3: 800.0,
      r3Note: "แนวต้านระยะยาว",
      summary:
        "บทวิเคราะห์รอบก่อนหน้าที่ครบกำหนดอายุ (Auto-Archived) และถูกเก็บเข้ากรุอัตโนมัติเพื่อไม่ให้หน้าแรกของ Web App รก ผู้ดูแลระบบสามารถเรียกดูหรือกดนำกลับมาแสดงได้จากหน้า Admin",
      signals: ["ผ่านพ้นรอบเหตุการณ์งบไตรมาสแล้ว (Auto-Archived)"],
      pinned: false,
      status: "ARCHIVED",
      archivedReason: "AUTO_ARCHIVE_TTL",
      autoArchiveDays: 14,
      createdAt: iso(-24 * 25),
      archivedAt: iso(-24 * 3)
    }
  ];

  const posts = rawCards.map((item) => normalizeResearchPostInput(item, { nowMs }));
  const nowIso = new Date(nowMs).toISOString();

  const store = {
    version: 1,
    updatedAt: nowIso,
    policy: {
      autoArchiveEnabled: true,
      autoArchiveDays: DEFAULT_AUTO_ARCHIVE_DAYS,
      maxVisibleFrontpageCards: 24,
      sharedAcrossAllSyncKeys: true,
      lastSweepAt: nowIso
    },
    tagRegistry: createDefaultTagRegistry(nowIso),
    posts
  };
  ensureTagRegistry(store, nowMs);
  return store;
}

/**
 * Normalizes and validates a research / S-R 1-2-3 post payload.
 */
function normalizeResearchPostInput(raw = {}, { existing = null, nowMs = Date.now() } = {}) {
  const nowIso = new Date(nowMs).toISOString();
  const base = existing ? deepClone(existing) : {};

  const symbol = String(raw.symbol ?? base.symbol ?? "NVDA")
    .trim()
    .toUpperCase();
  const fallbackInfo = FALLBACK_BASE[symbol] || { name: symbol, price: 100, currency: "USD" };
  const name = String(raw.name ?? raw.companyName ?? base.name ?? fallbackInfo.name ?? symbol).trim();
  const currency =
    String(raw.currency ?? base.currency ?? (symbol.endsWith(".BK") ? "THB" : fallbackInfo.currency || "USD"))
      .trim()
      .toUpperCase() === "THB"
      ? "THB"
      : "USD";

  const referencePrice = roundPrice(
    raw.referencePrice ?? raw.price ?? base.referencePrice ?? fallbackInfo.price ?? 100,
    currency
  );

  const resolveRawNum = (...candidates) => {
    for (const c of candidates) {
      if (c !== undefined && c !== null && c !== "" && Number(c) > 0) return Number(c);
    }
    return undefined;
  };
  const resolveRawStr = (...candidates) => {
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) return c.trim();
    }
    return undefined;
  };

  const builtLevels = buildQuantSupportResistanceLevels(symbol, referencePrice, {
    supportLevels: raw.supportLevels || base.supportLevels,
    resistanceLevels: raw.resistanceLevels || base.resistanceLevels,
    supports: raw.supports || base.supports,
    resistances: raw.resistances || base.resistances,
    s1: resolveRawNum(raw.s1, raw.supportLevels?.s1?.price, raw.supportLevels?.s1, raw.supports?.[0]?.price, raw.supports?.[0]),
    s2: resolveRawNum(raw.s2, raw.supportLevels?.s2?.price, raw.supportLevels?.s2, raw.supports?.[1]?.price, raw.supports?.[1]),
    s3: resolveRawNum(raw.s3, raw.supportLevels?.s3?.price, raw.supportLevels?.s3, raw.supports?.[2]?.price, raw.supports?.[2]),
    r1: resolveRawNum(raw.r1, raw.resistanceLevels?.r1?.price, raw.resistanceLevels?.r1, raw.resistances?.[0]?.price, raw.resistances?.[0]),
    r2: resolveRawNum(raw.r2, raw.resistanceLevels?.r2?.price, raw.resistanceLevels?.r2, raw.resistances?.[1]?.price, raw.resistances?.[1]),
    r3: resolveRawNum(raw.r3, raw.resistanceLevels?.r3?.price, raw.resistanceLevels?.r3, raw.resistances?.[2]?.price, raw.resistances?.[2]),
    s1Note: resolveRawStr(raw.s1Note, raw.supportLevels?.s1?.note, raw.supports?.[0]?.note),
    s2Note: resolveRawStr(raw.s2Note, raw.supportLevels?.s2?.note, raw.supports?.[1]?.note),
    s3Note: resolveRawStr(raw.s3Note, raw.supportLevels?.s3?.note, raw.supports?.[2]?.note),
    r1Note: resolveRawStr(raw.r1Note, raw.resistanceLevels?.r1?.note, raw.resistances?.[0]?.note),
    r2Note: resolveRawStr(raw.r2Note, raw.resistanceLevels?.r2?.note, raw.resistances?.[1]?.note),
    r3Note: resolveRawStr(raw.r3Note, raw.resistanceLevels?.r3?.note, raw.resistances?.[2]?.note)
  });

  const rawBias = String(raw.stance ?? raw.bias ?? base.stance ?? base.bias ?? "BULLISH")
    .trim()
    .toUpperCase();
  const allowedBiases = ["BULLISH", "ACCUMULATE", "NEUTRAL", "TRIM_RESISTANCE", "CAUTIOUS", "BEARISH"];
  const bias = allowedBiases.includes(rawBias) ? rawBias : "BULLISH";

  const rawStatus = String(raw.status ?? base.status ?? "PUBLISHED")
    .trim()
    .toUpperCase();
  const status = rawStatus === "ARCHIVED" || rawStatus === "HIDDEN" ? "ARCHIVED" : "PUBLISHED";

  const autoArchiveDays = Math.max(
    MIN_AUTO_ARCHIVE_DAYS,
    Math.min(
      MAX_AUTO_ARCHIVE_DAYS,
      Math.floor(Number(raw.autoArchiveDays ?? base.autoArchiveDays ?? DEFAULT_AUTO_ARCHIVE_DAYS) || DEFAULT_AUTO_ARCHIVE_DAYS)
    )
  );

  const createdAt = raw.publishedAt || raw.createdAt || base.publishedAt || base.createdAt || nowIso;
  const publishedAt = base.publishedAt || base.createdAt || raw.publishedAt || raw.createdAt || createdAt;
  const createdMs = Date.parse(publishedAt) || Date.parse(createdAt) || nowMs;
  const expiresAt = new Date(createdMs + autoArchiveDays * 86400 * 1000).toISOString();

  let signals = [];
  if (Array.isArray(raw.signals)) {
    signals = raw.signals.map((s) => String(s || "").trim()).filter(Boolean);
  } else if (typeof raw.signals === "string" && raw.signals.trim()) {
    signals = raw.signals
      .split(/\r?\n|\|/)
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (Array.isArray(base.signals)) {
    signals = base.signals;
  }

  const id =
    String(raw.id || base.id || "").trim() ||
    `hrp_${symbol.toLowerCase().replace(/[^a-z0-9]/g, "")}_${Math.floor(nowMs).toString(36)}`;

  const topicText = String(
    raw.headline ?? raw.title ?? raw.topic ?? base.topic ?? base.title ?? `${symbol} Support & Resistance (S1-S3 / R1-R3) Analysis`
  ).trim();

  const pinnedVal = raw.pinned !== undefined ? Boolean(raw.pinned) : Boolean(base.pinned);
  const autoArchiveExemptVal =
    raw.autoArchiveExempt !== undefined ? Boolean(raw.autoArchiveExempt) : Boolean(base.autoArchiveExempt || pinnedVal);
  const horizonFocus = String(raw.horizonFocus ?? base.horizonFocus ?? "ALL").trim().toUpperCase();

  const post = {
    id,
    symbol,
    name,
    currency,
    portfolioId: String(raw.portfolioId ?? base.portfolioId ?? "us-moat").trim(),
    author: String(raw.author ?? base.author ?? "Hermes Agent").trim(),
    source: String(raw.source ?? base.source ?? "HERMES_ANALYST")
      .trim()
      .toUpperCase(),
    topic: topicText,
    title: topicText,
    headline: topicText,
    tags: normalizeTagsList(raw.tags ?? base.tags ?? ["#SupportResistance", "#HermesDaily"]),
    bias,
    stance: bias,
    horizonFocus,
    referencePrice,
    supportLevels: builtLevels.supportLevels,
    resistanceLevels: builtLevels.resistanceLevels,
    supports: builtLevels.supports,
    resistances: builtLevels.resistances,
    supportResistance: builtLevels.supportResistance,
    confidence: Math.max(1, Math.min(100, Number(raw.confidence ?? base.confidence ?? 86))),
    summary: String(
      raw.summary ??
        raw.content ??
        base.summary ??
        `วิเคราะห์แนวรับ 1-2-3 (ระยะสั้น ${builtLevels.supportLevels.s1.price} / ระยะกลาง ${builtLevels.supportLevels.s2.price} / ระยะยาว ${builtLevels.supportLevels.s3.price}) และแนวต้าน 1-2-3 (${builtLevels.resistanceLevels.r1.price} / ${builtLevels.resistanceLevels.r2.price} / ${builtLevels.resistanceLevels.r3.price})`
    ).trim(),
    signals: signals.slice(0, 6),
    pinned: pinnedVal,
    autoArchiveExempt: autoArchiveExemptVal,
    status,
    archivedReason: status === "ARCHIVED" ? String(raw.archivedReason ?? base.archivedReason ?? "MANUAL_ADMIN").trim() : null,
    autoArchiveDays,
    createdAt,
    publishedAt,
    updatedAt: raw.updatedAt || base.updatedAt || nowIso,
    archivedAt: status === "ARCHIVED" ? base.archivedAt || raw.archivedAt || nowIso : null,
    expiresAt
  };

  post.signalMemo = String(
    raw.signalMemo ?? base.signalMemo ?? signals[0] ?? post.summary
  ).trim();

  const quant = computeCardQuantMetrics(post, raw.livePrice);
  post.livePrice = quant.livePrice;
  post.quant = quant;
  post.metrics = quant;
  post.quantMetrics = quant;
  return post;
}

/**
 * Runs the Auto-Archive Sweep on a store object.
 * Any PUBLISHED post that is NOT pinned/exempt and whose age exceeds min(post.autoArchiveDays, policy.autoArchiveDays)
 * is transitioned to ARCHIVED with archivedReason = "AUTO_ARCHIVE_TTL".
 */
function runAutoArchiveSweep(store, { nowMs = Date.now(), forcePolicyDays = null } = {}) {
  if (!store || !Array.isArray(store.posts)) {
    return { sweptCount: 0, archivedIds: [], dirty: false };
  }
  const policy = store.policy || {
    autoArchiveEnabled: true,
    autoArchiveDays: DEFAULT_AUTO_ARCHIVE_DAYS
  };

  if (!policy.autoArchiveEnabled && forcePolicyDays === null) {
    return { sweptCount: 0, archivedIds: [], dirty: false };
  }

  const globalDays = Math.max(
    MIN_AUTO_ARCHIVE_DAYS,
    Number(forcePolicyDays ?? policy.autoArchiveDays ?? DEFAULT_AUTO_ARCHIVE_DAYS)
  );
  const nowIso = new Date(nowMs).toISOString();
  const archivedIds = [];

  for (const post of store.posts) {
    if (post.status !== "PUBLISHED" && post.status !== "ACTIVE") continue;
    if (post.pinned || post.autoArchiveExempt) continue;

    const effectiveDays =
      forcePolicyDays !== null
        ? globalDays
        : Math.min(globalDays, Number(post.autoArchiveDays || globalDays));
    const createdMs = Date.parse(post.publishedAt || post.createdAt || post.updatedAt || nowIso) || nowMs;
    const ageDays = (nowMs - createdMs) / (86400 * 1000);

    if (ageDays >= effectiveDays) {
      post.status = "ARCHIVED";
      post.archivedReason = "AUTO_ARCHIVE_TTL";
      post.archivedAt = nowIso;
      post.updatedAt = nowIso;
      archivedIds.push(post.id);
    }
  }

  if (archivedIds.length > 0) {
    store.updatedAt = nowIso;
  }
  if (store.policy) {
    store.policy.lastSweepAt = nowIso;
  }

  return {
    sweptCount: archivedIds.length,
    archivedIds,
    dirty: archivedIds.length > 0
  };
}

/**
 * Collects unique watchlist & portfolio stocks across the shared owner profile ("VENU2-88")
 * plus the requesting user's active profile so every user can see S1-S2-S3 / R1-R2-R3
 * across all watchlist stocks!
 */
function buildWatchlistSupportResistanceMatrix(portfoliosStore, researchStore, { syncKey = "VENU2-88", liveQuotesMap = {} } = {}) {
  const symbolMap = new Map();

  const registerProfileHoldings = (profile, sourceLabel) => {
    if (!profile || !Array.isArray(profile.portfolios)) return;
    for (const port of profile.portfolios) {
      const holdings = Array.isArray(port.holdings) ? port.holdings : Array.isArray(port.items) ? port.items : [];
      for (const h of holdings) {
        const sym = String(h.symbol || "").trim().toUpperCase();
        if (!sym) continue;
        const existing = symbolMap.get(sym);
        const isWatchlist = Number(h.shares || 0) === 0;
        const fallbackInfo = FALLBACK_BASE[sym] || { name: sym, price: 100, currency: "USD" };
        const livePrice =
          Number(liveQuotesMap[sym]?.price) ||
          Number(h.price) ||
          Number(fallbackInfo.price) ||
          100;
        if (!existing) {
          symbolMap.set(sym, {
            symbol: sym,
            name: String(h.name || fallbackInfo.name || sym),
            currency: sym.endsWith(".BK") ? "THB" : String(h.currency || fallbackInfo.currency || "USD"),
            shares: Number(h.shares || 0),
            avgCost: Number(h.avgCost || 0),
            targetPrice: Number(h.targetPrice || 0),
            stopPrice: Number(h.stopPrice || 0),
            isWatchlist,
            memo: String(h.memo || h.note || ""),
            memoUpdatedAt: String(h.memoUpdatedAt || ""),
            portfolioId: String(port.id || "us-moat"),
            portfolioName: String(port.name || "Watchlist"),
            livePrice,
            sourceProfile: sourceLabel
          });
        } else if (h.memo) {
          const incomingUpdated = String(h.memoUpdatedAt || "");
          if (!existing.memo || (incomingUpdated && (!existing.memoUpdatedAt || incomingUpdated > existing.memoUpdatedAt))) {
            existing.memo = String(h.memo);
            existing.memoUpdatedAt = incomingUpdated || existing.memoUpdatedAt;
          }
        }
      }
    }
  };

  // 1. Always include primary owner accounts ("V2-07090781" real owner & "VENU2-88" demo owner)
  // so all SyncKeys share the core watchlist & Discord-approved WebMemo research
  if (portfoliosStore && portfoliosStore["V2-07090781"]) {
    registerProfileHoldings(portfoliosStore["V2-07090781"], "SHARED_CORE");
  }
  if (portfoliosStore && portfoliosStore["VENU2-88"]) {
    registerProfileHoldings(portfoliosStore["VENU2-88"], "SHARED_CORE");
  }
  // 2. Also merge the requesting user's SyncKey profile so their own watchlist tickers get S/R 1-2-3 too
  const cleanKey = String(syncKey || "VENU2-88").trim().toUpperCase();
  if (portfoliosStore && portfoliosStore[cleanKey] && cleanKey !== "VENU2-88" && cleanKey !== "V2-07090781") {
    registerProfileHoldings(portfoliosStore[cleanKey], cleanKey);
  }

  // Index active published research posts by symbol
  const publishedBySymbol = new Map();
  const activePosts = (researchStore?.posts || []).filter(
    (p) => p.status === "PUBLISHED" || p.status === "ACTIVE"
  );
  for (const post of activePosts) {
    const sym = String(post.symbol || "").toUpperCase();
    if (!publishedBySymbol.has(sym)) {
      publishedBySymbol.set(sym, post);
    }
  }

  const matrix = [];
  for (const [sym, info] of symbolMap.entries()) {
    const hermesPost = publishedBySymbol.get(sym) || null;
    const refPrice = Number(liveQuotesMap[sym]?.price) || Number(hermesPost?.referencePrice) || info.livePrice || 100;
    const levels = hermesPost
      ? buildQuantSupportResistanceLevels(sym, refPrice, {
          supportLevels: hermesPost.supportLevels,
          resistanceLevels: hermesPost.resistanceLevels,
          supports: hermesPost.supports,
          resistances: hermesPost.resistances
        })
      : buildQuantSupportResistanceLevels(sym, refPrice);

    const cardLike = {
      symbol: sym,
      currency: info.currency,
      referencePrice: refPrice,
      supportLevels: levels.supportLevels,
      resistanceLevels: levels.resistanceLevels,
      supports: levels.supports,
      resistances: levels.resistances
    };
    const quant = computeCardQuantMetrics(cardLike, refPrice);
    const stanceVal = hermesPost
      ? hermesPost.stance || hermesPost.bias || "BULLISH"
      : quant.riskRewardRatio >= 1.5
      ? "BULLISH"
      : "NEUTRAL";

    matrix.push({
      symbol: sym,
      name: info.name,
      currency: info.currency,
      livePrice: quant.livePrice,
      isWatchlist: info.isWatchlist,
      shares: info.shares,
      portfolioId: info.portfolioId,
      portfolioName: info.portfolioName,
      memo: info.memo,
      memoPreview: info.memo,
      hasHermesPost: Boolean(hermesPost),
      hasPublishedPost: Boolean(hermesPost),
      hermesPostId: hermesPost ? hermesPost.id : null,
      postId: hermesPost ? hermesPost.id : null,
      author: hermesPost ? hermesPost.author : "MoatWatch Quant Engine",
      topic: hermesPost ? hermesPost.topic : `${sym} Multi-Horizon S/R (S1–S3 / R1–R3)`,
      title: hermesPost ? hermesPost.title || hermesPost.topic : `${sym} Multi-Horizon S/R (S1–S3 / R1–R3)`,
      headline: hermesPost ? hermesPost.title || hermesPost.topic : `${sym} Multi-Horizon S/R (S1–S3 / R1–R3)`,
      tags: hermesPost ? hermesPost.tags : [info.isWatchlist ? "#Watchlist" : "#CoreHolding", "#QuantSR"],
      bias: stanceVal,
      stance: stanceVal,
      supportLevels: levels.supportLevels,
      resistanceLevels: levels.resistanceLevels,
      supports: levels.supports,
      resistances: levels.resistances,
      supportResistance: levels.supportResistance,
      summary: hermesPost
        ? hermesPost.summary
        : `แนวรับระยะสั้น S1 ${levels.supportLevels.s1.price} · ระยะกลาง S2 ${levels.supportLevels.s2.price} · ระยะยาว S3 ${levels.supportLevels.s3.price} | แนวต้าน R1 ${levels.resistanceLevels.r1.price} · R2 ${levels.resistanceLevels.r2.price} · R3 ${levels.resistanceLevels.r3.price}`,
      signalMemo: hermesPost
        ? hermesPost.signalMemo || hermesPost.summary
        : info.memo || `S1 ${levels.supportLevels.s1.price} / S2 ${levels.supportLevels.s2.price} · R2 ${levels.resistanceLevels.r2.price}`,
      quant,
      metrics: quant,
      quantMetrics: quant,
      publishedAt: hermesPost
        ? hermesPost.publishedAt || hermesPost.createdAt || hermesPost.updatedAt
        : info.memoUpdatedAt || null,
      memoUpdatedAt: info.memoUpdatedAt || (hermesPost ? hermesPost.updatedAt : null),
      updatedAt: hermesPost
        ? hermesPost.updatedAt || hermesPost.publishedAt || hermesPost.createdAt
        : info.memoUpdatedAt || new Date().toISOString()
    });
  }

  // Sort: stocks with Hermes published post first, then by Risk/Reward ratio descending
  matrix.sort((a, b) => {
    if (a.hasHermesPost !== b.hasHermesPost) return a.hasHermesPost ? -1 : 1;
    return (b.quant?.riskRewardRatio || 0) - (a.quant?.riskRewardRatio || 0);
  });

  return matrix;
}

/**
 * Builds the public `/api/research-feed` payload accessible to ALL SyncKeys.
 */
function buildPublicResearchFeedPayload({
  researchStore,
  portfoliosStore,
  syncKey = "VENU2-88",
  tagFilter = "",
  symbolFilter = "",
  includeArchived = false,
  nowMs = Date.now()
} = {}) {
  const store = researchStore || buildInitialSeedStore(nowMs);
  const sweep = runAutoArchiveSweep(store, { nowMs });
  const registryList = ensureTagRegistry(store, nowMs);
  const registryByLower = new Map(registryList.map((entry) => [entry.tag.toLowerCase(), entry]));

  const cleanTag = tagFilter ? normalizeTag(tagFilter).toLowerCase() : "";
  const cleanSym = String(symbolFilter || "").trim().toUpperCase();

  // Enrich live prices from FALLBACK_BASE or portfolio store
  const allPosts = (store.posts || []).map((post) => {
    const fallback = FALLBACK_BASE[post.symbol];
    const livePrice = Number(post.referencePrice) || Number(fallback?.price) || 100;
    const copy = normalizeResearchPostInput(post, { existing: post, nowMs });
    const quant = computeCardQuantMetrics(copy, livePrice);
    copy.livePrice = quant.livePrice;
    copy.quant = quant;
    copy.metrics = quant;
    copy.quantMetrics = quant;
    const createdMs = Date.parse(copy.publishedAt || copy.createdAt) || nowMs;
    copy.ageDays = Math.max(0, Math.round(((nowMs - createdMs) / (86400 * 1000)) * 10) / 10);
    copy.daysUntilAutoArchive =
      copy.pinned || copy.autoArchiveExempt
        ? null
        : Math.max(0, Math.round((Number(copy.autoArchiveDays || store.policy?.autoArchiveDays || 21) - copy.ageDays) * 10) / 10);
    return copy;
  });

  // Sort: Pinned first, then newest publishedAt / createdAt
  allPosts.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return (
      (Date.parse(b.publishedAt || b.createdAt) || 0) -
      (Date.parse(a.publishedAt || a.createdAt) || 0)
    );
  });

  const visiblePosts = allPosts.filter((post) => {
    if (!includeArchived && post.status !== "PUBLISHED" && post.status !== "ACTIVE") return false;
    if (cleanSym && post.symbol !== cleanSym) return false;
    if (cleanTag && !(post.tags || []).some((t) => t.toLowerCase() === cleanTag)) return false;
    return true;
  });

  // Collect all tags with counts across published & archived posts
  const activeTagCountsMap = new Map();
  const archivedTagCountsMap = new Map();
  for (const p of allPosts) {
    const isPublished = p.status === "PUBLISHED" || p.status === "ACTIVE";
    for (const rawT of p.tags || []) {
      const regMatch = registryByLower.get(String(rawT).toLowerCase());
      const canonicalTag = regMatch ? regMatch.tag : normalizeTag(rawT);
      if (!canonicalTag) continue;
      if (isPublished) {
        activeTagCountsMap.set(canonicalTag, (activeTagCountsMap.get(canonicalTag) || 0) + 1);
      } else {
        archivedTagCountsMap.set(canonicalTag, (archivedTagCountsMap.get(canonicalTag) || 0) + 1);
      }
    }
  }

  const enrichedTagRegistry = registryList
    .map((entry) => {
      const activeCount = activeTagCountsMap.get(entry.tag) || 0;
      const archivedCount = archivedTagCountsMap.get(entry.tag) || 0;
      return {
        ...entry,
        count: activeCount,
        activeCount,
        archivedCount,
        totalCount: activeCount + archivedCount
      };
    })
    .sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      if (b.activeCount !== a.activeCount) return b.activeCount - a.activeCount;
      return a.tag.localeCompare(b.tag);
    });

  const tagsSummary = enrichedTagRegistry
    .filter((entry) => {
      if (!includeArchived && entry.hidden) return false;
      return entry.activeCount > 0 || entry.pinned || includeArchived;
    })
    .map((entry) => ({
      tag: entry.tag,
      count: entry.activeCount,
      activeCount: entry.activeCount,
      archivedCount: entry.archivedCount,
      totalCount: entry.totalCount,
      color: entry.color,
      category: entry.category,
      description: entry.description,
      pinned: Boolean(entry.pinned),
      hidden: Boolean(entry.hidden)
    }));

  const officialTags = enrichedTagRegistry.filter((entry) => !entry.hidden).map((entry) => entry.tag);

  const watchlistMatrix = buildWatchlistSupportResistanceMatrix(portfoliosStore, store, { syncKey });

  const publishedCount = allPosts.filter((p) => p.status === "PUBLISHED" || p.status === "ACTIVE").length;
  const archivedCount = allPosts.filter((p) => p.status === "ARCHIVED").length;
  const pinnedCount = allPosts.filter((p) => (p.status === "PUBLISHED" || p.status === "ACTIVE") && p.pinned).length;

  return {
    ok: true,
    sharedAcrossAllSyncKeys: true,
    requestedBySyncKey: String(syncKey || "VENU2-88").trim().toUpperCase(),
    policy: store.policy || {
      autoArchiveEnabled: true,
      autoArchiveDays: DEFAULT_AUTO_ARCHIVE_DAYS,
      sharedAcrossAllSyncKeys: true
    },
    sweep,
    summary: {
      totalPosts: allPosts.length,
      publishedCount,
      activeCount: publishedCount,
      archivedCount,
      pinnedCount,
      watchlistMatrixCount: watchlistMatrix.length,
      uniqueTagsCount: tagsSummary.length,
      totalRegisteredTagsCount: enrichedTagRegistry.length
    },
    tags: tagsSummary,
    tagCloud: tagsSummary,
    tagRegistry: enrichedTagRegistry,
    officialTags,
    posts: visiblePosts,
    allPosts,
    watchlistMatrix,
    watchlistSrMatrix: watchlistMatrix,
    supportResistanceMatrix: watchlistMatrix
  };
}

/**
 * Builds the comprehensive BI & Quantitative Analytics Dashboard dataset for `/api/admin/bi-dashboard`.
 * Provides multi-angle, stackable datasets for:
 *  - Users & SyncKeys & Device License Tiers
 *  - Topics & Hermes `#Tags`
 *  - Analysis & WebMemos & Discord Drafts
 *  - Quantitative Support & Resistance (S1-S2-S3 / R1-R2-R3) Positioning & Risk/Reward
 */
function buildAdminBiAnalytics({
  portfoliosStore = {},
  licensesData = {},
  draftsList = [],
  researchStore = null,
  nowMs = Date.now()
} = {}) {
  const store = researchStore || buildInitialSeedStore(nowMs);
  runAutoArchiveSweep(store, { nowMs });

  const profileKeys = Object.keys(portfoliosStore || {});
  const devicesList = Array.isArray(licensesData.devices) ? licensesData.devices : Object.values(licensesData.devices || {});
  const requestsList = Array.isArray(licensesData.customerRequests) ? licensesData.customerRequests : [];

  // 1. User / SyncKey & Portfolio Breakdown
  let totalPortfolios = 0;
  let totalHoldingsEntries = 0;
  let totalActiveSharePositions = 0;
  let totalWatchlistEntries = 0;
  let totalMemosPopulated = 0;
  let totalTargetAlertsSet = 0;
  let totalStopAlertsSet = 0;

  const userProfilesBreakdown = [];
  const symbolFrequencyMap = new Map();
  const portfolioBreakdown = [];

  for (const syncKey of profileKeys) {
    const prof = portfoliosStore[syncKey];
    if (!prof || !Array.isArray(prof.portfolios)) continue;

    let userPositions = 0;
    let userWatchlist = 0;
    let userMemos = 0;
    let userAlerts = 0;

    for (const port of prof.portfolios) {
      totalPortfolios += 1;
      const holdings = Array.isArray(port.holdings) ? port.holdings : Array.isArray(port.items) ? port.items : [];
      let portPositions = 0;
      let portWatchlist = 0;
      let portMemos = 0;
      let portAlerts = 0;

      for (const h of holdings) {
        totalHoldingsEntries += 1;
        const sym = String(h.symbol || "").trim().toUpperCase();
        const shares = Number(h.shares || 0);
        const hasMemo = Boolean(String(h.memo || h.note || "").trim());
        const hasTarget = Number(h.targetPrice || 0) > 0;
        const hasStop = Number(h.stopPrice || 0) > 0;

        if (shares > 0) {
          totalActiveSharePositions += 1;
          userPositions += 1;
          portPositions += 1;
        } else {
          totalWatchlistEntries += 1;
          userWatchlist += 1;
          portWatchlist += 1;
        }

        if (hasMemo) {
          totalMemosPopulated += 1;
          userMemos += 1;
          portMemos += 1;
        }
        if (hasTarget) totalTargetAlertsSet += 1;
        if (hasStop) totalStopAlertsSet += 1;
        if (hasTarget || hasStop) {
          userAlerts += 1;
          portAlerts += 1;
        }

        if (sym) {
          const prev = symbolFrequencyMap.get(sym) || {
            symbol: sym,
            name: String(h.name || sym),
            holdersCount: 0,
            watchlistCount: 0,
            memosCount: 0,
            alertsCount: 0
          };
          if (shares > 0) prev.holdersCount += 1;
          else prev.watchlistCount += 1;
          if (hasMemo) prev.memosCount += 1;
          if (hasTarget || hasStop) prev.alertsCount += 1;
          symbolFrequencyMap.set(sym, prev);
        }
      }

      portfolioBreakdown.push({
        syncKey,
        portfolioId: String(port.id || "default"),
        portfolioName: String(port.name || "Portfolio"),
        currency: String(port.currency || "USD"),
        totalAssets: holdings.length,
        activePositions: portPositions,
        watchlistAssets: portWatchlist,
        memosCount: portMemos,
        alertsCount: portAlerts
      });
    }

    const boundDeviceId = prof.watchSettings?.deviceId || "V2-88VENU20";
    const matchedDevice = devicesList.find((d) => d.deviceId === boundDeviceId);
    const tier = matchedDevice
      ? matchedDevice.status === "ACTIVE" || matchedDevice.isActivated
        ? "PRO_ACTIVE"
        : matchedDevice.isTrialExpired
        ? "TRIAL_EXPIRED"
        : "FREE_TRIAL"
      : "UNBOUND_WEB";

    userProfilesBreakdown.push({
      syncKey,
      deviceId: boundDeviceId,
      watchModel: prof.watchSettings?.watchModel || "venu2",
      baseCurrency: prof.baseCurrency || "THB",
      tier,
      portfoliosCount: prof.portfolios.length,
      totalAssets: userPositions + userWatchlist,
      activePositions: userPositions,
      watchlistAssets: userWatchlist,
      memosCount: userMemos,
      alertsCount: userAlerts,
      updatedAt: prof.updatedAt || null
    });
  }

  // 2. Topics & Hermes Tags Quantitative Breakdown
  const allPosts = (store.posts || []).map((p) => {
    const copy = deepClone(p);
    copy.quant = computeCardQuantMetrics(copy, FALLBACK_BASE[copy.symbol]?.price || copy.referencePrice);
    return copy;
  });

  const topicTagStatsMap = new Map();
  for (const post of allPosts) {
    for (const tag of post.tags || ["#Untagged"]) {
      const entry = topicTagStatsMap.get(tag) || {
        tag,
        totalPosts: 0,
        publishedPosts: 0,
        archivedPosts: 0,
        pinnedPosts: 0,
        bullishCount: 0,
        accumulateCount: 0,
        neutralCount: 0,
        sumRiskReward: 0,
        symbols: []
      };
      entry.totalPosts += 1;
      if (post.status === "PUBLISHED") entry.publishedPosts += 1;
      else entry.archivedPosts += 1;
      if (post.pinned) entry.pinnedPosts += 1;

      if (post.bias === "BULLISH") entry.bullishCount += 1;
      else if (post.bias === "ACCUMULATE") entry.accumulateCount += 1;
      else entry.neutralCount += 1;

      entry.sumRiskReward += Number(post.quant?.riskRewardRatio || 1);
      if (!entry.symbols.includes(post.symbol)) entry.symbols.push(post.symbol);
      topicTagStatsMap.set(tag, entry);
    }
  }

  const topicTagBreakdown = Array.from(topicTagStatsMap.values())
    .map((item) => ({
      ...item,
      avgRiskReward: Math.round((item.sumRiskReward / Math.max(1, item.totalPosts)) * 100) / 100
    }))
    .sort((a, b) => b.totalPosts - a.totalPosts);

  // 3. WebMemo & Hermes Drafts Analytics
  const draftStateCounts = {
    APPROVED: 0,
    PENDING: 0,
    REJECTED: 0,
    CONFLICT: 0,
    EXPIRED: 0
  };
  for (const d of draftsList || []) {
    const st = String(d.status || "PENDING").toUpperCase();
    if (st === "APPROVED" || st === "PUBLISHED") draftStateCounts.APPROVED += 1;
    else if (st === "REJECTED") draftStateCounts.REJECTED += 1;
    else if (st === "CONFLICT" || st === "CONFLICT_SUPERSEDED") draftStateCounts.CONFLICT += 1;
    else if (st === "EXPIRED") draftStateCounts.EXPIRED += 1;
    else draftStateCounts.PENDING += 1;
  }

  // 4. Support / Resistance Quantitative Matrix & Distribution
  const watchlistMatrix = buildWatchlistSupportResistanceMatrix(portfoliosStore, store, { syncKey: "VENU2-88" });
  const srZoneDistribution = {
    DEEP_ACCUMULATE: 0,
    SHORT_SUPPORT_TEST: 0,
    MID_CHANNEL: 0,
    RESISTANCE_TEST: 0,
    EXTENDED_BREAKOUT: 0
  };
  const biasDistribution = {
    BULLISH: 0,
    ACCUMULATE: 0,
    NEUTRAL: 0,
    CAUTIOUS: 0
  };

  let sumRr = 0;
  let sumUpsideR2 = 0;
  let sumDownsideS1 = 0;

  for (const row of watchlistMatrix) {
    const z = row.quant?.tacticalZone || "MID_CHANNEL";
    if (srZoneDistribution[z] !== undefined) srZoneDistribution[z] += 1;
    const b = row.bias || "NEUTRAL";
    if (biasDistribution[b] !== undefined) biasDistribution[b] += 1;
    else biasDistribution.NEUTRAL += 1;

    sumRr += Number(row.quant?.riskRewardRatio || 0);
    sumUpsideR2 += Number(row.quant?.upsideToR2Pct || 0);
    sumDownsideS1 += Number(row.quant?.distToS1Pct || 0);
  }

  const matrixCount = Math.max(1, watchlistMatrix.length);
  const avgRiskRewardRatio = Math.round((sumRr / matrixCount) * 100) / 100;
  const avgUpsideToR2Pct = Math.round((sumUpsideR2 / matrixCount) * 100) / 100;
  const avgBufferToS1Pct = Math.round((sumDownsideS1 / matrixCount) * 100) / 100;

  const activePaidDevices = devicesList.filter((d) => d.status === "ACTIVE" || d.isActivated).length;
  const activeTrialDevices = devicesList.filter((d) => d.status !== "ACTIVE" && !d.isActivated && !d.isTrialExpired).length;
  const expiredTrialDevices = devicesList.filter((d) => d.status !== "ACTIVE" && !d.isActivated && d.isTrialExpired).length;

  const memoCoveragePct =
    totalHoldingsEntries > 0 ? Math.round((totalMemosPopulated / totalHoldingsEntries) * 1000) / 10 : 0;

  const publishedCount = allPosts.filter((p) => p.status === "PUBLISHED" || p.status === "ACTIVE").length;
  const archivedCount = allPosts.filter((p) => p.status === "ARCHIVED").length;
  const pinnedCount = allPosts.filter((p) => (p.status === "PUBLISHED" || p.status === "ACTIVE") && p.pinned).length;

  const pieUserLicenseTier = [
    { label: "PRO Activated Devices", value: activePaidDevices, color: "#10B981" },
    { label: "14-Day Free Trial", value: activeTrialDevices, color: "#F59E0B" },
    { label: "Expired Trial", value: expiredTrialDevices, color: "#F43F5E" },
    {
      label: "Web SyncKey Profiles",
      value: Math.max(0, profileKeys.length - devicesList.length),
      color: "#06B6D4"
    }
  ];

  const pieTopicDistribution = topicTagBreakdown.slice(0, 7).map((t, idx) => {
    const palette = ["#06B6D4", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#3B82F6", "#14B8A6"];
    return {
      label: t.tag,
      value: t.totalPosts,
      color: palette[idx % palette.length]
    };
  });

  const pieSrZoneDistribution = [
    { label: "Deep Accumulate (Near S2/S3)", value: srZoneDistribution.DEEP_ACCUMULATE, color: "#10B981" },
    { label: "Short Support Test (S1)", value: srZoneDistribution.SHORT_SUPPORT_TEST, color: "#14B8A6" },
    { label: "Mid Channel (S1 ↔ R1)", value: srZoneDistribution.MID_CHANNEL, color: "#06B6D4" },
    { label: "Resistance Test (R1)", value: srZoneDistribution.RESISTANCE_TEST, color: "#F59E0B" },
    { label: "Extended Breakout (>R2)", value: srZoneDistribution.EXTENDED_BREAKOUT, color: "#8B5CF6" }
  ];

  const pieMemoAndDraftPosture = [
    { label: "Holdings with WebMemo", value: totalMemosPopulated, color: "#10B981" },
    {
      label: "Watchlist Waiting Memo",
      value: Math.max(0, totalHoldingsEntries - totalMemosPopulated),
      color: "#334155"
    },
    { label: "Hermes Published S/R Cards", value: publishedCount, color: "#06B6D4" },
    { label: "Approved Discord Drafts", value: draftStateCounts.APPROVED, color: "#F59E0B" }
  ];

  const srTopList = watchlistMatrix.slice(0, 14);

  const stackedCharts = {
    userPortfolioStack: {
      title: "Users & Portfolios — Holdings, Watchlist, WebMemos & Alerts",
      categories: userProfilesBreakdown.map((u) => u.syncKey),
      series: [
        {
          name: "Active Positions",
          color: "#10B981",
          data: userProfilesBreakdown.map((u) => u.activePositions)
        },
        {
          name: "Watchlist Assets",
          color: "#06B6D4",
          data: userProfilesBreakdown.map((u) => u.watchlistAssets)
        },
        {
          name: "WebMemos Populated",
          color: "#F59E0B",
          data: userProfilesBreakdown.map((u) => u.memosCount)
        },
        {
          name: "Target/Stop Alerts",
          color: "#8B5CF6",
          data: userProfilesBreakdown.map((u) => u.alertsCount)
        }
      ]
    },
    srQuantitativeStack: {
      title: "Support/Resistance 1-2-3 Upside (%) vs Downside Buffer (%)",
      categories: srTopList.map((item) => item.symbol),
      series: [
        {
          name: "Upside to R1 (ระยะสั้น %)",
          color: "#06B6D4",
          data: srTopList.map((item) => Math.max(0, Number(item.quant?.upsideToR1Pct || 0)))
        },
        {
          name: "Upside to R2 (ระยะกลาง %)",
          color: "#10B981",
          data: srTopList.map((item) => Math.max(0, Number(item.quant?.upsideToR2Pct || 0)))
        },
        {
          name: "Upside to R3 (ระยะยาว %)",
          color: "#8B5CF6",
          data: srTopList.map((item) => Math.max(0, Number(item.quant?.upsideToR3Pct || 0)))
        },
        {
          name: "Buffer to S1 (ระยะสั้น %)",
          color: "#F59E0B",
          data: srTopList.map((item) => Math.abs(Number(item.quant?.distToS1Pct || 0)))
        },
        {
          name: "Buffer to S2 (ระยะกลาง %)",
          color: "#F43F5E",
          data: srTopList.map((item) => Math.abs(Number(item.quant?.distToS2Pct || 0)))
        }
      ]
    },
    topicTagStack: {
      title: "Hermes Topics & #Tags — Active vs Pinned vs Archived",
      categories: topicTagBreakdown.slice(0, 12).map((t) => t.tag),
      series: [
        {
          name: "Published Active",
          color: "#10B981",
          data: topicTagBreakdown.slice(0, 12).map((t) => t.publishedPosts)
        },
        {
          name: "Pinned Evergreen",
          color: "#06B6D4",
          data: topicTagBreakdown.slice(0, 12).map((t) => t.pinnedPosts)
        },
        {
          name: "Archived / Hidden",
          color: "#F59E0B",
          data: topicTagBreakdown.slice(0, 12).map((t) => t.archivedPosts)
        }
      ]
    },
    memoCoverageStack: {
      title: "Portfolio Asset & WebMemo Coverage Breakdown",
      categories: portfolioBreakdown.slice(0, 12).map((p) => `${p.syncKey}:${p.portfolioName}`),
      series: [
        {
          name: "Active Positions",
          color: "#10B981",
          data: portfolioBreakdown.slice(0, 12).map((p) => p.activePositions)
        },
        {
          name: "Watchlist Only",
          color: "#06B6D4",
          data: portfolioBreakdown.slice(0, 12).map((p) => p.watchlistAssets)
        },
        {
          name: "WebMemos Populated",
          color: "#F59E0B",
          data: portfolioBreakdown.slice(0, 12).map((p) => p.memosCount)
        },
        {
          name: "Price Alerts Set",
          color: "#8B5CF6",
          data: portfolioBreakdown.slice(0, 12).map((p) => p.alertsCount)
        }
      ]
    }
  };

  const srQuantitativeTable = watchlistMatrix.map((item) => ({
    symbol: item.symbol,
    name: item.name,
    currency: item.currency,
    livePrice: item.quant.livePrice,
    stance: item.stance || item.bias,
    s1: item.supportLevels.s1.price,
    s2: item.supportLevels.s2.price,
    s3: item.supportLevels.s3.price,
    r1: item.resistanceLevels.r1.price,
    r2: item.resistanceLevels.r2.price,
    r3: item.resistanceLevels.r3.price,
    downsideToS1Pct: item.quant.downsideToS1Pct,
    upsideToR2Pct: item.quant.upsideToR2Pct,
    riskRewardRatio: item.quant.riskRewardRatio,
    positionInBandPct: item.quant.positionInBandPct,
    zoneCode: item.quant.zoneCode,
    zoneLabel: item.quant.zoneLabel
  }));

  return {
    ok: true,
    generatedAt: new Date(nowMs).toISOString(),
    kpis: {
      totalSyncKeyProfiles: profileKeys.length,
      totalUsers: profileKeys.length,
      totalPortfolios,
      totalHoldingsEntries,
      totalHoldings: totalHoldingsEntries,
      totalActiveSharePositions,
      activePositions: totalActiveSharePositions,
      totalWatchlistEntries,
      watchlistOnlyCount: totalWatchlistEntries,
      totalUniqueSymbols: symbolFrequencyMap.size,
      totalMemosPopulated,
      totalWebMemos: totalMemosPopulated,
      memoCoveragePct,
      totalTargetAlertsSet,
      totalStopAlertsSet,
      totalDevices: devicesList.length,
      activePaidDevices,
      activeLicenses: activePaidDevices,
      activeTrialDevices,
      trialLicenses: activeTrialDevices,
      expiredTrialDevices,
      pendingCustomerRequests: requestsList.filter((r) => r.status === "PENDING").length,
      totalResearchPosts: allPosts.length,
      publishedResearchPosts: publishedCount,
      totalPublishedPosts: publishedCount,
      archivedResearchPosts: archivedCount,
      archivedPostsCount: archivedCount,
      pinnedResearchPosts: pinnedCount,
      pinnedPostsCount: pinnedCount,
      uniqueTagsCount: topicTagBreakdown.length,
      totalWebMemoDrafts: (draftsList || []).length,
      approvedDraftsCount: draftStateCounts.APPROVED,
      pendingDraftsCount: draftStateCounts.PENDING,
      avgRiskRewardRatio,
      avgRiskReward: avgRiskRewardRatio,
      avgUpsideToR2Pct,
      avgBufferToS1Pct,
      avgDownsideToS1Pct: -Math.abs(avgBufferToS1Pct)
    },
    stackedCharts,
    pieCharts: {
      topicDistribution: pieTopicDistribution,
      srZoneDistribution: pieSrZoneDistribution,
      userLicenseTier: pieUserLicenseTier,
      memoAndDraftPosture: pieMemoAndDraftPosture
    },
    srQuantitativeTable,
    charts: {
      stackedByTopicTag: topicTagBreakdown.map((t) => ({
        label: t.tag,
        published: t.publishedPosts,
        pinned: t.pinnedPosts,
        archived: t.archivedPosts,
        bullish: t.bullishCount,
        accumulate: t.accumulateCount,
        neutral: t.neutralCount,
        avgRiskReward: t.avgRiskReward,
        symbols: t.symbols
      })),
      stackedByStockSr: srTopList.map((item) => ({
        symbol: item.symbol,
        name: item.name,
        currentPrice: item.quant.currentPrice,
        s1: item.supportLevels.s1.price,
        s2: item.supportLevels.s2.price,
        s3: item.supportLevels.s3.price,
        r1: item.resistanceLevels.r1.price,
        r2: item.resistanceLevels.r2.price,
        r3: item.resistanceLevels.r3.price,
        distToS1Pct: item.quant.distToS1Pct,
        distToS2Pct: item.quant.distToS2Pct,
        distToS3Pct: item.quant.distToS3Pct,
        upsideToR1Pct: item.quant.upsideToR1Pct,
        upsideToR2Pct: item.quant.upsideToR2Pct,
        upsideToR3Pct: item.quant.upsideToR3Pct,
        riskRewardRatio: item.quant.riskRewardRatio,
        rangePositionPct: item.quant.rangePositionPct,
        bias: item.bias
      })),
      stackedByUserProfile: userProfilesBreakdown.map((u) => ({
        label: u.syncKey,
        tier: u.tier,
        activePositions: u.activePositions,
        watchlistAssets: u.watchlistAssets,
        memosCount: u.memosCount,
        alertsCount: u.alertsCount,
        portfoliosCount: u.portfoliosCount
      })),
      stackedByPortfolio: portfolioBreakdown.slice(0, 12),
      pies: {
        userAndDeviceTiers: pieUserLicenseTier,
        topicTagShare: pieTopicDistribution,
        srTacticalZones: pieSrZoneDistribution,
        memoAndDraftPosture: pieMemoAndDraftPosture
      }
    },
    researchStore: {
      policy: store.policy,
      posts: allPosts
    },
    watchlistMatrix,
    userProfiles: userProfilesBreakdown
  };
}

/**
 * Performs an Admin or Hermes mutation on the research feed store.
 */
function mutateResearchStore(store, actionPayload = {}, { actor = "admin", nowMs = Date.now() } = {}) {
  if (!store || !Array.isArray(store.posts)) {
    throw new Error("Invalid research feed store");
  }
  const nowIso = new Date(nowMs).toISOString();
  ensureTagRegistry(store, nowMs);
  const action = String(actionPayload.action || "UPSERT").trim().toUpperCase();

  if (action === "UPSERT" || action === "CREATE" || action === "UPDATE") {
    const rawPost = actionPayload.post || actionPayload;
    if (!rawPost || !rawPost.symbol) {
      return { ok: false, status: 400, error: "symbol is required to create or update a research card." };
    }
    const targetId = String(rawPost.id || actionPayload.postId || "").trim();
    const shouldUpsertBySymbol = rawPost.upsertBySymbol !== undefined ? Boolean(rawPost.upsertBySymbol) : action === "UPSERT";
    const existingIdx = targetId
      ? store.posts.findIndex((p) => p.id === targetId)
      : shouldUpsertBySymbol
      ? store.posts.findIndex(
          (p) =>
            p.symbol === String(rawPost.symbol).trim().toUpperCase() &&
            (p.status === "PUBLISHED" || p.status === "ACTIVE")
        )
      : -1;

    if (existingIdx >= 0) {
      const updated = normalizeResearchPostInput(
        {
          ...rawPost,
          updatedAt: rawPost.updatedAt || nowIso
        },
        {
          existing: store.posts[existingIdx],
          nowMs
        }
      );
      store.posts[existingIdx] = updated;
      ensureTagRegistry(store, nowMs);
      store.updatedAt = nowIso;
      return {
        ok: true,
        status: 200,
        message: `Updated research & S/R card for ${updated.symbol} (${updated.id}).`,
        post: updated
      };
    }

    const created = normalizeResearchPostInput(
      {
        ...rawPost,
        author: rawPost.author || (actor === "hermes" || actor === "hermes-agent" ? "Hermes Agent" : "MoatWatch Admin"),
        source: rawPost.source || (actor === "hermes" || actor === "hermes-agent" ? "HERMES_ANALYST" : "ADMIN")
      },
      { nowMs }
    );
    store.posts.unshift(created);
    ensureTagRegistry(store, nowMs);
    store.updatedAt = nowIso;
    return {
      ok: true,
      status: 201,
      message: `Published research & S/R 1-2-3 card for ${created.symbol} across all SyncKeys.`,
      post: created
    };
  }

  // --- Dynamic Tag Registry Management Actions ---
  if (action === "UPSERT_TAG" || action === "CREATE_TAG" || action === "UPDATE_TAG") {
    const tagPayload = actionPayload.tagEntry || actionPayload.tagData || actionPayload;
    const targetTag = normalizeTag(tagPayload.tag || tagPayload.name || tagPayload.newTag || "");
    if (!targetTag) {
      return { ok: false, status: 400, error: "Valid #tag name is required." };
    }
    const oldTag = normalizeTag(tagPayload.oldTag || tagPayload.previousTag || "");
    let cascadedPosts = 0;

    if (oldTag && oldTag.toLowerCase() !== targetTag.toLowerCase()) {
      for (const post of store.posts) {
        if (!Array.isArray(post.tags)) continue;
        const hadOld = post.tags.some((t) => t.toLowerCase() === oldTag.toLowerCase());
        if (hadOld) {
          post.tags = normalizeTagsList(
            post.tags.map((t) => (t.toLowerCase() === oldTag.toLowerCase() ? targetTag : t))
          );
          post.updatedAt = nowIso;
          cascadedPosts += 1;
        }
      }
      store.tagRegistry = (store.tagRegistry || []).filter(
        (entry) => entry.tag.toLowerCase() !== oldTag.toLowerCase()
      );
    } else if (oldTag && oldTag !== targetTag) {
      // Case-only rename (e.g., #hermesdaily -> #HermesDaily)
      for (const post of store.posts) {
        if (!Array.isArray(post.tags)) continue;
        const hadOld = post.tags.some((t) => t.toLowerCase() === oldTag.toLowerCase());
        if (hadOld) {
          post.tags = normalizeTagsList(
            post.tags.map((t) => (t.toLowerCase() === oldTag.toLowerCase() ? targetTag : t))
          );
          post.updatedAt = nowIso;
          cascadedPosts += 1;
        }
      }
    }

    const existingIdx = (store.tagRegistry || []).findIndex(
      (entry) => entry.tag.toLowerCase() === targetTag.toLowerCase()
    );
    const prev = existingIdx >= 0 ? store.tagRegistry[existingIdx] : {};
    const entry = normalizeTagRegistryEntry(
      {
        ...prev,
        tag: targetTag,
        color: tagPayload.color ?? prev.color,
        category: tagPayload.category ?? prev.category,
        description: tagPayload.description ?? prev.description,
        pinned: tagPayload.pinned !== undefined ? Boolean(tagPayload.pinned) : Boolean(prev.pinned),
        hidden: tagPayload.hidden !== undefined ? Boolean(tagPayload.hidden) : Boolean(prev.hidden),
        createdAt: prev.createdAt || nowIso,
        updatedAt: nowIso
      },
      existingIdx >= 0 ? existingIdx : store.tagRegistry.length,
      nowIso
    );

    if (existingIdx >= 0) {
      store.tagRegistry[existingIdx] = entry;
    } else {
      store.tagRegistry.push(entry);
    }

    // Ensure canonical casing across posts
    for (const post of store.posts) {
      if (!Array.isArray(post.tags)) continue;
      if (post.tags.some((t) => t.toLowerCase() === targetTag.toLowerCase() && t !== targetTag)) {
        post.tags = normalizeTagsList(
          post.tags.map((t) => (t.toLowerCase() === targetTag.toLowerCase() ? targetTag : t))
        );
      }
    }

    store.updatedAt = nowIso;
    return {
      ok: true,
      status: existingIdx >= 0 ? 200 : 201,
      message:
        oldTag && oldTag !== targetTag
          ? `Renamed ${oldTag} → ${targetTag} and updated ${cascadedPosts} card(s).`
          : `Saved dynamic tag ${targetTag} in registry.`,
      tagEntry: entry,
      affectedCount: cascadedPosts,
      tagRegistry: store.tagRegistry
    };
  }

  if (action === "RENAME_TAG") {
    const oldTag = normalizeTag(actionPayload.oldTag || actionPayload.fromTag || actionPayload.tag || "");
    const newTag = normalizeTag(actionPayload.newTag || actionPayload.toTag || "");
    if (!oldTag || !newTag) {
      return { ok: false, status: 400, error: "Both oldTag and newTag are required for RENAME_TAG." };
    }
    let affectedCount = 0;
    for (const post of store.posts) {
      if (!Array.isArray(post.tags)) continue;
      if (post.tags.some((t) => t.toLowerCase() === oldTag.toLowerCase())) {
        post.tags = normalizeTagsList(
          post.tags.map((t) => (t.toLowerCase() === oldTag.toLowerCase() ? newTag : t))
        );
        post.updatedAt = nowIso;
        affectedCount += 1;
      }
    }
    const oldIdx = (store.tagRegistry || []).findIndex(
      (entry) => entry.tag.toLowerCase() === oldTag.toLowerCase()
    );
    const newIdx = (store.tagRegistry || []).findIndex(
      (entry) => entry.tag.toLowerCase() === newTag.toLowerCase()
    );
    const oldEntry = oldIdx >= 0 ? store.tagRegistry[oldIdx] : {};
    if (oldIdx >= 0 && newIdx >= 0 && oldIdx !== newIdx) {
      store.tagRegistry.splice(oldIdx, 1);
    } else if (oldIdx >= 0) {
      store.tagRegistry[oldIdx] = normalizeTagRegistryEntry(
        {
          ...oldEntry,
          tag: newTag,
          color: actionPayload.color ?? oldEntry.color,
          category: actionPayload.category ?? oldEntry.category,
          description: actionPayload.description ?? oldEntry.description,
          updatedAt: nowIso
        },
        oldIdx,
        nowIso
      );
    } else {
      store.tagRegistry.push(
        normalizeTagRegistryEntry(
          {
            tag: newTag,
            color: actionPayload.color,
            category: actionPayload.category,
            description: actionPayload.description,
            createdAt: nowIso,
            updatedAt: nowIso
          },
          store.tagRegistry.length,
          nowIso
        )
      );
    }
    store.updatedAt = nowIso;
    return {
      ok: true,
      status: 200,
      message: `Renamed tag ${oldTag} → ${newTag} across ${affectedCount} research card(s).`,
      oldTag,
      newTag,
      affectedCount,
      replacedInPosts: affectedCount,
      tagRegistry: store.tagRegistry
    };
  }

  if (action === "MERGE_TAG") {
    const sourceTag = normalizeTag(actionPayload.sourceTag || actionPayload.fromTag || actionPayload.oldTag || "");
    const targetTag = normalizeTag(
      actionPayload.targetTag || actionPayload.intoTag || actionPayload.toTag || actionPayload.newTag || ""
    );
    if (!sourceTag || !targetTag || sourceTag.toLowerCase() === targetTag.toLowerCase()) {
      return { ok: false, status: 400, error: "Distinct sourceTag and targetTag are required for MERGE_TAG." };
    }
    let affectedCount = 0;
    for (const post of store.posts) {
      if (!Array.isArray(post.tags)) continue;
      if (post.tags.some((t) => t.toLowerCase() === sourceTag.toLowerCase())) {
        post.tags = normalizeTagsList(
          post.tags.map((t) => (t.toLowerCase() === sourceTag.toLowerCase() ? targetTag : t))
        );
        post.updatedAt = nowIso;
        affectedCount += 1;
      }
    }
    const sourceEntry = (store.tagRegistry || []).find(
      (entry) => entry.tag.toLowerCase() === sourceTag.toLowerCase()
    );
    store.tagRegistry = (store.tagRegistry || []).filter(
      (entry) => entry.tag.toLowerCase() !== sourceTag.toLowerCase()
    );
    const hasTarget = store.tagRegistry.some(
      (entry) => entry.tag.toLowerCase() === targetTag.toLowerCase()
    );
    if (!hasTarget) {
      store.tagRegistry.push(
        normalizeTagRegistryEntry(
          {
            ...(sourceEntry || {}),
            tag: targetTag,
            updatedAt: nowIso
          },
          store.tagRegistry.length,
          nowIso
        )
      );
    }
    store.updatedAt = nowIso;
    return {
      ok: true,
      status: 200,
      message: `Merged ${sourceTag} into ${targetTag} across ${affectedCount} research card(s).`,
      sourceTag,
      targetTag,
      affectedCount,
      mergedInPosts: affectedCount,
      tagRegistry: store.tagRegistry
    };
  }

  if (action === "DELETE_TAG" || action === "REMOVE_TAG") {
    const targetTag = normalizeTag(actionPayload.tag || actionPayload.tagName || "");
    if (!targetTag) {
      return { ok: false, status: 400, error: "Valid #tag is required for DELETE_TAG." };
    }
    let affectedCount = 0;
    for (const post of store.posts) {
      if (!Array.isArray(post.tags)) continue;
      if (post.tags.some((t) => t.toLowerCase() === targetTag.toLowerCase())) {
        const remaining = post.tags.filter((t) => t.toLowerCase() !== targetTag.toLowerCase());
        post.tags = remaining.length > 0 ? remaining : ["#WatchlistQuant"];
        post.updatedAt = nowIso;
        affectedCount += 1;
      }
    }
    const beforeReg = (store.tagRegistry || []).length;
    store.tagRegistry = (store.tagRegistry || []).filter(
      (entry) => entry.tag.toLowerCase() !== targetTag.toLowerCase()
    );
    store.updatedAt = nowIso;
    return {
      ok: true,
      status: 200,
      message: `Deleted tag ${targetTag} from registry and removed from ${affectedCount} card(s).`,
      deletedTag: targetTag,
      affectedCount,
      removedFromRegistry: beforeReg - store.tagRegistry.length,
      tagRegistry: store.tagRegistry
    };
  }

  if (action === "TOGGLE_TAG_PIN" || action === "PIN_TAG" || action === "UNPIN_TAG") {
    const targetTag = normalizeTag(actionPayload.tag || actionPayload.tagName || "");
    if (!targetTag) {
      return { ok: false, status: 400, error: "Valid #tag is required for TOGGLE_TAG_PIN." };
    }
    const idx = (store.tagRegistry || []).findIndex(
      (entry) => entry.tag.toLowerCase() === targetTag.toLowerCase()
    );
    if (idx < 0) {
      return { ok: false, status: 404, error: `Tag ${targetTag} not found in registry.` };
    }
    const entry = store.tagRegistry[idx];
    entry.pinned =
      action === "PIN_TAG"
        ? true
        : action === "UNPIN_TAG"
        ? false
        : actionPayload.pinned !== undefined
        ? Boolean(actionPayload.pinned)
        : !entry.pinned;
    entry.updatedAt = nowIso;
    store.updatedAt = nowIso;
    return {
      ok: true,
      status: 200,
      message: `${entry.pinned ? "Pinned" : "Unpinned"} tag ${entry.tag} on frontpage filter pills.`,
      tagEntry: entry,
      tagRegistry: store.tagRegistry
    };
  }

  if (action === "TOGGLE_TAG_VISIBILITY" || action === "HIDE_TAG" || action === "SHOW_TAG") {
    const targetTag = normalizeTag(actionPayload.tag || actionPayload.tagName || "");
    if (!targetTag) {
      return { ok: false, status: 400, error: "Valid #tag is required for TOGGLE_TAG_VISIBILITY." };
    }
    const idx = (store.tagRegistry || []).findIndex(
      (entry) => entry.tag.toLowerCase() === targetTag.toLowerCase()
    );
    if (idx < 0) {
      return { ok: false, status: 404, error: `Tag ${targetTag} not found in registry.` };
    }
    const entry = store.tagRegistry[idx];
    entry.hidden =
      action === "HIDE_TAG"
        ? true
        : action === "SHOW_TAG"
        ? false
        : actionPayload.hidden !== undefined
        ? Boolean(actionPayload.hidden)
        : !entry.hidden;
    entry.updatedAt = nowIso;
    store.updatedAt = nowIso;
    return {
      ok: true,
      status: 200,
      message: `${entry.hidden ? "Hidden" : "Unhidden"} tag ${entry.tag} on frontpage filter pills.`,
      tagEntry: entry,
      tagRegistry: store.tagRegistry
    };
  }

  const rawIds = actionPayload.ids || actionPayload.postIds;
  const singleId = actionPayload.id || actionPayload.postId;
  const targetIds = Array.isArray(rawIds)
    ? rawIds.map((x) => String(x).trim()).filter(Boolean)
    : singleId
    ? [String(singleId).trim()]
    : [];

  if (action === "ARCHIVE" || action === "HIDE") {
    if (targetIds.length === 0) {
      return { ok: false, status: 400, error: "id/postId or ids[]/postIds[] required for ARCHIVE action." };
    }
    let count = 0;
    for (const post of store.posts) {
      if (targetIds.includes(post.id)) {
        post.status = "ARCHIVED";
        post.archivedReason = String(actionPayload.reason || "ADMIN_ARCHIVED");
        post.archivedAt = nowIso;
        post.updatedAt = nowIso;
        count += 1;
      }
    }
    store.updatedAt = nowIso;
    return {
      ok: true,
      status: 200,
      message: `Archived/hidden ${count} card(s) from frontpage.`,
      affectedCount: count
    };
  }

  if (action === "RESTORE" || action === "UNARCHIVE" || action === "PUBLISH") {
    if (targetIds.length === 0) {
      return { ok: false, status: 400, error: "id/postId or ids[]/postIds[] required for RESTORE action." };
    }
    let count = 0;
    for (const post of store.posts) {
      if (targetIds.includes(post.id)) {
        post.status = "PUBLISHED";
        post.archivedReason = null;
        post.archivedAt = null;
        if (actionPayload.refreshTimestamp !== false) {
          post.createdAt = nowIso;
          post.publishedAt = nowIso;
        }
        post.updatedAt = nowIso;
        count += 1;
      }
    }
    store.updatedAt = nowIso;
    return {
      ok: true,
      status: 200,
      message: `Restored ${count} card(s) to live frontpage across all SyncKeys.`,
      affectedCount: count
    };
  }

  if (action === "TOGGLE_PIN" || action === "PIN" || action === "UNPIN") {
    if (targetIds.length === 0) {
      return { ok: false, status: 400, error: "id/postId or ids[]/postIds[] required for PIN action." };
    }
    let count = 0;
    for (const post of store.posts) {
      if (targetIds.includes(post.id)) {
        post.pinned = action === "PIN" ? true : action === "UNPIN" ? false : !post.pinned;
        post.autoArchiveExempt = post.pinned;
        post.updatedAt = nowIso;
        count += 1;
      }
    }
    store.updatedAt = nowIso;
    return {
      ok: true,
      status: 200,
      message: `Updated pin status for ${count} card(s).`,
      affectedCount: count
    };
  }

  if (action === "DELETE") {
    if (targetIds.length === 0) {
      return { ok: false, status: 400, error: "id/postId or ids[]/postIds[] required for DELETE action." };
    }
    const beforeLen = store.posts.length;
    store.posts = store.posts.filter((p) => !targetIds.includes(p.id));
    const deletedCount = beforeLen - store.posts.length;
    store.updatedAt = nowIso;
    return {
      ok: true,
      status: 200,
      message: `Permanently deleted ${deletedCount} card(s).`,
      affectedCount: deletedCount
    };
  }

  if (action === "UPDATE_POLICY" || action === "SET_AUTO_ARCHIVE_POLICY") {
    store.policy = store.policy || {};
    const polInput = actionPayload.policy || actionPayload;
    if (polInput.autoArchiveEnabled !== undefined) {
      store.policy.autoArchiveEnabled = Boolean(polInput.autoArchiveEnabled);
    }
    if (polInput.autoArchiveDays !== undefined) {
      store.policy.autoArchiveDays = Math.max(
        MIN_AUTO_ARCHIVE_DAYS,
        Math.min(MAX_AUTO_ARCHIVE_DAYS, Math.floor(Number(polInput.autoArchiveDays) || DEFAULT_AUTO_ARCHIVE_DAYS))
      );
    }
    const sweepRes = runAutoArchiveSweep(store, { nowMs });
    store.updatedAt = nowIso;
    return {
      ok: true,
      status: 200,
      message: `Auto-archive policy updated (${store.policy.autoArchiveEnabled ? `Enabled: >${store.policy.autoArchiveDays} days` : "Disabled"}). Auto-archived ${sweepRes.sweptCount} aging card(s).`,
      policy: store.policy,
      sweep: sweepRes
    };
  }

  if (action === "RUN_AUTO_ARCHIVE_SWEEP") {
    const rawForceDays =
      actionPayload.olderThanDays ??
      actionPayload.autoArchiveDays ??
      actionPayload.policy?.autoArchiveDays;
    const forceDays = rawForceDays !== undefined ? Number(rawForceDays) : store.policy?.autoArchiveDays || DEFAULT_AUTO_ARCHIVE_DAYS;
    const sweepRes = runAutoArchiveSweep(store, { nowMs, forcePolicyDays: forceDays });
    store.updatedAt = nowIso;
    return {
      ok: true,
      status: 200,
      message: `Auto-archive sweep complete: ${sweepRes.sweptCount} old card(s) archived.`,
      sweep: sweepRes
    };
  }

  return {
    ok: false,
    status: 400,
    error: `Unsupported research post action: ${action}`
  };
}

/**
 * Synchronize a Discord-approved WebMemo into the shared S/R 1-2-3 Research Store
 * so that approving a draft in Discord immediately updates/publishes the symbol's
 * shared research card across all SyncKeys.
 */
function syncApprovedWebMemoToResearchStore(
  store,
  { symbol, portfolioId, memo, analysisSummary, memoRevision, updatedAt, draftId } = {}
) {
  if (!store || !Array.isArray(store.posts)) return null;
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym || !memo) return null;

  const nowMs = updatedAt ? Date.parse(updatedAt) || Date.now() : Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const existingIdx = store.posts.findIndex(
    (p) => String(p.symbol || "").toUpperCase() === sym && (p.status === "PUBLISHED" || p.status === "ACTIVE")
  );

  if (existingIdx >= 0) {
    const existing = store.posts[existingIdx];
    const mergedTags = normalizeTagsList([
      ...(existing.tags || []),
      "#DiscordApproved",
      "#hermes-daily",
      "#support-resistance"
    ]);
    const updated = normalizeResearchPostInput(
      {
        ...existing,
        symbol: sym,
        signalMemo: String(memo).trim(),
        summary: analysisSummary
          ? `${String(analysisSummary).trim()} [Approved WebMemo rev ${memoRevision || 1}: ${String(memo).trim()}]`
          : existing.summary,
        tags: mergedTags,
        updatedAt: nowIso
      },
      { existing, nowMs }
    );
    updated.lastApprovedDraftId = draftId || null;
    updated.lastApprovedMemoRevision = memoRevision || 1;
    store.posts.splice(existingIdx, 1);
    store.posts.unshift(updated);
    store.updatedAt = nowIso;
    return updated;
  }

  const created = normalizeResearchPostInput(
    {
      id: `hermes-sr-${sym.toLowerCase()}-approved`,
      symbol: sym,
      title: `${sym} — Hermes Approved WebMemo & Multi-Horizon S/R 1-2-3`,
      headline: `${sym} — Hermes Approved WebMemo & Multi-Horizon S/R 1-2-3`,
      summary:
        analysisSummary ||
        `อนุมัติจากเจ้าของผ่าน Discord (${portfolioId || "us-moat"}): ${String(memo).trim()}`,
      signalMemo: String(memo).trim(),
      stance: "BULLISH",
      bias: "BULLISH",
      tags: ["#DiscordApproved", "#hermes-daily", "#support-resistance", "#watchlist"],
      author: "Hermes Quant Research Agent",
      source: "HERMES_DISCORD_APPROVAL",
      publishedAt: nowIso,
      updatedAt: nowIso
    },
    { nowMs }
  );
  created.lastApprovedDraftId = draftId || null;
  created.lastApprovedMemoRevision = memoRevision || 1;
  store.posts.unshift(created);
  store.updatedAt = nowIso;
  return created;
}

module.exports = {
  DEFAULT_AUTO_ARCHIVE_DAYS,
  DEFAULT_TAG_PALETTE,
  normalizeTag,
  normalizeTagsList,
  createDefaultTagRegistry,
  normalizeTagRegistryEntry,
  ensureTagRegistry,
  buildQuantSupportResistanceLevels,
  computeCardQuantMetrics,
  buildInitialSeedStore,
  normalizeResearchPostInput,
  runAutoArchiveSweep,
  buildWatchlistSupportResistanceMatrix,
  buildPublicResearchFeedPayload,
  buildAdminBiAnalytics,
  mutateResearchStore,
  syncApprovedWebMemoToResearchStore
};
