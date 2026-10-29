/**
 * MoatWatch Scoped WebMemo Integration Engine
 *
 * Provides least-privilege, typed portfolio/watchlist read access, 24-hour versioned
 * WebMemo approval drafts, Discord interaction verification, Compare-And-Swap (CAS)
 * memo patching, mandatory readback verification, and Web UI save reconciliation.
 */

const MAX_WEBMEMO_CHARS = 140;
const DEFAULT_DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MEMO_METADATA_FIELDS = new Set([
  "memo",
  "memoRevision",
  "memoUpdatedAt",
  "previousMemo",
  "memoSource",
  "memoDraftId"
]);

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Constant-time string comparison to prevent timing attacks on bearer tokens.
 */
function constantTimeEquals(a, b) {
  const strA = String(a || "");
  const strB = String(b || "");
  if (!strA || !strB) return false;
  const maxLen = Math.max(strA.length, strB.length);
  let diff = strA.length ^ strB.length;
  for (let i = 0; i < maxLen; i++) {
    const codeA = i < strA.length ? strA.charCodeAt(i) : 0;
    const codeB = i < strB.length ? strB.charCodeAt(i) : 0;
    diff |= codeA ^ codeB;
  }
  return diff === 0;
}

/**
 * Deterministic 64-bit hex digest (dual FNV-1a) that runs synchronously in both
 * Node.js and Cloudflare Workers without external dependencies.
 */
function computeContentHash(input) {
  const str = String(input ?? "");
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= ch ^ ((i & 0xff) + 1);
    h2 = Math.imul(h2, 0x811c9dc5) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/**
 * Generates a unique draft ID safe for Discord button custom_id (<= 32 chars).
 */
function generateDraftId(nowMs = Date.now()) {
  const tsPart = Math.max(0, Math.floor(nowMs)).toString(36);
  let randPart = "";
  if (typeof globalThis !== "undefined" && globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    randPart = globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  } else {
    randPart = Math.random().toString(36).slice(2, 12).padEnd(10, "0");
  }
  return `wmd_${tsPart}_${randPart}`;
}

/**
 * Masks a raw Sync Key so it is never exposed in logs, Discord cards, or API responses.
 * Example: "V2-ABCDEF81" -> "V2-***81"
 */
function maskSyncKey(rawKey) {
  const clean = String(rawKey || "").trim().toUpperCase();
  if (!clean) return "";
  if (clean.length <= 5) {
    return `${clean.slice(0, 1)}***${clean.slice(-1)}`;
  }
  if (clean.startsWith("V2-")) {
    return `${clean.slice(0, 3)}***${clean.slice(-2)}`;
  }
  return `${clean.slice(0, 2)}***${clean.slice(-2)}`;
}

/**
 * Derives a deterministic non-secret account identifier from a Sync Key.
 */
function deriveAccountId(rawKey) {
  const clean = String(rawKey || "").trim().toUpperCase();
  if (!clean) return "acct_unknown";
  return `acct_${computeContentHash(`moat-acct:${clean}`).slice(0, 12)}`;
}

/**
 * Validates a proposed WebMemo string (must be non-empty single-line string, <= 140 Unicode code points
 * AND <= 140 UTF-16 code units, with no control characters or newlines).
 */
function validateProposedMemo(rawMemo) {
  if (typeof rawMemo !== "string") {
    return {
      ok: false,
      status: 400,
      code: "INVALID_MEMO",
      error: "proposedMemo must be a string."
    };
  }
  if (/[\x00-\x1F\x7F]/.test(rawMemo)) {
    return {
      ok: false,
      status: 400,
      code: "MEMO_CONTROL_CHARS_FORBIDDEN",
      error: "proposedMemo contains disallowed control characters or line breaks."
    };
  }
  const normalized = rawMemo.trim();
  if (!normalized) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_MEMO",
      error: "proposedMemo cannot be empty."
    };
  }
  const codePointLength = Array.from(normalized).length;
  const utf16Length = normalized.length;
  if (codePointLength > MAX_WEBMEMO_CHARS || utf16Length > MAX_WEBMEMO_CHARS) {
    return {
      ok: false,
      status: 400,
      code: "MEMO_TOO_LONG",
      error: `proposedMemo exceeds maximum length of ${MAX_WEBMEMO_CHARS} characters (got ${Math.max(
        codePointLength,
        utf16Length
      )}).`,
      codePointLength,
      utf16Length,
      maxLength: MAX_WEBMEMO_CHARS
    };
  }
  return {
    ok: true,
    memo: normalized,
    codePointLength,
    utf16Length
  };
}

/**
 * Encodes a Discord button custom_id bound to a specific draftId and version.
 */
function encodeDiscordButtonCustomId(action, draftId, version = 1) {
  const cleanAction = String(action || "").trim().toLowerCase();
  if (cleanAction !== "approve" && cleanAction !== "reject") {
    throw new Error(`Invalid button action: ${action}`);
  }
  const cleanId = String(draftId || "").trim();
  if (!cleanId || cleanId.includes(":")) {
    throw new Error(`Invalid draftId for custom_id: ${draftId}`);
  }
  const ver = Math.max(1, Math.floor(Number(version) || 1));
  return `webmemo:${cleanAction}:${cleanId}:${ver}`;
}

/**
 * Parses a Discord button custom_id. Returns null if not a WebMemo button so
 * existing Hermes Discord buttons (clarify, exec, etc.) remain untouched.
 */
function parseDiscordButtonCustomId(customId) {
  const raw = String(customId || "").trim();
  if (!raw.startsWith("webmemo:")) return null;
  const parts = raw.split(":");
  if (parts.length !== 4) {
    return null;
  }
  const [, rawAction, draftId, rawVersion] = parts;
  const action = rawAction.toLowerCase();
  if (action !== "approve" && action !== "reject") {
    return null;
  }
  const version = Number(rawVersion);
  if (!draftId || !Number.isInteger(version) || version < 1) {
    return null;
  }
  return {
    action,
    draftId,
    version
  };
}

/**
 * Scans a profile's portfolios for duplicate symbols and locates a target (portfolioId, symbol).
 */
function findTargetHolding(profile, { portfolioId, symbol } = {}) {
  const cleanSymbol = String(symbol || "").trim().toUpperCase();
  if (!cleanSymbol) {
    return {
      ok: false,
      status: 400,
      code: "MISSING_SYMBOL",
      error: "symbol is required."
    };
  }

  const portfolios = Array.isArray(profile?.portfolios) ? profile.portfolios : [];
  const cleanPortfolioId = portfolioId !== undefined && portfolioId !== null ? String(portfolioId).trim() : "";

  const matches = [];
  for (let pIdx = 0; pIdx < portfolios.length; pIdx++) {
    const port = portfolios[pIdx];
    const holdings = Array.isArray(port.holdings)
      ? port.holdings
      : Array.isArray(port.items)
      ? port.items
      : [];
    const matchingHoldingIndices = [];
    for (let hIdx = 0; hIdx < holdings.length; hIdx++) {
      const h = holdings[hIdx];
      if (String(h.symbol || "").trim().toUpperCase() === cleanSymbol) {
        matchingHoldingIndices.push(hIdx);
      }
    }
    if (matchingHoldingIndices.length > 0) {
      matches.push({
        portfolioIndex: pIdx,
        portfolioId: port.id,
        portfolioName: port.name,
        holdingIndices: matchingHoldingIndices
      });
    }
  }

  if (cleanPortfolioId) {
    const targetPortfolioIdx = portfolios.findIndex((p) => String(p.id) === cleanPortfolioId);
    if (targetPortfolioIdx === -1) {
      return {
        ok: false,
        status: 404,
        code: "PORTFOLIO_NOT_FOUND",
        error: `Portfolio '${cleanPortfolioId}' was not found in this account.`
      };
    }
    const portMatch = matches.find((m) => String(m.portfolioId) === cleanPortfolioId);
    if (!portMatch || portMatch.holdingIndices.length === 0) {
      return {
        ok: false,
        status: 404,
        code: "HOLDING_NOT_FOUND",
        error: `Symbol '${cleanSymbol}' was not found in portfolio '${cleanPortfolioId}'.`
      };
    }
    if (portMatch.holdingIndices.length > 1) {
      return {
        ok: false,
        status: 409,
        code: "DUPLICATE_SYMBOL_IN_PORTFOLIO",
        error: `Symbol '${cleanSymbol}' appears multiple times (${portMatch.holdingIndices.length}) in portfolio '${cleanPortfolioId}'.`
      };
    }
    const pIdx = portMatch.portfolioIndex;
    const hIdx = portMatch.holdingIndices[0];
    const portfolio = portfolios[pIdx];
    const holdings = Array.isArray(portfolio.holdings) ? portfolio.holdings : portfolio.items;
    return {
      ok: true,
      portfolioIndex: pIdx,
      holdingIndex: hIdx,
      portfolioId: portfolio.id,
      portfolioName: portfolio.name,
      symbol: cleanSymbol,
      holding: holdings[hIdx]
    };
  }

  // No portfolioId specified
  if (matches.length === 0) {
    return {
      ok: false,
      status: 404,
      code: "HOLDING_NOT_FOUND",
      error: `Symbol '${cleanSymbol}' was not found in any portfolio.`
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      status: 409,
      code: "AMBIGUOUS_SYMBOL_PORTFOLIO",
      error: `Symbol '${cleanSymbol}' exists in multiple portfolios (${matches
        .map((m) => m.portfolioId)
        .join(", ")}). Specify portfolioId explicitly.`,
      matchingPortfolios: matches.map((m) => ({
        portfolioId: m.portfolioId,
        portfolioName: m.portfolioName
      }))
    };
  }
  if (matches[0].holdingIndices.length > 1) {
    return {
      ok: false,
      status: 409,
      code: "DUPLICATE_SYMBOL_IN_PORTFOLIO",
      error: `Symbol '${cleanSymbol}' appears multiple times in portfolio '${matches[0].portfolioId}'.`
    };
  }

  const pIdx = matches[0].portfolioIndex;
  const hIdx = matches[0].holdingIndices[0];
  const portfolio = portfolios[pIdx];
  const holdings = Array.isArray(portfolio.holdings) ? portfolio.holdings : portfolio.items;
  return {
    ok: true,
    portfolioIndex: pIdx,
    holdingIndex: hIdx,
    portfolioId: portfolio.id,
    portfolioName: portfolio.name,
    symbol: cleanSymbol,
    holding: holdings[hIdx]
  };
}

/**
 * Strips memo-specific metadata fields from a holding object to verify that all financial
 * and configuration fields (shares, avgCost, targetPrice, stopPrice, etc.) are untouched.
 */
function stripMemoMetadata(holding) {
  const copy = {};
  for (const key of Object.keys(holding || {}).sort()) {
    if (!MEMO_METADATA_FIELDS.has(key)) {
      copy[key] = holding[key];
    }
  }
  return copy;
}

/**
 * Verifies that between beforeStore and afterStore ONLY the target holding's memo
 * (and memo audit metadata) changed, and no other account, portfolio, symbol, or field changed.
 */
function assertOnlyTargetMemoChanged(beforeStore, afterStore, target) {
  const accountKey = target?.accountKey || target?.syncKey;
  const portfolioId = target?.portfolioId;
  const symbol = target?.symbol;
  const expectedNewMemo =
    target?.expectedNewMemo !== undefined ? target.expectedNewMemo : target?.expectedMemo;
  const cleanSymbol = String(symbol || "").trim().toUpperCase();

  const beforeKeys = Object.keys(beforeStore || {}).sort();
  const afterKeys = Object.keys(afterStore || {}).sort();
  if (JSON.stringify(beforeKeys) !== JSON.stringify(afterKeys)) {
    throw new Error("INVARIANT_VIOLATION: Account key set changed during memo patch.");
  }
  if (!beforeStore || !beforeStore[accountKey] || !afterStore || !afterStore[accountKey]) {
    throw new Error(`INVARIANT_VIOLATION: Target account '${maskSyncKey(accountKey)}' missing.`);
  }

  for (const key of beforeKeys) {
    if (key !== accountKey) {
      if (JSON.stringify(beforeStore[key]) !== JSON.stringify(afterStore[key])) {
        throw new Error(`INVARIANT_VIOLATION: Non-target account '${maskSyncKey(key)}' was modified.`);
      }
    }
  }

  const beforeProfile = beforeStore[accountKey];
  const afterProfile = afterStore[accountKey];

  if (
    beforeProfile.syncKey !== afterProfile.syncKey ||
    beforeProfile.baseCurrency !== afterProfile.baseCurrency ||
    JSON.stringify(beforeProfile.watchSettings) !== JSON.stringify(afterProfile.watchSettings)
  ) {
    throw new Error("INVARIANT_VIOLATION: Account-level settings changed during memo patch.");
  }

  const beforePorts = Array.isArray(beforeProfile.portfolios) ? beforeProfile.portfolios : [];
  const afterPorts = Array.isArray(afterProfile.portfolios) ? afterProfile.portfolios : [];
  if (beforePorts.length !== afterPorts.length) {
    throw new Error("INVARIANT_VIOLATION: Portfolio count changed during memo patch.");
  }

  let matchedCount = 0;
  for (let pIdx = 0; pIdx < beforePorts.length; pIdx++) {
    const bp = beforePorts[pIdx];
    const ap = afterPorts[pIdx];
    if (bp.id !== ap.id || bp.name !== ap.name || bp.currency !== ap.currency) {
      throw new Error(`INVARIANT_VIOLATION: Portfolio metadata changed for '${bp.id}'.`);
    }
    const bHoldings = Array.isArray(bp.holdings) ? bp.holdings : bp.items || [];
    const aHoldings = Array.isArray(ap.holdings) ? ap.holdings : ap.items || [];
    if (bHoldings.length !== aHoldings.length) {
      throw new Error(`INVARIANT_VIOLATION: Holdings count changed in portfolio '${bp.id}'.`);
    }

    for (let hIdx = 0; hIdx < bHoldings.length; hIdx++) {
      const bh = bHoldings[hIdx];
      const ah = aHoldings[hIdx];
      const isTarget =
        String(bp.id) === String(portfolioId) &&
        String(bh.symbol || "").trim().toUpperCase() === cleanSymbol;

      if (!isTarget) {
        if (JSON.stringify(bh) !== JSON.stringify(ah)) {
          throw new Error(
            `INVARIANT_VIOLATION: Non-target holding '${bh.symbol}' in portfolio '${bp.id}' was modified.`
          );
        }
      } else {
        matchedCount += 1;
        if (JSON.stringify(stripMemoMetadata(bh)) !== JSON.stringify(stripMemoMetadata(ah))) {
          throw new Error(
            `INVARIANT_VIOLATION: Financial or non-memo fields of '${cleanSymbol}' in '${bp.id}' were modified.`
          );
        }
        if (ah.memo !== expectedNewMemo) {
          throw new Error(
            `INVARIANT_VIOLATION: Target memo mismatch on '${cleanSymbol}' (expected '${expectedNewMemo}', got '${ah.memo}').`
          );
        }
      }
    }
  }

  if (matchedCount !== 1) {
    throw new Error(`INVARIANT_VIOLATION: Expected exactly 1 target holding match, found ${matchedCount}.`);
  }
  return true;
}

/**
 * Applies a scoped Compare-And-Swap memo update on a cloned portfolio store.
 */
function applyScopedMemoPatch(store, { accountKey, portfolioId, symbol, expectedMemo, expectedRevision, proposedMemo, draftId, nowIso }) {
  const validMemo = validateProposedMemo(proposedMemo);
  if (!validMemo.ok) {
    return validMemo;
  }

  const profile = store?.[accountKey];
  if (!profile) {
    return {
      ok: false,
      status: 404,
      code: "ACCOUNT_NOT_FOUND",
      error: "Configured target account was not found in portfolio store."
    };
  }

  const found = findTargetHolding(profile, { portfolioId, symbol });
  if (!found.ok) {
    return found;
  }

  const currentHolding = found.holding;
  const currentMemo = String(currentHolding.memo || "");
  const currentRevision = Number(currentHolding.memoRevision ?? 0);

  if (expectedMemo !== undefined && expectedMemo !== null && currentMemo !== String(expectedMemo)) {
    return {
      ok: false,
      status: 409,
      code: "STALE_MEMO_CONFLICT",
      error: `Holding memo for ${found.symbol} in '${found.portfolioId}' changed since draft creation.`,
      currentMemo,
      currentRevision,
      expectedMemo: String(expectedMemo),
      expectedRevision: expectedRevision !== undefined ? Number(expectedRevision) : null
    };
  }

  if (
    expectedRevision !== undefined &&
    expectedRevision !== null &&
    Number(expectedRevision) !== currentRevision
  ) {
    return {
      ok: false,
      status: 409,
      code: "STALE_MEMO_CONFLICT",
      error: `Holding memoRevision for ${found.symbol} in '${found.portfolioId}' changed (expected ${expectedRevision}, current ${currentRevision}).`,
      currentMemo,
      currentRevision,
      expectedMemo: expectedMemo !== undefined ? String(expectedMemo) : currentMemo,
      expectedRevision: Number(expectedRevision)
    };
  }

  const timestamp = nowIso || new Date().toISOString();
  const nextStore = deepClone(store);
  const nextProfile = nextStore[accountKey];
  const nextPortfolio = nextProfile.portfolios[found.portfolioIndex];
  const nextHoldings = Array.isArray(nextPortfolio.holdings) ? nextPortfolio.holdings : nextPortfolio.items;
  const nextHolding = nextHoldings[found.holdingIndex];

  const nextRevision = currentRevision + 1;
  nextHolding.previousMemo = currentMemo;
  nextHolding.memo = validMemo.memo;
  nextHolding.memoRevision = nextRevision;
  nextHolding.memoUpdatedAt = timestamp;
  nextHolding.memoSource = "DISCORD_APPROVAL";
  if (draftId) {
    nextHolding.memoDraftId = String(draftId);
  }
  nextProfile.updatedAt = timestamp;

  assertOnlyTargetMemoChanged(store, nextStore, {
    accountKey,
    portfolioId: found.portfolioId,
    symbol: found.symbol,
    expectedNewMemo: validMemo.memo
  });

  return {
    ok: true,
    nextStore,
    portfolioId: found.portfolioId,
    portfolioName: found.portfolioName,
    symbol: found.symbol,
    previousMemo: currentMemo,
    publishedMemo: validMemo.memo,
    memoRevision: nextRevision,
    memoUpdatedAt: timestamp
  };
}

/**
 * Reconciles an incoming Web UI portfolio save (PUT /api/portfolio) with the latest
 * server profile so that:
 * 1. Normal web edits (shares, avgCost, targetPrice, stopPrice, added/removed symbols) always succeed.
 * 2. If a browser tab had a stale pre-approval memo snapshot for a symbol and did not edit that memo,
 *    the newer Discord-approved WebMemo is preserved instead of overwritten.
 * 3. If the web user explicitly changed a symbol's memo on the web, the web edit wins and increments memoRevision.
 */
function reconcileWebPortfolioSave(arg1, arg2, arg3 = [], arg4 = new Date().toISOString()) {
  let existingPorts = [];
  let normalizedPortfolios = [];
  let rawPorts = [];
  let nowIso = arg4;
  let calledAsOptionsObject = false;

  if (
    arg1 &&
    typeof arg1 === "object" &&
    !Array.isArray(arg1) &&
    (arg1.currentServerPortfolios !== undefined || arg1.normalizedClientPortfolios !== undefined)
  ) {
    calledAsOptionsObject = true;
    existingPorts = Array.isArray(arg1.currentServerPortfolios) ? arg1.currentServerPortfolios : [];
    normalizedPortfolios = Array.isArray(arg1.normalizedClientPortfolios) ? arg1.normalizedClientPortfolios : [];
    rawPorts = Array.isArray(arg1.rawClientPortfolios) ? arg1.rawClientPortfolios : [];
    nowIso = arg1.nowIso || new Date().toISOString();
  } else {
    existingPorts = Array.isArray(arg1?.portfolios)
      ? arg1.portfolios
      : Array.isArray(arg1)
      ? arg1
      : [];
    normalizedPortfolios = Array.isArray(arg2) ? arg2 : [];
    rawPorts = Array.isArray(arg3) ? arg3 : [];
  }

  const resultPortfolios = normalizedPortfolios.map((normPort, pIdx) => {
    const existingPort =
      existingPorts.find((ep) => String(ep.id) === String(normPort.id)) || existingPorts[pIdx] || null;
    const rawPort =
      rawPorts.find((rp) => rp && String(rp.id) === String(normPort.id)) || rawPorts[pIdx] || null;

    const existingHoldings = Array.isArray(existingPort?.holdings)
      ? existingPort.holdings
      : Array.isArray(existingPort?.items)
      ? existingPort.items
      : [];
    const rawHoldings = Array.isArray(rawPort?.holdings)
      ? rawPort.holdings
      : Array.isArray(rawPort?.items)
      ? rawPort.items
      : [];

    const reconciledHoldings = (normPort.holdings || []).map((normHolding, hIdx) => {
      const sym = String(normHolding.symbol || "").trim().toUpperCase();
      const existingHolding = existingHoldings.find(
        (eh) => String(eh.symbol || "").trim().toUpperCase() === sym
      );
      const rawHolding =
        rawHoldings[hIdx] && String(rawHoldings[hIdx].symbol || "").trim().toUpperCase() === sym
          ? rawHoldings[hIdx]
          : rawHoldings.find((rh) => String(rh?.symbol || "").trim().toUpperCase() === sym) || {};

      if (!existingHolding) {
        return {
          ...normHolding,
          memoRevision: 0,
          memoUpdatedAt: normHolding.memo ? nowIso : null,
          memoSource: normHolding.memo ? "WEB_UI" : null
        };
      }

      const existingMemo = String(existingHolding.memo || "");
      const existingRev = Number(existingHolding.memoRevision ?? 0);
      const existingPrevMemo =
        existingHolding.previousMemo !== undefined ? String(existingHolding.previousMemo) : null;
      const incomingMemo = String(normHolding.memo || "");

      const rawBase =
        rawHolding?.baseMemo !== undefined && rawHolding?.baseMemo !== null
          ? rawHolding.baseMemo
          : rawHolding?.loadedMemo !== undefined && rawHolding?.loadedMemo !== null
          ? rawHolding.loadedMemo
          : null;
      const hasBaseMemo = rawBase !== null;
      const baseMemo = hasBaseMemo ? String(rawBase).slice(0, MAX_WEBMEMO_CHARS) : null;
      const hasIncomingRev =
        rawHolding && rawHolding.memoRevision !== undefined && rawHolding.memoRevision !== null;
      const incomingRev = hasIncomingRev ? Number(rawHolding.memoRevision) : null;

      let preserveServerMemo = false;

      if (hasBaseMemo) {
        if (incomingMemo === baseMemo && incomingMemo !== existingMemo) {
          preserveServerMemo = true;
        }
      } else if (hasIncomingRev && incomingRev < existingRev) {
        if (existingPrevMemo !== null && incomingMemo === existingPrevMemo && incomingMemo !== existingMemo) {
          preserveServerMemo = true;
        }
      } else if (
        existingHolding.memoSource === "DISCORD_APPROVAL" &&
        existingPrevMemo !== null &&
        incomingMemo === existingPrevMemo &&
        incomingMemo !== existingMemo
      ) {
        preserveServerMemo = true;
      }

      if (preserveServerMemo) {
        return {
          ...normHolding,
          memo: existingMemo,
          memoRevision: existingRev,
          memoUpdatedAt: existingHolding.memoUpdatedAt || nowIso,
          previousMemo: existingPrevMemo,
          memoSource: existingHolding.memoSource || "DISCORD_APPROVAL",
          ...(existingHolding.memoDraftId ? { memoDraftId: existingHolding.memoDraftId } : {})
        };
      }

      if (incomingMemo !== existingMemo) {
        return {
          ...normHolding,
          memo: incomingMemo,
          memoRevision: existingRev + 1,
          memoUpdatedAt: nowIso,
          previousMemo: existingMemo,
          memoSource: "WEB_UI"
        };
      }

      return {
        ...normHolding,
        memo: existingMemo,
        memoRevision: existingRev,
        memoUpdatedAt: existingHolding.memoUpdatedAt || null,
        ...(existingPrevMemo !== null ? { previousMemo: existingPrevMemo } : {}),
        ...(existingHolding.memoSource ? { memoSource: existingHolding.memoSource } : {}),
        ...(existingHolding.memoDraftId ? { memoDraftId: existingHolding.memoDraftId } : {})
      };
    });

    return {
      ...normPort,
      holdings: reconciledHoldings
    };
  });

  if (calledAsOptionsObject) {
    return { portfolios: resultPortfolios };
  }
  resultPortfolios.portfolios = resultPortfolios;
  return resultPortfolios;
}

/**
 * Builds a sanitized, read-only account view for Hermes Agent.
 * Never includes raw Sync Keys or activation keys.
 */
function buildSanitizedAccountView(profile, accountId = "owner") {
  const syncKey = String(profile?.syncKey || "");
  const accountMask = maskSyncKey(syncKey);
  const symbolToPortfolios = {};

  const portfolios = (Array.isArray(profile?.portfolios) ? profile.portfolios : []).map((p) => {
    const rawHoldings = Array.isArray(p.holdings) ? p.holdings : Array.isArray(p.items) ? p.items : [];
    const holdings = rawHoldings.map((h) => {
      const sym = String(h.symbol || "").trim().toUpperCase();
      const shares = Number(h.shares || 0);
      if (!symbolToPortfolios[sym]) symbolToPortfolios[sym] = [];
      if (!symbolToPortfolios[sym].includes(p.id)) {
        symbolToPortfolios[sym].push(p.id);
      }
      const memoText = String(h.memo || "");
      const memoHash = computeContentHash(memoText);
      return {
        symbol: sym,
        name: String(h.name || sym),
        currency: h.currency || p.currency || "USD",
        role: shares > 0 ? "HELD" : "WATCHLIST",
        shares,
        avgCost: Number(h.avgCost || 0),
        targetPrice: Number(h.targetPrice || 0),
        stopPrice: Number(h.stopPrice || 0),
        alertDir: h.alertDir || "ABOVE",
        earningsDate: h.earningsDate || "",
        memo: memoText,
        memoRevision: Number(h.memoRevision ?? 0),
        memoUpdatedAt: h.memoUpdatedAt || null,
        memoHash,
        contentHash: memoHash
      };
    });
    return {
      id: p.id,
      name: p.name,
      currency: p.currency || "USD",
      heldCount: holdings.filter((h) => h.shares > 0).length,
      watchlistCount: holdings.filter((h) => h.shares === 0).length,
      holdings
    };
  });

  const duplicateSymbolPortfolios = {};
  for (const [sym, portIds] of Object.entries(symbolToPortfolios)) {
    if (portIds.length > 1) {
      duplicateSymbolPortfolios[sym] = portIds;
    }
  }

  const holdingCount = portfolios.reduce((sum, p) => sum + p.heldCount, 0);
  const watchlistCount = portfolios.reduce((sum, p) => sum + p.watchlistCount, 0);

  return {
    accountId,
    accountMask,
    accountMasked: accountMask,
    derivedAccountId: deriveAccountId(syncKey),
    baseCurrency: profile?.baseCurrency === "USD" ? "USD" : "THB",
    updatedAt: profile?.updatedAt || null,
    portfoliosCount: portfolios.length,
    holdingCount,
    watchlistCount,
    duplicateSymbolPortfolios,
    portfolios
  };
}

/**
 * Formats a draft record for API responses, including Discord button custom_ids.
 */
function serializeDraftRecord(draft) {
  if (!draft) return null;
  const version = Number(draft.version) || 1;
  const approveCid = encodeDiscordButtonCustomId("approve", draft.draftId, version);
  const rejectCid = encodeDiscordButtonCustomId("reject", draft.draftId, version);
  const baseRev = Number(draft.expectedRevision ?? 0);
  return {
    draftId: draft.draftId,
    accountId: draft.accountId,
    accountMask: draft.accountMask,
    accountMasked: draft.accountMask,
    portfolioId: draft.portfolioId,
    symbol: draft.symbol,
    expectedMemo: draft.expectedMemo,
    baseMemo: draft.expectedMemo,
    expectedRevision: baseRev,
    baseMemoRevision: baseRev,
    proposedMemo: draft.proposedMemo,
    proposedMemoLength: Array.from(String(draft.proposedMemo || "")).length,
    analysisSummary: draft.analysisSummary || "",
    version,
    status: draft.status,
    idempotencyKey: draft.idempotencyKey || null,
    requestedBy: draft.requestedBy || "hermes",
    createdAt: draft.createdAt,
    expiresAt: draft.expiresAt,
    decidedAt: draft.decidedAt || null,
    actorDiscordUserId: draft.actorDiscordUserId || null,
    interactionId: draft.interactionId || null,
    supersededByDraftId: draft.supersededByDraftId || null,
    discordChannelId: draft.discordChannelId || null,
    discordMessageId: draft.discordMessageId || null,
    readbackVerified: Boolean(draft.readbackVerified),
    readbackHash: draft.readbackHash || null,
    audit: draft.audit || {},
    customIds: {
      approve: approveCid,
      reject: rejectCid
    },
    discordButtons: {
      approveCustomId: approveCid,
      rejectCustomId: rejectCid
    }
  };
}

/**
 * Creates a storage adapter backed by Cloudflare D1 (`env.DB`) and/or an in-memory/file fallback.
 */
function createIntegrationStoreAdapter({
  env = null,
  getMemoryPortfolios = null,
  setMemoryPortfolios = null,
  getMemoryDrafts = null,
  setMemoryDrafts = null,
  faultInjector = null,
  faultInjection = null
} = {}) {
  const hasD1 = Boolean(env && env.DB && typeof env.DB.prepare === "function");
  const fi = faultInjector || faultInjection || null;

  function readMemDraftsList() {
    const raw = typeof getMemoryDrafts === "function" ? getMemoryDrafts() : [];
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object") return Object.values(raw);
    return [];
  }

  function writeMemDraft(draftClone) {
    const raw = typeof getMemoryDrafts === "function" ? getMemoryDrafts() : [];
    if (Array.isArray(raw)) {
      const idx = raw.findIndex((d) => d && d.draftId === draftClone.draftId);
      const next = [...raw];
      if (idx >= 0) next[idx] = draftClone;
      else next.push(draftClone);
      if (typeof setMemoryDrafts === "function") {
        setMemoryDrafts(next);
      } else if (idx >= 0) {
        raw[idx] = draftClone;
      } else {
        raw.push(draftClone);
      }
      return;
    }
    const mapObj = raw && typeof raw === "object" ? raw : {};
    mapObj[draftClone.draftId] = draftClone;
    if (typeof setMemoryDrafts === "function") {
      setMemoryDrafts(mapObj);
    }
  }

  async function ensureTables() {
    if (fi && typeof fi.onEnsureTables === "function") {
      await fi.onEnsureTables();
    }
    if (!hasD1) return;
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)"
    ).run();
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS webmemo_drafts (
        draft_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        account_mask TEXT NOT NULL,
        portfolio_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        expected_memo TEXT NOT NULL,
        expected_revision INTEGER NOT NULL DEFAULT 1,
        proposed_memo TEXT NOT NULL,
        analysis_summary TEXT NOT NULL DEFAULT '',
        version INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        idempotency_key TEXT,
        requested_by TEXT NOT NULL DEFAULT 'hermes',
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        decided_at TEXT,
        actor_discord_user_id TEXT,
        interaction_id TEXT,
        decision_idempotency_key TEXT,
        superseded_by_draft_id TEXT,
        discord_channel_id TEXT,
        discord_message_id TEXT,
        readback_verified INTEGER NOT NULL DEFAULT 0,
        readback_hash TEXT,
        audit_json TEXT NOT NULL DEFAULT '{}'
      )`
    ).run();
  }

  async function readPortfoliosSnapshot() {
    if (fi && fi.failReadPortfolios) {
      throw new Error("Simulated D1 portfolio read failure");
    }
    if (fi && typeof fi.onReadPortfolios === "function") {
      await fi.onReadPortfolios();
    }
    if (hasD1) {
      await ensureTables();
      const row = await env.DB.prepare("SELECT value, updated_at FROM kv_store WHERE key = ?")
        .bind("portfolios")
        .first();
      if (row && typeof row.value === "string") {
        const parsed = JSON.parse(row.value);
        if (typeof setMemoryPortfolios === "function") {
          setMemoryPortfolios(deepClone(parsed));
        }
        return {
          store: parsed,
          rawText: row.value,
          raw: row.value,
          updatedAt: row.updated_at || null
        };
      }
    }
    const mem = typeof getMemoryPortfolios === "function" ? getMemoryPortfolios() : {};
    const cloned = deepClone(mem || {});
    const rawText = JSON.stringify(cloned);
    return {
      store: cloned,
      rawText,
      raw: rawText,
      updatedAt: null
    };
  }

  async function casWritePortfoliosSnapshot(expectedRawText, nextStore, nowIso = new Date().toISOString()) {
    if (fi && fi.failWritePortfolios) {
      throw new Error("Simulated D1 portfolio write failure");
    }
    if (fi && typeof fi.onWritePortfolios === "function") {
      await fi.onWritePortfolios();
    }
    const nextRawText = JSON.stringify(nextStore);

    if (hasD1) {
      await ensureTables();
      if (expectedRawText !== null && expectedRawText !== undefined) {
        const res = await env.DB.prepare(
          "UPDATE kv_store SET value = ?, updated_at = ? WHERE key = 'portfolios' AND value = ?"
        )
          .bind(nextRawText, nowIso, expectedRawText)
          .run();
        const changes = Number(res?.meta?.changes ?? res?.changes ?? 0);
        if (changes === 0) {
          return { ok: false, casConflict: true };
        }
      } else {
        await env.DB.prepare(
          "INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
        )
          .bind("portfolios", nextRawText, nowIso)
          .run();
      }
      if (typeof setMemoryPortfolios === "function") {
        setMemoryPortfolios(deepClone(nextStore));
      }
      return { ok: true, rawText: nextRawText, raw: nextRawText, updatedAt: nowIso };
    }

    // Memory / Node file mode with CAS check
    if (typeof getMemoryPortfolios === "function") {
      const currentRaw = JSON.stringify(getMemoryPortfolios() || {});
      if (expectedRawText !== null && expectedRawText !== undefined && currentRaw !== expectedRawText) {
        return { ok: false, casConflict: true };
      }
    }
    if (typeof setMemoryPortfolios === "function") {
      setMemoryPortfolios(deepClone(nextStore));
    }
    return { ok: true, rawText: nextRawText, raw: nextRawText, updatedAt: nowIso };
  }

  async function readbackPortfoliosSnapshot() {
    if (fi && typeof fi.onReadbackPortfolios === "function") {
      await fi.onReadbackPortfolios();
    }
    const snap = await readPortfoliosSnapshot();
    if (fi && fi.corruptReadback && snap && snap.store) {
      const corrupted = deepClone(snap.store);
      for (const prof of Object.values(corrupted)) {
        for (const p of prof?.portfolios || []) {
          for (const h of p?.holdings || []) {
            h.memo = "__CORRUPTED_READBACK__";
          }
        }
      }
      return {
        ...snap,
        store: corrupted
      };
    }
    return snap;
  }

  function rowToDraft(row) {
    if (!row) return null;
    let audit = {};
    try {
      audit = row.audit_json ? JSON.parse(row.audit_json) : {};
    } catch (_) {
      audit = {};
    }
    return {
      draftId: row.draft_id,
      accountId: row.account_id,
      accountMask: row.account_mask,
      portfolioId: row.portfolio_id,
      symbol: row.symbol,
      expectedMemo: row.expected_memo,
      expectedRevision: Number(row.expected_revision ?? 0),
      proposedMemo: row.proposed_memo,
      analysisSummary: row.analysis_summary || "",
      version: Number(row.version) || 1,
      status: row.status,
      idempotencyKey: row.idempotency_key || null,
      requestedBy: row.requested_by || "hermes",
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      decidedAt: row.decided_at || null,
      actorDiscordUserId: row.actor_discord_user_id || null,
      interactionId: row.interaction_id || null,
      decisionIdempotencyKey: row.decision_idempotency_key || null,
      supersededByDraftId: row.superseded_by_draft_id || null,
      discordChannelId: row.discord_channel_id || null,
      discordMessageId: row.discord_message_id || null,
      readbackVerified: Boolean(row.readback_verified),
      readbackHash: row.readback_hash || null,
      audit
    };
  }

  async function getDraftById(draftId) {
    if (fi && typeof fi.onReadDraft === "function") {
      await fi.onReadDraft(draftId);
    }
    if (hasD1) {
      await ensureTables();
      const row = await env.DB.prepare("SELECT * FROM webmemo_drafts WHERE draft_id = ?")
        .bind(String(draftId))
        .first();
      return rowToDraft(row);
    }
    const found = readMemDraftsList().find((d) => d && d.draftId === draftId);
    return found ? deepClone(found) : null;
  }

  async function findDraftByIdempotencyKey(accountId, idempotencyKey) {
    if (!idempotencyKey) return null;
    if (hasD1) {
      await ensureTables();
      const row = await env.DB.prepare(
        "SELECT * FROM webmemo_drafts WHERE account_id = ? AND idempotency_key = ? ORDER BY created_at DESC LIMIT 1"
      )
        .bind(String(accountId), String(idempotencyKey))
        .first();
      return rowToDraft(row);
    }
    const list = readMemDraftsList().filter(
      (d) => d && d.accountId === accountId && d.idempotencyKey === idempotencyKey
    );
    return list.length > 0 ? deepClone(list[list.length - 1]) : null;
  }

  async function saveDraft(draft) {
    if (fi && typeof fi.onSaveDraft === "function") {
      await fi.onSaveDraft(draft);
    }
    if (hasD1) {
      await ensureTables();
      await env.DB.prepare(
        `INSERT INTO webmemo_drafts (
          draft_id, account_id, account_mask, portfolio_id, symbol,
          expected_memo, expected_revision, proposed_memo, analysis_summary,
          version, status, idempotency_key, requested_by, created_at, expires_at,
          decided_at, actor_discord_user_id, interaction_id, decision_idempotency_key,
          superseded_by_draft_id, discord_channel_id, discord_message_id,
          readback_verified, readback_hash, audit_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(draft_id) DO UPDATE SET
          status = excluded.status,
          decided_at = excluded.decided_at,
          actor_discord_user_id = excluded.actor_discord_user_id,
          interaction_id = excluded.interaction_id,
          decision_idempotency_key = excluded.decision_idempotency_key,
          superseded_by_draft_id = excluded.superseded_by_draft_id,
          discord_channel_id = excluded.discord_channel_id,
          discord_message_id = excluded.discord_message_id,
          readback_verified = excluded.readback_verified,
          readback_hash = excluded.readback_hash,
          audit_json = excluded.audit_json`
      )
        .bind(
          draft.draftId,
          draft.accountId,
          draft.accountMask,
          draft.portfolioId,
          draft.symbol,
          draft.expectedMemo,
          Number(draft.expectedRevision ?? 0),
          draft.proposedMemo,
          draft.analysisSummary || "",
          Number(draft.version) || 1,
          draft.status,
          draft.idempotencyKey || null,
          draft.requestedBy || "hermes",
          draft.createdAt,
          draft.expiresAt,
          draft.decidedAt || null,
          draft.actorDiscordUserId || null,
          draft.interactionId || null,
          draft.decisionIdempotencyKey || null,
          draft.supersededByDraftId || null,
          draft.discordChannelId || null,
          draft.discordMessageId || null,
          draft.readbackVerified ? 1 : 0,
          draft.readbackHash || null,
          JSON.stringify(draft.audit || {})
        )
        .run();
      return deepClone(draft);
    }

    const cloned = deepClone(draft);
    writeMemDraft(cloned);
    return deepClone(cloned);
  }

  async function listDrafts({ accountId, status, symbol, limit = 25 } = {}) {
    if (hasD1) {
      await ensureTables();
      let sql = "SELECT * FROM webmemo_drafts WHERE account_id = ?";
      const params = [String(accountId)];
      if (status) {
        sql += " AND status = ?";
        params.push(String(status));
      }
      if (symbol) {
        sql += " AND symbol = ?";
        params.push(String(symbol).trim().toUpperCase());
      }
      sql += " ORDER BY created_at DESC LIMIT ?";
      params.push(Math.max(1, Math.min(100, Number(limit) || 25)));
      const res = await env.DB.prepare(sql).bind(...params).all();
      const rows = Array.isArray(res?.results) ? res.results : [];
      return rows.map(rowToDraft);
    }
    let items = readMemDraftsList().filter((d) => d && (!accountId || d.accountId === accountId));
    if (status) items = items.filter((d) => d.status === status);
    if (symbol) items = items.filter((d) => d.symbol === String(symbol).trim().toUpperCase());
    items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return items.slice(0, Math.max(1, Math.min(100, Number(limit) || 25))).map(deepClone);
  }

  return {
    hasD1,
    ensureTables,
    readPortfoliosSnapshot,
    casWritePortfoliosSnapshot,
    readbackPortfoliosSnapshot,
    getDraftById,
    findDraftByIdempotencyKey,
    saveDraft,
    listDrafts
  };
}

/**
 * Resolves integration configuration from Cloudflare Worker `env` or Node `process.env`.
 */
function resolveIntegrationConfig(env = {}) {
  const procEnv = typeof process !== "undefined" && process.env ? process.env : {};
  const rawEnabled =
    env?.WEBMEMO_INTEGRATION_ENABLED ?? procEnv.WEBMEMO_INTEGRATION_ENABLED ?? "false";
  const enabled = ["1", "true", "yes", "on"].includes(String(rawEnabled).trim().toLowerCase());

  const token = String(
    env?.WEBMEMO_INTEGRATION_TOKEN ?? procEnv.WEBMEMO_INTEGRATION_TOKEN ?? ""
  ).trim();

  const allowedAccountKey = String(
    env?.WEBMEMO_ALLOWED_ACCOUNT_KEY ?? procEnv.WEBMEMO_ALLOWED_ACCOUNT_KEY ?? ""
  )
    .trim()
    .toUpperCase();

  const allowedAccountId = String(
    env?.WEBMEMO_ALLOWED_ACCOUNT_ID ?? procEnv.WEBMEMO_ALLOWED_ACCOUNT_ID ?? "owner"
  ).trim();

  const rawDiscordUsers = String(
    env?.WEBMEMO_ALLOWED_DISCORD_USER_IDS ??
      procEnv.WEBMEMO_ALLOWED_DISCORD_USER_IDS ??
      "932083816485519411,714126273964736522"
  ).trim();
  const allowedDiscordUserIds = new Set(
    rawDiscordUsers
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );

  return {
    enabled,
    token,
    allowedAccountKey,
    allowedAccountId,
    allowedAccountMask: maskSyncKey(allowedAccountKey),
    derivedAccountId: deriveAccountId(allowedAccountKey),
    allowedDiscordUserIds
  };
}

/**
 * Validates the Bearer token and account scope.
 * Never accepts a raw Sync Key as an integration credential.
 */
function verifyIntegrationAuth(reqHeaders, cfg, store = {}) {
  if (!cfg.enabled) {
    return {
      ok: false,
      status: 503,
      code: "INTEGRATION_DISABLED",
      error: "WebMemo integration is currently disabled."
    };
  }
  if (!cfg.token || !cfg.allowedAccountKey) {
    return {
      ok: false,
      status: 503,
      code: "INTEGRATION_MISCONFIGURED",
      error: "WebMemo integration credentials or target account are not configured."
    };
  }

  const authHeader = String(reqHeaders?.["authorization"] || reqHeaders?.["Authorization"] || "").trim();
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return {
      ok: false,
      status: 401,
      code: "INVALID_INTEGRATION_TOKEN",
      error: "Authorization: Bearer <WEBMEMO_INTEGRATION_TOKEN> header is required."
    };
  }

  const providedToken = authHeader.slice(7).trim();
  if (!providedToken) {
    return {
      ok: false,
      status: 401,
      code: "INVALID_INTEGRATION_TOKEN",
      error: "Bearer token is empty."
    };
  }

  // Explicitly forbid using any Sync Key as the bearer token
  const upperToken = providedToken.toUpperCase();
  if (upperToken === cfg.allowedAccountKey || (store && store[upperToken])) {
    return {
      ok: false,
      status: 403,
      code: "SYNC_KEY_AS_TOKEN_FORBIDDEN",
      error: "Sync Key cannot be used as an integration authentication token."
    };
  }

  if (!constantTimeEquals(providedToken, cfg.token)) {
    return {
      ok: false,
      status: 401,
      code: "INVALID_INTEGRATION_TOKEN",
      error: "Invalid integration bearer token."
    };
  }

  return { ok: true };
}

/**
 * Verifies that the caller's requested accountId matches the single allowed owner account
 * and rejects any attempt to pass raw Sync Keys or access other accounts.
 */
function verifyAccountScope(requestedAccountId, rawPayload = {}, cfg = {}, store = {}) {
  if (rawPayload && (rawPayload.syncKey !== undefined || rawPayload.key !== undefined)) {
    return {
      ok: false,
      status: 403,
      code: "ACCOUNT_SCOPE_FORBIDDEN",
      error: "Passing raw syncKey is forbidden on integration endpoints; use scoped accountId."
    };
  }

  const candidate = String(requestedAccountId || cfg.allowedAccountId || "owner").trim();
  const validIds = new Set([
    cfg.allowedAccountId,
    "owner",
    cfg.allowedAccountMask,
    cfg.derivedAccountId
  ]);

  // Explicitly reject if caller passes the raw Sync Key or another account's key/ID
  if (
    candidate.toUpperCase() === cfg.allowedAccountKey ||
    (store && store[candidate.toUpperCase()] && !validIds.has(candidate))
  ) {
    return {
      ok: false,
      status: 403,
      code: "ACCOUNT_SCOPE_FORBIDDEN",
      error: "Raw Sync Key or non-scoped account key is not permitted."
    };
  }

  if (!validIds.has(candidate)) {
    return {
      ok: false,
      status: 403,
      code: "ACCOUNT_SCOPE_FORBIDDEN",
      error: `Account '${candidate}' is not authorized for this integration.`
    };
  }

  return {
    ok: true,
    accountKey: cfg.allowedAccountKey,
    accountId: cfg.allowedAccountId || "owner",
    accountMask: cfg.allowedAccountMask
  };
}

/**
 * Handles all `/api/integration/*` requests across both Cloudflare Worker and Node.js server.
 */
async function handleIntegrationRequest({
  method,
  pathname,
  query = {},
  headers = {},
  body = {},
  env = {},
  adapter = null,
  store = null,
  nowFn = () => Date.now()
}) {
  const storeAdapter = adapter || store;
  const cfg = resolveIntegrationConfig(env);
  const nowMs = nowFn();
  const nowIso = new Date(nowMs).toISOString();

  let snapshot;
  try {
    snapshot = await storeAdapter.readPortfoliosSnapshot();
  } catch (err) {
    return {
      status: 503,
      body: {
        ok: false,
        code: "PORTFOLIO_READ_FAILED",
        error: `Failed to read portfolio store: ${err.message}`
      }
    };
  }

  const authCheck = verifyIntegrationAuth(headers, cfg, snapshot.store);
  if (!authCheck.ok) {
    return {
      status: authCheck.status,
      body: {
        ok: false,
        code: authCheck.code,
        error: authCheck.error
      }
    };
  }

  const requestedAccountId =
    body?.account ?? body?.accountId ?? query?.account ?? query?.accountId ?? cfg.allowedAccountId;
  const scopeCheck = verifyAccountScope(requestedAccountId, { ...query, ...body }, cfg, snapshot.store);
  if (!scopeCheck.ok) {
    return {
      status: scopeCheck.status,
      body: {
        ok: false,
        code: scopeCheck.code,
        error: scopeCheck.error
      }
    };
  }

  const { accountKey, accountId, accountMask } = scopeCheck;
  const profile = snapshot.store?.[accountKey];
  if (!profile) {
    return {
      status: 404,
      body: {
        ok: false,
        code: "ACCOUNT_NOT_FOUND",
        error: `Configured owner account (${accountMask}) does not exist in portfolio store.`
      }
    };
  }

  // 1. GET /api/integration/status (Read-only preflight check)
  if (pathname === "/api/integration/status" && method === "GET") {
    const view = buildSanitizedAccountView(profile, accountKey);
    let pendingDraftCount = 0;
    try {
      const pending = await storeAdapter.listDrafts({ accountId, status: "PENDING" });
      pendingDraftCount = pending.length;
    } catch (_) {
      pendingDraftCount = 0;
    }
    return {
      status: 200,
      body: {
        ok: true,
        integration: "moatwatch-hermes-webmemo",
        mode: "SCOPED_MEMO_ONLY",
        maxMemoChars: MAX_WEBMEMO_CHARS,
        draftTtlHours: 24,
        d1Backed: Boolean(storeAdapter.hasD1),
        allowedDiscordUsersCount: cfg.allowedDiscordUserIds.size,
        allowedDiscordUserIds: Array.from(cfg.allowedDiscordUserIds),
        accountId,
        accountMask: view.accountMask,
        accountMasked: view.accountMasked,
        pendingDraftCount,
        account: {
          accountId,
          accountMask: view.accountMask,
          accountMasked: view.accountMasked,
          derivedAccountId: view.derivedAccountId,
          updatedAt: view.updatedAt,
          portfoliosCount: view.portfoliosCount,
          holdingCount: view.holdingCount,
          watchlistCount: view.watchlistCount,
          duplicateSymbolPortfolios: view.duplicateSymbolPortfolios,
          portfolios: view.portfolios.map((p) => ({
            id: p.id,
            name: p.name,
            currency: p.currency,
            heldCount: p.heldCount,
            watchlistCount: p.watchlistCount,
            totalSymbols: p.holdings.length
          }))
        }
      }
    };
  }

  // 2. GET /api/integration/account (Read full account portfolios + watchlist + memos)
  if (pathname === "/api/integration/account" && method === "GET") {
    const view = buildSanitizedAccountView(profile, accountKey);
    const filterPortfolioId = query.portfolioId ? String(query.portfolioId).trim() : "";
    const filterRole = query.role ? String(query.role).trim().toUpperCase() : "";
    const filterSymbol = query.symbol ? String(query.symbol).trim().toUpperCase() : "";

    let portfolios = view.portfolios;
    if (filterPortfolioId) {
      portfolios = portfolios.filter((p) => String(p.id) === filterPortfolioId);
      if (portfolios.length === 0) {
        return {
          status: 404,
          body: {
            ok: false,
            code: "PORTFOLIO_NOT_FOUND",
            error: `Portfolio '${filterPortfolioId}' was not found.`
          }
        };
      }
    }
    if (filterRole === "HELD" || filterRole === "WATCHLIST" || filterSymbol) {
      portfolios = portfolios.map((p) => {
        const filteredHoldings = p.holdings.filter((h) => {
          if (filterRole === "HELD" || filterRole === "WATCHLIST") {
            if (h.role !== filterRole) return false;
          }
          if (filterSymbol && h.symbol !== filterSymbol) return false;
          return true;
        });
        return {
          ...p,
          heldCount: filteredHoldings.filter((h) => h.role === "HELD").length,
          watchlistCount: filteredHoldings.filter((h) => h.role === "WATCHLIST").length,
          holdings: filteredHoldings
        };
      });
    }

    const totalHoldings = portfolios.reduce((acc, p) => acc + p.heldCount, 0);
    const totalWatchlist = portfolios.reduce((acc, p) => acc + p.watchlistCount, 0);

    return {
      status: 200,
      body: {
        ok: true,
        ...view,
        accountId,
        holdingCount: totalHoldings,
        watchlistCount: totalWatchlist,
        portfolios
      }
    };
  }

  // 3. GET /api/integration/memo (Read single holding memo + revision + hash)
  if (pathname === "/api/integration/memo" && method === "GET") {
    const found = findTargetHolding(profile, {
      portfolioId: query.portfolioId,
      symbol: query.symbol
    });
    if (!found.ok) {
      return {
        status: found.status,
        body: {
          ok: false,
          code: found.code,
          error: found.error,
          ...(found.matchingPortfolios
            ? {
                matchingPortfolios: found.matchingPortfolios,
                candidatePortfolios: found.matchingPortfolios
              }
            : {})
        }
      };
    }
    const h = found.holding;
    const currentMemo = String(h.memo || "");
    const memoRevision = Number(h.memoRevision ?? 0);
    return {
      status: 200,
      body: {
        ok: true,
        accountId,
        accountMask,
        accountMasked: accountMask,
        portfolioId: found.portfolioId,
        portfolioName: found.portfolioName,
        symbol: found.symbol,
        role: Number(h.shares || 0) > 0 ? "HELD" : "WATCHLIST",
        shares: Number(h.shares || 0),
        memo: currentMemo,
        memoRevision,
        memoUpdatedAt: h.memoUpdatedAt || null,
        memoSource: h.memoSource || null,
        memoHash: computeContentHash(currentMemo)
      }
    };
  }

  // 4. POST /api/integration/drafts (Create 24h approval draft)
  if (pathname === "/api/integration/drafts" && method === "POST") {
    try {
      const idempotencyKey = body.idempotencyKey ? String(body.idempotencyKey).trim() : "";
      if (idempotencyKey) {
        const existingDraft = await storeAdapter.findDraftByIdempotencyKey(accountId, idempotencyKey);
        if (existingDraft) {
          if (
            existingDraft.portfolioId !== String(body.portfolioId || existingDraft.portfolioId).trim() ||
            existingDraft.symbol !== String(body.symbol || "").trim().toUpperCase() ||
            existingDraft.proposedMemo !== String(body.proposedMemo || "").trim()
          ) {
            return {
              status: 409,
              body: {
                ok: false,
                code: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH",
                error: "idempotencyKey was already used with a different draft payload."
              }
            };
          }
          return {
            status: 200,
            body: {
              ok: true,
              idempotentReplay: true,
              draft: serializeDraftRecord(existingDraft)
            }
          };
        }
      }

      const validMemo = validateProposedMemo(body.proposedMemo);
      if (!validMemo.ok) {
        return {
          status: validMemo.status,
          body: {
            ok: false,
            code: validMemo.code,
            error: validMemo.error,
            ...(validMemo.maxLength ? { maxLength: validMemo.maxLength } : {})
          }
        };
      }

      const found = findTargetHolding(profile, {
        portfolioId: body.portfolioId,
        symbol: body.symbol
      });
      if (!found.ok) {
        return {
          status: found.status,
          body: {
            ok: false,
            code: found.code,
            error: found.error,
            ...(found.matchingPortfolios
              ? {
                  matchingPortfolios: found.matchingPortfolios,
                  candidatePortfolios: found.matchingPortfolios
                }
              : {})
          }
        };
      }

      const currentMemo = String(found.holding.memo || "");
      const currentRevision = Number(found.holding.memoRevision ?? 0);

      if (body.expectedMemo !== undefined && body.expectedMemo !== null && String(body.expectedMemo) !== currentMemo) {
        return {
          status: 409,
          body: {
            ok: false,
            code: "STALE_MEMO_CONFLICT",
            error: `Holding memo for ${found.symbol} changed before draft creation.`,
            currentMemo,
            currentRevision,
            currentServerMemo: currentMemo,
            currentServerMemoRevision: currentRevision
          }
        };
      }
      if (
        body.expectedRevision !== undefined &&
        body.expectedRevision !== null &&
        Number(body.expectedRevision) !== currentRevision
      ) {
        return {
          status: 409,
          body: {
            ok: false,
            code: "STALE_MEMO_CONFLICT",
            error: `Holding memoRevision for ${found.symbol} changed before draft creation.`,
            currentMemo,
            currentRevision,
            currentServerMemo: currentMemo,
            currentServerMemoRevision: currentRevision
          }
        };
      }

      const draftId = generateDraftId(nowMs);
      const expiresAt = new Date(nowMs + DEFAULT_DRAFT_TTL_MS).toISOString();
      const draftRecord = {
        draftId,
        accountId,
        accountMask,
        portfolioId: found.portfolioId,
        symbol: found.symbol,
        expectedMemo: currentMemo,
        expectedRevision: currentRevision,
        proposedMemo: validMemo.memo,
        analysisSummary: String(body.analysisSummary || "").slice(0, 1500),
        version: 1,
        status: "PENDING",
        idempotencyKey: idempotencyKey || null,
        requestedBy: String(body.requestedBy || "hermes").slice(0, 80),
        createdAt: nowIso,
        expiresAt,
        decidedAt: null,
        actorDiscordUserId: null,
        interactionId: null,
        decisionIdempotencyKey: null,
        supersededByDraftId: null,
        discordChannelId: body.discordChannelId ? String(body.discordChannelId) : null,
        discordMessageId: body.discordMessageId ? String(body.discordMessageId) : null,
        readbackVerified: false,
        readbackHash: null,
        audit: {
          createdAt: nowIso,
          expectedMemoHash: computeContentHash(currentMemo),
          proposedMemoHash: computeContentHash(validMemo.memo),
          events: [
            {
              type: "DRAFT_CREATED",
              at: nowIso,
              requestedBy: String(body.requestedBy || "hermes").slice(0, 80)
            }
          ]
        }
      };

      const saved = await storeAdapter.saveDraft(draftRecord);
      return {
        status: 201,
        body: {
          ok: true,
          idempotentReplay: false,
          draft: serializeDraftRecord(saved)
        }
      };
    } catch (err) {
      return {
        status: 503,
        body: {
          ok: false,
          code: "STORAGE_UNAVAILABLE",
          error: `Failed to persist draft: ${err.message}`
        }
      };
    }
  }

  // 5. GET /api/integration/drafts (List drafts)
  if (pathname === "/api/integration/drafts" && method === "GET") {
    try {
      const drafts = await storeAdapter.listDrafts({
        accountId,
        status: query.status,
        symbol: query.symbol,
        limit: query.limit
      });
      return {
        status: 200,
        body: {
          ok: true,
          count: drafts.length,
          drafts: drafts.map(serializeDraftRecord)
        }
      };
    } catch (err) {
      return {
        status: 503,
        body: {
          ok: false,
          code: "STORAGE_UNAVAILABLE",
          error: `Failed to list drafts: ${err.message}`
        }
      };
    }
  }

  // Match /api/integration/drafts/:draftId(/...)
  const draftRouteMatch = pathname.match(/^\/api\/integration\/drafts\/([^\/]+)(?:\/(discord-message|decision|approve|reject))?$/);
  if (draftRouteMatch) {
    const draftId = decodeURIComponent(draftRouteMatch[1]);
    const subAction = draftRouteMatch[2] || "";

    let draft;
    try {
      draft = await storeAdapter.getDraftById(draftId);
    } catch (err) {
      return {
        status: 503,
        body: {
          ok: false,
          code: "STORAGE_UNAVAILABLE",
          error: `Failed to load draft '${draftId}': ${err.message}`
        }
      };
    }

    if (!draft || draft.accountId !== accountId) {
      return {
        status: 404,
        body: {
          ok: false,
          code: "DRAFT_NOT_FOUND",
          error: `Draft '${draftId}' was not found.`
        }
      };
    }

    // Auto-expire check if still PENDING and past 24h TTL
    const isPending = draft.status === "PENDING" || draft.status === "PENDING_APPROVAL";
    const isExpiredByClock = isPending && nowMs > Date.parse(draft.expiresAt);

    // 5B. GET /api/integration/drafts/:draftId
    if (!subAction && method === "GET") {
      if (isExpiredByClock) {
        draft.status = "EXPIRED";
        draft.decidedAt = nowIso;
        draft.audit.events = [...(draft.audit.events || []), { type: "DRAFT_EXPIRED", at: nowIso }];
        await storeAdapter.saveDraft(draft).catch(() => {});
      }
      return {
        status: 200,
        body: {
          ok: true,
          draft: serializeDraftRecord(draft)
        }
      };
    }

    // 5C. PATCH /api/integration/drafts/:draftId/discord-message
    if (subAction === "discord-message" && (method === "PATCH" || method === "POST")) {
      draft.discordChannelId = body.discordChannelId ? String(body.discordChannelId) : draft.discordChannelId;
      draft.discordMessageId = body.discordMessageId ? String(body.discordMessageId) : draft.discordMessageId;
      draft.audit.events = [
        ...(draft.audit.events || []),
        {
          type: "DISCORD_MESSAGE_BOUND",
          at: nowIso,
          discordChannelId: draft.discordChannelId,
          discordMessageId: draft.discordMessageId
        }
      ];
      try {
        const saved = await storeAdapter.saveDraft(draft);
        return {
          status: 200,
          body: {
            ok: true,
            draft: serializeDraftRecord(saved)
          }
        };
      } catch (err) {
        return {
          status: 503,
          body: {
            ok: false,
            code: "STORAGE_UNAVAILABLE",
            error: `Failed to bind Discord message metadata: ${err.message}`
          }
        };
      }
    }

    // 6. POST /api/integration/drafts/:draftId/decision (or /approve, /reject)
    if ((subAction === "decision" || subAction === "approve" || subAction === "reject") && method === "POST") {
      const rawAction =
        subAction === "approve"
          ? "APPROVE"
          : subAction === "reject"
          ? "REJECT"
          : String(body.action || "").trim().toUpperCase();

      if (rawAction !== "APPROVE" && rawAction !== "REJECT") {
        return {
          status: 400,
          body: {
            ok: false,
            code: "INVALID_DECISION_ACTION",
            error: "action must be 'APPROVE' or 'REJECT'."
          }
        };
      }

      const actorDiscordUserId = String(body.actorDiscordUserId || "").trim();
      if (!actorDiscordUserId || !cfg.allowedDiscordUserIds.has(actorDiscordUserId)) {
        draft.audit.events = [
          ...(draft.audit.events || []),
          {
            type: "UNAUTHORIZED_DECISION_ATTEMPT",
            at: nowIso,
            actorDiscordUserId: actorDiscordUserId || "missing",
            action: rawAction
          }
        ];
        await storeAdapter.saveDraft(draft).catch(() => {});
        return {
          status: 403,
          body: {
            ok: false,
            code: "UNAUTHORIZED_DISCORD_USER",
            error: "Discord user is not authorized to approve or reject WebMemo drafts."
          }
        };
      }

      const providedVersion = body.expectedVersion ?? body.version;
      if (
        providedVersion !== undefined &&
        providedVersion !== null &&
        Number(providedVersion) !== Number(draft.version)
      ) {
        return {
          status: 409,
          body: {
            ok: false,
            code: "DRAFT_VERSION_MISMATCH",
            error: `Draft version mismatch (button version ${providedVersion}, draft version ${draft.version}).`
          }
        };
      }

      // Replay / double-click check
      if (draft.status === "APPROVED" || draft.status === "PUBLISHED" || draft.status === "REJECTED") {
        return {
          status: 409,
          body: {
            ok: false,
            code: "DRAFT_ALREADY_DECIDED",
            alreadyDecided: true,
            error: `Draft '${draft.draftId}' was already ${draft.status} at ${draft.decidedAt}.`,
            draft: serializeDraftRecord(draft)
          }
        };
      }

      if (draft.status === "CONFLICT" || draft.status === "CONFLICT_SUPERSEDED") {
        return {
          status: 409,
          body: {
            ok: false,
            code: "DRAFT_SUPERSEDED",
            error: `Draft '${draft.draftId}' was superseded by '${draft.supersededByDraftId}'.`,
            draft: serializeDraftRecord(draft)
          }
        };
      }

      if (draft.status === "EXPIRED" || isExpiredByClock) {
        draft.status = "EXPIRED";
        draft.decidedAt = draft.decidedAt || nowIso;
        draft.audit.events = [...(draft.audit.events || []), { type: "DRAFT_EXPIRED", at: nowIso }];
        await storeAdapter.saveDraft(draft).catch(() => {});
        return {
          status: 410,
          body: {
            ok: false,
            code: "DRAFT_EXPIRED",
            error: `Draft '${draft.draftId}' expired after 24 hours (${draft.expiresAt}).`,
            draft: serializeDraftRecord(draft)
          }
        };
      }

      // Handle REJECT
      if (rawAction === "REJECT") {
        draft.status = "REJECTED";
        draft.decidedAt = nowIso;
        draft.actorDiscordUserId = actorDiscordUserId;
        draft.interactionId = body.interactionId ? String(body.interactionId) : null;
        draft.decisionIdempotencyKey = body.idempotencyKey ? String(body.idempotencyKey) : null;
        draft.audit.events = [
          ...(draft.audit.events || []),
          {
            type: "DRAFT_REJECTED",
            at: nowIso,
            actorDiscordUserId,
            interactionId: draft.interactionId
          }
        ];
        try {
          const saved = await storeAdapter.saveDraft(draft);
          return {
            status: 200,
            body: {
              ok: true,
              decision: "REJECTED",
              draft: serializeDraftRecord(saved)
            }
          };
        } catch (err) {
          return {
            status: 503,
            body: {
              ok: false,
              code: "STORAGE_UNAVAILABLE",
              error: `Failed to record rejection: ${err.message}`
            }
          };
        }
      }

      // Handle APPROVE with Compare-And-Swap + Retry on non-conflicting store changes + Readback Verification
      try {
        let casSuccess = false;
        let patchResult = null;
        let beforeStoreSnapshot = null;

        for (let attempt = 1; attempt <= 3; attempt++) {
          const latestSnapshot = attempt === 1 ? snapshot : await storeAdapter.readPortfoliosSnapshot();
          beforeStoreSnapshot = latestSnapshot.store;

          patchResult = applyScopedMemoPatch(latestSnapshot.store, {
            accountKey,
            portfolioId: draft.portfolioId,
            symbol: draft.symbol,
            expectedMemo: draft.expectedMemo,
            expectedRevision: draft.expectedRevision,
            proposedMemo: draft.proposedMemo,
            draftId: draft.draftId,
            nowIso
          });

          if (!patchResult.ok) {
            // If holding's memo changed since draft creation, mark superseded and create replacement draft!
            if (patchResult.code === "STALE_MEMO_CONFLICT") {
              const replacementDraftId = generateDraftId(nowMs + 1);
              const replacementExpiresAt = new Date(nowMs + DEFAULT_DRAFT_TTL_MS).toISOString();
              const replacementRecord = {
                draftId: replacementDraftId,
                accountId,
                accountMask,
                portfolioId: draft.portfolioId,
                symbol: draft.symbol,
                expectedMemo: patchResult.currentMemo,
                expectedRevision: patchResult.currentRevision,
                proposedMemo: draft.proposedMemo,
                analysisSummary: draft.analysisSummary || "",
                version: 1,
                status: "PENDING",
                idempotencyKey: null,
                requestedBy: draft.requestedBy || "hermes",
                createdAt: nowIso,
                expiresAt: replacementExpiresAt,
                decidedAt: null,
                actorDiscordUserId: null,
                interactionId: null,
                decisionIdempotencyKey: null,
                supersededByDraftId: null,
                discordChannelId: draft.discordChannelId || null,
                discordMessageId: null,
                readbackVerified: false,
                readbackHash: null,
                audit: {
                  createdAt: nowIso,
                  supersedesDraftId: draft.draftId,
                  expectedMemoHash: computeContentHash(patchResult.currentMemo),
                  proposedMemoHash: computeContentHash(draft.proposedMemo),
                  events: [
                    {
                      type: "REPLACEMENT_DRAFT_CREATED_ON_CONFLICT",
                      at: nowIso,
                      previousDraftId: draft.draftId,
                      currentMemoAtConflict: patchResult.currentMemo,
                      currentRevisionAtConflict: patchResult.currentRevision
                    }
                  ]
                }
              };

              draft.status = "CONFLICT";
              draft.decidedAt = nowIso;
              draft.actorDiscordUserId = actorDiscordUserId;
              draft.interactionId = body.interactionId ? String(body.interactionId) : null;
              draft.supersededByDraftId = replacementDraftId;
              draft.audit.events = [
                ...(draft.audit.events || []),
                {
                  type: "STALE_MEMO_CONFLICT_DETECTED",
                  at: nowIso,
                  actorDiscordUserId,
                  expectedMemo: draft.expectedMemo,
                  expectedRevision: draft.expectedRevision,
                  actualMemo: patchResult.currentMemo,
                  actualRevision: patchResult.currentRevision,
                  replacementDraftId
                }
              ];

              await storeAdapter.saveDraft(draft);
              const savedReplacement = await storeAdapter.saveDraft(replacementRecord);

              return {
                status: 409,
                body: {
                  ok: false,
                  code: "STALE_MEMO_CONFLICT",
                  conflict: true,
                  error: patchResult.error,
                  currentMemo: patchResult.currentMemo,
                  currentRevision: patchResult.currentRevision,
                  currentServerMemo: patchResult.currentMemo,
                  currentServerMemoRevision: patchResult.currentRevision,
                  supersededDraft: serializeDraftRecord(draft),
                  replacementDraft: serializeDraftRecord(savedReplacement)
                }
              };
            }

            return {
              status: patchResult.status || 400,
              body: {
                ok: false,
                code: patchResult.code || "PATCH_FAILED",
                error: patchResult.error
              }
            };
          }

          const writeRes = await storeAdapter.casWritePortfoliosSnapshot(
            latestSnapshot.rawText,
            patchResult.nextStore,
            nowIso
          );
          if (writeRes.ok) {
            casSuccess = true;
            break;
          }
        }

        if (!casSuccess) {
          return {
            status: 409,
            body: {
              ok: false,
              code: "CONCURRENT_STORE_CONTENTION",
              error: "Concurrent portfolio writes prevented atomic CAS commit; please retry approval."
            }
          };
        }

        // Mandatory Readback Verification from persistent storage
        const readbackSnap = await storeAdapter.readbackPortfoliosSnapshot();
        const readbackProfile = readbackSnap.store?.[accountKey];
        const readbackFound = findTargetHolding(readbackProfile, {
          portfolioId: draft.portfolioId,
          symbol: draft.symbol
        });

        if (!readbackFound.ok || readbackFound.holding.memo !== draft.proposedMemo) {
          return {
            status: 500,
            body: {
              ok: false,
              code: "READBACK_VERIFICATION_FAILED",
              error: "Storage readback did not match the approved WebMemo; refusing to report publish success."
            }
          };
        }

        // Verify structural invariant between pre-patch snapshot and readback snapshot
        assertOnlyTargetMemoChanged(beforeStoreSnapshot, readbackSnap.store, {
          accountKey,
          portfolioId: draft.portfolioId,
          symbol: draft.symbol,
          expectedNewMemo: draft.proposedMemo
        });

        const readbackHash = computeContentHash(
          `${draft.portfolioId}:${draft.symbol}:${readbackFound.holding.memo}:${readbackFound.holding.memoRevision}`
        );

        draft.status = "APPROVED";
        draft.decidedAt = nowIso;
        draft.actorDiscordUserId = actorDiscordUserId;
        draft.interactionId = body.interactionId ? String(body.interactionId) : null;
        draft.decisionIdempotencyKey = body.idempotencyKey ? String(body.idempotencyKey) : null;
        draft.readbackVerified = true;
        draft.readbackHash = readbackHash;
        draft.audit.events = [
          ...(draft.audit.events || []),
          {
            type: "DRAFT_APPROVED_AND_PUBLISHED",
            at: nowIso,
            actorDiscordUserId,
            interactionId: draft.interactionId,
            previousMemo: patchResult.previousMemo,
            publishedMemo: patchResult.publishedMemo,
            memoRevision: patchResult.memoRevision,
            readbackHash
          }
        ];

        const savedDraft = await storeAdapter.saveDraft(draft);

        return {
          status: 200,
          body: {
            ok: true,
            decision: "APPROVED",
            draft: serializeDraftRecord(savedDraft),
            readback: {
              verified: true,
              accountId,
              accountMask,
              accountMasked: accountMask,
              portfolioId: draft.portfolioId,
              symbol: draft.symbol,
              previousMemo: patchResult.previousMemo,
              memo: readbackFound.holding.memo,
              memoRevision: Number(readbackFound.holding.memoRevision ?? patchResult.memoRevision),
              memoUpdatedAt: readbackFound.holding.memoUpdatedAt || nowIso,
              shares: Number(readbackFound.holding.shares || 0),
              avgCost: Number(readbackFound.holding.avgCost || 0),
              targetPrice: Number(readbackFound.holding.targetPrice || 0),
              stopPrice: Number(readbackFound.holding.stopPrice || 0),
              readbackHash,
              contentHash: readbackHash
            }
          }
        };
      } catch (err) {
        return {
          status: 503,
          body: {
            ok: false,
            code: "PUBLISH_OR_READBACK_ERROR",
            error: `Approval publish/readback failed: ${err.message}`
          }
        };
      }
    }
  }

  return {
    status: 404,
    body: {
      ok: false,
      code: "INTEGRATION_ROUTE_NOT_FOUND",
      error: `Integration route '${method} ${pathname}' not found.`
    }
  };
}

module.exports = {
  MAX_WEBMEMO_CHARS,
  DEFAULT_DRAFT_TTL_MS,
  maskSyncKey,
  deriveAccountId,
  computeContentHash,
  constantTimeEquals,
  validateProposedMemo,
  encodeDiscordButtonCustomId,
  parseDiscordButtonCustomId,
  findTargetHolding,
  assertOnlyTargetMemoChanged,
  applyScopedMemoPatch,
  reconcileWebPortfolioSave,
  buildSanitizedAccountView,
  serializeDraftRecord,
  createIntegrationStoreAdapter,
  resolveIntegrationConfig,
  verifyIntegrationAuth,
  verifyAccountScope,
  handleIntegrationRequest
};
