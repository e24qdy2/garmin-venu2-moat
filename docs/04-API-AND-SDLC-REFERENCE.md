# Venu2Moat — API Reference, Data Models & SDLC Guide

เอกสารฉบับนี้รวบรวมโครงสร้างฐานข้อมูล (`Entity-Relationship Diagram`), รายละเอียด REST API ทุก Endpoint พร้อมตัวอย่าง JSON Payload, และขั้นตอนการทดสอบตามมาตรฐาน **SDLC (Software Development Life Cycle)**

---

## 1. โครงสร้างข้อมูล (Data Model & ER Diagram)

ระบบจัดเก็บข้อมูลในรูปแบบ JSON ที่อ่านและสำรองข้อมูลได้ง่าย (`data/portfolios.json`, `data/licenses.json`, และไฟล์อีเมล `data/mail-outbox/*.eml`):

```mermaid
erDiagram
    PROFILE ||--o{ PORTFOLIO : contains
    PROFILE ||--|| WATCH_SETTINGS : configures
    PORTFOLIO ||--o{ HOLDING : tracks
    DEVICE_LICENSE ||--o{ CUSTOMER_REQUEST : submits
    DEVICE_LICENSE ||--o{ AUDIT_LOG : records
    CUSTOMER_REQUEST ||--o{ EMAIL_LOG : triggers

    PROFILE {
        string syncKey PK "เช่น VENU2-88"
        string baseCurrency "THB หรือ USD"
        string updatedAt "ISO-8601 Timestamp"
    }

    WATCH_SETTINGS {
        boolean autoSwipeEnabled "Default: true"
        int autoSwipeSec "Default: 5 (Range: 2..120)"
        boolean alwaysOnDisplay "Default: false (Optional)"
        string deviceId "เช่น V2-88VENU20"
        string activationKey "MOAT-XXXX-XXXX-XXXX"
    }

    PORTFOLIO {
        string id PK "เช่น port-us-moat"
        string name "ชื่อพอร์ตโฟลิโอ"
        string currency "USD หรือ THB"
    }

    HOLDING {
        string symbol "เช่น NVDA, ADVANC.BK"
        string name "ชื่อบริษัท"
        float shares "จำนวนหุ้น (0 = Watchlist)"
        float avgCost "ต้นทุนเฉลี่ยต่อหุ้น"
        float targetPrice "ราคาเป้าหมายแจ้งเตือน"
        string alertDir "ABOVE หรือ BELOW"
        string memo "บันทึก WebMemo บนหน้าปัดนาฬิกา"
    }

    DEVICE_LICENSE {
        string deviceId PK "เช่น V2-88VENU20"
        string label "ชื่อเครื่องลูกค้า"
        string syncKey "พอร์ตที่ผูกอยู่"
        string status "TRIAL | ACTIVE | EXPIRED"
        int trialStartMs "เวลาเริ่มทดลองใช้ 14 วัน"
        int trialExpiresMs "เวลาหมดอายุทดลองใช้"
        string issuedKey "คีย์ที่แอดมินสร้างให้"
        string activatedKey "คีย์ที่ปลดล็อกแล้ว"
    }

    CUSTOMER_REQUEST {
        string id PK "เช่น REQ-XXXXXX"
        string requestType "TRIAL_EXTEND | PURCHASE_LICENSE"
        string status "PENDING | APPROVED | REJECTED"
        string deviceId FK "รหัสเครื่องนาฬิกา"
        int requestedDays "จำนวนวันที่ขอต่ออายุ (เช่น 7 หรือ 14)"
        string contactName "ชื่อผู้ติดต่อ"
        string contactEmail "อีเมลติดต่อกลับ"
        string contactPhone "เบอร์โทร / LINE ID"
        string message "ความประสงค์เพิ่มเติม"
    }

    EMAIL_LOG {
        string id PK "เช่น MAIL-XXXXXX"
        string to "e24qdy2@gmail.com"
        string subject "หัวข้ออีเมลแจ้งเตือน"
        string status "SENT_SMTP | SENT_DIRECT_MX | SAVED_OUTBOX"
        string outboxFile "พาธไฟล์ .eml ใน data/mail-outbox/"
    }

    AUDIT_LOG {
        string id PK
        string timestamp "ISO-8601"
        string actor "saharat.bun@icloud.com หรือ web-companion"
        string action "KEY_GENERATED | DEVICE_ACTIVATED | CUSTOMER_REQUEST_RESOLVED | ..."
        string targetDeviceId "รหัสเครื่องที่ถูกดำเนินการ"
        string details "รายละเอียด"
    }
```

---

## 2. รายละเอียด REST API Endpoints

### 2.1 Watch & Web Companion Endpoints (`https://moat.readybyte.top`)

| Method | Endpoint | คำอธิบาย |
| :--- | :--- | :--- |
| `GET` | `/api/watch?key=VENU2-88&did=V2-XXXX&akey=...` | คืนค่า Compact JSON (`<4KB`) สำหรับแอปบนนาฬิกา Garmin Venu 2 พร้อมการตั้งค่า `cfg` และสถานะไลเซนส์ `lic` (`own: "saharat.bun@icloud.com"`) |
| `GET` | `/api/portfolio?key=VENU2-88` | คืนค่าข้อมูลพอร์ตแบบเต็มสำหรับหน้าเว็บ Companion และ Watch Simulator |
| `PUT` / `POST` | `/api/portfolio` | บันทึกการแก้ไขพอร์ตหุ้น, WebMemo, สกุลเงินหลัก และการตั้งค่า `watchSettings` (`autoSwipeEnabled`, `autoSwipeSec`, `alwaysOnDisplay`) |
| `POST` | `/api/device/activate` | ตรวจสอบและปลดล็อก `deviceId` ด้วยรหัส `activationKey` (`MOAT-XXXX-XXXX-XXXX`) |
| `POST` | `/api/license/request` | ส่งคำขอ **Request Trial Key Extend** (`TRIAL_EXTEND`) หรือ **Purchase Request Form** (`PURCHASE_LICENSE`) เข้าสู่คิวอนุมัติของแอดมิน พร้อมส่งอีเมลแจ้งเตือนไปที่ **`e24qdy2@gmail.com`** |
| `GET` | `/api/device/status?key=VENU2-88&did=V2-XXXX` | ตรวจสอบสถานะ Trial 14 วัน, สถานะการเปิดใช้งานของเครื่อง และรายการคำขอล่าสุดของเครื่องนั้น |
| `GET` | `/api/quote?symbol=NVDA` | ดึงราคาตลาดและอินดิเคเตอร์ของหุ้นรายตัวแบบเรียลไทม์ |

#### ตัวอย่าง Compact JSON จาก `GET /api/watch?key=VENU2-88&did=V2-88VENU20`
```json
{
  "k": "VENU2-88",
  "bc": "THB",
  "fx": 33.58,
  "ts": 1792505891,
  "cfg": {
    "asw": 1,
    "asec": 5,
    "aon": 0
  },
  "lic": {
    "did": "V2-88VENU20",
    "st": "TRIAL",
    "days": 14,
    "exp": 0,
    "own": "saharat.bun@icloud.com"
  },
  "tot": {
    "val": 1482910,
    "dp": 18420,
    "dPct": 1.25,
    "tp": 312450,
    "tPct": 26.69
  },
  "p": [
    {
      "id": "us-moat",
      "n": "US Wide Moat",
      "val": 920400,
      "dp": 14200,
      "dPct": 1.57,
      "tp": 248900,
      "tPct": 37.06,
      "al": 1,
      "s": [
        {
          "s": "NVDA",
          "sym": "NVDA",
          "cur": "USD",
          "p": 138.6,
          "px": 138.6,
          "c": 2.82,
          "pct": 2.82,
          "sh": 45,
          "avg": 92.5,
          "pPct": 49.84,
          "tgt": 135,
          "alrt": "TARGET_HIT",
          "note": "AI GPU moat leader; hold core position",
          "spk": [128.4, 130.1, 133.5, 135.2, 138.6],
          "sma": 132.4,
          "ub": 140.2,
          "lb": 124.6
        }
      ]
    }
  ]
}
```

---

### 2.2 Admin Licensing Portal Endpoints (`https://admin-moat.readybyte.top`)

ทุก Endpoint ภายใต้ `/api/admin/*` บังคับตรวจสอบสิทธิ์ผู้ดูแลระบบ (`saharat.bun@icloud.com`) ผ่าน Header `Authorization: Bearer <token>` หรือ `X-Admin-Token`:

| Method | Endpoint | คำอธิบาย |
| :--- | :--- | :--- |
| `GET` | `/api/admin/session` | ตรวจสอบสถานะการล็อกอินของแอดมิน (`saharat.bun@icloud.com`), อีเมลแจ้งเตือน (`e24qdy2@gmail.com`) และสถานะรหัสผ่าน (`isDefaultPassword`, `passwordUpdatedAt`) |
| `POST` | `/api/admin/auth/login` | ล็อกอินเข้าสู่ระบบผู้ดูแลด้วยรหัสผ่าน (`{ email: "saharat.bun@icloud.com", password }`) เพื่อรับ Session Token |
| `POST` | `/api/admin/auth/change-password` | เปลี่ยนรหัสผ่านผู้ดูแลระบบหลังล็อกอิน โดยต้องส่ง `{ currentPassword, newPassword, confirmPassword }` เพื่อยืนยันรหัสผ่านเดิมก่อนเสมอ |
| `GET` | `/api/admin/devices` | ดึงรายชื่อเครื่อง Garmin Venu 2 ทั้งหมด, คิวคำขอของลูกค้า (`customerRequests`), ประวัติการส่งอีเมล (`emailLogs`), สถิติสรุป และ Audit Logs |
| `POST` | `/api/admin/requests/resolve` | อนุมัติหรือปฏิเสธคำขอของลูกค้าในคลิกเดียว (`APPROVE_EXTEND_7D`, `APPROVE_EXTEND_14D`, `APPROVE_ACTIVATE`, `REJECT`) |
| `GET` / `POST` | `/api/admin/email/config` | อ่านหรือบันทึกการตั้งค่าเซิร์ฟเวอร์ SMTP สำหรับส่งอีเมลแจ้งเตือนไปยัง `e24qdy2@gmail.com` |
| `POST` | `/api/admin/email/test` | ทดสอบส่งอีเมลแจ้งเตือนไปยัง `e24qdy2@gmail.com` ทันที |
| `POST` | `/api/admin/devices/generate-key` | สร้างรหัส Activation Key (`MOAT-XXXX-XXXX-XXXX`) ผูกกับ `deviceId` |
| `POST` | `/api/admin/devices/update` | เปลี่ยนสถานะเครื่อง (`ACTIVATE`, `EXPIRE_TRIAL`, `EXTEND_TRIAL`, `RESET_TRIAL`, `DELETE`) |

---

## 3. กระบวนการพัฒนาและทดสอบตามมาตรฐาน SDLC (`tests/sdlc.test.js`)

โปรเจกต์นี้มีชุดทดสอบอัตโนมัติแบบ End-to-End ในไฟล์ [`tests/sdlc.test.js`](../tests/sdlc.test.js) ซึ่งตรวจสอบครบ 8 แกนหลัก:
1. **Subdomain Routing Test:** ทดสอบการเรียก `Host: admin-moat.readybyte.top` ว่าเสิร์ฟหน้า Admin Portal พร้อมฟอร์มล็อกอินด้วยรหัสผ่าน (`adminPasswordLoginForm`) และฟอร์มเปลี่ยนรหัสผ่าน (`changeAdminPasswordForm`) สำหรับ `saharat.bun@icloud.com` ถูกต้อง
2. **Watch Display Settings Sync Test:** ทดสอบการบันทึกค่า `autoSwipeEnabled`, `autoSwipeSec` (ทั้งค่าเริ่มต้น `5s` และกำหนดเอง `9s`) และ `alwaysOnDisplay` (`true`/`false`) ว่าส่งต่อไปยัง `/api/watch` (`cfg.asw`, `cfg.asec`, `cfg.aon`) ถูกต้อง
3. **Admin Password Login & Change Password Verification Test:** ทดสอบการล็อกอินด้วยรหัสผ่านแอดมิน (`POST /api/admin/auth/login`), ทดสอบการปฏิเสธรหัสผ่านผิด (`401`), ทดสอบการเปลี่ยนรหัสผ่าน (`POST /api/admin/auth/change-password`) โดยหากใส่รหัสผ่านเดิม (`currentPassword`) ผิดต้องถูกปฏิเสธ (`400`) และเมื่อใส่รหัสผ่านเดิมถูกต้องจึงเปลี่ยนเป็นรหัสผ่านใหม่และใช้ล็อกอินได้จริง
4. **14-Day Trial Auto-Registration Test:** ทดสอบว่า `Device ID` ใหม่ได้รับสิทธิ์ `TRIAL` 14 วัน (`lic.exp = 0`, `lic.days = 14`, `lic.own = "saharat.bun@icloud.com"`) โดยอัตโนมัติ
5. **14-Day Trial Expiration Lock Test:** ทดสอบการจำลองให้ครบ 14 วัน (`EXPIRE_TRIAL`) แล้วตรวจสอบว่า `/api/watch` ส่งสถานะล็อกหน้าจอ (`lic.st = "EXPIRED"`, `lic.exp = 1`, `lic.own = "saharat.bun@icloud.com"`)
6. **Per-Device Activation Key Verification Test:** ทดสอบการสร้างคีย์ `MOAT-XXXX-XXXX-XXXX` ราย `Device ID`, ทดสอบการปฏิเสธคีย์ปลอม (`HTTP 400`), และทดสอบการปลดล็อกเครื่องด้วยคีย์จริง (`lic.st = "ACTIVE"`, `lic.exp = 0`)
7. **Customer Trial Extend & Purchase Request Form + Admin 1-Click Approval + Email Dispatch Test:** ทดสอบการส่งคำขอ `TRIAL_EXTEND` และ `PURCHASE_LICENSE` (`POST /api/license/request`), ตรวจสอบการส่งอีเมลแจ้งเตือนไปยัง `e24qdy2@gmail.com` พร้อมไฟล์ `.eml` ใน `data/mail-outbox/`, และทดสอบการกดอนุมัติใน 1 คลิกของแอดมิน (`APPROVE_EXTEND_14D` และ `APPROVE_ACTIVATE`)
8. **SMTP / System Mail Configuration & Test Email Dispatch to `e24qdy2@gmail.com`:** ทดสอบการบันทึกตั้งค่า SMTP (`POST /api/admin/email/config`) และการกดปุ่มทดสอบส่งอีเมลไปยัง `e24qdy2@gmail.com` (`POST /api/admin/email/test`)

### คำสั่งรันทดสอบ SDLC
```powershell
npm test
```
