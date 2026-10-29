import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.WatchUi;

// Responsive Round AMOLED & MIP View for Garmin 2024-2026 Watches (260x260 through 454x454)
// Delegates layout geometry, collision prevention, and semantic rendering to MoatWatchLayout
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

    function onUpdate(dc as Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;

        _store.updateResponsiveMetrics(w, h);

        if (dc has :setAntiAlias) {
            dc.setAntiAlias(true);
        }

        var fMicro = _store.fontMicro;
        var fRow = (w >= 340) ? _store.fontRow : _store.fontMicro;
        var fVal = (w >= 340) ? _store.fontVal : _store.fontRow;

        // True Void Black Background
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        // Top Clock, Auto-Swipe, Always-On & License Status Header
        var clockTime = System.getClockTime();
        var timeStr = clockTime.hour.format("%02d") + ":" + clockTime.min.format("%02d");
        var modeFlags = MoatWatchLayout.formatHeaderModeFlags(_store);

        dc.setColor(0x94A3B8, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 5) / 100, fMicro, timeStr + modeFlags, Graphics.TEXT_JUSTIFY_CENTER);

        // Enforce 14-Day Trial Expiration Lock Screen
        if (_store.trialExpired) {
            MoatWatchLayout.drawTrialExpiredScreen(dc, _store, w, h, cx);
            return;
        }

        var port = _store.getActivePortfolio();
        if (port == null) {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h / 2 - 24, fVal, "MoatWatch", Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(0x06B6D4, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h / 2 + 6, fRow, "Key: " + _store.getSyncKey(), Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(0x64748B, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h / 2 + 30, fMicro, "ID: " + _store.deviceId, Graphics.TEXT_JUSTIFY_CENTER);
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
        dc.drawText(cx, (h * 10) / 100, fRow, "< " + portName + pageSuffix + " >", Graphics.TEXT_JUSTIFY_CENTER);

        // Portfolio Net Value
        var portVal = _store.toNum(port.get("val"), 0);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 15) / 100, fVal, curSym + portVal.toString(), Graphics.TEXT_JUSTIFY_CENTER);

        // Day P&L vs Total Return Toggle Line + Daily Fear & Greed Badge (FG:xxG)
        MoatWatchLayout.drawPortfolioPnlAndFearGreed(dc, _store, port, curSym, w, h, cx, fMicro);

        // Subtle Divider Line
        var divY = (h * 27) / 100;
        var divPad = _store.getCirclePadX(divY, divY + 1, (w * 9) / 100);
        dc.setColor(0x1E293B, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(divPad, divY, w - divPad, divY);

        // Responsive Holdings Rows (3 rows on 260/280 MIP, 4 rows on 360..454 AMOLED)
        var startIdx = _store.scrollRowOffset;
        var rowY = _store.rowStartY;
        var rowHeight = _store.rowHeight;
        var cardH = rowHeight - 4;

        for (var i = 0; i < visRows; i++) {
            var itemIdx = startIdx + i;
            if (itemIdx >= items.size()) {
                break;
            }
            var item = items[itemIdx] as Dictionary;
            MoatWatchLayout.drawHoldingRowCard(
                dc,
                _store,
                item,
                rowY,
                cardH,
                fRow,
                fMicro
            );
            rowY += rowHeight;
        }

        // Bottom Portfolio Dots Indicator
        MoatWatchLayout.drawPortfolioDots(dc, _store, h, cx);
    }
}
