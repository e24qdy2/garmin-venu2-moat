import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.WatchUi;

// Responsive Round AMOLED & MIP View for Garmin 2024-2026 Watches (260x260 through 454x454)
class Venu2MoatView extends WatchUi.View {
    private var _store as PortfolioStore;

    function initialize(store as PortfolioStore) {
        View.initialize();
        _store = store;
    }

    function onShow() as Void {
        _store.inDetailView = false;
        _store.applyBacklightIfEnabled();
    }

    function drawTrialExpiredScreen(dc as Dc, w as Number, h as Number, cx as Number) as Void {
        // Outer Rose Alert Ring
        dc.setColor(0xF43F5E, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(3);
        dc.drawCircle(cx, h / 2, (w / 2) - 6);
        dc.setPenWidth(1);

        var pillW = (w * 54) / 100;
        var pillH = (h * 7) / 100;
        var pillY = (h * 13) / 100;
        dc.setColor(0x3B0A18, Graphics.COLOR_TRANSPARENT);
        dc.fillRoundedRectangle(cx - (pillW / 2), pillY, pillW, pillH, 12);
        dc.setColor(0xF43F5E, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, pillY + 2, Graphics.FONT_XTINY, "TRIAL 14D EXPIRED", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 24) / 100, Graphics.FONT_SMALL, "Activation Required", Graphics.TEXT_JUSTIFY_CENTER);

        var boxW = (w * 62) / 100;
        var boxH = (h * 10) / 100;
        var boxY = (h * 34) / 100;
        dc.setColor(0x0D131C, Graphics.COLOR_TRANSPARENT);
        dc.fillRoundedRectangle(cx - (boxW / 2), boxY, boxW, boxH, 10);
        dc.setColor(0xF59E0B, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, boxY + 6, Graphics.FONT_XTINY, "ID: " + _store.deviceId, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(0x94A3B8, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 47) / 100, Graphics.FONT_XTINY, "Contact App Owner (Paid):", Graphics.TEXT_JUSTIFY_CENTER);

        var mailW = (w * 68) / 100;
        var mailH = (h * 10) / 100;
        var mailY = (h * 55) / 100;
        dc.setColor(0x082F49, Graphics.COLOR_TRANSPARENT);
        dc.fillRoundedRectangle(cx - (mailW / 2), mailY, mailW, mailH, 10);
        dc.setColor(0x06B6D4, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, mailY + 6, Graphics.FONT_XTINY, _store.ownerEmail, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(0x64748B, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 70) / 100, Graphics.FONT_XTINY, "Activate via Web Settings", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(0x10B981, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 77) / 100, Graphics.FONT_XTINY, "Press SELECT to Verify", Graphics.TEXT_JUSTIFY_CENTER);
    }

    function onUpdate(dc as Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;

        _store.updateResponsiveMetrics(w, h);

        if (dc has :setAntiAlias) {
            dc.setAntiAlias(true);
        }

        // True Void Black Background
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        // Top Clock, Auto-Swipe, Always-On & License Status Header
        var clockTime = System.getClockTime();
        var timeStr = clockTime.hour.format("%02d") + ":" + clockTime.min.format("%02d");
        var modeFlags = "";
        if (_store.autoSwipeEnabled) {
            modeFlags = modeFlags + " · " + _store.autoSwipeSec.toString() + "s";
        }
        if (_store.alwaysOnDisplay) {
            modeFlags = modeFlags + " · AON";
        }
        if (_store.licenseStatus.equals("ACTIVE")) {
            modeFlags = modeFlags + " · PRO";
        } else if (!_store.trialExpired) {
            modeFlags = modeFlags + " · " + _store.trialDaysLeft.toString() + "d";
        }

        dc.setColor(0x94A3B8, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 4) / 100, Graphics.FONT_XTINY, timeStr + modeFlags, Graphics.TEXT_JUSTIFY_CENTER);

        // Enforce 14-Day Trial Expiration Lock Screen
        if (_store.trialExpired) {
            drawTrialExpiredScreen(dc, w, h, cx);
            return;
        }

        var port = _store.getActivePortfolio();
        if (port == null) {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h / 2 - 24, Graphics.FONT_SMALL, "Venu2Moat", Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(0x06B6D4, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h / 2 + 4, Graphics.FONT_XTINY, "Key: " + _store.getSyncKey(), Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(0x64748B, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h / 2 + 28, Graphics.FONT_XTINY, "ID: " + _store.deviceId, Graphics.TEXT_JUSTIFY_CENTER);
            return;
        }

        var bc = (_store.payload != null && _store.payload.hasKey("bc")) ? (_store.payload.get("bc") as String) : "THB";
        var curSym = bc.equals("USD") ? "$" : "฿";

        // Holdings array & pagination indicator
        var items = port.get("s") as Array;
        var visRows = _store.visibleRows;
        var totalPages = (items.size() > 0) ? ((items.size() + visRows - 1) / visRows) : 1;
        var curPage = (_store.scrollRowOffset / visRows) + 1;
        var pageSuffix = (totalPages > 1) ? (" " + curPage.toString() + "/" + totalPages.toString()) : "";

        // Portfolio Short Title
        var portName = port.get("n") as String;
        dc.setColor(0x06B6D4, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 10) / 100, Graphics.FONT_XTINY, "< " + portName + pageSuffix + " >", Graphics.TEXT_JUSTIFY_CENTER);

        // Portfolio Net Value
        var portVal = port.get("val") as Number;
        var valFont = (h < 300) ? Graphics.FONT_SMALL : Graphics.FONT_MEDIUM;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 15) / 100, valFont, curSym + portVal.toString(), Graphics.TEXT_JUSTIFY_CENTER);

        // Day P&L vs Total Return Toggle Line
        var pnlVal = _store.showTotalReturn ? (port.get("tp") as Number) : (port.get("dp") as Number);
        var pnlPct = _store.showTotalReturn ? (port.get("tPct") as Float) : (port.get("dPct") as Float);
        var modePrefix = _store.showTotalReturn ? "TOTAL: " : "DAY: ";
        var sign = (pnlVal >= 0) ? "+" : "";
        var pnlColor = (pnlVal >= 0) ? 0x10B981 : 0xF43F5E;

        dc.setColor(pnlColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(
            cx,
            (h * 24) / 100,
            Graphics.FONT_XTINY,
            modePrefix + sign + curSym + pnlVal.toString() + " (" + sign + pnlPct.format("%.2f") + "%)",
            Graphics.TEXT_JUSTIFY_CENTER
        );

        // Subtle Divider Line
        var divY = (h * 31) / 100;
        var sidePad = (w * 11) / 100;
        dc.setColor(0x1E293B, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(sidePad, divY, w - sidePad, divY);

        // Responsive Holdings Rows (3 rows on 260/280 MIP, 4 rows on 360..454 AMOLED)
        var startIdx = _store.scrollRowOffset;
        var rowY = _store.rowStartY;
        var rowHeight = _store.rowHeight;
        var symFont = (h < 340) ? Graphics.FONT_XTINY : Graphics.FONT_SMALL;

        for (var i = 0; i < visRows; i++) {
            var itemIdx = startIdx + i;
            if (itemIdx >= items.size()) {
                break;
            }
            var item = items[itemIdx] as Dictionary;
            var sym = (item.hasKey("sym") ? item.get("sym") : item.get("s")) as String;
            var px = (item.hasKey("px") ? item.get("px") : item.get("p")) as Float;
            var pct = _store.showTotalReturn
                ? ((item.hasKey("pPct") ? item.get("pPct") : item.get("tPct")) as Float)
                : ((item.hasKey("pct") ? item.get("pct") : item.get("c")) as Float);
            var alrt = item.hasKey("alrt") ? (item.get("alrt") as String) : "NORMAL";
            var itemCur = (item.get("cur") as String).equals("USD") ? "$" : "฿";

            // Rounded Row Tray
            dc.setColor(0x0D131C, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(sidePad, rowY, w - (sidePad * 2), rowHeight - 5, 10);

            var dotX = sidePad + 12;
            var dotY = rowY + ((rowHeight - 5) / 2);

            // Target / Stop Alert Dot
            if (alrt.equals("TARGET_HIT")) {
                dc.setColor(0x10B981, Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(dotX, dotY, 4);
            } else if (alrt.equals("STOP_BREACH")) {
                dc.setColor(0xF43F5E, Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(dotX, dotY, 4);
            } else if (alrt.equals("NEAR_TARGET")) {
                dc.setColor(0xF59E0B, Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(dotX, dotY, 4);
            }

            // Symbol Name
            var textOffsetY = (rowHeight - 24) / 2;
            if (textOffsetY < 4) { textOffsetY = 4; }
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(sidePad + 22, rowY + textOffsetY, symFont, sym, Graphics.TEXT_JUSTIFY_LEFT);

            // Price & Delta %
            var rowSign = (pct >= 0) ? "+" : "";
            var rowColor = (pct >= 0) ? 0x10B981 : 0xF43F5E;
            dc.setColor(0xCBD5E1, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w - sidePad - ((w * 20) / 100), rowY + textOffsetY + 2, Graphics.FONT_XTINY, itemCur + px.format("%.2f"), Graphics.TEXT_JUSTIFY_RIGHT);

            dc.setColor(rowColor, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w - sidePad - 10, rowY + textOffsetY + 2, Graphics.FONT_XTINY, rowSign + pct.format("%.2f") + "%", Graphics.TEXT_JUSTIFY_RIGHT);

            rowY += rowHeight;
        }

        // Bottom Portfolio Dots Indicator
        var allPorts = _store.getPortfolios();
        var dotSpan = allPorts.size() * 14;
        var dotStartX = cx - (dotSpan / 2) + 7;
        var dotBarY = h - ((h * 6) / 100);
        for (var pIdx = 0; pIdx < allPorts.size(); pIdx++) {
            if (pIdx == _store.activePortfolioIdx) {
                dc.setColor(0x06B6D4, Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(dotStartX + pIdx * 14, dotBarY, 4);
            } else {
                dc.setColor(0x334155, Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(dotStartX + pIdx * 14, dotBarY, 3);
            }
        }
    }
}
