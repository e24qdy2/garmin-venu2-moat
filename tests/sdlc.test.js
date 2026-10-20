const assert = require("assert");
const http = require("http");

const BASE_URL = "http://localhost:3880";

function httpRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(path, BASE_URL);
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
  console.log("==========================================================");
  console.log("  Venu2Moat Phase 2 SDLC Automated Verification Suite");
  console.log("==========================================================\n");

  const testDeviceId = "V2-SDLC9901";

  // 1. Subdomain Routing Check (admin-moat.readybyte.top -> Admin Portal HTML)
  const adminHtmlRes = await httpRequest("GET", "/", null, {
    Host: "admin-moat.readybyte.top"
  });
  assert.strictEqual(adminHtmlRes.status, 200, "Admin subdomain should return HTTP 200");
  assert.ok(
    adminHtmlRes.raw.includes("Venu2Moat Admin") &&
      adminHtmlRes.raw.includes("saharabu@scg.com"),
    "Admin subdomain HTML should render Admin Portal with owner email saharabu@scg.com"
  );
  console.log("[PASS] 1. Subdomain routing (Host: admin-moat.readybyte.top -> Admin Portal UI)");

  // 2. Watch Display Settings (Auto-Swipe 5s default + custom seconds + Optional Always-On Display)
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

  // Restore default 5s auto-swipe and Always-On false (optional)
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
  console.log("[PASS] 2. Web -> Watch Auto-Swipe (default 5s & custom 9s) + Optional Always-On Display sync");

  // 3. Admin Auth Gate (401 without token, Cloudflare Zero Trust & 6-digit OTP for saharabu@scg.com)
  const unauthRes = await httpRequest("GET", "/api/admin/devices");
  assert.strictEqual(unauthRes.status, 401, "Unauthenticated admin API call must return 401");

  // Verify Cloudflare Access header authentication
  const cfAuthSession = await httpRequest("GET", "/api/admin/session", null, {
    "Cf-Access-Authenticated-User-Email": "saharabu@scg.com"
  });
  assert.strictEqual(cfAuthSession.json.authenticated, true);
  assert.strictEqual(cfAuthSession.json.authMethod, "CLOUDFLARE_ACCESS_OTP");

  // Verify 6-digit OTP request & verification flow for saharabu@scg.com
  const otpReq = await httpRequest("POST", "/api/admin/auth/request-otp", {
    email: "saharabu@scg.com"
  });
  assert.strictEqual(otpReq.status, 200);
  assert.strictEqual(otpReq.json.ok, true);
  assert.strictEqual(otpReq.json.otpCode.length, 6);

  const otpVerify = await httpRequest("POST", "/api/admin/auth/verify-otp", {
    email: "saharabu@scg.com",
    code: otpReq.json.otpCode
  });
  assert.strictEqual(otpVerify.status, 200);
  assert.strictEqual(otpVerify.json.ok, true);
  const adminToken = otpVerify.json.token;
  assert.ok(adminToken && adminToken.length > 20);
  console.log("[PASS] 3. Cloudflare Zero Trust & 6-Digit Admin OTP Authentication (saharabu@scg.com)");

  // 4. 14-Day Free Trial Initialization for New Device
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
  assert.ok(watchTrialRes.json.lic.days >= 13 && watchTrialRes.json.lic.days <= 14);
  assert.strictEqual(watchTrialRes.json.lic.own, "saharabu@scg.com");
  console.log("[PASS] 4. 14-Day Free Trial auto-registration & countdown telemetry");

  // 5. Simulate 14-Day Trial Expiration via Admin API & Verify Watch Lock State
  const expireRes = await httpRequest(
    "POST",
    "/api/admin/devices/update",
    { action: "EXPIRE_TRIAL", deviceId: testDeviceId },
    { "X-Admin-Token": adminToken }
  );
  assert.strictEqual(expireRes.status, 200);
  assert.strictEqual(expireRes.json.device.status, "EXPIRED");
  assert.strictEqual(expireRes.json.device.isExpired, true);

  const watchExpiredRes = await httpRequest(
    "GET",
    `/api/watch?key=VENU2-88&did=${encodeURIComponent(testDeviceId)}`
  );
  assert.strictEqual(watchExpiredRes.json.lic.st, "EXPIRED");
  assert.strictEqual(watchExpiredRes.json.lic.exp, 1);
  assert.strictEqual(watchExpiredRes.json.lic.days, 0);
  assert.strictEqual(watchExpiredRes.json.lic.own, "saharabu@scg.com");
  console.log("[PASS] 5. 14-Day Trial Expiration locks watch payload & displays owner saharabu@scg.com");

  // 6. Admin Per-Device Activation Key Generator & Device Unlock Verification
  const genKeyRes = await httpRequest(
    "POST",
    "/api/admin/devices/generate-key",
    { deviceId: testDeviceId, label: "SDLC Automated Test Watch" },
    { "X-Admin-Token": adminToken }
  );
  assert.strictEqual(genKeyRes.status, 200);
  const generatedKey = genKeyRes.json.activationKey;
  assert.match(generatedKey, /^MOAT-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  // Reject wrong key first
  const badActivateRes = await httpRequest("POST", "/api/device/activate", {
    syncKey: "VENU2-88",
    deviceId: testDeviceId,
    activationKey: "MOAT-0000-0000-0000"
  });
  assert.strictEqual(badActivateRes.status, 400);

  // Activate with valid per-device key
  const goodActivateRes = await httpRequest("POST", "/api/device/activate", {
    syncKey: "VENU2-88",
    deviceId: testDeviceId,
    activationKey: generatedKey
  });
  assert.strictEqual(goodActivateRes.status, 200);
  assert.strictEqual(goodActivateRes.json.ok, true);
  assert.strictEqual(goodActivateRes.json.license.status, "ACTIVE");
  assert.strictEqual(goodActivateRes.json.license.isExpired, false);

  const watchActiveRes = await httpRequest(
    "GET",
    `/api/watch?key=VENU2-88&did=${encodeURIComponent(testDeviceId)}`
  );
  assert.strictEqual(watchActiveRes.json.lic.st, "ACTIVE");
  assert.strictEqual(watchActiveRes.json.lic.exp, 0);
  console.log(`[PASS] 6. Per-Device Activation Key (${generatedKey}) verified & unlocked ${testDeviceId}`);

  // Reset primary demo device V2-88VENU20 to fresh 14-day trial so user's default simulator & watch start unlocked
  await httpRequest(
    "POST",
    "/api/admin/devices/update",
    { action: "RESET_TRIAL", deviceId: "V2-88VENU20" },
    { "X-Admin-Token": adminToken }
  );
  await httpRequest("PUT", "/api/portfolio", {
    syncKey: "VENU2-88",
    watchSettings: {
      autoSwipeEnabled: true,
      autoSwipeSec: 5,
      alwaysOnDisplay: false,
      deviceId: "V2-88VENU20",
      activationKey: ""
    }
  });

  console.log("\n==========================================================");
  console.log("  ALL 6 SDLC TEST SUITES PASSED (100% GREEN)");
  console.log("==========================================================");
}

runSdlcSuite().catch((err) => {
  console.error("[FAIL] SDLC Suite Error:", err);
  process.exit(1);
});
