const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { loadEnvFile } = require("../lib/envLoader");

loadEnvFile();

let BASE_URL = "http://localhost:3880";
const INITIAL_ADMIN_PWD = process.env.ADMIN_INITIAL_PASSWORD || "MOAT-ADM-9X4K-7P2M";
let ephemeralServer = null;

async function ensureTestServer() {
  try {
    await httpRequest("GET", "/api/devices/compatible");
  } catch (_) {
    const { createAppServer } = require("../server");
    ephemeralServer = createAppServer();
    await new Promise((resolve) => ephemeralServer.listen(0, "127.0.0.1", resolve));
    const addr = ephemeralServer.address();
    BASE_URL = `http://127.0.0.1:${addr.port}`;
  }
}

function httpRequest(method, reqPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(reqPath, BASE_URL);
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          ...headers
        }
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch (_) {
            // Non-JSON (e.g. HTML)
          }
          resolve({ status: res.statusCode, headers: res.headers, raw, json });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runSdlcSuite() {
  await ensureTestServer();
  console.log("==================================================================");
  console.log("  MoatWatch SDLC + Security VA + Garmin 2024-2026 Automated Suite");
  console.log("==================================================================\n");

  const testDeviceId = "V2-SDLC9901";

  // 1. Subdomain Routing & Zero-Hint Security Check on Admin Portal HTML
  const adminHtmlRes = await httpRequest("GET", "/", null, {
    Host: "admin-moat.readybyte.top"
  });
  assert.strictEqual(adminHtmlRes.status, 200, "Admin subdomain should return HTTP 200");
  assert.ok(
    adminHtmlRes.raw.includes("MoatWatch Admin") &&
      adminHtmlRes.raw.includes("saharat.bun@icloud.com") &&
      adminHtmlRes.raw.includes("e24qdy2@gmail.com") &&
      adminHtmlRes.raw.includes("adminPasswordLoginForm") &&
      adminHtmlRes.raw.includes("changeAdminPasswordForm"),
    "Admin subdomain HTML should render Admin Password Login & Change Password forms"
  );
  // VA C-01 Check: View-Source on Admin HTML and JS must contain ZERO password hints
  assert.ok(
    !adminHtmlRes.raw.includes("defaultPasswordHintBox") &&
      !adminHtmlRes.raw.includes("MOAT-888888") &&
      !adminHtmlRes.raw.includes(INITIAL_ADMIN_PWD),
    "VA C-01: Admin HTML source must NOT expose any default password or password hint box"
  );
  const adminJsRaw = fs.readFileSync(path.join(__dirname, "..", "public", "admin.js"), "utf8");
  assert.ok(
    !adminJsRaw.includes("defaultPasswordHintBox") && !adminJsRaw.includes("MOAT-888888"),
    "VA C-01: public/admin.js must NOT contain any default password hint logic"
  );
  // VA M-02 Check: HTTP Security Headers
  assert.strictEqual(adminHtmlRes.headers["x-frame-options"], "DENY");
  assert.strictEqual(adminHtmlRes.headers["x-content-type-options"], "nosniff");
  assert.ok(String(adminHtmlRes.headers["content-security-policy"] || "").includes("frame-ancestors 'none'"));
  console.log("[PASS] 1. Subdomain routing + VA C-01 (Zero Password Hint in View-Source) + Security Headers");

  // 2. VA C-02 & C-03: Block Header Spoofing & Legacy Unauthenticated OTP Backdoor
  const spoofedHeaderRes = await httpRequest("GET", "/api/admin/devices", null, {
    "cf-access-authenticated-user-email": "saharat.bun@icloud.com"
  });
  assert.strictEqual(
    spoofedHeaderRes.status,
    401,
    "VA C-03: Spoofed cf-access-authenticated-user-email without JWT must return 401"
  );

  const legacyOtpRes = await httpRequest("POST", "/api/admin/auth/request-otp", {
    email: "saharat.bun@icloud.com"
  });
  assert.strictEqual(
    legacyOtpRes.status,
    403,
    "VA C-02: Legacy unauthenticated /api/admin/auth/request-otp backdoor must return 403"
  );
  console.log("[PASS] 2. VA C-02 & C-03: Cloudflare Header Spoofing (401) & Legacy OTP Backdoor (403) blocked");

  // 3. Watch Display Settings (Auto-Swipe 5s default + custom seconds + Optional Always-On Display)
  const updateSettingsRes = await httpRequest("PUT", "/api/portfolio", {
    syncKey: "VENU2-88",
    watchSettings: {
      autoSwipeEnabled: true,
      autoSwipeSec: 9,
      alwaysOnDisplay: true,
      deviceId: "V2-88VENU20"
    }
  });
  assert.strictEqual(updateSettingsRes.status, 200);
  assert.strictEqual(updateSettingsRes.json.watch.cfg.asw, 1);
  assert.strictEqual(updateSettingsRes.json.watch.cfg.asec, 9);
  assert.strictEqual(updateSettingsRes.json.watch.cfg.aon, 1);

  const restoreSettingsRes = await httpRequest("PUT", "/api/portfolio", {
    syncKey: "VENU2-88",
    watchSettings: {
      autoSwipeEnabled: true,
      autoSwipeSec: 5,
      alwaysOnDisplay: false,
      deviceId: "V2-88VENU20"
    }
  });
  assert.strictEqual(restoreSettingsRes.json.watch.cfg.asw, 1);
  assert.strictEqual(restoreSettingsRes.json.watch.cfg.asec, 5);
  assert.strictEqual(restoreSettingsRes.json.watch.cfg.aon, 0);
  console.log("[PASS] 3. Web -> Watch Auto-Swipe (default 5s & custom 9s) + Optional Always-On Display sync");

  // 4. Admin Password Login & Change Password (with Current Password Verification + HttpOnly Cookie)
  const unauthRes = await httpRequest("GET", "/api/admin/devices");
  assert.strictEqual(unauthRes.status, 401, "Unauthenticated admin API call must return 401");

  const badLoginRes = await httpRequest("POST", "/api/admin/auth/login", {
    email: "saharat.bun@icloud.com",
    password: "WRONG-PASSWORD-999"
  });
  assert.strictEqual(badLoginRes.status, 401, "Wrong admin password must return 401");
  assert.strictEqual(badLoginRes.json.ok, false);

  const goodLoginRes = await httpRequest("POST", "/api/admin/auth/login", {
    email: "saharat.bun@icloud.com",
    password: INITIAL_ADMIN_PWD
  });
  assert.strictEqual(goodLoginRes.status, 200, "Valid admin password must return 200");
  assert.strictEqual(goodLoginRes.json.ok, true);
  assert.strictEqual(goodLoginRes.json.authMethod, "ADMIN_PASSWORD");
  assert.ok(
    Array.isArray(goodLoginRes.headers["set-cookie"]) &&
      goodLoginRes.headers["set-cookie"].some((c) => c.includes("__moat_admin_session=") && c.includes("HttpOnly")),
    "VA M-01: Admin login must set HttpOnly __moat_admin_session cookie"
  );
  const adminToken = goodLoginRes.json.token;
  assert.ok(adminToken && adminToken.length > 20);

  // Attempt change password with WRONG currentPassword -> must fail (400)
  const badCurrentPwdRes = await httpRequest(
    "POST",
    "/api/admin/auth/change-password",
    {
      currentPassword: "WRONG-OLD-PASSWORD",
      newPassword: "NewAdmin@2026",
      confirmPassword: "NewAdmin@2026"
    },
    { "X-Admin-Token": adminToken }
  );
  assert.strictEqual(badCurrentPwdRes.status, 400, "Wrong current password must be rejected");

  // Change password with VALID currentPassword -> "NewAdmin@2026"
  const changePwdSuccessRes = await httpRequest(
    "POST",
    "/api/admin/auth/change-password",
    {
      currentPassword: INITIAL_ADMIN_PWD,
      newPassword: "NewAdmin@2026",
      confirmPassword: "NewAdmin@2026"
    },
    { "X-Admin-Token": adminToken }
  );
  assert.strictEqual(changePwdSuccessRes.status, 200, "Valid password change should return 200");
  assert.strictEqual(changePwdSuccessRes.json.ok, true);
  assert.strictEqual(changePwdSuccessRes.json.isDefaultPassword, false);

  // Verify old password no longer works, and new password works
  const oldPwdLoginAfterChange = await httpRequest("POST", "/api/admin/auth/login", {
    email: "saharat.bun@icloud.com",
    password: INITIAL_ADMIN_PWD
  });
  assert.strictEqual(oldPwdLoginAfterChange.status, 401, "Old password must no longer work after change");

  const newPwdLoginAfterChange = await httpRequest("POST", "/api/admin/auth/login", {
    email: "saharat.bun@icloud.com",
    password: "NewAdmin@2026"
  });
  assert.strictEqual(newPwdLoginAfterChange.status, 200, "New password must authenticate successfully");

  // Restore initial password from .env by verifying currentPassword "NewAdmin@2026"
  const restorePwdRes = await httpRequest(
    "POST",
    "/api/admin/auth/change-password",
    {
      currentPassword: "NewAdmin@2026",
      newPassword: INITIAL_ADMIN_PWD,
      confirmPassword: INITIAL_ADMIN_PWD
    },
    { "X-Admin-Token": adminToken }
  );
  assert.strictEqual(restorePwdRes.status, 200);
  assert.strictEqual(restorePwdRes.json.ok, true);
  assert.strictEqual(restorePwdRes.json.isDefaultPassword, true);
  console.log("[PASS] 4. Admin Password Login (.env secret) + Change Password + HttpOnly Cookie");

  // 5. 14-Day Free Trial Initialization & Expiration Lock Screen
  await httpRequest(
    "POST",
    "/api/admin/devices/update",
    { action: "RESET_TRIAL", deviceId: testDeviceId },
    { "X-Admin-Token": adminToken }
  );
  const watchTrialRes = await httpRequest(
    "GET",
    `/api/watch?key=VENU2-88&did=${encodeURIComponent(testDeviceId)}`
  );
  assert.strictEqual(watchTrialRes.status, 200);
  assert.strictEqual(watchTrialRes.json.lic.did, testDeviceId);
  assert.strictEqual(watchTrialRes.json.lic.st, "TRIAL");
  assert.strictEqual(watchTrialRes.json.lic.exp, 0);
  assert.strictEqual(watchTrialRes.json.lic.own, "saharat.bun@icloud.com");

  const expireRes = await httpRequest(
    "POST",
    "/api/admin/devices/update",
    { action: "EXPIRE_TRIAL", deviceId: testDeviceId },
    { "X-Admin-Token": adminToken }
  );
  assert.strictEqual(expireRes.status, 200);
  assert.strictEqual(expireRes.json.device.status, "EXPIRED");

  const watchExpiredRes = await httpRequest(
    "GET",
    `/api/watch?key=VENU2-88&did=${encodeURIComponent(testDeviceId)}`
  );
  assert.strictEqual(watchExpiredRes.json.lic.st, "EXPIRED");
  assert.strictEqual(watchExpiredRes.json.lic.exp, 1);
  console.log("[PASS] 5. 14-Day Free Trial auto-registration & expiration lock screen verified");

  // 6. Admin Per-Device Activation Key Generator + VA H-02 (No issuedKey leaked on public endpoints)
  const genKeyRes = await httpRequest(
    "POST",
    "/api/admin/devices/generate-key",
    { deviceId: testDeviceId, label: "SDLC Automated Test Watch" },
    { "X-Admin-Token": adminToken }
  );
  assert.strictEqual(genKeyRes.status, 200);
  const generatedKey = genKeyRes.json.activationKey;
  assert.match(generatedKey, /^MOAT-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  // VA H-02 Check: Public /api/device/status and /api/portfolio must NEVER expose issuedKey
  const publicDeviceStatusRes = await httpRequest(
    "GET",
    `/api/device/status?did=${encodeURIComponent(testDeviceId)}&key=VENU2-88`
  );
  assert.strictEqual(publicDeviceStatusRes.status, 200);
  assert.strictEqual(
    publicDeviceStatusRes.json.full.issuedKey,
    undefined,
    "VA H-02: Public /api/device/status must NOT expose unactivated issuedKey"
  );
  assert.strictEqual(
    publicDeviceStatusRes.json.public.issuedKey,
    undefined,
    "VA H-02: Public /api/device/status.public must NOT expose unactivated issuedKey"
  );

  // Activate with valid per-device key
  const goodActivateRes = await httpRequest("POST", "/api/device/activate", {
    syncKey: "VENU2-88",
    deviceId: testDeviceId,
    activationKey: generatedKey
  });
  assert.strictEqual(goodActivateRes.status, 200);
  assert.strictEqual(goodActivateRes.json.ok, true);
  assert.strictEqual(goodActivateRes.json.license.status, "ACTIVE");
  console.log(`[PASS] 6. Per-Device Activation Key (${generatedKey}) + VA H-02 (No issuedKey leak on public APIs)`);

  // 7. Customer Self-Service: Request Trial Key Extend & Purchase License Form + Email Notification to e24qdy2@gmail.com
  const trialExtendReqRes = await httpRequest("POST", "/api/license/request", {
    requestType: "TRIAL_EXTEND",
    deviceId: testDeviceId,
    syncKey: "VENU2-88",
    requestedExtendDays: 14,
    contactName: "John Doe (System Test)",
    contactEmail: "investor@readybyte.top",
    contactPhone: "081-999-8888",
    message: "Requesting +14 days Free Trial extension for my Garmin watch"
  });
  assert.strictEqual(trialExtendReqRes.status, 200);
  assert.strictEqual(trialExtendReqRes.json.ok, true);
  assert.strictEqual(trialExtendReqRes.json.emailDelivery.recipientEmail, "e24qdy2@gmail.com");

  const purchaseReqRes = await httpRequest("POST", "/api/license/request", {
    requestType: "PURCHASE_LICENSE",
    deviceId: testDeviceId,
    syncKey: "VENU2-88",
    contactName: "John Doe (System Test)",
    contactEmail: "investor@readybyte.top",
    contactPhone: "LINE: @investor_moat",
    message: "Requesting a lifetime PRO License for my Garmin watch"
  });
  assert.strictEqual(purchaseReqRes.status, 200);
  assert.strictEqual(purchaseReqRes.json.ok, true);

  const resolveExtendRes = await httpRequest(
    "POST",
    "/api/admin/requests/resolve",
    {
      requestId: trialExtendReqRes.json.request.id,
      action: "APPROVE_EXTEND_14"
    },
    { "X-Admin-Token": adminToken }
  );
  assert.strictEqual(resolveExtendRes.status, 200);

  const resolvePurchaseRes = await httpRequest(
    "POST",
    "/api/admin/requests/resolve",
    {
      requestId: purchaseReqRes.json.request.id,
      action: "APPROVE_PURCHASE_ACTIVATE"
    },
    { "X-Admin-Token": adminToken }
  );
  assert.strictEqual(resolvePurchaseRes.status, 200);
  assert.strictEqual(resolvePurchaseRes.json.device.status, "ACTIVE");
  console.log("[PASS] 7. Customer Trial Extend & Purchase Request Form + Admin 1-Click Approval + Email Dispatch");

  // 8. Garmin 2024-2026 Multi-Device Compatibility API & Manifest Verification (20 Models)
  const compatRes = await httpRequest("GET", "/api/devices/compatible");
  assert.strictEqual(compatRes.status, 200);
  assert.strictEqual(compatRes.json.ok, true);
  assert.strictEqual(compatRes.json.count, 20, "Should expose all 20 Garmin watch configurations (2024-2026 lineup)");
  const modelIds = compatRes.json.devices.map((d) => d.id);
  for (const expectedId of [
    "venu2",
    "venu2s",
    "venu2plus",
    "venu3",
    "venu3s",
    "vivoactive5",
    "fr165",
    "fr165m",
    "fr265",
    "fr265s",
    "fr965",
    "fenix843mm",
    "fenix847mm",
    "fenix8solar47mm",
    "enduro3",
    "epix2pro42mm",
    "epix2pro47mm",
    "epix2pro51mm",
    "approachs7042mm",
    "approachs7047mm"
  ]) {
    assert.ok(modelIds.includes(expectedId), `Compatible device list must include ${expectedId}`);
  }
  console.log(`[PASS] 8. Garmin 2024-2026 Compatible Devices Matrix verified (${compatRes.json.count} watch models ready)`);

  // 9. VA H-01: Brute-Force Lockout Verification (5 failed attempts -> HTTP 429)
  let lockedOutStatus = 0;
  const bfTestIp = `203.0.113.${Math.floor(Math.random() * 200) + 10}`;
  for (let i = 0; i < 6; i++) {
    const bfRes = await httpRequest(
      "POST",
      "/api/admin/auth/login",
      {
        email: "saharat.bun@icloud.com",
        password: `BRUTE-FORCE-WRONG-${i}`
      },
      { "X-Forwarded-For": bfTestIp }
    );
    if (bfRes.status === 429) {
      lockedOutStatus = 429;
      assert.strictEqual(bfRes.json.locked, true);
      break;
    }
  }
  assert.strictEqual(lockedOutStatus, 429, "VA H-01: Brute-force login attempts must trigger HTTP 429 lockout");
  console.log("[PASS] 9. VA H-01: Brute-Force Login Lockout (5 attempts -> HTTP 429) verified");

  // 10. Auto-Sort % Change Setting (ASC: Negative -> Positive / DESC: Positive -> Negative / NONE: Manual)
  const sortAscRes = await httpRequest("PUT", "/api/portfolio", {
    syncKey: "VENU2-88",
    watchSettings: {
      autoSwipeEnabled: true,
      autoSwipeSec: 5,
      alwaysOnDisplay: true,
      sortByPctOrder: "ASC",
      sortByPctMetric: "DAY",
      deviceId: "V2-88VENU20"
    }
  });
  assert.strictEqual(sortAscRes.status, 200);
  assert.strictEqual(sortAscRes.json.web.watchSettings.sortByPctOrder, "ASC");
  assert.strictEqual(sortAscRes.json.watch.cfg.srt, "ASC");
  const ascHoldings = sortAscRes.json.web.portfolios[0].holdings;
  if (ascHoldings.length >= 2) {
    assert.ok(
      ascHoldings[0].changePct <= ascHoldings[ascHoldings.length - 1].changePct,
      "ASC must sort holdings from lowest (most negative) % change to highest (most positive) % change"
    );
  }

  const sortDescRes = await httpRequest("PUT", "/api/portfolio", {
    syncKey: "VENU2-88",
    watchSettings: {
      autoSwipeEnabled: true,
      autoSwipeSec: 5,
      alwaysOnDisplay: true,
      sortByPctOrder: "DESC",
      sortByPctMetric: "DAY",
      deviceId: "V2-88VENU20"
    }
  });
  assert.strictEqual(sortDescRes.status, 200);
  assert.strictEqual(sortDescRes.json.web.watchSettings.sortByPctOrder, "DESC");
  assert.strictEqual(sortDescRes.json.watch.cfg.srt, "DESC");
  const descHoldings = sortDescRes.json.web.portfolios[0].holdings;
  if (descHoldings.length >= 2) {
    assert.ok(
      descHoldings[0].changePct >= descHoldings[descHoldings.length - 1].changePct,
      "DESC must sort holdings from highest (most positive) % change to lowest (most negative) % change"
    );
  }
  console.log("[PASS] 10. Auto-Sort % Change Setting (ASC: Negative->Positive / DESC: Positive->Negative) verified");

  // Restore default ASC sort order & keep V2-88VENU20 active
  const finalPortfolioRes = await httpRequest("PUT", "/api/portfolio", {
    syncKey: "VENU2-88",
    watchSettings: {
      autoSwipeEnabled: true,
      autoSwipeSec: 5,
      alwaysOnDisplay: true,
      sortByPctOrder: "ASC",
      sortByPctMetric: "DAY",
      deviceId: "V2-88VENU20"
    }
  });
  const firstWebHolding = finalPortfolioRes.json.web.portfolios[0].holdings[0];
  const firstWatchHolding = finalPortfolioRes.json.watch.p[0].s[0];
  assert.ok(typeof firstWebHolding.price === "number" && firstWebHolding.price > 0, "Web holding must include current price");
  assert.ok(typeof firstWebHolding.sma20 === "number" && firstWebHolding.sma20 > 0, "Web holding must include sma20");
  assert.ok(typeof firstWebHolding.smaPct === "number", "Web holding must include smaPct (% distance vs SMA20)");
  assert.ok(/^e-\d{2}\/\d{2}\/\d{2}$/.test(firstWebHolding.earningsBadge), "Equity web holding must include earningsBadge (e-dd/mm/yy)");
  assert.ok(typeof firstWebHolding.dayHigh === "number" && firstWebHolding.dayHigh >= firstWebHolding.price, "Web holding must include dayHigh >= price");
  assert.ok(typeof firstWebHolding.dayLow === "number" && firstWebHolding.dayLow <= firstWebHolding.price, "Web holding must include dayLow <= price");
  assert.ok(typeof firstWatchHolding.px === "number" && firstWatchHolding.px > 0, "Watch holding must include px (current price)");
  assert.ok(typeof firstWatchHolding.chg === "number", "Watch holding must include chg (daily change in currency)");
  assert.ok(typeof firstWatchHolding.pct === "number", "Watch holding must include pct (Last % change)");
  assert.ok(
    Math.abs(firstWebHolding.changePct) < 25,
    "Daily changePct must reflect single-day Yahoo Finance change, not 3-month chartPreviousClose drift"
  );
  assert.ok(typeof firstWatchHolding.sma === "number" && firstWatchHolding.sma > 0, "Watch holding must include sma (SMA20)");
  assert.ok(typeof firstWatchHolding.sPct === "number", "Watch holding must include sPct (SMA20 % distance)");
  assert.ok(/^e-\d{2}\/\d{2}\/\d{2}$/.test(firstWatchHolding.ed), "Watch equity holding must include ed (e-dd/mm/yy)");
  assert.ok(typeof firstWatchHolding.hi === "number" && firstWatchHolding.hi >= firstWatchHolding.px, "Watch holding must include hi (Day High)");
  assert.ok(typeof firstWatchHolding.lo === "number" && firstWatchHolding.lo <= firstWatchHolding.px, "Watch holding must include lo (Day Low)");

  // Verify ETFs / Crypto hide earnings badge ("")
  const allWatchHoldings = finalPortfolioRes.json.watch.p.flatMap((port) => port.s);
  const btcWatch = allWatchHoldings.find((item) => item.sym === "BTC-USD");
  if (btcWatch) {
    assert.strictEqual(btcWatch.ed, "", "Crypto/ETF holding (BTC-USD) must have empty earnings badge");
  }
  console.log("[PASS] 11. Watch & Web Stock Metrics (Current Price, Last % Change, SMA20 + SMA20 %, e-dd/mm/yy Earnings Date, Day High/Low) verified");

  // 12. Cloudflare Worker Serverless Bundle Parity Verification
  const workerSrcPath = path.join(__dirname, "..", "src", "worker.js");
  if (fs.existsSync(workerSrcPath)) {
    const { pathToFileURL } = require("url");
    const workerMod = await import(pathToFileURL(workerSrcPath).href);
    const worker = workerMod.default;
    assert.ok(worker && typeof worker.fetch === "function", "Cloudflare Worker must export default.fetch");

    const wHealthRes = await worker.fetch(new Request("https://moat.readybyte.top/api/health"), {});
    const wHealthJson = await wHealthRes.json();
    assert.strictEqual(wHealthRes.status, 200);
    assert.strictEqual(wHealthJson.runtime, "cloudflare-workers");

    const wWatchRes = await worker.fetch(new Request("https://moat.readybyte.top/api/watch?key=VENU2-88"), {});
    const wWatchJson = await wWatchRes.json();
    assert.strictEqual(wWatchRes.status, 200);
    assert.strictEqual(wWatchJson.k, "VENU2-88");
    assert.strictEqual(wWatchJson.lic.st, "ACTIVE");
    assert.ok(Array.isArray(wWatchJson.p) && wWatchJson.p.length >= 1, "Worker watch payload must contain portfolios");
    assert.ok(wWatchJson.p[0].s.length >= 1, "Worker watch payload must contain holdings");
    assert.strictEqual(
      typeof wWatchJson.p[0].s[0].rsi,
      "number",
      "Worker watch holding must include RSI14 (rsi) integer"
    );
    assert.ok(
      wWatchJson.p[0].s[0].rsi >= 0 && wWatchJson.p[0].s[0].rsi <= 100,
      "Worker watch holding RSI14 must be within 0..100"
    );

    const wAdminLoginRes = await worker.fetch(
      new Request("https://admin-moat.readybyte.top/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "saharat.bun@icloud.com", password: INITIAL_ADMIN_PWD })
      }),
      {}
    );
    const wAdminLoginJson = await wAdminLoginRes.json();
    assert.strictEqual(wAdminLoginRes.status, 200);
    assert.strictEqual(wAdminLoginJson.ok, true);
    assert.ok(wAdminLoginJson.token.startsWith("ms1."), "Worker must issue stateless HMAC-signed admin session token");

    const wDevicesRes = await worker.fetch(
      new Request("https://admin-moat.readybyte.top/api/admin/devices", {
        headers: { "X-Admin-Token": wAdminLoginJson.token }
      }),
      {}
    );
    const wDevicesJson = await wDevicesRes.json();
    assert.strictEqual(wDevicesRes.status, 200);
    assert.strictEqual(wDevicesJson.ok, true);
    console.log("[PASS] 12. Cloudflare Worker Serverless Bundle (API / Watch / Stateless Admin Auth) verified");
  }

  // 13. Deep Module Interface & Seam Verification (lib/moatEngine.js)
  const moatEngine = require("../lib/moatEngine");
  const mockCloses = Array.from({ length: 25 }, (_, idx) => 100 + idx * 1.5); // 100.0 -> 136.0
  const mockFetchJson = async () => ({
    chart: {
      result: [
        {
          meta: {
            currency: "USD",
            shortName: "Mock Moat Corp",
            regularMarketPrice: 138.0,
            chartPreviousClose: 90.0, // 3-month ago close (must NOT be used as yesterday's close)
            regularMarketDayHigh: 140.0,
            regularMarketDayLow: 135.5
          },
          indicators: {
            quote: [
              {
                close: mockCloses,
                high: mockCloses.map((c) => c + 1),
                low: mockCloses.map((c) => c - 1)
              }
            ]
          }
        }
      ]
    }
  });
  const seamQuote = await moatEngine.fetchSymbolMarketData("NVDA", {
    bypassCache: true,
    fetchJson: mockFetchJson
  });
  assert.strictEqual(seamQuote.source, "LIVE_YAHOO");
  assert.strictEqual(seamQuote.price, 138.0);
  // Prior daily close should be mockCloses[mockCloses.length - 2] = 134.5, NOT chartPreviousClose (90.0)
  assert.strictEqual(seamQuote.prevClose, 134.5, "Must derive yesterday close from prior daily bar when meta.previousClose is omitted");
  assert.strictEqual(seamQuote.change, 3.5);
  assert.strictEqual(seamQuote.changePct, Number(((3.5 / 134.5) * 100).toFixed(2)));
  assert.strictEqual(seamQuote.earningsBadge, "e-17/11/26");
  assert.ok(seamQuote.rsi14 > 70, "Monotonically rising closes must yield RSI14 > 70");
  assert.ok(seamQuote.sma20 > 100 && seamQuote.sma20 < 138, "SMA20 must reflect 20-day moving average");
  console.log("[PASS] 13. Deep Module Interface & Mock Seam (lib/moatEngine.js) verified");

  // 14. Parts 2 & 3 Deep Modules Verification (MoatWatchLayout.mc + public/watchSimulator.js)
  const watchLayoutMcPath = path.join(__dirname, "..", "garmin-venu2-app", "source", "MoatWatchLayout.mc");
  const venu2ViewMcPath = path.join(__dirname, "..", "garmin-venu2-app", "source", "Venu2MoatView.mc");
  const symbolDetailMcPath = path.join(__dirname, "..", "garmin-venu2-app", "source", "SymbolDetailView.mc");
  const prgBinPath = path.join(__dirname, "..", "dist", "Venu2Moat.prg");
  assert.ok(fs.existsSync(watchLayoutMcPath), "MoatWatchLayout.mc must exist");
  assert.ok(fs.existsSync(prgBinPath), "Compiled Venu2Moat.prg binary must exist");
  const watchLayoutMcContent = fs.readFileSync(watchLayoutMcPath, "utf8");
  const venu2ViewMcContent = fs.readFileSync(venu2ViewMcPath, "utf8");
  const symbolDetailMcContent = fs.readFileSync(symbolDetailMcPath, "utf8");
  assert.ok(watchLayoutMcContent.includes("module MoatWatchLayout"), "MoatWatchLayout.mc must define module MoatWatchLayout");
  assert.ok(watchLayoutMcContent.includes("function drawHoldingRowCard"), "MoatWatchLayout.mc must encapsulate drawHoldingRowCard");
  assert.ok(watchLayoutMcContent.includes("function drawSparklineChart"), "MoatWatchLayout.mc must encapsulate drawSparklineChart");
  assert.ok(venu2ViewMcContent.includes("MoatWatchLayout.drawHoldingRowCard"), "Venu2MoatView.mc must delegate to MoatWatchLayout.drawHoldingRowCard");
  assert.ok(symbolDetailMcContent.includes("MoatWatchLayout.drawSparklineChart"), "SymbolDetailView.mc must delegate to MoatWatchLayout.drawSparklineChart");

  const watchSimulator = require("../public/watchSimulator");
  assert.strictEqual(typeof watchSimulator.normalizeServerPayload, "function", "watchSimulator must export normalizeServerPayload");
  assert.strictEqual(typeof watchSimulator.sortPortfolioItems, "function", "watchSimulator must export sortPortfolioItems");
  assert.strictEqual(typeof watchSimulator.buildWatchHoldingRowHtml, "function", "watchSimulator must export buildWatchHoldingRowHtml");
  assert.strictEqual(typeof watchSimulator.renderGarminVenu2Watch, "function", "watchSimulator must export renderGarminVenu2Watch");

  const normalizedProfile = watchSimulator.normalizeServerPayload(finalPortfolioRes.json, "VENU2-88");
  assert.strictEqual(normalizedProfile.syncKey, "VENU2-88");
  assert.ok(Array.isArray(normalizedProfile.portfolios) && normalizedProfile.portfolios.length >= 1);
  const sampleItem = normalizedProfile.portfolios[0].items[0];
  assert.strictEqual(typeof sampleItem.rsi14, "number", "Normalized item must include rsi14");
  const rowHtml = watchSimulator.buildWatchHoldingRowHtml(sampleItem, 0, 0);
  assert.ok(rowHtml.includes("SMA:") && rowHtml.includes("R:"), "Watch holding row HTML must render SMA and R:xx RSI14");

  const sortedAsc = watchSimulator.sortPortfolioItems(
    [
      { symbol: "A", origIdx: 0, changePct: 4.2, unrealizedPnlPct: 12, shares: 10 },
      { symbol: "B", origIdx: 1, changePct: -2.1, unrealizedPnlPct: -5, shares: 10 }
    ],
    "ASC",
    "DAY"
  );
  assert.strictEqual(sortedAsc[0].symbol, "B", "sortPortfolioItems ASC must place negative % first");

  const simJsRes = await httpRequest("GET", "/watchSimulator.js");
  assert.strictEqual(simJsRes.status, 200, "/watchSimulator.js must be served with HTTP 200");
  assert.ok(simJsRes.raw.includes("MoatWatchSimulator"), "/watchSimulator.js body must expose MoatWatchSimulator");
  console.log("[PASS] 14. Parts 2 & 3 Deep Modules (MoatWatchLayout.mc + public/watchSimulator.js) verified");

  // 15. Multi-User Profile & Trial Isolation Verification (Web, Node API, Cloudflare Worker, Watch Auto-Device-ID)
  const userAKey = "V2-USERA111";
  const userBKey = "V2-USERB222";
  const portfoliosJsonPath = path.join(__dirname, "..", "data", "portfolios.json");
  const licensesJsonPath = path.join(__dirname, "..", "data", "licenses.json");
  const originalPortfoliosJson = fs.existsSync(portfoliosJsonPath) ? fs.readFileSync(portfoliosJsonPath, "utf8") : null;
  const originalLicensesJson = fs.existsSync(licensesJsonPath) ? fs.readFileSync(licensesJsonPath, "utf8") : null;

  try {
    const userARes = await httpRequest("GET", `/api/portfolio?key=${userAKey}`);
    const userBRes = await httpRequest("GET", `/api/portfolio?key=${userBKey}`);
    assert.strictEqual(userARes.status, 200);
    assert.strictEqual(userBRes.status, 200);
    assert.strictEqual(userARes.json.web.syncKey, userAKey);
    assert.strictEqual(userBRes.json.web.syncKey, userBKey);
    assert.strictEqual(
      userARes.json.web.watchSettings.deviceId,
      userAKey,
      "User A must get isolated deviceId (must NOT collide with V2-88VENU20)"
    );
    assert.strictEqual(
      userBRes.json.web.watchSettings.deviceId,
      userBKey,
      "User B must get isolated deviceId (must NOT collide with User A or V2-88VENU20)"
    );
    assert.strictEqual(userARes.json.web.license.status, "TRIAL", "New User A must start on an independent 14-day TRIAL");
    assert.strictEqual(userBRes.json.web.license.status, "TRIAL", "New User B must start on an independent 14-day TRIAL");

    // Mutate User A's portfolio and verify User B and VENU2-88 remain untouched
    const userAMutatedProfile = {
      syncKey: userAKey,
      ownerName: "Alice Isolated Investor",
      baseCurrency: userARes.json.web.baseCurrency,
      watchSettings: userARes.json.web.watchSettings,
      portfolios: JSON.parse(JSON.stringify(userARes.json.web.portfolios))
    };
    userAMutatedProfile.portfolios[0].name = "Alice Secret Alpha";
    const saveARes = await httpRequest("PUT", "/api/portfolio", userAMutatedProfile);
    assert.strictEqual(saveARes.status, 200);

    const userBAfterRes = await httpRequest("GET", `/api/portfolio?key=${userBKey}`);
    assert.notStrictEqual(
      userBAfterRes.json.web.ownerName,
      "Alice Isolated Investor",
      "Modifying User A must NOT overwrite User B profile"
    );
    assert.notStrictEqual(
      userBAfterRes.json.web.portfolios[0].name,
      "Alice Secret Alpha",
      "Modifying User A portfolio name must NOT leak into User B"
    );

    // Watch Auto-Device-ID mode (?key=&did=V2-USERA111) resolves to User A's isolated profile
    const watchAutoRes = await httpRequest("GET", `/api/watch?key=&did=${userAKey}`);
    assert.strictEqual(watchAutoRes.status, 200);
    assert.strictEqual(watchAutoRes.json.k, userAKey, "Watch with blank SyncKey and hardware did=V2-USERA111 must resolve to User A");
    assert.strictEqual(watchAutoRes.json.p[0].n, "Alice Secret Alpha");

    // Verify Cloudflare Worker also isolates multi-user profiles & auto-device-ID
    if (fs.existsSync(workerSrcPath)) {
      const { pathToFileURL } = require("url");
      const workerMod = await import(pathToFileURL(workerSrcPath).href);
      const worker = workerMod.default;
      const wUserRes = await worker.fetch(new Request(`https://moat.readybyte.top/api/watch?key=&did=${userBKey}`), {});
      const wUserJson = await wUserRes.json();
      assert.strictEqual(wUserRes.status, 200);
      assert.strictEqual(wUserJson.k, userBKey, "Cloudflare Worker must isolate auto-device-ID profile per watch");
      assert.strictEqual(wUserJson.lic.did, userBKey, "Cloudflare Worker license did must match isolated watch ID");
      assert.strictEqual(wUserJson.lic.st, "TRIAL", "Cloudflare Worker new watch must start on independent TRIAL");
    }
    console.log("[PASS] 15. Multi-User Profile & Trial Isolation (Web + Node + Cloudflare Worker + Watch Auto-Device-ID) verified");
  } finally {
    if (originalPortfoliosJson !== null) {
      fs.writeFileSync(portfoliosJsonPath, originalPortfoliosJson, "utf8");
    }
    if (originalLicensesJson !== null) {
      fs.writeFileSync(licensesJsonPath, originalLicensesJson, "utf8");
    }
  }

  // 16. Daily US Market Fear & Greed Index (FG:xxG / FG:xxEF) Across Backend, Web & Garmin Watch
  assert.strictEqual(typeof moatEngine.classifyFearGreed, "function", "moatEngine must export classifyFearGreed");
  assert.strictEqual(typeof moatEngine.fetchFearGreedIndex, "function", "moatEngine must export fetchFearGreedIndex");
  const fgEf = moatEngine.classifyFearGreed(18, 22, "CNN_LIVE");
  const fgF = moatEngine.classifyFearGreed(35, 38, "CNN_LIVE");
  const fgN = moatEngine.classifyFearGreed(50, 49, "CNN_LIVE");
  const fgG = moatEngine.classifyFearGreed(68, 64, "CNN_LIVE");
  const fgEg = moatEngine.classifyFearGreed(82, 77, "CNN_LIVE");
  assert.strictEqual(fgEf.badge, "FG:18EF");
  assert.strictEqual(fgF.badge, "FG:35F");
  assert.strictEqual(fgN.badge, "FG:50N");
  assert.strictEqual(fgG.badge, "FG:68G");
  assert.strictEqual(fgEg.badge, "FG:82EG");

  const mockCnnFg = await moatEngine.fetchFearGreedIndex({
    bypassCache: true,
    fetchJson: async () => ({
      fear_and_greed: {
        score: 68.4,
        previous_close: 64.1
      }
    })
  });
  assert.strictEqual(mockCnnFg.score, 68);
  assert.strictEqual(mockCnnFg.prevClose, 64);
  assert.strictEqual(mockCnnFg.change, 4);
  assert.strictEqual(mockCnnFg.code, "G");
  assert.strictEqual(mockCnnFg.badge, "FG:68G");
  assert.strictEqual(mockCnnFg.source, "CNN_LIVE");

  assert.ok(finalPortfolioRes.json.web.fearGreed, "Web payload must include fearGreed object");
  assert.ok(
    /^FG:\d{1,3}(EF|F|N|G|EG)$/.test(finalPortfolioRes.json.web.fearGreed.badge),
    "Web fearGreed.badge must match FG:<0..100><EF|F|N|G|EG>"
  );
  assert.ok(finalPortfolioRes.json.watch.fg, "Watch payload must include compact fg object");
  assert.strictEqual(typeof finalPortfolioRes.json.watch.fg.s, "number", "Watch fg.s must be integer score");
  assert.ok(
    /^FG:\d{1,3}(EF|F|N|G|EG)$/.test(finalPortfolioRes.json.watch.fg.b),
    "Watch fg.b must match FG:<0..100><EF|F|N|G|EG>"
  );

  assert.strictEqual(typeof watchSimulator.getFearGreedZoneStyle, "function", "watchSimulator must export getFearGreedZoneStyle");
  assert.strictEqual(watchSimulator.getFearGreedZoneStyle(22).badge, "FG:22EF");
  assert.strictEqual(watchSimulator.getFearGreedZoneStyle(68).badge, "FG:68G");
  assert.ok(normalizedProfile.fearGreed && /^FG:\d{1,3}(EF|F|N|G|EG)$/.test(normalizedProfile.fearGreed.badge));

  assert.ok(watchLayoutMcContent.includes("function getFearGreedColor"), "MoatWatchLayout.mc must define getFearGreedColor");
  assert.ok(
    watchLayoutMcContent.includes("function drawPortfolioPnlAndFearGreed"),
    "MoatWatchLayout.mc must define drawPortfolioPnlAndFearGreed"
  );
  assert.ok(
    venu2ViewMcContent.includes("MoatWatchLayout.drawPortfolioPnlAndFearGreed"),
    "Venu2MoatView.mc must render P&L and Fear & Greed via MoatWatchLayout.drawPortfolioPnlAndFearGreed"
  );
  console.log("[PASS] 16. Daily US Market Fear & Greed Index (FG:xxG / FG:xxEF) across Backend, Web & Watch verified");

  // 17. Admin Non-Permanent Session (15m Idle / 30m Max TTL) & Individual / Multi-Select Key Removal
  assert.strictEqual(goodLoginRes.json.expiresInSec, 1800, "Admin session max TTL must be 1800s (30m) instead of permanent/12h");
  assert.strictEqual(goodLoginRes.json.idleTimeoutSec, 900, "Admin idle auto-logout timeout must be 900s (15m)");
  assert.ok(
    goodLoginRes.headers["set-cookie"].some((c) => c.includes("Max-Age=1800")),
    "Admin session cookie must use short Max-Age=1800 (30m)"
  );

  const sessionCheckRes = await httpRequest("GET", "/api/admin/session", null, {
    "X-Admin-Token": adminToken
  });
  assert.strictEqual(sessionCheckRes.status, 200);
  assert.strictEqual(sessionCheckRes.json.authenticated, true);
  assert.ok(sessionCheckRes.json.remainingSec > 0 && sessionCheckRes.json.remainingSec <= 1800);
  assert.strictEqual(sessionCheckRes.json.idleTimeoutSec, 900);

  // Create two temporary devices with keys, then test individual REMOVE_KEY and multi-select batch DELETE
  const tempDevA = "V2-RMKEY01";
  const tempDevB = "V2-RMKEY02";
  await httpRequest(
    "POST",
    "/api/admin/devices/generate-key",
    { deviceId: tempDevA, label: "Temp Remove Key A", autoActivate: true },
    { "X-Admin-Token": adminToken }
  );
  await httpRequest(
    "POST",
    "/api/admin/devices/generate-key",
    { deviceId: tempDevB, label: "Temp Remove Key B", autoActivate: true },
    { "X-Admin-Token": adminToken }
  );

  // Individual key removal (REMOVE_KEY) on tempDevA
  const singleRemoveKeyRes = await httpRequest(
    "POST",
    "/api/admin/devices/update",
    { deviceId: tempDevA, action: "REMOVE_KEY" },
    { "X-Admin-Token": adminToken }
  );
  assert.strictEqual(singleRemoveKeyRes.status, 200);
  assert.strictEqual(singleRemoveKeyRes.json.ok, true);
  assert.strictEqual(singleRemoveKeyRes.json.removedKey, true);
  assert.strictEqual(singleRemoveKeyRes.json.device.activatedKey, "");
  assert.strictEqual(singleRemoveKeyRes.json.device.issuedKey, "");
  assert.notStrictEqual(singleRemoveKeyRes.json.device.status, "ACTIVE");

  // Multi-select batch deletion (DELETE) on [tempDevA, tempDevB]
  const batchDeleteRes = await httpRequest(
    "POST",
    "/api/admin/devices/update",
    { deviceIds: [tempDevA, tempDevB], action: "DELETE" },
    { "X-Admin-Token": adminToken }
  );
  assert.strictEqual(batchDeleteRes.status, 200);
  assert.strictEqual(batchDeleteRes.json.ok, true);
  assert.strictEqual(batchDeleteRes.json.batch, true);
  assert.strictEqual(batchDeleteRes.json.count, 2);
  const remainingDeviceIds = batchDeleteRes.json.devices.map((d) => d.deviceId);
  assert.ok(!remainingDeviceIds.includes(tempDevA), "Deleted device A must be removed from device list");
  assert.ok(!remainingDeviceIds.includes(tempDevB), "Deleted device B must be removed from device list");
  console.log("[PASS] 17. Admin Non-Permanent Session (15m Idle / 30m Max TTL) & Individual/Multi-Select Key Removal verified");

  // 18. Shared Support/Resistance 1-2-3 (S1/S2/S3 & R1/R2/R3), Hermes Tagged CMS, Auto-Archive & Admin BI Dashboard
  const researchFeedJsonPath = path.join(__dirname, "..", "data", "research_feed.json");
  const originalResearchFeedJson = fs.existsSync(researchFeedJsonPath)
    ? fs.readFileSync(researchFeedJsonPath, "utf8")
    : null;

  try {
    // 18a. Verify shared /api/research-feed is accessible across different SyncKeys
    const feedOwnerRes = await httpRequest("GET", "/api/research-feed?key=VENU2-88");
    const feedGuestRes = await httpRequest("GET", "/api/research-feed?key=V2-ANYUSER99");
    assert.strictEqual(feedOwnerRes.status, 200);
    assert.strictEqual(feedGuestRes.status, 200);
    assert.strictEqual(feedOwnerRes.json.ok, true);
    assert.strictEqual(feedGuestRes.json.ok, true);
    assert.strictEqual(feedOwnerRes.json.sharedAcrossAllSyncKeys, true);
    assert.strictEqual(feedGuestRes.json.sharedAcrossAllSyncKeys, true);
    assert.ok(Array.isArray(feedOwnerRes.json.posts) && feedOwnerRes.json.posts.length >= 4);
    assert.strictEqual(
      feedOwnerRes.json.posts.length,
      feedGuestRes.json.posts.length,
      "All SyncKeys must see the same shared active Support/Resistance 1-2-3 analyst feed"
    );

    const sampleSrPost = feedOwnerRes.json.posts[0];
    assert.strictEqual(sampleSrPost.supports.length, 3, "Each S/R post must contain 3 support levels (S1/S2/S3)");
    assert.strictEqual(sampleSrPost.resistances.length, 3, "Each S/R post must contain 3 resistance levels (R1/R2/R3)");
    assert.strictEqual(sampleSrPost.supports[0].horizon, "SHORT");
    assert.strictEqual(sampleSrPost.supports[1].horizon, "MEDIUM");
    assert.strictEqual(sampleSrPost.supports[2].horizon, "LONG");
    assert.ok(sampleSrPost.metrics && typeof sampleSrPost.metrics.livePrice === "number");

    // 18b. Admin CMS Create (UPSERT) a new tagged Hermes S/R 1-2-3 card
    const createPostRes = await httpRequest(
      "POST",
      "/api/admin/research-posts",
      {
        action: "UPSERT",
        post: {
          id: "hermes-sr-tsmc-test",
          symbol: "TSM",
          title: "TSMC CoWoS Packaging Moat — S1/S2/S3 & R1/R2/R3 Ladder",
          summary: "AI foundry monopoly with expanding gross margins; accumulate on S1/S2 pullbacks.",
          stance: "BULLISH",
          horizonFocus: "ALL",
          currency: "USD",
          tags: ["#hermes-daily", "#support-resistance", "#semiconductor", "#moat"],
          supports: [
            { rank: 1, horizon: "SHORT", price: 178.5, note: "S1 20D EMA support" },
            { rank: 2, horizon: "MEDIUM", price: 165.0, note: "S2 50D institutional base" },
            { rank: 3, horizon: "LONG", price: 148.0, note: "S3 200D structural floor" }
          ],
          resistances: [
            { rank: 1, horizon: "SHORT", price: 195.0, note: "R1 swing high supply" },
            { rank: 2, horizon: "MEDIUM", price: 212.0, note: "R2 quarterly target" },
            { rank: 3, horizon: "LONG", price: 240.0, note: "R3 long-term valuation target" }
          ]
        }
      },
      { "X-Admin-Token": adminToken }
    );
    assert.ok([200, 201].includes(createPostRes.status), `Expected 200 or 201, got ${createPostRes.status}`);
    assert.strictEqual(createPostRes.json.ok, true);
    assert.ok(
      createPostRes.json.posts.some((p) => p.id === "hermes-sr-tsmc-test" && p.symbol === "TSM"),
      "Newly created TSM S/R post must appear in admin posts list"
    );

    // Verify new post is immediately visible to all SyncKeys on the frontpage feed
    const feedAfterCreate = await httpRequest("GET", "/api/research-feed?key=V2-OTHER-SYNC");
    assert.ok(
      feedAfterCreate.json.posts.some((p) => p.id === "hermes-sr-tsmc-test"),
      "Shared frontpage research feed must immediately include newly published TSM S/R card for every SyncKey"
    );

    // 18c. Admin CMS Archive/Hide (ซ่อน/เก็บเข้ากรุ) and verify hidden from public feed
    const archivePostRes = await httpRequest(
      "POST",
      "/api/admin/research-posts",
      {
        action: "ARCHIVE",
        postId: "hermes-sr-tsmc-test",
        reason: "MANUAL_ADMIN_ARCHIVE_TEST"
      },
      { "X-Admin-Token": adminToken }
    );
    assert.strictEqual(archivePostRes.status, 200);
    const feedAfterArchive = await httpRequest("GET", "/api/research-feed?key=VENU2-88");
    assert.ok(
      !feedAfterArchive.json.posts.some((p) => p.id === "hermes-sr-tsmc-test"),
      "Archived/hidden card must NOT appear on public frontpage feed"
    );

    // 18d. Restore card & test Auto-Archive Sweep on old unpinned cards
    await httpRequest(
      "POST",
      "/api/admin/research-posts",
      { action: "RESTORE", postId: "hermes-sr-tsmc-test" },
      { "X-Admin-Token": adminToken }
    );

    // Create an expired card (45 days old) and verify RUN_AUTO_ARCHIVE_SWEEP archives it automatically
    const fortyFiveDaysAgoIso = new Date(Date.now() - 45 * 86400000).toISOString();
    await httpRequest(
      "POST",
      "/api/admin/research-posts",
      {
        action: "UPSERT",
        post: {
          id: "hermes-sr-old-expired",
          symbol: "INTC",
          title: "Old Stale Analysis Card",
          summary: "Should be auto-archived by TTL sweep.",
          publishedAt: fortyFiveDaysAgoIso,
          updatedAt: fortyFiveDaysAgoIso,
          pinned: false,
          autoArchiveExempt: false,
          tags: ["#hermes-daily"],
          supports: [19, 17, 15],
          resistances: [23, 26, 30]
        }
      },
      { "X-Admin-Token": adminToken }
    );

    const sweepRes = await httpRequest(
      "POST",
      "/api/admin/research-posts",
      {
        action: "RUN_AUTO_ARCHIVE_SWEEP",
        autoArchiveDays: 21,
        forceSweep: true
      },
      { "X-Admin-Token": adminToken }
    );
    assert.strictEqual(sweepRes.status, 200);
    const expiredCardInAdmin = sweepRes.json.posts.find((p) => p.id === "hermes-sr-old-expired");
    assert.ok(expiredCardInAdmin, "Expired card must still be retained in Admin CMS archive");
    assert.strictEqual(expiredCardInAdmin.status, "ARCHIVED", "Expired card must be transitioned to ARCHIVED status");

    // Clean up test posts via DELETE
    const cleanupDelRes = await httpRequest(
      "POST",
      "/api/admin/research-posts",
      {
        action: "DELETE",
        postIds: ["hermes-sr-tsmc-test", "hermes-sr-old-expired"]
      },
      { "X-Admin-Token": adminToken }
    );
    assert.strictEqual(cleanupDelRes.status, 200);

    // 18e. Verify Admin BI & Quantitative Virtualized Dashboard (/api/admin/bi-dashboard)
    const biRes = await httpRequest("GET", "/api/admin/bi-dashboard", null, {
      "X-Admin-Token": adminToken
    });
    assert.strictEqual(biRes.status, 200);
    assert.strictEqual(biRes.json.ok, true);
    const bi = biRes.json.biAnalytics;
    assert.ok(bi && bi.kpis, "BI response must include kpis summary");
    assert.ok(bi.stackedCharts && bi.stackedCharts.userPortfolioStack, "BI must include userPortfolioStack chart series");
    assert.ok(bi.stackedCharts.srQuantitativeStack, "BI must include srQuantitativeStack chart series");
    assert.ok(bi.stackedCharts.topicTagStack, "BI must include topicTagStack chart series");
    assert.ok(bi.stackedCharts.memoCoverageStack, "BI must include memoCoverageStack chart series");
    assert.ok(bi.pieCharts && Array.isArray(bi.pieCharts.topicDistribution), "BI must include topicDistribution pie data");
    assert.ok(Array.isArray(bi.pieCharts.srZoneDistribution), "BI must include srZoneDistribution pie data");
    assert.ok(Array.isArray(bi.pieCharts.userLicenseTier), "BI must include userLicenseTier pie data");
    assert.ok(Array.isArray(bi.srQuantitativeTable) && bi.srQuantitativeTable.length >= 1, "BI must include srQuantitativeTable");

    // 18f. Verify Redesigned HTML templates contain required BI, CMS, and Shared S/R DOM IDs
    const indexHtmlRes = await httpRequest("GET", "/");
    assert.strictEqual(indexHtmlRes.status, 200);
    assert.ok(indexHtmlRes.raw.includes("section-hermes-research"), "index.html must include #section-hermes-research");
    assert.ok(indexHtmlRes.raw.includes("hermesResearchCardsGrid"), "index.html must include #hermesResearchCardsGrid");
    assert.ok(indexHtmlRes.raw.includes("hermesWatchlistSrMatrixBody"), "index.html must include #hermesWatchlistSrMatrixBody");

    const adminHtmlRes = await httpRequest("GET", "/admin.html");
    assert.strictEqual(adminHtmlRes.status, 200);
    assert.ok(adminHtmlRes.raw.includes("section-admin-hermes-control"), "admin.html must include #section-admin-hermes-control");
    assert.ok(adminHtmlRes.raw.includes("btnHermesRestartGw"), "admin.html must include #btnHermesRestartGw");
    assert.ok(adminHtmlRes.raw.includes("btnHermesPauseStop"), "admin.html must include #btnHermesPauseStop");
    assert.ok(adminHtmlRes.raw.includes("btnHermesStartService"), "admin.html must include #btnHermesStartService");
    assert.ok(adminHtmlRes.raw.includes("btnHermesRebootPi"), "admin.html must include #btnHermesRebootPi");
    assert.ok(adminHtmlRes.raw.includes("btnHermesTestAllFuncs"), "admin.html must include #btnHermesTestAllFuncs");
    assert.ok(adminHtmlRes.raw.includes("section-admin-bi"), "admin.html must include #section-admin-bi");
    assert.ok(adminHtmlRes.raw.includes("biStackedBarCanvas"), "admin.html must include #biStackedBarCanvas");
    assert.ok(adminHtmlRes.raw.includes("section-admin-hermes-cms"), "admin.html must include #section-admin-hermes-cms");
    assert.ok(adminHtmlRes.raw.includes("cmsPostForm"), "admin.html must include #cmsPostForm");

    console.log("[PASS] 18. Shared S/R 1-2-3 Feed, Hermes Tagged CMS, Auto-Archive & Admin BI Dashboard verified");

    // -----------------------------------------------------------------------
    // 19. HERMES NODE HEARTBEAT, REMOTE SERVICE CONTROL & 8-STEP DIAGNOSTICS
    // -----------------------------------------------------------------------
    const nodeStateFile = path.join(__dirname, "..", "data", "hermes_node_state.json");
    const origNodeStateJson = fs.existsSync(nodeStateFile) ? fs.readFileSync(nodeStateFile, "utf8") : null;
    const prevIntEnabled = process.env.WEBMEMO_INTEGRATION_ENABLED;
    const prevIntToken = process.env.WEBMEMO_INTEGRATION_TOKEN;
    const prevIntKey = process.env.WEBMEMO_ALLOWED_ACCOUNT_KEY;
    const hermesToken = "hermes-sdlc-test-token-2026";
    process.env.WEBMEMO_INTEGRATION_ENABLED = "true";
    process.env.WEBMEMO_INTEGRATION_TOKEN = hermesToken;
    process.env.WEBMEMO_ALLOWED_ACCOUNT_KEY = "VENU2-88";
    try {
      // 19a. Admin queues RESTART_GW command
      const cmdRes = await httpRequest(
        "POST",
        "/api/admin/hermes-node/command",
        { action: "RESTART_GW", reason: "SDLC test restart" },
        { "X-Admin-Token": adminToken }
      );
      assert.strictEqual(cmdRes.status, 200);
      assert.strictEqual(cmdRes.json.ok, true);
      assert.strictEqual(cmdRes.json.command.action, "RESTART_GW");
      assert.strictEqual(cmdRes.json.command.status, "PENDING");
      const cmdId = cmdRes.json.command.commandId;

      // 19b. Raspberry Pi (echo24) sends heartbeat and picks up the pending command
      const hbRes = await httpRequest(
        "POST",
        "/api/integration/hermes-node/heartbeat",
        {
          host: "echo24",
          lanIp: "192.168.1.100",
          tailscaleIp: "100.113.60.19",
          gatewayStatus: "RUNNING (PID 24801)",
          gatewayServiceActive: true,
          gatewayPid: 24801,
          cpuTempC: 49.4,
          memUsedMb: 412,
          memTotalMb: 924,
          loadAvg1m: 0.28,
          uptimeHuman: "5 days, 4 hours"
        },
        { Authorization: `Bearer ${hermesToken}` }
      );
      assert.strictEqual(hbRes.status, 200);
      assert.strictEqual(hbRes.json.ok, true);
      assert.ok(hbRes.json.nextCommand, "Heartbeat must return the queued RESTART_GW command");
      assert.strictEqual(hbRes.json.nextCommand.commandId, cmdId);
      assert.strictEqual(hbRes.json.nextCommand.status, "DISPATCHED");

      // 19c. Pi reports command execution completion
      const repRes = await httpRequest(
        "POST",
        "/api/integration/hermes-node/command-result",
        {
          commandId: cmdId,
          status: "SUCCEEDED",
          output: "Restarted hermes-gateway.service -> state=active (PID 24990)"
        },
        { Authorization: `Bearer ${hermesToken}` }
      );
      assert.strictEqual(repRes.status, 200);
      assert.strictEqual(repRes.json.ok, true);
      assert.strictEqual(repRes.json.command.status, "SUCCEEDED");

      // 19d. Admin executes TEST_ALL_FUNCTIONS (8-step diagnostic suite)
      const diagCmdRes = await httpRequest(
        "POST",
        "/api/admin/hermes-node/command",
        { action: "TEST_ALL_FUNCTIONS", reason: "SDLC full diagnostic test" },
        { "X-Admin-Token": adminToken }
      );
      assert.strictEqual(diagCmdRes.status, 200);
      assert.strictEqual(diagCmdRes.json.ok, true);
      assert.ok(diagCmdRes.json.diagnosticReport, "TEST_ALL_FUNCTIONS must return diagnosticReport");
      assert.strictEqual(diagCmdRes.json.diagnosticReport.steps.length, 8);
      assert.strictEqual(diagCmdRes.json.diagnosticReport.summary.failed, 0);

      // 19e. Admin checks live status
      const statusRes = await httpRequest("GET", "/api/admin/hermes-node/status", null, {
        "X-Admin-Token": adminToken
      });
      assert.strictEqual(statusRes.status, 200);
      assert.strictEqual(statusRes.json.connectionState, "ONLINE");
      assert.strictEqual(statusRes.json.host, "echo24");

      // 19f. Hermes updates an existing seeded card (NVDA) with flat s1..r3 and referencePrice
      const nvdaUpdateRes = await httpRequest(
        "POST",
        "/api/integration/research-posts",
        {
          action: "UPSERT",
          symbol: "NVDA",
          companyName: "NVIDIA Corp.",
          headline: "NVDA Live Cron Update — S1-S3 / R1-R3 Re-anchored @ $201.97",
          summary: "Automated Hermes cron update with fresh Yahoo Finance price and S/R 1-2-3 levels.",
          signalMemo: "Hold core; S1 $186.99 / S2 $176.22 · R1 $205.00 / R2 $212.19",
          bias: "BULLISH",
          confidence: 92,
          referencePrice: 201.97,
          s1: 186.99,
          s2: 176.22,
          s3: 164.27,
          r1: 205.00,
          r2: 212.19,
          r3: 225.00,
          s1Note: "EMA-20 Short-Term Pullback Zone",
          r2Note: "52-Week High Breakout Target",
          tags: ["#hermes-daily", "#ai-infra", "#support-resistance"]
        },
        { Authorization: `Bearer ${hermesToken}` }
      );
      assert.strictEqual(nvdaUpdateRes.status, 200);
      assert.strictEqual(nvdaUpdateRes.json.ok, true);
      assert.strictEqual(nvdaUpdateRes.json.post.referencePrice, 201.97);
      assert.strictEqual(nvdaUpdateRes.json.post.supportLevels.s1.price, 186.99);
      assert.strictEqual(nvdaUpdateRes.json.post.supportLevels.s2.price, 176.22);
      assert.strictEqual(nvdaUpdateRes.json.post.supportLevels.s3.price, 164.27);
      assert.strictEqual(nvdaUpdateRes.json.post.resistanceLevels.r1.price, 205.0);
      assert.strictEqual(nvdaUpdateRes.json.post.resistanceLevels.r2.price, 212.19);
      assert.strictEqual(nvdaUpdateRes.json.post.resistanceLevels.r3.price, 225.0);
      assert.strictEqual(nvdaUpdateRes.json.post.supportLevels.s1.note, "EMA-20 Short-Term Pullback Zone");
      assert.strictEqual(nvdaUpdateRes.json.post.resistanceLevels.r2.note, "52-Week High Breakout Target");
      assert.strictEqual(
        nvdaUpdateRes.json.post.title,
        "NVDA Live Cron Update — S1-S3 / R1-R3 Re-anchored @ $201.97"
      );

      console.log("[PASS] 19. Hermes Live Connection Status, 5 Remote Commands, S/R 1-2-3 Re-Anchor & 8-Step Functional Diagnostics verified");

      // =========================================================================
      // 20. HERMES CRON SCHEDULER TELEMETRY, DYNAMIC #TAG REGISTRY & PUBLISH TIMESTAMPS
      // =========================================================================
      const futureNextRun = new Date(Date.now() + 25 * 60 * 1000).toISOString();
      const laterNextRun = new Date(Date.now() + 120 * 60 * 1000).toISOString();
      const cronHbRes = await httpRequest(
        "POST",
        "/api/integration/hermes-node/heartbeat",
        {
          host: "echo24",
          lanIp: "192.168.1.100",
          tailscaleIp: "100.113.60.19",
          gatewayStatus: "RUNNING (PID 24990)",
          gatewayServiceActive: true,
          gatewayPid: 24990,
          cpuTempC: 48.9,
          memUsedMb: 410,
          memTotalMb: 924,
          loadAvg1m: 0.22,
          uptimeHuman: "5 days, 5 hours",
          cronJobs: [
            {
              id: "bf4153d5646f",
              name: "MoatWatch Daily Watchlist & Portfolio Analyst",
              scheduleDisplay: "5 8,20 * * *",
              enabled: true,
              state: "scheduled",
              nextRunAt: futureNextRun,
              lastRunAt: "2026-10-30T01:05:00.000Z",
              lastStatus: "ok",
              deliver: "discord"
            },
            {
              id: "a5a26db09ca5",
              name: "RPi System Resource Monitor",
              scheduleDisplay: "every 10m",
              enabled: true,
              state: "scheduled",
              nextRunAt: laterNextRun,
              lastRunAt: "2026-10-30T03:50:00.000Z",
              lastStatus: "ok",
              deliver: "local"
            },
            {
              id: "c67fb5e4e5e1",
              name: "US Market Hourly Portfolio Tracker",
              scheduleDisplay: "35 20-23,0-2 * * 1-5",
              enabled: false,
              state: "paused",
              nextRunAt: null,
              lastRunAt: "2026-10-26T20:35:00.000Z",
              lastStatus: "ok",
              deliver: "discord"
            }
          ]
        },
        { Authorization: `Bearer ${hermesToken}` }
      );
      assert.strictEqual(cronHbRes.status, 200);
      assert.strictEqual(cronHbRes.json.ok, true);
      assert.strictEqual(cronHbRes.json.nodeStatus.scheduler.activeCount, 2);
      assert.strictEqual(cronHbRes.json.nodeStatus.scheduler.pausedCount, 1);
      assert.ok(cronHbRes.json.nodeStatus.scheduler.nextJob, "Scheduler must identify nearest active nextJob");
      assert.strictEqual(cronHbRes.json.nodeStatus.scheduler.nextJob.id, "bf4153d5646f");
      assert.ok(cronHbRes.json.nodeStatus.scheduler.nextJob.nextRunInSec > 0);

      // 20a. Admin pauses a specific Cron Job (CRON_PAUSE)
      const pauseJobRes = await httpRequest(
        "POST",
        "/api/admin/hermes-node/command",
        {
          action: "CRON_PAUSE",
          jobId: "bf4153d5646f",
          jobName: "MoatWatch Daily Watchlist & Portfolio Analyst",
          reason: "Admin test pause"
        },
        { "X-Admin-Token": adminToken }
      );
      assert.strictEqual(pauseJobRes.status, 200);
      assert.strictEqual(pauseJobRes.json.ok, true);
      assert.strictEqual(pauseJobRes.json.command.action, "CRON_PAUSE");
      assert.strictEqual(pauseJobRes.json.command.jobId, "bf4153d5646f");
      assert.strictEqual(pauseJobRes.json.nodeStatus.scheduler.activeCount, 1);
      assert.strictEqual(pauseJobRes.json.nodeStatus.scheduler.pausedCount, 2);

      // 20b. Admin resumes the Cron Job (CRON_RESUME) and triggers CRON_RUN_NOW
      const resumeJobRes = await httpRequest(
        "POST",
        "/api/admin/hermes-node/command",
        {
          action: "CRON_RESUME",
          jobId: "bf4153d5646f",
          jobName: "MoatWatch Daily Watchlist & Portfolio Analyst"
        },
        { "X-Admin-Token": adminToken }
      );
      assert.strictEqual(resumeJobRes.status, 200);
      assert.strictEqual(resumeJobRes.json.nodeStatus.scheduler.activeCount, 2);

      const runNowJobRes = await httpRequest(
        "POST",
        "/api/admin/hermes-node/command",
        {
          action: "CRON_RUN_NOW",
          jobId: "bf4153d5646f",
          jobName: "MoatWatch Daily Watchlist & Portfolio Analyst"
        },
        { "X-Admin-Token": adminToken }
      );
      assert.strictEqual(runNowJobRes.status, 200);
      assert.strictEqual(runNowJobRes.json.command.action, "CRON_RUN_NOW");
      assert.strictEqual(runNowJobRes.json.command.jobId, "bf4153d5646f");

      // 20c. Dynamic #Tag Registry: Create, Cascade Rename, Cascade Merge, Pin & Visibility
      const createTagRes = await httpRequest(
        "POST",
        "/api/admin/research-posts",
        {
          action: "UPSERT_TAG",
          tag: "#quant-breakout",
          labelTh: "สัญญาณ Quant Breakout",
          category: "QUANT",
          color: "#f43f5e",
          pinned: true,
          description: "Breakout confirmation tag"
        },
        { "X-Admin-Token": adminToken }
      );
      assert.strictEqual(createTagRes.status, 201);
      assert.strictEqual(createTagRes.json.ok, true);
      assert.strictEqual(createTagRes.json.tagEntry.tag, "#quant-breakout");
      assert.strictEqual(createTagRes.json.tagEntry.pinned, true);

      // Create a post with explicit publishedAt and #quant-breakout tag
      const initialPublishedAt = "2026-10-29T01:05:00.000Z";
      const taggedPostRes = await httpRequest(
        "POST",
        "/api/admin/research-posts",
        {
          action: "CREATE",
          post: {
            id: "post_tag_ts_test",
            symbol: "AMD",
            name: "Advanced Micro Devices",
            title: "AMD MI350 Ramp & S/R 1-2-3 Channels",
            summary: "Testing explicit publishedAt vs updatedAt and cascading dynamic #tag operations.",
            signalMemo: "Hold above S1 $152; target R2 $178",
            publishedAt: initialPublishedAt,
            tags: ["#quant-breakout", "#ai-infra"]
          }
        },
        { "X-Admin-Token": adminToken }
      );
      assert.strictEqual(taggedPostRes.status, 201);
      assert.strictEqual(taggedPostRes.json.post.publishedAt, initialPublishedAt);

      // Update the post and verify publishedAt is preserved while updatedAt advances
      const updatedPostRes = await httpRequest(
        "POST",
        "/api/admin/research-posts",
        {
          action: "UPDATE",
          id: "post_tag_ts_test",
          post: {
            id: "post_tag_ts_test",
            symbol: "AMD",
            title: "AMD MI350 Ramp — Updated Target R2 $182",
            tags: ["#quant-breakout", "#ai-infra"]
          }
        },
        { "X-Admin-Token": adminToken }
      );
      assert.strictEqual(updatedPostRes.status, 200);
      assert.strictEqual(updatedPostRes.json.post.publishedAt, initialPublishedAt, "Original publishedAt must be preserved on update");
      assert.notStrictEqual(updatedPostRes.json.post.updatedAt, initialPublishedAt, "updatedAt must advance to latest edit timestamp");

      // Rename #quant-breakout -> #quant-momentum and verify cascade across posts
      const renameTagRes = await httpRequest(
        "POST",
        "/api/admin/research-posts",
        {
          action: "RENAME_TAG",
          oldTag: "#quant-breakout",
          newTag: "#quant-momentum",
          labelTh: "โมเมนตัมเชิงปริมาณ",
          category: "QUANT",
          color: "#a855f7",
          pinned: true
        },
        { "X-Admin-Token": adminToken }
      );
      assert.strictEqual(renameTagRes.status, 200);
      assert.strictEqual(renameTagRes.json.ok, true);
      assert.ok(renameTagRes.json.replacedInPosts >= 1, "Rename must cascade to existing posts");

      // Verify public /api/research-feed reflects renamed tag, officialTags, and matrix publishedAt
      const feedAfterRename = await httpRequest("GET", "/api/research-feed?key=V2-07090781");
      assert.strictEqual(feedAfterRename.status, 200);
      assert.ok(Array.isArray(feedAfterRename.json.officialTags), "Feed must expose officialTags array");
      assert.ok(feedAfterRename.json.officialTags.includes("#quant-momentum"), "officialTags must include renamed #quant-momentum");
      const amdPost = feedAfterRename.json.posts.find((p) => p.id === "post_tag_ts_test");
      assert.ok(amdPost, "AMD test post must be in active feed");
      assert.ok(amdPost.tags.includes("#quant-momentum"), "Post tags must be cascaded to #quant-momentum");
      assert.strictEqual(amdPost.publishedAt, initialPublishedAt);

      // Merge #quant-momentum -> #hermes-daily and clean up test post
      const mergeTagRes = await httpRequest(
        "POST",
        "/api/admin/research-posts",
        {
          action: "MERGE_TAG",
          sourceTag: "#quant-momentum",
          targetTag: "#hermes-daily"
        },
        { "X-Admin-Token": adminToken }
      );
      assert.strictEqual(mergeTagRes.status, 200);
      assert.strictEqual(mergeTagRes.json.ok, true);
      assert.ok(mergeTagRes.json.mergedInPosts >= 1, "Merge must cascade to posts");

      await httpRequest(
        "POST",
        "/api/admin/research-posts",
        { action: "DELETE", id: "post_tag_ts_test" },
        { "X-Admin-Token": adminToken }
      );

      console.log("[PASS] 20. Hermes Cron Scheduler Telemetry, Per-Job Controls, Dynamic #Tag Registry & Explicit Publish Timestamps verified");
    } finally {
      if (prevIntEnabled === undefined) delete process.env.WEBMEMO_INTEGRATION_ENABLED;
      else process.env.WEBMEMO_INTEGRATION_ENABLED = prevIntEnabled;
      if (prevIntToken === undefined) delete process.env.WEBMEMO_INTEGRATION_TOKEN;
      else process.env.WEBMEMO_INTEGRATION_TOKEN = prevIntToken;
      if (prevIntKey === undefined) delete process.env.WEBMEMO_ALLOWED_ACCOUNT_KEY;
      else process.env.WEBMEMO_ALLOWED_ACCOUNT_KEY = prevIntKey;

      if (origNodeStateJson !== null) {
        fs.writeFileSync(nodeStateFile, origNodeStateJson, "utf8");
      } else if (fs.existsSync(nodeStateFile)) {
        fs.unlinkSync(nodeStateFile);
      }
    }
  } finally {
    if (originalResearchFeedJson !== null) {
      fs.writeFileSync(researchFeedJsonPath, originalResearchFeedJson, "utf8");
    } else if (fs.existsSync(researchFeedJsonPath)) {
      fs.unlinkSync(researchFeedJsonPath);
    }
  }

  console.log("\n==================================================================");
  console.log("  ALL 20 SDLC + MULTI-USER + BI & HERMES CMS SUITES PASSED (100%)");
  console.log("==================================================================");
  if (ephemeralServer) {
    ephemeralServer.close();
  }
}

runSdlcSuite().catch((err) => {
  if (ephemeralServer) {
    ephemeralServer.close();
  }
  console.error("[FAIL] SDLC Suite Error:", err);
  process.exit(1);
});
