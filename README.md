# Venu2Moat — Garmin Venu 2 Portfolio, Auto-Swipe & Licensing Platform

Easymoat-inspired stock & ETF portfolio tracker, target-price alert engine, and WebMemo note system engineered natively for the **Garmin Venu 2 (416×416 AMOLED)** along with its Web Companion and Dedicated Admin Licensing Portal.

## Live Endpoints (`readybyte.top`)
- **Web Companion & 416×416 Watch Simulator:** [`https://moat.readybyte.top`](https://moat.readybyte.top)
- **Admin Licensing & Device Activation Portal:** [`https://admin-moat.readybyte.top`](https://admin-moat.readybyte.top)
- **Garmin Venu 2 JSON Telemetry Endpoint:** [`https://moat.readybyte.top/api/watch?key=VENU2-88`](https://moat.readybyte.top/api/watch?key=VENU2-88)

## Key Features
1. **Garmin Venu 2 Native App (`garmin-venu2-app/` & `dist/Venu2Moat.prg`):**
   - Built for the 416×416 round AMOLED screen in Monkey C (Connect IQ SDK 8.4.1).
   - **Auto-Swipe Next Screen (`autoSwipeEnabled`, `autoSwipeSec`):** Automatically paginates through all stock holdings (4 rows per screen) and cycles across all portfolios every **5 seconds** by default (customizable `2s`–`120s` from Web Settings).
   - **Optional Always-On Screen (`alwaysOnDisplay`):** Optional toggle (defaults to `OFF`) that keeps the Venu 2 AMOLED backlight awake while viewing your portfolios.
   - **Sparkline + SMA20 + Bollinger Bands + WebMemo:** Tap any holding row to inspect its 14-day price sparkline, technical bands, and custom thesis memo.
2. **14-Day Free Trial & Per-Device Activation Key System (`lib/licenseManager.js`):**
   - Every Garmin Venu 2 `Device ID` receives an automatic **14-day free trial**.
   - Upon trial expiration, the watch app and web simulator lock the screen (`TRIAL 14D EXPIRED`) and instruct the user to contact the App Owner for the Paid Version at **`saharabu@scg.com`**.
3. **Admin Portal Subdomain (`https://admin-moat.readybyte.top`):**
   - Protected by **Cloudflare Zero Trust Access** (`Cf-Access-Authenticated-User-Email`) and a **6-Digit Admin OTP / Passkey Gate** for **`saharabu@scg.com`**.
   - Generates deterministic HMAC-SHA256 activation keys (`MOAT-XXXX-XXXX-XXXX`) per `Device ID`, manages trial extensions/expirations, and records an immutable security audit log.

## Commands
```powershell
# Start Web Companion + Watch API + Admin Portal Server (Port 3880)
npm start

# Run Automated SDLC Verification Suite (6 End-to-End Suites)
npm test

# Compile Venu2Moat.prg & Sideload via MTP USB to Garmin Venu 2
npm run build:watch

# Commit & Push Any Source Code Changes to GitHub
powershell -ExecutionPolicy Bypass -File .\sync-github.ps1 "Update message"
```
