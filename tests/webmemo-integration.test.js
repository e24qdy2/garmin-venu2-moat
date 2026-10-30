#!/usr/bin/env node
/**
 * Contract & Integration Tests for MoatWatch <-> Hermes Agent + Discord WebMemo Approval
 * Tests both:
 *   1. Cloudflare Worker (`src/worker.js`) with simulated D1 (`env.DB`, `kv_store` + `webmemo_drafts`)
 *   2. Node HTTP Server (`server.js`)
 *   3. Edge cases: wrong account, Sync Key as token, ambiguous symbol across portfolios,
 *      stale memo CAS conflict + auto replacement draft, concurrent web UI save,
 *      unauthorized/expired/replayed approval, D1 read/write/readback failures,
 *      gateway restart recovery, Unicode <=140 chars, and strict financial field immutability.
 */

const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");
const {
  validateProposedMemo,
  encodeDiscordButtonCustomId,
  parseDiscordButtonCustomId,
  assertOnlyTargetMemoChanged,
  createIntegrationStoreAdapter,
  handleIntegrationRequest
} = require("../lib/webMemoIntegration");

/**
 * Simulated Cloudflare D1 binding (`env.DB`) supporting `kv_store` and `webmemo_drafts`
 * including SQL Compare-And-Swap (`WHERE key = 'portfolios' AND value = ?`).
 */
class MockD1Database {
  constructor(initialPortfoliosStore = {}) {
    this.kvStore = new Map();
    this.drafts = new Map();
    if (initialPortfoliosStore) {
      this.kvStore.set("portfolios", {
        key: "portfolios",
        value: JSON.stringify(initialPortfoliosStore),
        updated_at: new Date().toISOString()
      });
    }
  }

  prepare(sql) {
    const db = this;
    const normalizedSql = sql.replace(/\s+/g, " ").trim();
    return {
      _args: [],
      bind(...args) {
        this._args = args;
        return this;
      },
      async first() {
        if (normalizedSql.startsWith("SELECT value, updated_at FROM kv_store WHERE key = ?")) {
          const k = this._args[0];
          return db.kvStore.get(k) || null;
        }
        if (normalizedSql.startsWith("SELECT value FROM kv_store WHERE key = ?")) {
          const k = this._args[0];
          const row = db.kvStore.get(k);
          return row ? { value: row.value } : null;
        }
        if (normalizedSql.includes("FROM webmemo_drafts WHERE draft_id = ?")) {
          return db.drafts.get(this._args[0]) || null;
        }
        if (normalizedSql.includes("FROM webmemo_drafts WHERE account_id = ? AND idempotency_key = ?")) {
          const [accId, idemKey] = this._args;
          for (const row of db.drafts.values()) {
            if (row.account_id === accId && row.idempotency_key === idemKey) {
              return row;
            }
          }
          return null;
        }
        return null;
      },
      async all() {
        if (normalizedSql.includes("FROM webmemo_drafts WHERE account_id = ?")) {
          const accId = this._args[0];
          let idx = 1;
          let statusFilter = null;
          let symbolFilter = null;
          if (normalizedSql.includes("AND status = ?")) {
            statusFilter = this._args[idx++];
          }
          if (normalizedSql.includes("AND symbol = ?")) {
            symbolFilter = this._args[idx++];
          }
          const limit = Number(this._args[idx] || 50);
          const results = Array.from(db.drafts.values())
            .filter((r) => {
              if (r.account_id !== accId) return false;
              if (statusFilter && r.status !== statusFilter) return false;
              if (symbolFilter && r.symbol !== symbolFilter) return false;
              return true;
            })
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
            .slice(0, limit);
          return { results };
        }
        return { results: [] };
      },
      async run() {
        if (normalizedSql.startsWith("CREATE TABLE") || normalizedSql.startsWith("CREATE INDEX")) {
          return { meta: { changes: 0 } };
        }
        if (
          normalizedSql.startsWith(
            "UPDATE kv_store SET value = ?, updated_at = ? WHERE key = 'portfolios' AND value = ?"
          )
        ) {
          const [nextVal, updatedAt, expectedRaw] = this._args;
          const existing = db.kvStore.get("portfolios");
          if (!existing || existing.value !== expectedRaw) {
            return { meta: { changes: 0 } };
          }
          db.kvStore.set("portfolios", {
            key: "portfolios",
            value: nextVal,
            updated_at: updatedAt
          });
          return { meta: { changes: 1 } };
        }
        if (normalizedSql.startsWith("INSERT INTO kv_store (key, value, updated_at) VALUES")) {
          const [k, val, updatedAt] = this._args;
          if (normalizedSql.includes("ON CONFLICT(key) DO NOTHING") && db.kvStore.has(k)) {
            return { meta: { changes: 0 } };
          }
          db.kvStore.set(k, { key: k, value: val, updated_at: updatedAt });
          return { meta: { changes: 1 } };
        }
        if (normalizedSql.startsWith("INSERT INTO webmemo_drafts")) {
          const [
            draft_id,
            account_id,
            account_mask,
            portfolio_id,
            symbol,
            expected_memo,
            expected_revision,
            proposed_memo,
            analysis_summary,
            version,
            status,
            idempotency_key,
            requested_by,
            created_at,
            expires_at,
            decided_at,
            actor_discord_user_id,
            interaction_id,
            decision_idempotency_key,
            superseded_by_draft_id,
            discord_channel_id,
            discord_message_id,
            readback_verified,
            readback_hash,
            audit_json
          ] = this._args;
          db.drafts.set(draft_id, {
            draft_id,
            account_id,
            account_mask,
            portfolio_id,
            symbol,
            expected_memo,
            expected_revision,
            proposed_memo,
            analysis_summary,
            version,
            status,
            idempotency_key,
            requested_by,
            created_at,
            expires_at,
            decided_at,
            actor_discord_user_id,
            interaction_id,
            decision_idempotency_key,
            superseded_by_draft_id,
            discord_channel_id,
            discord_message_id,
            readback_verified,
            readback_hash,
            audit_json
          });
          return { meta: { changes: 1 } };
        }
        if (normalizedSql.startsWith("UPDATE webmemo_drafts SET")) {
          const [
            version,
            status,
            discord_channel_id,
            discord_message_id,
            decided_by_discord_user_id,
            decided_by_discord_tag,
            decided_at,
            published_at,
            conflict_reason,
            replaced_by_draft_id,
            readback_hash,
            draft_id,
            expectedStatus
          ] = this._args;
          const row = db.drafts.get(draft_id);
          if (!row) return { meta: { changes: 0 } };
          if (expectedStatus && row.status !== expectedStatus) {
            return { meta: { changes: 0 } };
          }
          Object.assign(row, {
            version,
            status,
            discord_channel_id,
            discord_message_id,
            decided_by_discord_user_id,
            decided_by_discord_tag,
            decided_at,
            published_at,
            conflict_reason,
            replaced_by_draft_id,
            readback_hash
          });
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      }
    };
  }
}

function createSamplePortfoliosStore() {
  return {
    "V2-TESTKEY81": {
      syncKey: "V2-TESTKEY81",
      baseCurrency: "USD",
      updatedAt: "2026-04-04T00:00:00.000Z",
      watchSettings: {
        autoSwipeEnabled: true,
        autoSwipeSec: 15,
        alwaysOnDisplay: false,
        sortByPctOrder: "ASC",
        sortByPctMetric: "DAY",
        deviceId: "V2-TESTKEY81",
        watchModel: "venu2",
        activationKey: "GMV2-XXXX-YYYY-ZZZZ"
      },
      portfolios: [
        {
          id: "us-moat",
          name: "US Core & AI Moat",
          currency: "USD",
          holdings: [
            {
              symbol: "SPCX",
              name: "SPCX",
              shares: 10,
              avgCost: 22.85,
              currency: "USD",
              targetPrice: 30,
              stopPrice: 18,
              alertDir: "ABOVE",
              earningsDate: "15/05/26",
              memo: "Core SPAC arbitrage"
            },
            {
              symbol: "NVDA",
              name: "NVIDIA Corp",
              shares: 0,
              avgCost: 0,
              currency: "USD",
              targetPrice: 155,
              stopPrice: 0,
              alertDir: "ABOVE",
              earningsDate: "28/05/26",
              memo: "Initial NVDA memo"
            },
            {
              symbol: "DUPL",
              name: "Duplicate Symbol Corp",
              shares: 0,
              avgCost: 0,
              currency: "USD",
              targetPrice: 0,
              stopPrice: 0,
              alertDir: "ABOVE",
              earningsDate: "",
              memo: "DUPL in us-moat"
            }
          ]
        },
        {
          id: "ai-satellite",
          name: "AI Satellite Watchlist",
          currency: "USD",
          holdings: [
            {
              symbol: "DUPL",
              name: "Duplicate Symbol Corp",
              shares: 5,
              avgCost: 100,
              currency: "USD",
              targetPrice: 140,
              stopPrice: 90,
              alertDir: "ABOVE",
              earningsDate: "",
              memo: "DUPL in ai-satellite"
            }
          ]
        }
      ]
    },
    "VENU2-88": {
      syncKey: "VENU2-88",
      baseCurrency: "THB",
      updatedAt: "2026-04-04T00:00:00.000Z",
      watchSettings: {
        autoSwipeEnabled: true,
        autoSwipeSec: 5,
        alwaysOnDisplay: false,
        sortByPctOrder: "ASC",
        sortByPctMetric: "DAY",
        deviceId: "V2-88VENU20",
        watchModel: "venu2",
        activationKey: ""
      },
      portfolios: [
        {
          id: "us-moat",
          name: "Demo US Moat",
          currency: "USD",
          holdings: [
            {
              symbol: "NVDA",
              name: "NVIDIA Corp",
              shares: 40,
              avgCost: 92.5,
              currency: "USD",
              targetPrice: 155,
              stopPrice: 0,
              alertDir: "ABOVE",
              earningsDate: "",
              memo: "Demo account memo"
            }
          ]
        }
      ]
    }
  };
}

async function runTests() {
  console.log("=== Running MoatWatch <-> Hermes WebMemo Integration Test Suite ===");
  let passed = 0;

  function ok(name) {
    passed += 1;
    console.log(`  [PASS] ${passed}. ${name}`);
  }

  // -------------------------------------------------------------------------
  // 1. Unicode <= 140 & Button Custom ID Unit Tests
  // -------------------------------------------------------------------------
  {
    const validThaiEmoji = "🚀 หุ้น NVDA กำไรโต +93% YoY | Blackwell AI Moat แข็งแกร่ง รอสะสมเมื่อย่อตัว < $135";
    const res1 = validateProposedMemo(validThaiEmoji);
    assert.strictEqual(res1.ok, true);

    const exact140 = "ก".repeat(140);
    assert.strictEqual(validateProposedMemo(exact140).ok, true);

    const tooLong141 = "ก".repeat(141);
    const resTooLong = validateProposedMemo(tooLong141);
    assert.strictEqual(resTooLong.ok, false);
    assert.strictEqual(resTooLong.code, "MEMO_TOO_LONG");

    const withNewline = "Line 1\nLine 2";
    const resCtrl = validateProposedMemo(withNewline);
    assert.strictEqual(resCtrl.ok, false);
    assert.strictEqual(resCtrl.code, "MEMO_CONTROL_CHARS_FORBIDDEN");

    const cid = encodeDiscordButtonCustomId("approve", "wm_12345_abcd", 2);
    assert.strictEqual(cid, "webmemo:approve:wm_12345_abcd:2");
    assert.deepStrictEqual(parseDiscordButtonCustomId(cid), {
      action: "approve",
      draftId: "wm_12345_abcd",
      version: 2
    });
    // Non-webmemo custom_ids must return null so Hermes built-in buttons are unaffected
    assert.strictEqual(parseDiscordButtonCustomId("exec_approve:cmd_99"), null);
    assert.strictEqual(parseDiscordButtonCustomId("other:btn:1"), null);
    ok("Unicode <=140 validation, control char rejection, and isolated Discord button custom_id parsing");
  }

  // -------------------------------------------------------------------------
  // 2. Load Cloudflare Worker (`src/worker.js`) with Mock D1
  // -------------------------------------------------------------------------
  const workerPath = pathToFileURL(path.join(__dirname, "..", "src", "worker.js")).href;
  const workerMod = await import(workerPath);
  const worker = workerMod.default;

  const TEST_TOKEN = "mw_int_secret_token_2026_echo24_pi3b_998877665544332211";
  const OWNER_DISCORD_ID = "714126273964736522";
  const ATTACKER_DISCORD_ID = "999999999999999999";

  const mockDb = new MockD1Database(createSamplePortfoliosStore());
  const env = {
    DB: mockDb,
    WEBMEMO_INTEGRATION_ENABLED: "true",
    WEBMEMO_INTEGRATION_TOKEN: TEST_TOKEN,
    WEBMEMO_ALLOWED_ACCOUNT_KEY: "V2-TESTKEY81",
    WEBMEMO_ALLOWED_DISCORD_USER_IDS: OWNER_DISCORD_ID
  };

  async function callWorker(method, urlPath, { body, token = TEST_TOKEN, headers = {} } = {}) {
    const reqHeaders = { ...headers };
    if (token !== null) {
      reqHeaders["Authorization"] = `Bearer ${token}`;
    }
    if (body !== undefined) {
      reqHeaders["Content-Type"] = "application/json";
    }
    const req = new Request(`https://moat.readybyte.top${urlPath}`, {
      method,
      headers: reqHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const res = await worker.fetch(req, env, {});
    const json = await res.json();
    return { status: res.status, json };
  }

  // -------------------------------------------------------------------------
  // 3. Auth, Sync Key as Token Rejection, and Wrong Account Scope Rejection
  // -------------------------------------------------------------------------
  {
    const noToken = await callWorker("GET", "/api/integration/account", { token: null });
    assert.strictEqual(noToken.status, 401);
    assert.strictEqual(noToken.json.code, "INVALID_INTEGRATION_TOKEN");

    const syncKeyAsToken = await callWorker("GET", "/api/integration/account", {
      token: "V2-TESTKEY81"
    });
    assert.strictEqual(syncKeyAsToken.status, 403);
    assert.strictEqual(syncKeyAsToken.code || syncKeyAsToken.json.code, "SYNC_KEY_AS_TOKEN_FORBIDDEN");

    const wrongAccount = await callWorker("GET", "/api/integration/account?account=VENU2-88");
    assert.strictEqual(wrongAccount.status, 403);
    assert.strictEqual(wrongAccount.json.code, "ACCOUNT_SCOPE_FORBIDDEN");

    const validAccount = await callWorker("GET", "/api/integration/account?portfolioId=us-moat");
    assert.strictEqual(validAccount.status, 200);
    assert.strictEqual(validAccount.json.ok, true);
    assert.strictEqual(validAccount.json.accountMasked, "V2-***81");
    // Ensure raw syncKey is never leaked in the integration response
    assert.strictEqual(JSON.stringify(validAccount.json).includes("V2-TESTKEY81"), false);
    assert.strictEqual(validAccount.json.holdingCount, 1); // SPCX (10 shares)
    assert.strictEqual(validAccount.json.watchlistCount, 2); // NVDA (0 sh), DUPL (0 sh) in us-moat
    ok("Auth guard: rejects missing token, forbids Sync Key as token, blocks non-owner account, masks Sync Key");
  }

  // -------------------------------------------------------------------------
  // 4. Duplicate Symbol Across Multiple Portfolios -> 409 AMBIGUOUS_SYMBOL_PORTFOLIO
  // -------------------------------------------------------------------------
  {
    const ambigGet = await callWorker("GET", "/api/integration/memo?symbol=DUPL");
    assert.strictEqual(ambigGet.status, 409);
    assert.strictEqual(ambigGet.json.code, "AMBIGUOUS_SYMBOL_PORTFOLIO");
    assert.strictEqual(ambigGet.json.candidatePortfolios.length, 2);

    const ambigDraft = await callWorker("POST", "/api/integration/drafts", {
      body: { symbol: "DUPL", proposedMemo: "Should fail without portfolioId" }
    });
    assert.strictEqual(ambigDraft.status, 409);
    assert.strictEqual(ambigDraft.json.code, "AMBIGUOUS_SYMBOL_PORTFOLIO");

    const scopedGet = await callWorker("GET", "/api/integration/memo?symbol=DUPL&portfolioId=ai-satellite");
    assert.strictEqual(scopedGet.status, 200);
    assert.strictEqual(scopedGet.json.memo, "DUPL in ai-satellite");
    ok("Duplicate symbol across portfolios requires explicit portfolioId (409 AMBIGUOUS_SYMBOL_PORTFOLIO)");
  }

  // -------------------------------------------------------------------------
  // 5. Draft Creation, Idempotency, Unauthorized Approval, and Valid Approval + Readback
  // -------------------------------------------------------------------------
  let approvedNvdaDraftId = null;
  {
    const beforeStoreRaw = mockDb.kvStore.get("portfolios").value;
    const beforeStore = JSON.parse(beforeStoreRaw);

    const draftBody = {
      portfolioId: "us-moat",
      symbol: "NVDA",
      proposedMemo: "Blackwell DC ramp +93% YoY | แนวรับ $135 | Hold core",
      analysisSummary: "Data center revenue surged; Blackwell supply expanding Q2.",
      idempotencyKey: "idem-nvda-test-001"
    };

    const create1 = await callWorker("POST", "/api/integration/drafts", { body: draftBody });
    assert.strictEqual(create1.status, 201);
    assert.strictEqual(create1.json.ok, true);
    assert.strictEqual(create1.json.draft.status, "PENDING");
    assert.strictEqual(create1.json.draft.baseMemo, "Initial NVDA memo");
    assert.strictEqual(create1.json.draft.baseMemoRevision, 0);
    approvedNvdaDraftId = create1.json.draft.draftId;

    // Idempotent replay with same idempotencyKey
    const create2 = await callWorker("POST", "/api/integration/drafts", { body: draftBody });
    assert.strictEqual(create2.status, 200);
    assert.strictEqual(create2.json.idempotentReplay, true);
    assert.strictEqual(create2.json.draft.draftId, approvedNvdaDraftId);

    // Record Discord message metadata
    const patchMsg = await callWorker(
      "PATCH",
      `/api/integration/drafts/${approvedNvdaDraftId}/discord-message`,
      {
        body: {
          discordChannelId: "1484918931700449487",
          discordMessageId: "1489999999999999999"
        }
      }
    );
    assert.strictEqual(patchMsg.status, 200);
    assert.strictEqual(patchMsg.json.draft.discordMessageId, "1489999999999999999");

    // Unauthorized Discord user tries to approve
    const unauthApprove = await callWorker(
      "POST",
      `/api/integration/drafts/${approvedNvdaDraftId}/decision`,
      {
        body: {
          action: "approve",
          expectedVersion: 1,
          actorDiscordUserId: ATTACKER_DISCORD_ID,
          actorDiscordTag: "attacker#0001"
        }
      }
    );
    assert.strictEqual(unauthApprove.status, 403);
    assert.strictEqual(unauthApprove.json.code, "UNAUTHORIZED_DISCORD_USER");

    // Verify web memo is STILL unchanged before owner approval
    const midStore = JSON.parse(mockDb.kvStore.get("portfolios").value);
    assert.strictEqual(
      midStore["V2-TESTKEY81"].portfolios[0].holdings[1].memo,
      "Initial NVDA memo"
    );

    // Wrong version check
    const wrongVer = await callWorker(
      "POST",
      `/api/integration/drafts/${approvedNvdaDraftId}/decision`,
      {
        body: {
          action: "approve",
          expectedVersion: 99,
          actorDiscordUserId: OWNER_DISCORD_ID
        }
      }
    );
    assert.strictEqual(wrongVer.status, 409);
    assert.strictEqual(wrongVer.json.code, "DRAFT_VERSION_MISMATCH");

    // Authorized owner approves
    const approveRes = await callWorker(
      "POST",
      `/api/integration/drafts/${approvedNvdaDraftId}/decision`,
      {
        body: {
          action: "approve",
          expectedVersion: 1,
          actorDiscordUserId: OWNER_DISCORD_ID,
          actorDiscordTag: "owner#7141"
        }
      }
    );
    assert.strictEqual(approveRes.status, 200);
    assert.strictEqual(approveRes.json.ok, true);
    assert.strictEqual(approveRes.json.draft.status, "APPROVED");
    assert.strictEqual(approveRes.json.readback.verified, true);
    assert.strictEqual(
      approveRes.json.readback.memo,
      "Blackwell DC ramp +93% YoY | แนวรับ $135 | Hold core"
    );
    assert.strictEqual(approveRes.json.readback.memoRevision, 1);
    assert.strictEqual(approveRes.json.readback.researchPostSynced, true);

    // Verify strict field-level immutability: NO other field, stock, portfolio, or account changed
    const afterStore = JSON.parse(mockDb.kvStore.get("portfolios").value);
    assertOnlyTargetMemoChanged(beforeStore, afterStore, {
      syncKey: "V2-TESTKEY81",
      portfolioId: "us-moat",
      symbol: "NVDA",
      expectedMemo: "Blackwell DC ramp +93% YoY | แนวรับ $135 | Hold core"
    });

    // Replay protection: clicking Approve or Reject again on decided draft returns 409
    const replayApprove = await callWorker(
      "POST",
      `/api/integration/drafts/${approvedNvdaDraftId}/decision`,
      {
        body: {
          action: "approve",
          expectedVersion: 1,
          actorDiscordUserId: OWNER_DISCORD_ID
        }
      }
    );
    assert.strictEqual(replayApprove.status, 409);
    assert.strictEqual(replayApprove.json.code, "DRAFT_ALREADY_DECIDED");

    ok("Draft idempotency, unauthorized Discord user rejection, owner approval, readback, replay block, and strict field immutability");
  }

  // -------------------------------------------------------------------------
  // 6. Concurrent Web UI Save (Shares/Cost/Targets Edit Preserves Newer Approved Memo)
  // -------------------------------------------------------------------------
  {
    // Simulate a browser tab that loaded the portfolio BEFORE Discord approved NVDA's memo
    // (`loadedMemo: "Initial NVDA memo"`, `memoRevision: 0`), and now updates SPCX shares/cost
    // and NVDA targetPrice from 155 -> 175 without editing NVDA's memo field in the browser.
    const webSavePayload = {
      syncKey: "V2-TESTKEY81",
      baseCurrency: "USD",
      watchSettings: {
        autoSwipeEnabled: true,
        autoSwipeSec: 15,
        alwaysOnDisplay: false,
        sortByPctOrder: "ASC",
        sortByPctMetric: "DAY",
        deviceId: "V2-TESTKEY81",
        watchModel: "venu2"
      },
      portfolios: [
        {
          id: "us-moat",
          name: "US Core & AI Moat",
          currency: "USD",
          holdings: [
            {
              symbol: "SPCX",
              name: "SPCX",
              shares: 15, // User updated shares from 10 -> 15 on Web UI
              avgCost: 23.1,
              currency: "USD",
              targetPrice: 32,
              stopPrice: 18,
              alertDir: "ABOVE",
              earningsDate: "15/05/26",
              memo: "Core SPAC arbitrage",
              baseMemo: "Core SPAC arbitrage",
              memoRevision: 0
            },
            {
              symbol: "NVDA",
              name: "NVIDIA Corp",
              shares: 0,
              avgCost: 0,
              currency: "USD",
              targetPrice: 175, // User updated targetPrice from 155 -> 175 on Web UI
              stopPrice: 0,
              alertDir: "ABOVE",
              earningsDate: "28/05/26",
              memo: "Initial NVDA memo", // Stale browser snapshot!
              baseMemo: "Initial NVDA memo",
              memoRevision: 0
            },
            {
              symbol: "DUPL",
              name: "Duplicate Symbol Corp",
              shares: 0,
              avgCost: 0,
              currency: "USD",
              targetPrice: 0,
              stopPrice: 0,
              alertDir: "ABOVE",
              earningsDate: "",
              memo: "DUPL in us-moat",
              baseMemo: "DUPL in us-moat",
              memoRevision: 0
            }
          ]
        },
        {
          id: "ai-satellite",
          name: "AI Satellite Watchlist",
          currency: "USD",
          holdings: [
            {
              symbol: "DUPL",
              name: "Duplicate Symbol Corp",
              shares: 5,
              avgCost: 100,
              currency: "USD",
              targetPrice: 140,
              stopPrice: 90,
              alertDir: "ABOVE",
              earningsDate: "",
              memo: "DUPL in ai-satellite",
              baseMemo: "DUPL in ai-satellite",
              memoRevision: 0
            }
          ]
        }
      ]
    };

    const putRes = await callWorker("PUT", "/api/portfolio", {
      token: null,
      body: webSavePayload
    });
    assert.strictEqual(putRes.status, 200);

    // Check D1 store: SPCX shares must be 15, NVDA targetPrice must be 175,
    // AND NVDA's Discord-approved memo ("Blackwell DC ramp +93% YoY | แนวรับ $135 | Hold core") MUST be preserved!
    const afterWebSave = JSON.parse(mockDb.kvStore.get("portfolios").value);
    const spcx = afterWebSave["V2-TESTKEY81"].portfolios[0].holdings[0];
    const nvda = afterWebSave["V2-TESTKEY81"].portfolios[0].holdings[1];
    assert.strictEqual(spcx.shares, 15);
    assert.strictEqual(nvda.targetPrice, 175);
    assert.strictEqual(nvda.memo, "Blackwell DC ramp +93% YoY | แนวรับ $135 | Hold core");
    assert.strictEqual(nvda.memoRevision, 1);
    ok("Concurrent Web UI save updates shares/targets while preserving newer Discord-approved WebMemo");
  }

  // -------------------------------------------------------------------------
  // 7. Stale Memo Conflict (Web User Explicitly Edits Memo While Draft is Pending)
  // -------------------------------------------------------------------------
  {
    // 1. Hermes creates a new pending draft for NVDA (against baseMemoRevision: 1)
    const draftRes = await callWorker("POST", "/api/integration/drafts", {
      body: {
        portfolioId: "us-moat",
        symbol: "NVDA",
        proposedMemo: "Hermes draft while web user is editing memo",
        analysisSummary: "Testing CAS conflict detection"
      }
    });
    assert.strictEqual(draftRes.status, 201);
    const staleDraftId = draftRes.json.draft.draftId;
    assert.strictEqual(draftRes.json.draft.baseMemoRevision, 1);

    // 2. Web user explicitly edits NVDA's memo in the Web UI modal and saves
    const currentStore = JSON.parse(mockDb.kvStore.get("portfolios").value);
    const webEditedPortfolios = JSON.parse(JSON.stringify(currentStore["V2-TESTKEY81"].portfolios));
    webEditedPortfolios[0].holdings[1].baseMemo = webEditedPortfolios[0].holdings[1].memo;
    webEditedPortfolios[0].holdings[1].memo = "Owner manual web memo override @ $142";

    const webPut = await callWorker("PUT", "/api/portfolio", {
      token: null,
      body: {
        syncKey: "V2-TESTKEY81",
        baseCurrency: "USD",
        watchSettings: currentStore["V2-TESTKEY81"].watchSettings,
        portfolios: webEditedPortfolios
      }
    });
    assert.strictEqual(webPut.status, 200);

    // 3. Owner clicks Approve on the older Discord draft (`staleDraftId`)
    const conflictApprove = await callWorker(
      "POST",
      `/api/integration/drafts/${staleDraftId}/decision`,
      {
        body: {
          action: "approve",
          expectedVersion: 1,
          actorDiscordUserId: OWNER_DISCORD_ID
        }
      }
    );
    assert.strictEqual(conflictApprove.status, 409);
    assert.strictEqual(conflictApprove.json.code, "STALE_MEMO_CONFLICT");
    assert.strictEqual(
      conflictApprove.json.currentServerMemo,
      "Owner manual web memo override @ $142"
    );
    assert.ok(conflictApprove.json.replacementDraft);
    assert.strictEqual(conflictApprove.json.replacementDraft.status, "PENDING");
    assert.strictEqual(
      conflictApprove.json.replacementDraft.baseMemo,
      "Owner manual web memo override @ $142"
    );
    assert.strictEqual(conflictApprove.json.replacementDraft.baseMemoRevision, 2);

    // Verify the web user's manual memo was NOT overwritten by the conflicted approval
    const storeAfterConflict = JSON.parse(mockDb.kvStore.get("portfolios").value);
    assert.strictEqual(
      storeAfterConflict["V2-TESTKEY81"].portfolios[0].holdings[1].memo,
      "Owner manual web memo override @ $142"
    );

    // 4. Owner approves the newly generated replacementDraft -> succeeds cleanly
    const replacementId = conflictApprove.json.replacementDraft.draftId;
    const approveReplacement = await callWorker(
      "POST",
      `/api/integration/drafts/${replacementId}/decision`,
      {
        body: {
          action: "approve",
          expectedVersion: 1,
          actorDiscordUserId: OWNER_DISCORD_ID
        }
      }
    );
    assert.strictEqual(approveReplacement.status, 200);
    assert.strictEqual(approveReplacement.json.readback.verified, true);
    assert.strictEqual(approveReplacement.json.readback.memoRevision, 3);
    ok("Stale memo CAS conflict detected (409 STALE_MEMO_CONFLICT), blocks overwrite, and generates working replacementDraft");
  }

  // -------------------------------------------------------------------------
  // 8. Expired Draft (>24 Hours) & Gateway Restart Recovery
  // -------------------------------------------------------------------------
  {
    const expDraftRes = await callWorker("POST", "/api/integration/drafts", {
      body: {
        portfolioId: "us-moat",
        symbol: "SPCX",
        proposedMemo: "Expired draft memo test"
      }
    });
    assert.strictEqual(expDraftRes.status, 201);
    const expDraftId = expDraftRes.json.draft.draftId;

    // Backdate expires_at in D1 to simulate >24h expiration
    const row = mockDb.drafts.get(expDraftId);
    row.expires_at = "2020-01-01T00:00:00.000Z";

    const tryExpired = await callWorker("POST", `/api/integration/drafts/${expDraftId}/decision`, {
      body: {
        action: "approve",
        expectedVersion: 1,
        actorDiscordUserId: OWNER_DISCORD_ID
      }
    });
    assert.strictEqual(tryExpired.status, 410);
    assert.strictEqual(tryExpired.json.code, "DRAFT_EXPIRED");

    // Simulate Gateway Restart Recovery:
    // Create a draft, then simulate gateway restart where only button `custom_id` is received
    const restartDraft = await callWorker("POST", "/api/integration/drafts", {
      body: {
        portfolioId: "us-moat",
        symbol: "SPCX",
        proposedMemo: "SPCX NAV floor $23.10 | Low downside arbitrage"
      }
    });
    assert.strictEqual(restartDraft.status, 201);
    const buttonCustomId = restartDraft.json.draft.customIds.approve;
    const parsedBtn = parseDiscordButtonCustomId(buttonCustomId);
    assert.ok(parsedBtn);

    const recoverDecision = await callWorker(
      "POST",
      `/api/integration/drafts/${parsedBtn.draftId}/decision`,
      {
        body: {
          action: parsedBtn.action,
          expectedVersion: parsedBtn.version,
          actorDiscordUserId: OWNER_DISCORD_ID
        }
      }
    );
    assert.strictEqual(recoverDecision.status, 200);
    assert.strictEqual(recoverDecision.json.readback.verified, true);
    assert.strictEqual(
      recoverDecision.json.readback.memo,
      "SPCX NAV floor $23.10 | Low downside arbitrage"
    );
    ok("24-hour draft expiration (410 DRAFT_EXPIRED) and stateless Discord button recovery across gateway restarts");
  }

  // -------------------------------------------------------------------------
  // 9. Fault Injection: D1 Read, CAS Write, and Readback Failures
  // -------------------------------------------------------------------------
  {
    let memPortfolios = createSamplePortfoliosStore();
    let memDrafts = [];

    // 9a. Read failure
    const failingReadStore = createIntegrationStoreAdapter({
      getMemoryPortfolios: () => memPortfolios,
      setMemoryPortfolios: (n) => {
        memPortfolios = n;
      },
      getMemoryDrafts: () => memDrafts,
      setMemoryDrafts: (n) => {
        memDrafts = n;
      },
      faultInjection: { failReadPortfolios: true }
    });
    const readFailRes = await handleIntegrationRequest({
      method: "GET",
      pathname: "/api/integration/account",
      query: {},
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      body: {},
      env,
      store: failingReadStore
    });
    assert.strictEqual(readFailRes.status, 503);
    assert.strictEqual(readFailRes.body.code, "PORTFOLIO_READ_FAILED");

    // 9b. Corrupt readback failure (never false positive 200 OK!)
    const corruptReadbackStore = createIntegrationStoreAdapter({
      getMemoryPortfolios: () => memPortfolios,
      setMemoryPortfolios: (n) => {
        memPortfolios = n;
      },
      getMemoryDrafts: () => memDrafts,
      setMemoryDrafts: (n) => {
        memDrafts = n;
      },
      faultInjection: { corruptReadback: true }
    });
    const createForCorrupt = await handleIntegrationRequest({
      method: "POST",
      pathname: "/api/integration/drafts",
      query: {},
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      body: {
        portfolioId: "us-moat",
        symbol: "NVDA",
        proposedMemo: "Memo that fails readback verification"
      },
      env,
      store: corruptReadbackStore
    });
    assert.strictEqual(createForCorrupt.status, 201);

    const approveCorrupt = await handleIntegrationRequest({
      method: "POST",
      pathname: `/api/integration/drafts/${createForCorrupt.body.draft.draftId}/decision`,
      query: {},
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      body: {
        action: "approve",
        expectedVersion: 1,
        actorDiscordUserId: OWNER_DISCORD_ID
      },
      env,
      store: corruptReadbackStore
    });
    assert.strictEqual(approveCorrupt.status, 500);
    assert.strictEqual(approveCorrupt.body.code, "READBACK_VERIFICATION_FAILED");
    assert.strictEqual(approveCorrupt.body.ok, false);
    ok("Fault injection: D1 read failure (503) and readback corruption (500) never report false-positive success");
  }

  // -------------------------------------------------------------------------
  // 10. Node HTTP Server (`server.js`) Parity Verification
  // -------------------------------------------------------------------------
  {
    process.env.WEBMEMO_INTEGRATION_ENABLED = "true";
    process.env.WEBMEMO_INTEGRATION_TOKEN = TEST_TOKEN;
    process.env.WEBMEMO_ALLOWED_ACCOUNT_KEY = "VENU2-88";
    process.env.WEBMEMO_ALLOWED_DISCORD_USER_IDS = OWNER_DISCORD_ID;

    const fs = require("fs");
    const path = require("path");
    const researchFeedPath = path.join(__dirname, "..", "data", "research_feed.json");
    const origResearchFeed = fs.existsSync(researchFeedPath) ? fs.readFileSync(researchFeedPath, "utf8") : null;
    const { createAppServer } = require("../server");
    const appServer = createAppServer();
    await new Promise((resolve) => appServer.listen(0, "127.0.0.1", resolve));
    const port = appServer.address().port;

    try {
      const statusRes = await fetch(`http://127.0.0.1:${port}/api/integration/status`, {
        headers: { Authorization: `Bearer ${TEST_TOKEN}` }
      });
      assert.strictEqual(statusRes.status, 200);
      const statusJson = await statusRes.json();
      assert.strictEqual(statusJson.ok, true);
      assert.strictEqual(statusJson.accountMasked, "VE***88");

      // Verify Hermes integration can publish & list Support/Resistance 1-2-3 tagged posts
      const unauthResearchRes = await fetch(`http://127.0.0.1:${port}/api/integration/research-posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: "NVDA" })
      });
      assert.strictEqual(unauthResearchRes.status, 401, "Unauthenticated research post must be rejected with 401");

      const pubResearchRes = await fetch(`http://127.0.0.1:${port}/api/integration/research-posts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEST_TOKEN}`
        },
        body: JSON.stringify({
          id: "hermes-int-test-sr",
          symbol: "NVDA",
          title: "Hermes Automated S/R 1-2-3 Update",
          summary: "Automated Hermes daily S1/S2/S3 & R1/R2/R3 calibration.",
          stance: "BULLISH",
          tags: ["#hermes-daily", "#support-resistance", "#ai-moat"],
          supports: [115, 108, 95],
          resistances: [128, 140, 165]
        })
      });
      assert.ok([200, 201].includes(pubResearchRes.status), `Expected 200 or 201, got ${pubResearchRes.status}`);
      const pubResearchJson = await pubResearchRes.json();
      assert.strictEqual(pubResearchJson.ok, true);
      assert.ok(pubResearchJson.post && pubResearchJson.post.symbol === "NVDA");
      assert.strictEqual(pubResearchJson.post.supports.length, 3);
      assert.strictEqual(pubResearchJson.post.resistances.length, 3);
      ok("Node server.js `/api/integration/status` and `/api/integration/research-posts` parity verified");
    } finally {
      await new Promise((resolve) => appServer.close(resolve));
      if (origResearchFeed !== null) {
        fs.writeFileSync(researchFeedPath, origResearchFeed, "utf8");
      } else if (fs.existsSync(researchFeedPath)) {
        fs.unlinkSync(researchFeedPath);
      }
    }
  }

  console.log(`\nALL ${passed} WEBMEMO INTEGRATION TEST SUITES PASSED (100%)!`);
}

runTests().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
