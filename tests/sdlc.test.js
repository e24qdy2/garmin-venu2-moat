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
  console.log("  Venu2Moat SDLC + Security VA + Garmin 2024-2026 Automated Suite");
  console.log("==================================================================\n");

  const testDeviceId = "V2-SDLC9901";

  // 1. Subdomain Routing & Zero-Hint Security Check on Admin Portal HTML
  const adminHtmlRes = await httpRequest("GET", "/", null, {
    Host: "admin-moat.readybyte.top"
  });
  assert.strictEqual(adminHtmlRes.status, 200, "Admin subdomain should return HTTP 200");
  assert.ok(
    adminHtmlRes.raw.includes("Venu2Moat Admin") &&
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
    contactName: "คุณสมชาย ทดสอบระบบ",
    contactEmail: "investor@readybyte.top",
    contactPhone: "081-999-8888",
    message: "ขอต่ออายุทดลองใช้บนนาฬิกา Garmin เพิ่มเติม 14 วันครับ"
  });
  assert.strictEqual(trialExtendReqRes.status, 200);
  assert.strictEqual(trialExtendReqRes.json.ok, true);
  assert.strictEqual(trialExtendReqRes.json.emailDelivery.recipientEmail, "e24qdy2@gmail.com");

  const purchaseReqRes = await httpRequest("POST", "/api/license/request", {
    requestType: "PURCHASE_LICENSE",
    deviceId: testDeviceId,
    syncKey: "VENU2-88",
    contactName: "คุณสมชาย ทดสอบระบบ",
    contactEmail: "investor@readybyte.top",
    contactPhone: "LINE: @investor_moat",
    message: "ต้องการซื้อ License ถาวรสำหรับ Garmin กรุณาติดต่อกลับครับ"
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

  console.log("\n==================================================================");
  console.log("  ALL 13 SDLC + DEEP MODULE + CLOUDFLARE WORKER SUITES PASSED (100%)");
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
