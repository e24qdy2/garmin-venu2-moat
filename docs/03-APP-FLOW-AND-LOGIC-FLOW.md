# Venu2Moat — App Flow & Core Logic Flow Specification

เอกสารฉบับนี้อธิบายลำดับการทำงานของระบบ (**App Flow**) และตรรกะการตัดสินใจเชิงลึก (**Logic Flow**) ทุกโมดูล ตั้งแต่การซิงค์ข้อมูลระหว่างเว็บกับนาฬิกา, ระบบ Auto-Swipe & Always-On Timer, อัลกอริทึมตรวจสอบสิทธิ์ Trial 14 วัน / Activation Key (`HMAC-SHA256`), ไปจนถึงการคำนวณอินดิเคเตอร์ทางเทคนิค (`SMA-20` & `Bollinger Bands`)

---

## 1. สถาปัตยกรรมภาพรวมและการไหลของข้อมูล (End-to-End Architecture Flow)

```mermaid
flowchart TD
    subgraph CloudflareEdge["Cloudflare Global Edge (readybyte.top)"]
        CF_Web["https://moat.readybyte.top<br/>(Web Companion & Watch API)"]
        CF_Admin["https://admin-moat.readybyte.top<br/>(Zero Trust Access + OTP Gate)"]
        CF_Tunnel["cloudflared Tunnel Daemon<br/>(venu2moat)"]
    end

    subgraph BackendServer["Node.js Backend Engine (server.js :3880)"]
        Router["Hostname & API Router"]
        MarketEngine["Yahoo Finance Live Quote +<br/>Deterministic Fallback Engine"]
        TechEngine["Technical Indicator Engine<br/>(14d Sparkline, SMA-20, Bollinger, FX)"]
        LicEngine["License & Trial Engine<br/>(lib/licenseManager.js)"]
        Store[("JSON Persistence<br/>data/portfolios.json<br/>data/licenses.json")]
    end

    subgraph WatchDevice["Garmin Venu 2 (416x416 AMOLED)"]
        WatchApp["Venu2Moat.prg<br/>(PortfolioStore + Timer)"]
        WatchStorage[("Application.Storage<br/>Offline Cache")]
    end

    CF_Web --> CF_Tunnel
    CF_Admin --> CF_Tunnel
    CF_Tunnel --> Router
    Router --> MarketEngine
    MarketEngine --> TechEngine
    Router --> LicEngine
    TechEngine --> Store
    LicEngine --> Store
    WatchApp <-->|"GET /api/watch?key=VENU2-88&did=V2-XXXX"| CF_Web
    WatchApp <--> WatchStorage
```

---

## 2. App Flow: การเริ่มต้นแอปบนนาฬิกาและการซิงค์ข้อมูล (Watch Startup & Sync Sequence)

เมื่อผู้ใช้เปิดแอป **Venu2Moat** บนนาฬิกา Garmin Venu 2 แอปจะแสดงข้อมูลจากแคชในเครื่องทันที (`0ms latency`) ก่อนดึงข้อมูลสดจากเซิร์ฟเวอร์ในพื้นหลัง:

```mermaid
sequenceDiagram
    autonumber
    actor User as ผู้ใช้ (Garmin Venu 2)
    participant App as Venu2MoatApp.mc
    participant Store as PortfolioStore.mc
    participant Storage as Application.Storage
    participant API as https://moat.readybyte.top/api/watch
    participant Lic as LicenseManager (Server)

    User->>App: เปิดแอป Venu2Moat บนนาฬิกา
    App->>Store: initialize() -> อ่าน uniqueIdentifier (Device ID: V2-XXXX)
    App->>Store: loadCached()
    Store->>Storage: getValue("venu2moat_payload")
    Storage-->>Store: คืนค่าข้อมูลแคชล่าสุด (รวม cfg และ lic)
    App->>Store: startRuntimeTimer() (Timer ทุก 1 วินาที)
    App->>Store: fetchRemote()
    Store->>API: GET /api/watch?key=VENU2-88&did=V2-XXXX&akey=...
    API->>Lic: evaluateDeviceLicense(did, akey)
    Lic-->>API: คืนค่าสถานะ TRIAL (เหลือ X วัน) / ACTIVE / EXPIRED
    API-->>Store: HTTP 200 JSON { cfg, lic, tot, p } (<4KB)
    Store->>Store: applyRemoteConfigAndLicense(payload)
    Store->>Storage: setValue("venu2moat_payload", payload)
    Store->>User: WatchUi.requestUpdate() วาดหน้าจอ 416x416 ล่าสุด
```

---

## 3. Logic Flow: ระบบ Auto-Swipe หน้าจอหุ้น & Always-On Backlight (`PortfolioStore.mc`)

ทุกๆ **1 วินาที** (`_runtimeTimer.start(method(:onRuntimeTick), 1000, true)`) ระบบใน [`PortfolioStore.onRuntimeTick`](../garmin-venu2-app/source/PortfolioStore.mc) จะประมวลผลตรรกะ 2 ส่วนพร้อมกัน:

1. **Always-On Screen Logic (`alwaysOnDisplay`):**
   - หากผู้ใช้เปิด `alwaysOnDisplay = true` (ไม่ได้บังคับเปิด; ค่าเริ่มต้นคือ `false`)
   - ทุกๆ 4 วินาที (`_backlightTick >= 4`) ระบบจะเรียก `Attention.backlight(true)` เพื่อยืดเวลาไฟหน้าจอ AMOLED ไม่ให้ดับขณะเปิดดูพอร์ต
2. **Auto-Swipe Pagination Logic (`autoSwipeEnabled`, `autoSwipeSec`):**
   - จะทำงานเมื่อ `autoSwipeEnabled == true` **และ** ไม่ได้ติดหน้าจอล็อก (`!trialExpired`) **และ** ไม่ได้เปิดหน้ากราฟรายตัวค้างไว้ (`!inDetailView`)
   - เมื่อนับเวลาครบ `autoSwipeSec` วินาที (ค่าเริ่มต้น `5` วินาที หรือตามที่ตั้งจากเว็บ `2..120` วินาที):
     - ถ้ารายการหุ้นในพอร์ตปัจจุบันยังมีหน้าถัดไป (`scrollRowOffset + 4 < itemCount`) -> เลื่อนลง 4 แถว (`scrollRowOffset += 4`) เพื่อแสดงหุ้นชุดถัดไป (เช่น หน้า `1/2` -> `2/2`)
     - ถ้าแสดงครบทุกหน้าของพอร์ตปัจจุบันแล้ว -> รีเซ็ตแถวกลับไปหน้าแรก (`scrollRowOffset = 0`) แล้วสลับไปยังพอร์ตโฟลิโอถัดไป (`activePortfolioIdx = (activePortfolioIdx + 1) % list.size()`)
   - หากผู้ใช้สัมผัสหน้าจอหรือกดปุ่มใดๆ ระบบจะเรียก `resetSwipeTimer()` เพื่อเริ่มนับเวลาใหม่ทันที ไม่ให้หน้าจอเด้งเปลี่ยนหน้าจังหวะที่ผู้ใช้กำลังกดดู

```mermaid
flowchart TD
    Tick(["Timer Tick (ทุก 1 วินาที)"]) --> CheckAON{"alwaysOnDisplay == true?"}
    CheckAON -- "ใช่" --> IncBL["_backlightTick += 1"]
    IncBL --> CheckBL4{"_backlightTick >= 4?"}
    CheckBL4 -- "ใช่" --> FireBL["เรียก Attention.backlight(true)<br/>รีเซ็ต _backlightTick = 0"]
    CheckBL4 -- "ไม่ใช่" --> CheckSwipeGate
    CheckAON -- "ไม่ใช่ (Default OFF)" --> CheckSwipeGate

    FireBL --> CheckSwipeGate{"autoSwipeEnabled == true<br/>AND !trialExpired<br/>AND !inDetailView?"}
    CheckSwipeGate -- "ไม่ใช่" --> EndTick(["จบการทำงานรอบนี้"])
    CheckSwipeGate -- "ใช่" --> IncSwipe["_swipeElapsedSec += 1"]
    IncSwipe --> ReachSec{"_swipeElapsedSec >= autoSwipeSec<br/>(Default 5s)?"}
    ReachSec -- "ยังไม่ถึง" --> EndTick
    ReachSec -- "ถึงกำหนดเวลาแล้ว" --> ResetSec["_swipeElapsedSec = 0"]
    ResetSec --> HasMoreRows{"scrollRowOffset + 4 < จำนวนหุ้นในพอร์ตนี้?"}
    HasMoreRows -- "ยังมีหุ้นหน้าถัดไป" --> NextPage["scrollRowOffset += 4<br/>(เลื่อนดูหุ้น 4 ตัวถัดไปในพอร์ตเดิม)"]
    HasMoreRows -- "ครบทุกตัวในพอร์ตนี้แล้ว" --> NextPort["scrollRowOffset = 0<br/>activePortfolioIdx = (activePortfolioIdx + 1) % จำนวนพอร์ต"]
    NextPage --> Redraw["WatchUi.requestUpdate()<br/>วาดหน้าจอใหม่"]
    NextPort --> Redraw
    Redraw --> EndTick
```

---

## 4. Logic Flow: ระบบ 14-Day Free Trial & Per-Device Activation Key (`lib/licenseManager.js`)

### 4.1 State Machine ของสถานะเครื่อง (`Device License Lifecycle`)

```mermaid
stateDiagram-v2
    [*] --> TRIAL : เครื่องซิงค์ครั้งแรก (Auto-Register 14 วัน)
    TRIAL --> TRIAL : ซิงค์ปกติ (วันที่เหลือ > 0)
    TRIAL --> EXPIRED : ครบกำหนด 14 วัน (nowMs > trialExpiresMs)\nหรือแอดมินกด Expire 14d
    TRIAL --> ACTIVE : ลูกค้ากรอก Activation Key ที่ถูกต้อง\nหรือแอดมินกด Activate
    EXPIRED --> ACTIVE : ลูกค้าติดต่อ saharabu@scg.com\nและกรอกรหัส MOAT-XXXX-XXXX-XXXX ที่ถูกต้อง
    EXPIRED --> TRIAL : แอดมินกด Extend (+14d) หรือ Reset (14d)
    ACTIVE --> EXPIRED : แอดมินสั่ง Revoke สิทธิ์ในหน้า Admin
```

### 4.2 อัลกอริทึมการสร้างและตรวจสอบ Activation Key ราย `Device ID`
ระบบป้องกันการใช้คีย์ข้ามเครื่องด้วยการผูก `Device ID` เข้ากับรหัสคีย์ผ่านอัลกอริทึม **HMAC-SHA256**:
1. **Normalization:** แปลง `deviceId` เป็นตัวพิมพ์ใหญ่และตัดอักขระพิเศษ (เช่น `V2-88VENU20`)
2. **HMAC Digest:** คำนวณ `HMAC_SHA256(secretKey, "VENU2MOAT_V2::" + normalizedDeviceId + "::saharabu@scg.com")`
3. **Base32 Readability Encoding:** แปลงค่าแฮชเป็นชุดตัวอักษรที่อ่านง่าย (ตัด `0/O/1/I` เพื่อไม่ให้สับสนเวลาพิมพ์) จำนวน 12 ตัวอักษร แล้วจัดรูปแบบเป็น:
   ```text
   MOAT-XXXX-XXXX-XXXX
   ```
   *(ตัวอย่าง: เครื่อง `V2-SDLC9901` จะได้คีย์เฉพาะเครื่องคือ `MOAT-RZA6-TADM-HLFV` เสมอ)*

---

## 5. Logic Flow: ระบบยืนยันตัวตนด้วย Admin Password และการเปลี่ยนรหัสผ่าน (`https://admin-moat.readybyte.top`)

หน้า Admin Portal ใช้การยืนยันตัวตนด้วย **Admin Password (เข้ารหัสด้วย `scrypt` + Random Salt)** สำหรับเจ้าของระบบ **`saharabu@scg.com`** และอนุญาตให้เปลี่ยนรหัสผ่านใหม่หลังล็อกอินโดยบังคับตรวจสอบรหัสผ่านเดิม (`Current Password`) ก่อนทุกครั้ง:

```mermaid
sequenceDiagram
    autonumber
    actor Admin as แอดมิน (saharabu@scg.com)
    participant UI as admin.html / admin.js
    participant Server as server.js (/api/admin/*)
    participant Lic as LicenseManager (Scrypt Hash)

    Admin->>UI: เปิด https://admin-moat.readybyte.top
    UI->>Server: GET /api/admin/session
    Server-->>UI: { authenticated: false, isDefaultPassword: true }
    Admin->>UI: กรอก Admin Password แล้วกด Sign In with Password
    UI->>Server: POST /api/admin/auth/login { email, password }
    Server->>Lic: loginAdminWithPassword(email, password)
    Lic->>Lic: ตรวจสอบ timingSafeEqual(scrypt(password, salt), storedHash)
    alt รหัสผ่านไม่ถูกต้อง
        Lic-->>UI: HTTP 401 { ok: false, error: "รหัสผ่านผู้ดูแลระบบไม่ถูกต้อง" }
    else รหัสผ่านถูกต้อง
        Lic-->>UI: HTTP 200 { ok: true, token: "...", authMethod: "ADMIN_PASSWORD" }
        UI->>Server: GET /api/admin/devices (แนบ Bearer Token)
        Server-->>UI: คืนค่ารายการเครื่องทั้งหมด + Audit Logs
    end

    Note over Admin,Lic: ขั้นตอนการเปลี่ยนรหัสผ่าน (Change Admin Password พร้อมยืนยันรหัสเดิม)
    Admin->>UI: กรอก 1) รหัสผ่านเดิม 2) รหัสผ่านใหม่ 3) ยืนยันรหัสผ่านใหม่
    UI->>Server: POST /api/admin/auth/change-password (แนบ Bearer Token)
    Server->>Lic: changeAdminPassword(email, currentPassword, newPassword, confirmPassword)
    Lic->>Lic: 1. ตรวจสอบ currentPassword กับ Stored Hash ปัจจุบัน
    alt รหัสผ่านเดิมไม่ถูกต้อง หรือ รหัสใหม่ไม่ตรงกัน
        Lic-->>UI: HTTP 400 { ok: false, error: "รหัสผ่านเดิมไม่ถูกต้อง..." }
    else ยืนยันรหัสเดิมถูกต้อง
        Lic->>Lic: 2. สร้าง Salt ใหม่ + คำนวณ scrypt(newPassword, newSalt)
        Lic->>Lic: 3. บันทึกลง data/licenses.json และเพิ่ม ADMIN_PASSWORD_CHANGED ใน Audit Log
        Lic-->>UI: HTTP 200 { ok: true, message: "เปลี่ยนรหัสผ่านผู้ดูแลระบบเรียบร้อยแล้ว" }
    end
```

---

## 6. Logic Flow: การคำนวณมูลค่าพอร์ต, อัตราแลกเปลี่ยน และอินดิเคเตอร์เทคนิค (`server.js`)

```mermaid
flowchart LR
    Yahoo["1. ดึงข้อมูลราคาหุ้น 1 เดือนย้อนหลัง<br/>จาก Yahoo Finance API<br/>(หรือ Deterministic Fallback)"] --> FX["2. ดึงค่าเงิน USD/THB (THB=X)<br/>เพื่อแปลงมูลค่าทุกพอร์ตเป็นสกุลเงินหลัก<br/>(Base Currency: THB หรือ USD)"]
    FX --> Tech["3. คำนวณ Technicals จากราคาปิด 20 วัน:<br/>• Sparkline (14 วันล่าสุด)<br/>• SMA-20 (ค่าเฉลี่ย 20 วัน)<br/>• Upper/Lower Bollinger (±2 SD)"]
    Tech --> Alert["4. ตรวจสอบเงื่อนไขราคาเป้าหมาย:<br/>• ABOVE: price >= targetPrice -> TARGET_HIT<br/>• BELOW: price <= targetPrice -> STOP_BREACH"]
    Alert --> DualOut["5. สร้างเพย์โหลด 2 รูปแบบ:<br/>• web: ข้อมูลละเอียดสำหรับหน้าเว็บ<br/>• watch: ข้อมูลย่อ <4KB สำหรับ Venu 2"]
```
