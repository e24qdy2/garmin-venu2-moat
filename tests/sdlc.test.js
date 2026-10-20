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
      adminHtmlRes.raw.includes("saharat.bun@icloud.com") &&
      adminHtmlRes.raw.includes("e24qdy2@gmail.com") &&
      adminHtmlRes.raw.includes("adminPasswordLoginForm") &&
      adminHtmlRes.raw.includes("changeAdminPasswordForm"),
    "Admin subdomain HTML should render Admin Password Login & Change Password forms for saharat.bun@icloud.com"
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
    email: "saharat.bun@icloud.com",
    password: "WRONG-PASSWORD-999"
  });
  assert.strictEqual(badLoginRes.status, 401, "Wrong admin password must return 401");
  assert.strictEqual(badLoginRes.json.ok, false);

  // Login with valid admin password
  const goodLoginRes = await httpRequest("POST", "/api/admin/auth/login", {
    email: "saharat.bun@icloud.com",
    password: "MOAT-888888"
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
      currentPassword: "MOAT-888888",
      newPassword: "NewAdmin@2026",
      confirmPassword: "DifferentConfirm@2026"
    },
    { "X-Admin-Token": adminToken }
  );
  assert.strictEqual(mismatchPwdRes.status, 400, "Mismatched confirm password must be rejected");

  // Change password with VALID currentPassword ("MOAT-888888") -> "NewAdmin@2026"
  const changePwdSuccessRes = await httpRequest(
    "POST",
    "/api/admin/auth/change-password",
    {
      currentPassword: "MOAT-888888",
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
    password: "MOAT-888888"
  });
  assert.strictEqual(oldPwdLoginAfterChange.status, 401, "Old password must no longer work after change");

  const newPwdLoginAfterChange = await httpRequest("POST", "/api/admin/auth/login", {
    email: "saharat.bun@icloud.com",
    password: "NewAdmin@2026"
  });
  assert.strictEqual(newPwdLoginAfterChange.status, 200, "New password must authenticate successfully");
  assert.strictEqual(newPwdLoginAfterChange.json.ok, true);

  // Restore initial password "MOAT-888888" by verifying currentPassword "NewAdmin@2026"
  const restorePwdRes = await httpRequest(
    "POST",
    "/api/admin/auth/change-password",
    {
      currentPassword: "NewAdmin@2026",
      newPassword: "MOAT-888888",
      confirmPassword: "MOAT-888888"
    },
    { "X-Admin-Token": adminToken }
  );
  assert.strictEqual(restorePwdRes.status, 200);
  assert.strictEqual(restorePwdRes.json.ok, true);
  assert.strictEqual(restorePwdRes.json.isDefaultPassword, true);
  console.log("[PASS] 3. Admin Password Login & Change Password with Current Password Verification (saharat.bun@icloud.com)");

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
  assert.strictEqual(watchTrialRes.json.lic.own, "saharat.bun@icloud.com");
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
  assert.strictEqual(watchExpiredRes.json.lic.own, "saharat.bun@icloud.com");
  console.log("[PASS] 5. 14-Day Trial Expiration locks watch payload & displays owner saharat.bun@icloud.com");

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

  // 7. Customer Self-Service: Request Trial Key Extend & Purchase License Form + Email Notification to e24qdy2@gmail.com
  const trialExtendReqRes = await httpRequest("POST", "/api/license/request", {
    requestType: "TRIAL_EXTEND",
    deviceId: testDeviceId,
    syncKey: "VENU2-88",
    requestedExtendDays: 14,
    contactName: "คุณสมชาย ทดสอบระบบ",
    contactEmail: "investor@readybyte.top",
    contactPhone: "081-999-8888",
    message: "ขอต่ออายุทดลองใช้บนนาฬิกา Garmin Venu 2 เพิ่มเติม 14 วันครับ"
  });
  assert.strictEqual(trialExtendReqRes.status, 200);
  assert.strictEqual(trialExtendReqRes.json.ok, true);
  assert.strictEqual(trialExtendReqRes.json.request.requestType, "TRIAL_EXTEND");
  assert.strictEqual(trialExtendReqRes.json.request.status, "PENDING");
  assert.strictEqual(trialExtendReqRes.json.emailDelivery.recipientEmail, "e24qdy2@gmail.com");

  const purchaseReqRes = await httpRequest("POST", "/api/license/request", {
    requestType: "PURCHASE_LICENSE",
    deviceId: testDeviceId,
    syncKey: "VENU2-88",
    contactName: "คุณสมชาย ทดสอบระบบ",
    contactEmail: "investor@readybyte.top",
    contactPhone: "LINE: @investor_moat",
    message: "ต้องการซื้อ License ถาวรสำหรับ Garmin Venu 2 กรุณาติดต่อกลับครับ"
  });
  assert.strictEqual(purchaseReqRes.status, 200);
  assert.strictEqual(purchaseReqRes.json.ok, true);
  assert.strictEqual(purchaseReqRes.json.request.requestType, "PURCHASE_LICENSE");
  assert.strictEqual(purchaseReqRes.json.emailDelivery.recipientEmail, "e24qdy2@gmail.com");

  // Resolve Trial Extend request in Admin Portal
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
  assert.strictEqual(resolveExtendRes.json.ok, true);
  assert.strictEqual(resolveExtendRes.json.request.status, "APPROVED");

  // Resolve Purchase Request in Admin Portal (Approve & Activate PRO)
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
  assert.strictEqual(resolvePurchaseRes.json.ok, true);
  assert.strictEqual(resolvePurchaseRes.json.request.status, "APPROVED");
  assert.strictEqual(resolvePurchaseRes.json.device.status, "ACTIVE");
  console.log("[PASS] 7. Customer Trial Extend & Purchase Request Form + Admin 1-Click Approval + Email Dispatch to e24qdy2@gmail.com");

  // 8. Admin SMTP / System Mail Configuration & Test Email to e24qdy2@gmail.com
  const emailCfgRes = await httpRequest("GET", "/api/admin/email/config", null, {
    "X-Admin-Token": adminToken
  });
  assert.strictEqual(emailCfgRes.status, 200);
  assert.strictEqual(emailCfgRes.json.smtpConfig.recipientEmail, "e24qdy2@gmail.com");

  const testEmailRes = await httpRequest(
    "POST",
    "/api/admin/email/test",
    { recipientEmail: "e24qdy2@gmail.com" },
    { "X-Admin-Token": adminToken }
  );
  assert.strictEqual(testEmailRes.status, 200);
  assert.strictEqual(testEmailRes.json.ok, true);
  assert.strictEqual(testEmailRes.json.delivery.recipientEmail, "e24qdy2@gmail.com");
  console.log("[PASS] 8. SMTP / System Mail Service & Test Email Dispatch to e24qdy2@gmail.com");

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
  console.log("  ALL 8 SDLC TEST SUITES PASSED (100% GREEN)");
  console.log("==========================================================");
}

runSdlcSuite().catch((err) => {
  console.error("[FAIL] SDLC Suite Error:", err);
  process.exit(1);
});
