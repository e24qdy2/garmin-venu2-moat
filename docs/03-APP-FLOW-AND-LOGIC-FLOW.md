# MoatWatch — App Flow & Core Logic Flow Specification

เอกสารฉบับนี้อธิบายลำดับการทำงานของระบบ (**App Flow**) และตรรกะการตัดสินใจเชิงลึก (**Logic Flow**) ทุกโมดูล ตั้งแต่การซิงค์ข้อมูลระหว่างเว็บกับนาฬิกา Garmin ทั้ง 20 รุ่น, ระบบดึงค่าดัชนี **Daily US Market Fear & Greed Index (`FG:xxG` / `FG:xxEF`)**, ระบบ Auto-Swipe & Always-On Timer, ระบบแยกพอร์ตรายเครื่องอัตโนมัติ (Multi-User Auto-Device-ID), อัลกอริทึมตรวจสอบสิทธิ์ Trial 14 วัน / Activation Key (`HMAC-SHA256`), และระบบส่งอีเมลแจ้งเตือนไปยัง **`e24qdy2@gmail.com`**

---

## 1. สถาปัตยกรรมภาพรวมและการไหลของข้อมูล (End-to-End Architecture Flow)

```mermaid
flowchart TD
    subgraph CloudflareEdge["Cloudflare Global Edge (readybyte.top)"]
        CF_Web["https://moat.readybyte.top<br/>(Web Companion, Request Form & Watch API)"]
        CF_Admin["https://admin-moat.readybyte.top<br/>(Admin Portal - saharat.bun@icloud.com)"]
        CF_Tunnel["Cloudflare Tunnel / Worker<br/>(server.js & src/worker.js)"]
    end

    subgraph BackendServer["MoatWatch Core Engine (lib/moatEngine.js)"]
        Router["Hostname & API Router"]
        MarketEngine["Yahoo Finance Live Quote +<br/>Deterministic Fallback Engine"]
        SentimentEngine["CNN US Fear & Greed Index Engine<br/>(30-Min Cache + FG:xx Zone Formatter)"]
        TechEngine["Technical Indicator Engine<br/>(14d Sparkline, SMA-20, RSI-14, Bollinger, FX)"]
        LicEngine["License, Trial & Request Queue Engine<br/>(lib/licenseManager.js)"]
        MailEngine["Email Notification Service<br/>(lib/emailService.js)"]
        Store[("JSON & Mail Persistence<br/>data/portfolios.json<br/>data/licenses.json<br/>data/mail-outbox/*.eml")]
    end

    subgraph WatchDevice["Garmin Watch (20 Models: 260x260–454x454)"]
        WatchApp["MoatWatch.prg / MoatWatch.iq<br/>(PortfolioStore + MoatWatchLayout)"]
        WatchStorage[("Application.Storage<br/>Offline Cache")]
    end

    CF_Web --> CF_Tunnel
    CF_Admin --> CF_Tunnel
    CF_Tunnel --> Router
    Router --> MarketEngine
    Router --> SentimentEngine
    MarketEngine --> TechEngine
    Router --> LicEngine
    LicEngine --> MailEngine
    MailEngine -->|"SMTP TLS / Direct MX"| GmailInbox["e24qdy2@gmail.com"]
    TechEngine --> Store
    LicEngine --> Store
    MailEngine --> Store
    WatchApp <-->|"GET /api/watch?key=MW-XXXX&did=V2-XXXX"| CF_Web
    WatchApp <--> WatchStorage
```

---

## 2. App Flow: การเริ่มต้นแอปบนนาฬิกา Garmin และการซิงค์ข้อมูล (Watch Startup & Sync Sequence)

เมื่อผู้ใช้เปิดแอป **MoatWatch** บนนาฬิกา Garmin แอปจะอ่านรหัสฮาร์ดแวร์ประจำเครื่อง (`uniqueIdentifier`), สร้าง `Sync Key` เฉพาะเครื่องหากยังไม่ได้ตั้งค่า, แสดงข้อมูลจากแคชในเครื่องทันที (`0ms latency`), แล้วดึงข้อมูลสดพร้อมดัชนี `Fear & Greed` จากเซิร์ฟเวอร์ในพื้นหลัง:

```mermaid
sequenceDiagram
    autonumber
    actor User as ผู้ใช้ (Garmin Watch)
    participant App as Venu2MoatApp.mc
    participant Store as PortfolioStore.mc
    participant Storage as Application.Storage
    participant API as https://moat.readybyte.top/api/watch
    participant Engine as MoatEngine + LicenseManager

    User->>App: เปิดแอป MoatWatch บนนาฬิกา Garmin
    App->>Store: initialize() -> อ่าน uniqueIdentifier (Device ID: V2-XXXX)
    Store->>Store: สร้าง Sync Key เฉพาะเครื่องอัตโนมัติ (MW-XXXXXX) หากยังใช้ค่าเริ่มต้น
    App->>Store: loadCached() จาก Application.Storage
    App->>Store: startRuntimeTimer() (Timer ทุก 1 วินาที)
    App->>Store: fetchRemote()
    Store->>API: GET /api/watch?key=MW-XXXXXX&did=V2-XXXX&akey=...
    API->>Engine: buildDualPayloads() + getUSFearGreedIndex() + evaluateDeviceLicense()
    Engine-->>API: คืนค่าข้อมูลพอร์ต + ดัชนี fg (เช่น FG:64G) + สถานะ TRIAL/ACTIVE/EXPIRED
    API-->>Store: HTTP 200 JSON { cfg, fg, lic, tot, p } (<4KB)
    Store->>Store: applyRemoteConfigAndLicense(payload)
    Store->>Storage: setValue("venu2moat_payload", payload)
    Store->>User: WatchUi.requestUpdate() วาดหน้าจอพร้อมป้าย FG:64G ล่าสุด
```

---

## 3. Logic Flow: ระบบดึงและคำนวณ Daily US Market Fear & Greed Index (`lib/moatEngine.js`)

```mermaid
flowchart LR
    Req["เรียก buildDualPayloads()"] --> CheckCache{"มีข้อมูลในแคช<br/>อายุไม่เกิน 30 นาที?"}
    CheckCache -- "ใช่" --> UseCache["ใช้ข้อมูล US Fear & Greed จากแคชทันที"]
    CheckCache -- "ไม่ใช่ / หมดอายุ" --> FetchCNN["ดึงข้อมูลจาก CNN Dataviz API<br/>(fearandgreed/graphdata)"]
    FetchCNN --> Valid{"ดึงสำเร็จและได้ค่า<br/>score 0..100?"}
    Valid -- "สำเร็จ" --> Classify["จัดโซนคะแนน 5 ระดับ:<br/>0-24: EF (#F43F5E)<br/>25-44: F (#FB923C)<br/>45-55: N (#94A3B8)<br/>56-74: G (#10B981)<br/>75-100: EG (#06B6D4)"]
    Valid -- "ออฟไลน์ / Timeout" --> Fallback["ใช้ค่า Deterministic Fallback<br/>(score: 64, code: G, shortText: FG:64G)"]
    Classify --> Out["สร้าง fg payload สำหรับเว็บและนาฬิกา<br/>(เช็คสวิตช์ showFearGreed / cfg.sfg)"]
    Fallback --> Out
    UseCache --> Out
```

---

## 4. Logic Flow: ระบบ Auto-Swipe หน้าจอหุ้น & Always-On Backlight (`PortfolioStore.mc`)

ทุกๆ **1 วินาที** (`_runtimeTimer.start(method(:onRuntimeTick), 1000, true)`) ระบบใน [`PortfolioStore.onRuntimeTick`](../garmin-venu2-app/source/PortfolioStore.mc) จะประมวลผลตรรกะ 2 ส่วนพร้อมกัน:

1. **Always-On Screen Logic (`alwaysOnDisplay`):**
   - หากผู้ใช้เปิด `alwaysOnDisplay = true` ทุกๆ 4 วินาทีระบบจะเรียก `Attention.backlight(true)` เพื่อยืดเวลาไฟหน้าจอไม่ให้ดับขณะเปิดดูพอร์ต
2. **Auto-Swipe Pagination Logic (`autoSwipeEnabled`, `autoSwipeSec`):**
   - ทำงานเมื่อ `autoSwipeEnabled == true` **และ** ไม่ได้ติดหน้าจอล็อก (`!trialExpired`) **และ** ไม่ได้เปิดหน้ากราฟรายตัวค้างไว้ (`!inDetailView`)
   - เมื่อนับเวลาครบ `autoSwipeSec` วินาที (ค่าเริ่มต้น `5` วินาที หรือตามที่ตั้งจากเว็บ `2..120` วินาที):
     - ถ้าในพอร์ตปัจจุบันยังมีหุ้นหน้าถัดไป -> เลื่อนลง 4 แถว (`scrollRowOffset += 4`)
     - ถ้าแสดงครบทุกหน้าของพอร์ตปัจจุบันแล้ว -> รีเซ็ตแถวกลับไปหน้าแรก (`scrollRowOffset = 0`) แล้วสลับไปยังพอร์ตโฟลิโอถัดไป (`activePortfolioIdx = (activePortfolioIdx + 1) % list.size()`)

---

## 5. Logic Flow: ระบบ 14-Day Free Trial, Customer Request Queue & Per-Device Activation Key (`lib/licenseManager.js`)

```mermaid
stateDiagram-v2
    [*] --> TRIAL : เครื่องซิงค์ครั้งแรก (Auto-Register 14 วัน)
    TRIAL --> TRIAL : ซิงค์ปกติ (วันที่เหลือ > 0) หรือแอดมินอนุมัติ Trial Extend (+7d/+14d)
    TRIAL --> EXPIRED : ครบกำหนด 14 วัน (nowMs > trialExpiresMs)\nหรือแอดมินกด Expire 14d
    TRIAL --> ACTIVE : ลูกค้ากรอก Activation Key ที่ถูกต้อง\nหรือแอดมินกด Approve & Activate PRO
    EXPIRED --> ACTIVE : ลูกค้าส่ง Purchase Request Form / ติดต่อ saharat.bun@icloud.com\nแล้วแอดมินกด Approve PRO หรือลูกค้ากรอก MOAT-XXXX-XXXX-XXXX
    EXPIRED --> TRIAL : ลูกค้ากด Request Trial Key Extend แล้วแอดมินกด Approve (+7d/+14d)
    ACTIVE --> EXPIRED : แอดมินสั่ง Revoke สิทธิ์ในหน้า Admin
```

---

## 6. Logic Flow: การคำนวณมูลค่าพอร์ต, อัตราแลกเปลี่ยน, อินดิเคเตอร์เทคนิค & Auto-Sort `% Change` (`lib/moatEngine.js`)

```mermaid
flowchart LR
    Yahoo["1. ดึงข้อมูลราคาหุ้นย้อนหลัง<br/>จาก Yahoo Finance API<br/>(หรือ Deterministic Fallback)"] --> FX["2. ดึงค่าเงิน USD/THB (THB=X)<br/>เพื่อแปลงมูลค่าทุกพอร์ตเป็นสกุลเงินหลัก<br/>(Base Currency: THB หรือ USD)"]
    FX --> Tech["3. คำนวณ Technicals:<br/>• Sparkline (14 วันล่าสุด)<br/>• SMA-20 & SMA%<br/>• RSI-14 & Day Low/High<br/>• Upper/Lower Bollinger (±2 SD)"]
    Tech --> Sort["4. เรียงลำดับหุ้นตาม % Change:<br/>• ASC: ติดลบมากสุด -> กำไรมากสุด<br/>• DESC: กำไรมากสุด -> ติดลบมากสุด"]
    Sort --> DualOut["5. สร้างเพย์โหลด 2 รูปแบบ:<br/>• web: ข้อมูลละเอียด + fearGreed สำหรับหน้าเว็บ<br/>• watch: ข้อมูลย่อ <4KB + fg สำหรับนาฬิกา Garmin"]
```
