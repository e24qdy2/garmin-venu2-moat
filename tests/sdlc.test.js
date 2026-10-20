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

  // 1. Subdomain Routing Check (admin-moat.readybyte.top -> Admin Portal HTML with Password Login & Change Password)
  const adminHtmlRes = await httpRequest("GET", "/", null, {
    Host: "admin-moat.readybyte.top"
  });
  assert.strictEqual(adminHtmlRes.status, 200, "Admin subdomain should return HTTP 200");
  assert.ok(
    adminHtmlRes.raw.includes("Venu2Moat Admin") &&
      adminHtmlRes.raw.includes("saharabu@scg.com") &&
      adminHtmlRes.raw.includes("adminPasswordLoginForm") &&
      adminHtmlRes.raw.includes("changeAdminPasswordForm"),
    "Admin subdomain HTML should render Admin Password Login & Change Password forms for saharabu@scg.com"
  );
  console.log("[PASS] 1. Subdomain routing (Host: admin-moat.readybyte.top -> Admin Password Portal UI)");

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

  // 3. Admin Password Login & Change Password (with Current Password Verification)
  const unauthRes = await httpRequest("GET", "/api/admin/devices");
  assert.strictEqual(unauthRes.status, 401, "Unauthenticated admin API call must return 401");

  // Reject wrong admin password
  const badLoginRes = await httpRequest("POST", "/api/admin/auth/login", {
    email: "saharabu@scg.com",
    password: "WRONG-PASSWORD-999"
  });
  assert.strictEqual(badLoginRes.status, 401, "Wrong admin password must return 401");
  assert.strictEqual(badLoginRes.json.ok, false);

  // Login with valid admin password
  const goodLoginRes = await httpRequest("POST", "/api/admin/auth/login", {
    email: "saharabu@scg.com",
    password: "SCG-888888"
  });
  assert.strictEqual(goodLoginRes.status, 200, "Valid admin password must return 200");
  assert.strictEqual(goodLoginRes.json.ok, true);
  assert.strictEqual(goodLoginRes.json.authMethod, "ADMIN_PASSWORD");
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
  assert.strictEqual(badCurrentPwdRes.json.ok, false);

  // Attempt change password with mismatched confirmPassword -> must fail (400)
  const mismatchPwdRes = await httpRequest(
    "POST",
    "/api/admin/auth/change-password",
    {
      currentPassword: "SCG-888888",
      newPassword: "NewAdmin@2026",
      confirmPassword: "DifferentConfirm@2026"
    },
    { "X-Admin-Token": adminToken }
  );
  assert.strictEqual(mismatchPwdRes.status, 400, "Mismatched confirm password must be rejected");

  // Change password with VALID currentPassword ("SCG-888888") -> "NewAdmin@2026"
  const changePwdSuccessRes = await httpRequest(
    "POST",
    "/api/admin/auth/change-password",
    {
      currentPassword: "SCG-888888",
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
    email: "saharabu@scg.com",
    password: "SCG-888888"
  });
  assert.strictEqual(oldPwdLoginAfterChange.status, 401, "Old password must no longer work after change");

  const newPwdLoginAfterChange = await httpRequest("POST", "/api/admin/auth/login", {
    email: "saharabu@scg.com",
    password: "NewAdmin@2026"
  });
  assert.strictEqual(newPwdLoginAfterChange.status, 200, "New password must authenticate successfully");
  assert.strictEqual(newPwdLoginAfterChange.json.ok, true);

  // Restore initial password "SCG-888888" by verifying currentPassword "NewAdmin@2026"
  const restorePwdRes = await httpRequest(
    "POST",
    "/api/admin/auth/change-password",
    {
      currentPassword: "NewAdmin@2026",
      newPassword: "SCG-888888",
      confirmPassword: "SCG-888888"
    },
    { "X-Admin-Token": adminToken }
  );
  assert.strictEqual(restorePwdRes.status, 200);
  assert.strictEqual(restorePwdRes.json.ok, true);
  assert.strictEqual(restorePwdRes.json.isDefaultPassword, true);
  console.log("[PASS] 3. Admin Password Login & Change Password with Current Password Verification (saharabu@scg.com)");

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
