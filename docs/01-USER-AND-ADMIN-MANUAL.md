# คู่มือการใช้งานระบบ Venu2Moat อย่างละเอียด (User, Watch & Admin Manual)

เอกสารฉบับนี้เป็นคู่มือการใช้งานฉบับสมบูรณ์สำหรับระบบ **Venu2Moat v2.1** ครอบคลุมทั้งฝั่งผู้ใช้งานบนนาฬิกา **Garmin Venu 2**, หน้าเว็บ **Web Companion (`https://moat.readybyte.top`)**, ฟอร์มขอต่ออายุและสั่งซื้อคีย์ (**Request Trial Key Extend & Purchase Request Form**), ระบบแจ้งเตือนทางอีเมลไปยัง **`e24qdy2@gmail.com`**, และหน้าผู้ดูแลระบบ **Admin Licensing Portal (`https://admin-moat.readybyte.top`)** ของเจ้าของระบบ (**`saharat.bun@icloud.com`**)

---

## สารบัญ (Table of Contents)
1. [ภาพรวมระบบและ URL เข้าใช้งาน](#1-ภาพรวมระบบและ-url-เข้าใช้งาน)
2. [คู่มือการติดตั้งแอปลงนาฬิกา Garmin Venu 2 (USB MTP Sideload)](#2-คู่มือการติดตั้งแอปลงนาฬิกา-garmin-venu-2-usb-mtp-sideload)
3. [คู่มือการใช้งานแอปบนนาฬิกา Garmin Venu 2](#3-คู่มือการใช้งานแอปบนนาฬิกา-garmin-venu-2)
4. [คู่มือการตั้งค่า Auto-Swipe & Always-On Screen ผ่านเว็บ](#4-คู่มือการตั้งค่า-auto-swipe--always-on-screen-ผ่านเว็บ)
5. [คู่มือการจัดการพอร์ตหุ้น, ราคาเป้าหมาย (Alert) และ WebMemo](#5-คู่มือการจัดการพอร์ตหุ้น-ราคาเป้าหมาย-alert-และ-webmemo)
6. [คู่มือระบบ Trial 14 วัน, การกดขอต่ออายุ Trial, ฟอร์มสั่งซื้อ License และการปลดล็อก Paid Version (`saharat.bun@icloud.com`)](#6-คู่มือระบบ-trial-14-วัน-การกดขอต่ออายุ-trial-ฟอร์มสั่งซื้อ-license-และการปลดล็อก-paid-version-saharatbunicloudcom)
7. [คู่มือผู้ดูแลระบบ Admin Licensing Portal & ระบบอีเมลแจ้งเตือน (`https://admin-moat.readybyte.top`)](#7-คู่มือผู้ดูแลระบบ-admin-licensing-portal--ระบบอีเมลแจ้งเตือน-httpsadmin-moatreadybytetop)

---

## 1. ภาพรวมระบบและ URL เข้าใช้งาน

| ระบบ | URL / ช่องทางเข้าถึง | รายละเอียดหน้าที่ |
| :--- | :--- | :--- |
| **Web Companion App** | [`https://moat.readybyte.top`](https://moat.readybyte.top) | จัดการพอร์ตหุ้น, จดบันทึก WebMemo, ตั้งค่า Auto-Swipe / Always-On, จำลองหน้าจอนาฬิกา 416×416, กรอกคีย์ปลดล็อกเครื่อง, กด **Request Trial Key Extend** และกรอก **Purchase Request Form** |
| **Admin Licensing Portal** | [`https://admin-moat.readybyte.top`](https://admin-moat.readybyte.top) | ระบบหลังบ้านเฉพาะเจ้าของระบบ (`saharat.bun@icloud.com`) สำหรับอนุมัติคำขอต่ออายุ/ซื้อคีย์ใน 1 คลิก, สร้าง Activation Key ราย `Device ID`, และตั้งค่า SMTP ส่งเมลแจ้งเตือนไปที่ `e24qdy2@gmail.com` |
| **Garmin Watch API** | `https://moat.readybyte.top/api/watch?key=VENU2-88` | Endpoint JSON ขนาดกะทัดรัด (`<12KB`) ที่นาฬิกา Garmin Venu 2 ดึงผ่าน Bluetooth / Wi-Fi |
| **Garmin Binary (`.prg`)** | `dist/Venu2Moat.prg` | ไฟล์แอปพลิเคชัน Connect IQ สำหรับติดตั้งลงใน `Internal Storage\GARMIN\APPS\` ของนาฬิกา |

---

## 2. คู่มือการติดตั้งแอปลงนาฬิกา Garmin Venu 2 (USB MTP Sideload)

```mermaid
flowchart LR
    A["1. เสียบสาย USB Garmin Venu 2 เข้าคอมพิวเตอร์"] --> B["2. รันสคริปต์ build-and-sideload.ps1"]
    B --> C["3. ระบบคอมไพล์ Venu2Moat.prg และคัดลอกเข้า GARMIN/APPS อัตโนมัติ"]
    C --> D["4. ถอดสาย USB ออกจากนาฬิกาเพื่อให้เครื่องติดตั้งแอป"]
    D --> E["5. กดปุ่มขวาบนที่นาฬิกา เลือกแอป Venu2Moat"]
```

### ขั้นตอนแบบอัตโนมัติ (แนะนำ)
1. เสียบสาย USB เชื่อมต่อนาฬิกา **Garmin Venu 2** เข้ากับคอมพิวเตอร์ (โหมด MTP)
2. เปิด PowerShell ที่โฟลเดอร์โปรเจกต์ `D:\all-workspace\garmin-venu2` แล้วรันคำสั่ง:
   ```powershell
   npm run build:watch
   # หรือ
   powershell -NoProfile -ExecutionPolicy Bypass -File .\build-and-sideload.ps1
   ```
3. สคริปต์จะทำการคอมไพล์ซอร์สโค้ด Monkey C เป็นไฟล์ `dist\Venu2Moat.prg` และส่งไฟล์เข้า `Garmin Venu 2\Internal Storage\GARMIN\APPS\Venu2Moat.prg` โดยอัตโนมัติ
4. **สำคัญ:** ถอดสาย USB ออกจากนาฬิกา เพื่อให้ระบบปฏิบัติการของ Garmin ทำการ Verify และติดตั้งไฟล์ `.prg` เข้าสู่เมนูแอป

### ขั้นตอนแบบคัดลอกไฟล์ด้วยตนเอง (Manual Drag & Drop)
1. เปิด **This PC** ใน Windows Explorer -> เข้าไปที่ **Venu 2** -> **Internal Storage** -> **GARMIN** -> **APPS**
2. คัดลอกไฟล์ `dist\Venu2Moat.prg` ไปวางในโฟลเดอร์ `APPS`
3. ถอดสาย USB ออกจากนาฬิกา แล้วเปิดแอป **Venu2Moat** จากรายการแอปบนนาฬิกา

---

## 3. คู่มือการใช้งานแอปบนนาฬิกา Garmin Venu 2

หน้าจอของ Garmin Venu 2 มีความละเอียด **416×416 พิกเซล (Round AMOLED)** โดยมีการควบคุมดังนี้:

| การกระทำบนนาฬิกา | ตำแหน่ง / ปุ่ม | ผลลัพธ์การทำงาน |
| :--- | :--- | :--- |
| **กดปุ่มขวาบน (Select Button)** | ปุ่มกายภาพด้านขวาบน | สลับการแสดงผลกำไร/ขาดทุนระหว่าง **DAY P&L (รายวัน)** และ **TOTAL RETURN (รวมทั้งหมด)** (หรือกดเพื่อตรวจสอบสิทธิ์ใหม่หากอยู่ในหน้าจอ Trial Expired) |
| **กดค้างปุ่มขวาล่าง (Menu / Back)** | ปุ่มกายภาพด้านขวาล่าง (กดค้าง) | สั่งดึงข้อมูลพอร์ตและสถานะ License ล่าสุดจากเซิร์ฟเวอร์ (`fetchRemote()`) ทันที |
| **ปัดซ้าย / ปัดขวา (`SWIPE_LEFT` / `RIGHT`)** | หน้าจอสัมผัส | สลับไปยังพอร์ตโฟลิโอก่อนหน้า / ถัดไป (เช่น `US Wide Moat` ⇄ `Thai Dividend` ⇄ `Watchlist`) |
| **ปัดขึ้น / ปัดลง (`SWIPE_UP` / `DOWN`)** | หน้าจอสัมผัส | เลื่อนดูรายชื่อหุ้นขึ้น-ลงทีละแถวภายในพอร์ตปัจจุบัน |
| **แตะที่แถบเวลาด้านบนสุด (`y < 40px`)** | ขอบบนของหน้าจอ | เปิด / ปิดโหมด **Auto-Swipe** อย่างรวดเร็วจากหน้าปัดนาฬิกาโดยตรง |
| **แตะที่ชื่อหุ้นในตาราง (`y = 136..352px`)** | แถวรายการหุ้น | เปิดหน้า **Symbol Detail View** เพื่อดูกราฟ **14-Day Sparkline**, เส้น **SMA-20**, กรอบ **Bollinger Bands**, ราคาเป้าหมาย และบันทึก **WebMemo** |
| **แตะในหน้า Symbol Detail View** | หน้าจอรายละเอียดหุ้น | เปิด / ปิดเส้นอินดิเคเตอร์ **SMA-20 / Bollinger Overlay** |

### สัญลักษณ์สถานะบนแถบด้านบนสุดของหน้าปัด (`Top Status Bar`)
- **`14:30 · 5s · AON · 14d`** หรือ **`14:30 · 5s · PRO`**
  - **`5s`**: เปิดโหมด Auto-Swipe เลื่อนหน้าหุ้นอัตโนมัติทุกๆ 5 วินาที (เปลี่ยนตามเวลาที่ตั้งจากหน้าเว็บ)
  - **`AON`**: เปิดโหมด Always-On Display (หน้าจอไม่ดับขณะเปิดแอป)
  - **`14d`**: จำนวนวันที่เหลือของช่วงทดลองใช้ฟรี (Free Trial 14 วัน)
  - **`PRO`**: เครื่องนี้ได้รับการ Activate ด้วยคีย์ถาวรเรียบร้อยแล้ว

### สัญลักษณ์จุดสีแจ้งเตือนหน้าชื่อหุ้น (`Alert Dot`)
- 🟢 **จุดสีเขียวมรกต (`TARGET_HIT`)**: ราคาตลาดปัจจุบันทะลุถึงเป้าหมาย (`ABOVE Target`) ที่ตั้งไว้แล้ว
- 🔴 **จุดสีแดง (`STOP_BREACH`)**: ราคาตลาดลดลงต่ำกว่าจุดเฝ้าระวัง (`BELOW Stop/Target`) ที่ตั้งไว้

---

## 4. คู่มือการตั้งค่า Auto-Swipe & Always-On Screen ผ่านเว็บ

ผู้ใช้งานสามารถปรับพฤติกรรมหน้าจอนาฬิกาได้จากหน้าเว็บ [`https://moat.readybyte.top`](https://moat.readybyte.top) ในส่วนการ์ด **"Watch Display & License Settings"** ด้านซ้ายมือ:

1. **Auto-Swipe Next Screen (`เปิด/ปิด` + `เวลาวินาที`)**:
   - เมื่อเปิดสวิตช์ **Auto-Swipe Next Screen** นาฬิกาจะเลื่อนดูหุ้นทีละหน้า (หน้าละ 4 ตัว เช่น หน้า `1/2` -> `2/2`) และเมื่อครบทุกหน้าในพอร์ตนั้น จะสลับไปยังพอร์ตถัดไปให้อัตโนมัติวนไปเรื่อยๆ โดยไม่ต้องใช้มือปัดจอ
   - **ค่าเริ่มต้น (Default):** `5s` (5 วินาที)
   - **ตั้งค่าเวลาเองได้ (Custom Seconds):** กดปุ่มลัด `3s`, `5s`, `10s`, `15s` หรือพิมพ์ตัวเลขวินาทีที่ต้องการ (`2` ถึง `120` วินาที) ลงในช่องตัวเลขได้เลย
2. **Always-On Screen (`ไม่บังคับเปิด`)**:
   - ค่าเริ่มต้นจะ **ปิด (`OFF`)** เพื่อประหยัดแบตเตอรี่
   - หากต้องการวางนาฬิกาหรือเปิดแอปดูพอร์ตแบบไม่ให้หน้าจอดับ ให้เปิดสวิตช์ **Always-On Screen (Keep Awake)** แล้วกดปุ่ม **Save & Sync to Watch**

---

## 5. คู่มือการจัดการพอร์ตหุ้น, ราคาเป้าหมาย (Alert) และ WebMemo

บนหน้าเว็บ [`https://moat.readybyte.top`](https://moat.readybyte.top):
1. **การเปลี่ยนสกุลเงินหลัก (`THB ฿` / `USD $`)**:
   - กดปุ่มสกุลเงินมุมขวาบน ระบบจะคำนวณมูลค่าพอร์ตรวม (`Total Net Worth`) และกำไร/ขาดทุน (`Day P&L` / `Total Return`) ด้วยอัตราแลกเปลี่ยน `USD/THB` แบบเรียลไทม์จาก Yahoo Finance
2. **การเพิ่ม/ลบพอร์ตโฟลิโอ (`+ New Portfolio`)**:
   - แยกหมวดหมู่พอร์ตได้อิสระ เช่น พอร์ตหุ้นเติบโตสหรัฐฯ, พอร์ตหุ้นปันผลไทย (`.BK`), หรือรายการเฝ้าดู (`Watchlist` โดยใส่จำนวนหุ้น `Shares = 0`)
3. **การเพิ่มหุ้นและตั้งค่า WebMemo**:
   - พิมพ์ชื่อย่อหุ้น เช่น `NVDA`, `MSFT`, `ADVANC.BK`, `DELTA.BK`, `BTC-USD`
   - ระบุจำนวนหุ้น (`Shares`), ต้นทุนเฉลี่ย (`Avg Cost`), ราคาเป้าหมาย (`Target Price`), เงื่อนไขแจ้งเตือน (`ABOVE` หรือ `BELOW`) และข้อความเตือนความจำในช่อง **WebMemo** (เช่น `"Wide moat AI GPU leader, hold for FY27"`)
   - กด **Save & Sync** ข้อมูลจะพร้อมให้แอปบนนาฬิกาดึงไปแสดงผลทันที

---

## 6. คู่มือระบบ Trial 14 วัน, การกดขอต่ออายุ Trial, ฟอร์มสั่งซื้อ License และการปลดล็อก Paid Version (`saharat.bun@icloud.com`)

```mermaid
flowchart TD
    Start["เปิดแอป Venu2Moat บนนาฬิกาครั้งแรก"] --> GenID["ระบบอ่าน Device ID ประจำเครื่อง (เช่น V2-88VENU20)"]
    GenID --> StartTrial["เริ่มสิทธิ์ทดลองใช้งานฟรี 14 วัน (TRIAL)"]
    StartTrial --> CheckExp{"ครบกำหนด 14 วันหรือยัง?"}
    CheckExp -- "ยังไม่ครบ (เหลือ 1..14 วัน)" --> Unlocked["ใช้งานดูพอร์ตหุ้นและ Auto-Swipe ได้เต็มรูปแบบ"]
    CheckExp -- "ครบ 14 วันแล้ว และยังไม่ได้ใส่คีย์" --> Locked["ล็อกหน้าจอนาฬิกา: TRIAL 14D EXPIRED"]
    Locked --> Contact["หน้าจอแสดง Device ID และอีเมลติดต่อเจ้าของแอป: saharat.bun@icloud.com"]
    Contact --> RequestForm["ลูกค้ากด Request Trial Key Extend หรือกรอก Purchase Request Form บนเว็บ"]
    RequestForm --> MailNotify["ระบบบันทึกเข้า Admin Approval Queue + ส่งเมลแจ้งเตือนไปที่ e24qdy2@gmail.com"]
    MailNotify --> AdminApprove["แอดมินกด Approve (+7d / +14d / PRO) หรือส่งรหัส MOAT-XXXX-XXXX-XXXX ให้ลูกค้า"]
    AdminApprove --> Pro["ปลดล็อกใช้งานต่อได้ทันทีบนนาฬิกาและหน้าเว็บ"]
```

### 6.1 เมื่อครบกำหนดทดลองใช้ 14 วัน (`TRIAL 14D EXPIRED`)
- หน้าจอนาฬิกาและตัวจำลองบนเว็บจะเปลี่ยนเป็นหน้าจอล็อกสีแดงเข้ม แสดงข้อความ:
  - **`TRIAL 14D EXPIRED — Activation Required`**
  - **`ID: V2-XXXXXXXX`** (รหัสประจำเครื่องนาฬิกาของคุณ)
  - **`Contact App Owner (Paid): saharat.bun@icloud.com`**

### 6.2 วิธีกดขอต่ออายุทดลองใช้ (`Request Trial Key Extend`) หรือกรอกฟอร์มสั่งซื้อ (`Purchase Request Form`)
บนหน้าเว็บ [`https://moat.readybyte.top`](https://moat.readybyte.top) ในส่วน **Per-Device License Activation** ด้านซ้ายมือ (หรือปุ่มบนหน้าจอจำลองเมื่อหมดอายุ):
1. กดปุ่ม **"+ Request Trial Key Extend"** (ขอต่ออายุทดลองใช้) หรือปุ่ม **"Purchase Request Form"** (แจ้งความประสงค์ซื้อคีย์ถาวร)
2. หน้าต่างแบบฟอร์มจะดึง **`Device ID`** และ **`Sync Key`** ของคุณมาใส่อัตโนมัติ
3. เลือกประเภทคำขอ:
   - **Request Trial Key Extend** (ระบุจำนวนวันที่ต้องการขอต่ออายุเพิ่ม เช่น `+7 วัน` หรือ `+14 วัน`)
   - **Purchase License (PRO)** (แจ้งความประสงค์ต้องการซื้อคีย์ถาวรเพื่อให้เจ้าของระบบติดต่อกลับ)
4. กรอกชื่อผู้ติดต่อ (`Contact Name`), อีเมล (`Email`), เบอร์โทรศัพท์ / LINE ID (`Phone / LINE ID`), และข้อความเพิ่มเติม แล้วกดปุ่ม **Submit Request**
5. ระบบจะส่งคำขอเข้าสู่คิวอนุมัติของผู้ดูแลระบบ (`saharat.bun@icloud.com`) และส่งอีเมลแจ้งเตือนไปยัง **`e24qdy2@gmail.com`** ทันที

### 6.3 วิธีกรอกรหัส Activation Key ด้วยตนเอง
หากได้รับรหัส **Activation Key** (รูปแบบ `MOAT-XXXX-XXXX-XXXX` ซึ่งผูกเฉพาะกับ `Device ID` ของคุณเท่านั้น):
1. เปิดเว็บ [`https://moat.readybyte.top`](https://moat.readybyte.top) -> ไปที่ช่อง **Activation Key** ด้านซ้าย -> วางรหัสคีย์แล้วกดปุ่ม **Activate**
2. บนนาฬิกา กดปุ่มขวาบน (**SELECT**) เพื่อซิงค์สถานะ หน้าจอล็อกจะปลดล็อกทันทีและแสดงสถานะ **`PRO`**

---

## 7. คู่มือผู้ดูแลระบบ Admin Licensing Portal & ระบบอีเมลแจ้งเตือน (`https://admin-moat.readybyte.top`)

หน้า Admin Portal แยกเป็น Subdomain เฉพาะที่ [`https://admin-moat.readybyte.top`](https://admin-moat.readybyte.top) สำหรับเจ้าของระบบ (**`saharat.bun@icloud.com`**) เท่านั้น

### 7.1 การเข้าสู่ระบบด้วยรหัสผ่านผู้ดูแลระบบ (Admin Password Login) และการเปลี่ยนรหัสผ่านใหม่ (Change Admin Password)
1. เปิด [`https://admin-moat.readybyte.top`](https://admin-moat.readybyte.top)
2. ในหน้า **เข้าสู่ระบบผู้ดูแล (Admin Login)**:
   - อีเมลผู้ดูแลระบบ: **`saharat.bun@icloud.com`**
   - กรอก **รหัสผ่านผู้ดูแลระบบ (Admin Password)** (รหัสผ่านเริ่มต้นถูกกำหนดไว้ในไฟล์ `.env` ภายในเครื่องเซิร์ฟเวอร์ที่ตัวแปร `ADMIN_INITIAL_PASSWORD` เท่านั้น และไม่มีการแสดง Hint รหัสผ่านใน HTML View Source เพื่อความปลอดภัยสูงสุด) แล้วกดปุ่ม **เข้าสู่ระบบจัดการ (Sign In with Password)**
   - **ระบบป้องกันการเดารหัสผ่าน (Brute-Force Lockout):** หากกรอกรหัสผ่านผิดเกิน **5 ครั้งภายใน 15 นาที** ระบบจะล็อกการเข้าสู่ระบบจาก IP นั้นเป็นเวลา 15 นาที (`HTTP 429 Too Many Requests`) โดยอัตโนมัติ
3. **การเปลี่ยนรหัสผ่านผู้ดูแลระบบ (Change Admin Password พร้อมยืนยันรหัสเดิม):**
   - หลังจากเข้าสู่ระบบแล้ว กดปุ่ม **"เปลี่ยนรหัสผ่าน Admin"** ที่มุมขวาบน หรือเลื่อนไปที่การ์ด **"เปลี่ยนรหัสผ่านผู้ดูแลระบบ (Change Password)"** ทางด้านซ้าย
   - กรอกข้อมูลให้ครบทั้ง 3 ช่อง:
     1. **รหัสผ่านเดิม (Current Password):** กรอกรหัสผ่านปัจจุบันเพื่อยืนยันตัวตน (หากกรอกรหัสผ่านเดิมไม่ถูกต้อง ระบบจะปฏิเสธการเปลี่ยนรหัสผ่านทันที)
     2. **รหัสผ่านใหม่ (New Password):** ตั้งรหัสผ่านใหม่อย่างน้อย 6 ตัวอักษร (ต้องไม่ซ้ำกับรหัสผ่านเดิม)
     3. **ยืนยันรหัสผ่านใหม่ (Confirm New Password):** กรอกรหัสผ่านใหม่อีกครั้งให้ตรงกัน
   - กดปุ่ม **"ยืนยันรหัสเดิมและเปลี่ยนรหัสผ่านใหม่"** ระบบจะเข้ารหัสรหัสผ่านใหม่ด้วย `crypto.scryptSync` พร้อม Salt ใหม่และบันทึกลง Audit Trail ทันที

### 7.2 การอนุมัติคำขอต่ออายุ Trial & คำขอสั่งซื้อ License (`Customer Requests Queue`)
ในส่วน **คิวคำขอต่ออายุ Trial & สั่งซื้อ License (Customer Requests Queue)** ด้านขวาบน:
- เมื่อลูกค้าส่งคำขอ **Trial Extend** หรือ **Purchase License** จากหน้าเว็บ รายการจะปรากฏพร้อมข้อมูลติดต่อ (`ชื่อ`, `อีเมล`, `เบอร์โทร / LINE`, `Device ID`, `ข้อความความประสงค์`) และมีรหัส `Activation Key` เฉพาะเครื่องแสดงให้พร้อมคัดลอก
- แอดมินสามารถกดปุ่มจัดการได้ในคลิกเดียว:
  - **`✓ Approve & Activate PRO`**: อนุมัติและปลดล็อกเครื่องเป็นสถานะ `ACTIVE (Paid PRO)` ให้ลูกค้าทันที
  - **`+ Approve Extend +14d`**: อนุมัติต่อเวลาทดลองใช้เพิ่มให้อีก 14 วันทันที
  - **`+ Approve Extend +7d`**: อนุมัติต่อเวลาทดลองใช้เพิ่มให้อีก 7 วันทันที
  - **`✕ Reject`**: ปฏิเสธคำขอ

### 7.3 การตั้งค่าบริการอีเมล SMTP / System Mail (ส่งแจ้งเตือนไปยัง `e24qdy2@gmail.com`)
ในการ์ด **ตั้งค่า SMTP / System Mail (ส่งแจ้งเตือนไปที่ `e24qdy2@gmail.com`)** ทางด้านซ้ายล่าง:
1. ระบบตั้งค่าปลายทางรับอีเมลแจ้งเตือนทุกคำขอไว้ที่ **`e24qdy2@gmail.com`**
2. สามารถตั้งค่าเซิร์ฟเวอร์ SMTP ได้โดยตรงผ่านหน้าเว็บ Admin:
   - **SMTP Host**: เช่น `smtp.gmail.com` หรือ `smtp.mail.me.com`
   - **SMTP Port**: `465` (Implicit TLS) หรือ `587` (STARTTLS)
   - **SMTP Username**: อีเมลผู้ส่ง (เช่น `e24qdy2@gmail.com` หรือ `saharat.bun@icloud.com`)
   - **SMTP App Password**: รหัสผ่านแอป 16 หลักของ Gmail / iCloud
3. กดปุ่ม **"บันทึกตั้งค่า SMTP"** เพื่อบันทึก หรือกดปุ่ม **"ทดสอบส่งเมลไป `e24qdy2@gmail.com`"** เพื่อทดสอบส่งอีเมลทันที
4. หากยังไม่ได้ใส่รหัส SMTP App Password ระบบจะใช้โหมด **Direct MX System Mail (`gmail-smtp-in.l.google.com:25`) + บันทึกไฟล์อีเมล `.eml` ลงใน `data/mail-outbox/`** พร้อมแสดงประวัติการส่งเมลทุกฉบับในตาราง **Email Notification Outbox Log** ด้านล่างของหน้า Admin

### 7.4 การออกรหัส Activation Key รายเครื่อง (`Per-Device Key Generator`) และควบคุมสถานะเครื่อง
1. ในส่วน **Generate Activation Key by Device ID**:
   - กรอก **`Device ID`** ของลูกค้า (เช่น `V2-88VENU20`) และชื่อลูกค้า
   - เลือก **Generate Key** หรือ **Generate & Auto-Activate**
2. ในตาราง **Registered Garmin Venu 2 Devices** แอดมินสามารถกดปุ่มควบคุมรายเครื่องได้ทันที:
   - **`Copy Key`**: คัดลอก Activation Key (`MOAT-XXXX-XXXX-XXXX`) ของเครื่องนั้นส่งให้ลูกค้า
   - **`Activate`**: ปลดล็อกเครื่องเป็นสถานะ `ACTIVE (Paid)` ทันที
   - **`Expire 14d`**: บังคับให้สิทธิ์ทดลองใช้หมดอายุทันที (ใช้ทดสอบหน้าจอล็อก `TRIAL 14D EXPIRED` บนนาฬิกา)
   - **`+14d`**: ต่ออายุเวลาทดลองใช้เพิ่มให้อีก 14 วัน
   - **`Reset 14d`**: รีเซ็ตเวลานับถอยหลัง Trial 14 วันใหม่ตั้งแต่ต้น
