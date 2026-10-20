# Venu2Moat — App Design & Garmin Venu 2 416×416 AMOLED UI Specification

เอกสารฉบับนี้อธิบายการออกแบบสถาปัตยกรรมหน้าจอ (UI/UX Blueprint), ข้อจำกัดฮาร์ดแวร์ของ **Garmin Venu 2**, ระบบสี AMOLED True Black, และการออกแบบคลาสในภาษา **Monkey C (Connect IQ SDK 8.4.1)**

---

## 1. ข้อมูลจำเพาะทางฮาร์ดแวร์ของ Garmin Venu 2 (`venu2`)

| พารามิเตอร์ฮาร์ดแวร์ | ค่ามาตรฐานของ Garmin Venu 2 | แนวทางการออกแบบใน Venu2Moat |
| :--- | :--- | :--- |
| **ความละเอียดหน้าจอ** | **416 × 416 พิกเซล** (ทรงกลม Round Display) | คำนวณระยะขอบโค้ง (Circular Safe Zone) ทุกแถวต้องมีระยะร่นซ้าย-ขวาอย่างน้อย `44px–56px` เพื่อไม่ให้ตัวอักษรตกขอบโค้ง |
| **ชนิดหน้าจอ** | **AMOLED** (65,536 สี) | ใช้พื้นหลัง **True Void Black (`0x000000`)** เพื่อปิดพิกเซลสีดำสนิท ลดการใช้พลังงานแบตเตอรี่สูงสุดแม้เปิดโหมด Always-On |
| **หน่วยความจำ HTTP JSON** | จำกัดการแปลง JSON ในหน่วยความจำ (`Communications.makeWebRequest`) | ออกแบบ Compact Watch Payload (`/api/watch`) ใช้คีย์ย่อ (`p`, `s`, `cfg`, `lic`, `tot`) ให้ขนาดเพย์โหลดรวมต่ำกว่า `4 KB` |
| **ปุ่มกดและอินพุต** | 2 ปุ่มกายภาพ (`Select` ขวาบน, `Back/Menu` ขวาล่าง) + หน้าจอสัมผัส (`Swipe`, `Tap`) | รองรับทั้งการกดปุ่ม, การปัดจอ 4 ทิศทาง, การแตะแถวหุ้น, และระบบ **Auto-Swipe** แบบไร้สัมผัส |

---

## 2. ผังพิกัดหน้าจอ 416×416 พิกเซล (Coordinate-Level Screen Blueprints)

### 2.1 หน้าจอหลัก: Portfolio & Holdings View (`Venu2MoatView.mc`)

```
                    ╭───────────────────────────────╮
                 ╭──╯     14:30 · 5s · AON · 14d    ╰──╮   [y = 16px]  Clock + Auto-Swipe + Always-On + Trial/PRO
              ╭──╯       < US Wide Moat 1/2 >          ╰──╮ [y = 42px]  Portfolio Title + Page Indicator
            ╭─╯               ฿1,482,910                  ╰─╮ [y = 64px]  Portfolio Net Value (FONT_MEDIUM)
           ╭╯         DAY: +฿18,420 (+1.25%)                ╰╮ [y = 102px] Day P&L / Total Return Toggle
          ╭╯  ─────────────────────────────────────────────  ╰╮ [y = 128px] Divider Line (x: 52..364)
          │   ┌───────────────────────────────────────────┐   │
          │   │ ● NVDA               $138.60     +2.82%   │   │ [y = 136px] Row 1 (Height: 48px, Radius: 12px)
          │   └───────────────────────────────────────────┘   │
          │   ┌───────────────────────────────────────────┐   │
          │   │   MSFT               $428.50     +1.04%   │   │ [y = 190px] Row 2
          │   └───────────────────────────────────────────┘   │
          │   ┌───────────────────────────────────────────┐   │
          │   │   GOOGL              $181.40     +1.28%   │   │ [y = 244px] Row 3
          │   └───────────────────────────────────────────┘   │
          │   ┌───────────────────────────────────────────┐   │
          │   │   BRK-B              $454.80     +0.62%   │   │ [y = 298px] Row 4
          │   └───────────────────────────────────────────┘   │
           ╰╮                                               ╭╯
            ╰─╮                  ●  ○  ○                  ╭─╯ [y = 390px] Portfolio Pagination Dots
              ╰──╮                                     ╭──╯
                 ╰──╮                               ╭──╯
                    ╰───────────────────────────────╯
```

### 2.2 หน้าจอรายละเอียดหุ้น: Symbol Detail + Sparkline + WebMemo (`SymbolDetailView.mc`)

```
                    ╭───────────────────────────────╮
                 ╭──╯             NVDA              ╰──╮   [y = 24px]  Symbol Ticker (FONT_SMALL)
              ╭──╯        $138.60 (+2.82%)             ╰──╮ [y = 56px]  Live Price & Change %
            ╭─╯            [TARGET_HIT]                   ╰─╮ [y = 80px]  Alert Status Pill (Emerald/Rose/Amber)
           ╭╯  ┌─────────────────────────────────────────┐  ╰╮
          ╭╯   │  ╭──╮        ╭───╮        ╭──────────   │   ╰╮ [y = 108..204px] 14-Day Sparkline (3px stroke)
          │    │ ─╯  ╰────────╯   ╰────────╯  (SMA-20)   │    │                  + Cyan SMA-20 Overlay (1px)
          ╰╮   └─────────────────────────────────────────┘   ╭╯
           ╰╮      Hold: 45.0 @ $92.5 (+49.8%)              ╭╯ [y = 220px] Position Shares, Avg Cost & Total P&L%
            ╰─╮               WEBMEMO                     ╭─╯ [y = 254px] WebMemo Header (Cyan 0x06B6D4)
              ╰──╮  "AI datacenter monopoly; trim 10%  ╭──╯   [y = 280px] Auto-wrapped Thesis Note (fitTextToArea)
                 ╰──╮     if PE exceeds 45x"        ╭──╯
                    ╰───────────────────────────────╯
```

### 2.3 หน้าจอล็อกเมื่อหมดเวลาทดลองใช้ 14 วัน (`drawTrialExpiredScreen` ใน `Venu2MoatView.mc`)

```
                    ╭═══════════════════════════════╮
                 ╭══╯   ┌───────────────────────┐   ╰══╮   [Outer Ring] Rose Alert Border (0xF43F5E, 3px)
              ╭══╯      │   TRIAL 14D EXPIRED   │      ╰══╮ [y = 56px]  Rose Badge Pill (0x3B0A18 fill)
            ╭═╯         └───────────────────────┘         ╰═╮
           ╭║              Activation Required              ║╮ [y = 102px] White Header (FONT_SMALL)
          ╭║     ┌─────────────────────────────────────┐     ║╮
          ║      │          ID: V2-88VENU20            │      ║ [y = 142px] Device ID Box (Amber 0xF59E0B)
          ║      └─────────────────────────────────────┘      ║
          ║            Contact App Owner (Paid):              ║ [y = 198px] Subtitle (Slate 0x94A3B8)
          ╰║     ┌─────────────────────────────────────┐     ║╯
           ╰║    │       saharat.bun@icloud.com        │    ║╯ [y = 230px] Owner Contact Pill (Cyan 0x06B6D4)
            ╰═╮  └─────────────────────────────────────┘  ╭═╯
              ╰══╮      Activate via Web Settings      ╭══╯   [y = 292px] Action Hint
                 ╭══╮    Press SELECT to Verify     ╭══╯      [y = 322px] Re-sync Trigger Hint (Emerald)
                    ╰═══════════════════════════════╯
```

---

## 3. ระบบสี AMOLED & Design Tokens (`Color & Typography System`)

เพื่อให้สอดคล้องกันทั้งบนหน้าปัดนาฬิกา Garmin Venu 2 และหน้าเว็บ Companion/Admin:

| Token Name | Hex Code | Monkey C Hex | การนำไปใช้งาน |
| :--- | :--- | :--- | :--- |
| **Void Black** | `#000000` / `#050608` | `Graphics.COLOR_BLACK` | พื้นหลังหลักของหน้าปัดนาฬิกา (ปิดเม็ดพิกเซล AMOLED เพื่อประหยัดพลังงาน) |
| **Row Surface Tray** | `#0D131C` | `0x0D131C` | พื้นหลังแถวรายการหุ้นทรงแคปซูลโค้งมน (`radius = 12px`) |
| **Alabaster White** | `#FFFFFF` | `Graphics.COLOR_WHITE` | มูลค่าพอร์ตสุทธิ, ชื่อย่อหุ้น (`sym`), และข้อความหลักที่ต้องการความคมชัดสูงสุด |
| **Moat Cyan** | `#06B6D4` | `0x06B6D4` | ชื่อพอร์ตโฟลิโอ, จุดบอกหน้าพอร์ตปัจจุบัน, เส้นค่าเฉลี่ย `SMA-20`, และอีเมลเจ้าของระบบ `saharat.bun@icloud.com` |
| **Profit Emerald** | `#10B981` | `0x10B981` | กำไรเป็นบวก (`+P&L`), กราฟขาขึ้น, จุดแจ้งเตือน `TARGET_HIT`, และสถานะ `ACTIVE` |
| **Loss Crimson Rose** | `#F43F5E` | `0xF43F5E` | ขาดทุนติดลบ (`-P&L`), จุดแจ้งเตือน `STOP_BREACH`, และกรอบล็อกหน้าจอ `TRIAL 14D EXPIRED` |
| **Warning Amber** | `#F59E0B` | `0xF59E0B` | แจ้งเตือนเข้าใกล้เป้าหมาย (`NEAR_TARGET`) และป้ายแสดงรหัส `Device ID` |

---

## 4. โครงสร้างคลาสของแอปนาฬิกา Garmin Connect IQ (`Class Diagram`)

```mermaid
classDiagram
    class Venu2MoatApp {
        -PortfolioStore _store
        +initialize()
        +onStart(state) Void
        +onStop(state) Void
        +onSettingsChanged() Void
        +getInitialView() Array
        +getGlanceView() Array
    }

    class PortfolioStore {
        +Dictionary payload
        +Number activePortfolioIdx
        +Number scrollRowOffset
        +Boolean showTotalReturn
        +Boolean autoSwipeEnabled
        +Number autoSwipeSec
        +Boolean alwaysOnDisplay
        +Boolean inDetailView
        +String deviceId
        +String activationKey
        +String licenseStatus
        +Number trialDaysLeft
        +Boolean trialExpired
        +String ownerEmail
        -Timer _runtimeTimer
        -Number _swipeElapsedSec
        -Number _backlightTick
        +initHardwareDeviceId() Void
        +loadLocalProperties() Void
        +startRuntimeTimer() Void
        +stopRuntimeTimer() Void
        +onRuntimeTick() Void
        +stepAutoSwipe() Void
        +applyBacklightIfEnabled() Void
        +applyRemoteConfigAndLicense(data) Void
        +fetchRemote() Void
        +onReceivePayload(responseCode, data) Void
    }

    class Venu2MoatView {
        -PortfolioStore _store
        +onShow() Void
        +onUpdate(dc) Void
        +drawTrialExpiredScreen(dc, w, h, cx) Void
    }

    class Venu2MoatDelegate {
        -PortfolioStore _store
        +onSelect() Boolean
        +onMenu() Boolean
        +onSwipe(evt) Boolean
        +onTap(evt) Boolean
    }

    class SymbolDetailView {
        -Dictionary _item
        +Boolean showBollinger
        +onUpdate(dc) Void
    }

    class SymbolDetailDelegate {
        -SymbolDetailView _view
        +onTap(evt) Boolean
        +onSelect() Boolean
        +onBack() Boolean
    }

    class Venu2MoatGlanceView {
        +onUpdate(dc) Void
    }

    Venu2MoatApp --> PortfolioStore : owns & starts timer
    Venu2MoatApp --> Venu2MoatView : creates
    Venu2MoatApp --> Venu2MoatDelegate : creates
    Venu2MoatApp --> Venu2MoatGlanceView : creates (:glance)
    Venu2MoatView --> PortfolioStore : reads state & renders 416x416
    Venu2MoatDelegate --> PortfolioStore : dispatches touch/button events
    Venu2MoatDelegate --> SymbolDetailView : pushes on row tap
    SymbolDetailDelegate --> SymbolDetailView : toggles SMA20/Bollinger
```
