import Toybox.Graphics;
import Toybox.Lang;

// ============================================================================
// MoatWatchLayout — Deep Module for Round AMOLED & MIP Watch Geometry,
// Collision-Safe Typography, Semantic Color Palette & Chart Rendering
// ============================================================================
module MoatWatchLayout {

    // Semantic P&L Color (Emerald >= 0, Rose < 0)
    function getPnlColor(val as Float) as Number {
        return (val >= 0.0) ? 0x10B981 : 0xF43F5E;
    }

    // Semantic RSI14 Color (<=30 Emerald Oversold, >=70 Rose Overbought, 31-69 Violet Neutral)
    function getRsiColor(rsi as Float) as Number {
        if (rsi <= 30.0) {
            return 0x34D399;
        }
        if (rsi >= 70.0) {
            return 0xFB7185;
        }
        return 0xC084FC;
    }

    // Alert Status Dot Color (0 if NORMAL)
    function getAlertColor(alrt as String) as Number {
        if (alrt.equals("TARGET_HIT")) {
            return 0x10B981;
        }
        if (alrt.equals("STOP_BREACH")) {
            return 0xF43F5E;
        }
        if (alrt.equals("NEAR_TARGET")) {
            return 0xF59E0B;
        }
        return 0;
    }

    // Compact Price Formatter ($123.45 or $12345 for >=10000)
    function formatPriceCompact(cur as String, px as Float) as String {
        return (px >= 10000.0) ? (cur + px.format("%.0f")) : (cur + px.format("%.2f"));
    }

    // Signed Percentage Formatter (+1.23% or -0.45%)
    function formatSignedPct(pct as Float) as String {
        var sign = (pct >= 0.0) ? "+" : "";
        return sign + pct.format("%.2f") + "%";
    }

    // Compact Day Low / Day High Range ("L215 H221")
    function formatHiLoCompact(dayLo as Float, dayHi as Float) as String {
        var loStr = (dayLo >= 100.0) ? dayLo.format("%.0f") : dayLo.format("%.1f");
        var hiStr = (dayHi >= 100.0) ? dayHi.format("%.0f") : dayHi.format("%.1f");
        return "L" + loStr + " H" + hiStr;
    }

    // Build Top Status Mode Flags String (Auto-Swipe, AON, Sort, License/Trial)
    function formatHeaderModeFlags(store as PortfolioStore) as String {
        var modeFlags = "";
        if (store.autoSwipeEnabled) {
            modeFlags = modeFlags + " · " + store.autoSwipeSec.toString() + "s";
        }
        if (store.alwaysOnDisplay) {
            modeFlags = modeFlags + " · AON";
        }
        if (store.sortByPctOrder.equals("ASC")) {
            modeFlags = modeFlags + " · ▲%";
        } else if (store.sortByPctOrder.equals("DESC")) {
            modeFlags = modeFlags + " · ▼%";
        }
        if (store.licenseStatus.equals("ACTIVE")) {
            modeFlags = modeFlags + " · PRO";
        } else if (!store.trialExpired) {
            modeFlags = modeFlags + " · " + store.trialDaysLeft.toString() + "d";
        }
        return modeFlags;
    }

    // 14-Day Trial Expiration Lock Screen
    function drawTrialExpiredScreen(dc as Dc, store as PortfolioStore, w as Number, h as Number, cx as Number) as Void {
        var fMicro = store.fontMicro;
        var fRow = store.fontRow;

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
        dc.drawText(cx, pillY + 4, fMicro, "TRIAL 14D EXPIRED", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 24) / 100, fRow, "Activation Required", Graphics.TEXT_JUSTIFY_CENTER);

        var boxW = (w * 62) / 100;
        var boxH = (h * 10) / 100;
        var boxY = (h * 34) / 100;
        dc.setColor(0x0D131C, Graphics.COLOR_TRANSPARENT);
        dc.fillRoundedRectangle(cx - (boxW / 2), boxY, boxW, boxH, 10);
        dc.setColor(0xF59E0B, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, boxY + 8, fRow, "ID: " + store.deviceId, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(0x94A3B8, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 47) / 100, fMicro, "Contact App Owner (Paid):", Graphics.TEXT_JUSTIFY_CENTER);

        var mailW = (w * 68) / 100;
        var mailH = (h * 10) / 100;
        var mailY = (h * 55) / 100;
        dc.setColor(0x082F49, Graphics.COLOR_TRANSPARENT);
        dc.fillRoundedRectangle(cx - (mailW / 2), mailY, mailW, mailH, 10);
        dc.setColor(0x06B6D4, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, mailY + 8, fMicro, store.ownerEmail, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(0x64748B, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 70) / 100, fMicro, "Activate via Web Settings", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(0x10B981, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 77) / 100, fMicro, "Press SELECT to Verify", Graphics.TEXT_JUSTIFY_CENTER);
    }

    // Draw Single Responsive Holding Row Card (Circle-Safe Inset + Dynamic Collision Prevention)
    function drawHoldingRowCard(
        dc as Dc,
        store as PortfolioStore,
        item as Dictionary,
        w as Number,
        rowY as Number,
        cardH as Number,
        minSidePad as Number,
        fRow as FontDefinition,
        fMicro as FontDefinition,
        rowFontH as Number,
        microFontH as Number,
        showSubMetrics as Boolean
    ) as Void {
        var sym = (item.hasKey("sym") ? item.get("sym") : item.get("s")) as String;
        var px = store.getDictFloat(item, "px", "p", 0.0);
        var lastPct = store.getDictFloat(item, "pct", "c", 0.0);
        var sma = store.getDictFloat(item, "sma", null, px);
        var defaultSmaPct = (sma > 0.0) ? (((px - sma) * 100.0) / sma) : 0.0;
        var smaPct = store.getDictFloat(item, "sPct", null, defaultSmaPct);
        var rsi = store.getDictFloat(item, "rsi", "rsi14", 50.0);
        var ed = item.hasKey("ed") ? (item.get("ed") as String?) : "";
        var dayHi = store.getDictFloat(item, "hi", null, px);
        var dayLo = store.getDictFloat(item, "lo", null, px);
        var alrt = item.hasKey("alrt") ? (item.get("alrt") as String) : "NORMAL";
        var itemCurStr = item.hasKey("cur") ? (item.get("cur") as String) : "USD";
        var itemCur = itemCurStr.equals("USD") ? "$" : "฿";

        // Circle-safe horizontal inset per row so cards curve naturally along the round bezel
        var rowPad = store.getCirclePadX(rowY, rowY + cardH, minSidePad);

        // Rounded Row Tray
        dc.setColor(0x0D131C, Graphics.COLOR_TRANSPARENT);
        dc.fillRoundedRectangle(rowPad, rowY, w - (rowPad * 2), cardH, 10);

        var topLineY = (cardH >= 50) ? (rowY + 5) : (rowY + 2);
        var subLineY = rowY + cardH - microFontH - ((cardH >= 50) ? 5 : 2);
        var dotX = rowPad + 7;
        var dotY = showSubMetrics ? (topLineY + (rowFontH / 2)) : (rowY + (cardH / 2));

        // Target / Stop Alert Dot
        var alertColor = getAlertColor(alrt);
        if (alertColor != 0) {
            dc.setColor(alertColor, Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(dotX, dotY, 3);
        }

        var rowColor = getPnlColor(lastPct);
        var pctStr = formatSignedPct(lastPct);
        var pxStr = formatPriceCompact(itemCur, px);
        var pctWidth = dc.getTextWidthInPixels(pctStr, fRow);
        var pxWidth = dc.getTextWidthInPixels(pxStr, fRow);
        var rightEdgeX = w - rowPad - 8;

        if (showSubMetrics) {
            var symX = rowPad + 14;

            // Line 1 Left: Symbol + Next Earnings Date (e-dd/mm/yy)
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(symX, topLineY, fRow, sym, Graphics.TEXT_JUSTIFY_LEFT);

            if (ed != null && ed.length() > 0) {
                var symW = dc.getTextWidthInPixels(sym, fRow);
                var edW = dc.getTextWidthInPixels(ed, fMicro);
                var maxLeftX = rightEdgeX - pctWidth - 6 - pxWidth - 6;
                if (symX + symW + 5 + edW <= maxLeftX) {
                    var edOffsetY = (rowFontH > microFontH) ? ((rowFontH - microFontH) / 2) : 0;
                    dc.setColor(0xFBBF24, Graphics.COLOR_TRANSPARENT);
                    dc.drawText(symX + symW + 5, topLineY + edOffsetY, fMicro, ed, Graphics.TEXT_JUSTIFY_LEFT);
                }
            }

            // Line 1 Right: Current Price + Last % Change
            dc.setColor(0xE2E8F0, Graphics.COLOR_TRANSPARENT);
            dc.drawText(rightEdgeX - pctWidth - 6, topLineY, fRow, pxStr, Graphics.TEXT_JUSTIFY_RIGHT);

            dc.setColor(rowColor, Graphics.COLOR_TRANSPARENT);
            dc.drawText(rightEdgeX, topLineY, fRow, pctStr, Graphics.TEXT_JUSTIFY_RIGHT);

            // Line 2 Right: Compact Day Low (L) / Day High (H)
            var loHiStr = formatHiLoCompact(dayLo, dayHi);
            var loHiW = dc.getTextWidthInPixels(loHiStr, fMicro);
            dc.setColor(0x94A3B8, Graphics.COLOR_TRANSPARENT);
            dc.drawText(rightEdgeX, subLineY, fMicro, loHiStr, Graphics.TEXT_JUSTIFY_RIGHT);

            // Line 2 Left: SMA20 Value + SMA20 % Distance + RSI14 (R:xx) with S: fallback
            var smaSign = (smaPct >= 0.0) ? "+" : "";
            var smaValStr = (sma >= 100.0) ? sma.format("%.0f") : sma.format("%.1f");
            var smaText = "SMA:" + smaValStr + "(" + smaSign + smaPct.format("%.1f") + "%)";
            var rsiText = "R:" + rsi.format("%.0f");
            var smaW = dc.getTextWidthInPixels(smaText, fMicro);
            var rsiW = dc.getTextWidthInPixels(rsiText, fMicro);
            if (symX + smaW + 5 + rsiW > rightEdgeX - loHiW - 6) {
                smaText = "S:" + smaValStr + "(" + smaSign + smaPct.format("%.1f") + "%)";
                smaW = dc.getTextWidthInPixels(smaText, fMicro);
            }

            dc.setColor(0x38BDF8, Graphics.COLOR_TRANSPARENT);
            dc.drawText(symX, subLineY, fMicro, smaText, Graphics.TEXT_JUSTIFY_LEFT);

            dc.setColor(getRsiColor(rsi), Graphics.COLOR_TRANSPARENT);
            dc.drawText(symX + smaW + 5, subLineY, fMicro, rsiText, Graphics.TEXT_JUSTIFY_LEFT);
        } else {
            var textOffsetY = (cardH - rowFontH) / 2;
            if (textOffsetY < 2) { textOffsetY = 2; }
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(rowPad + 14, rowY + textOffsetY, fRow, sym, Graphics.TEXT_JUSTIFY_LEFT);

            dc.setColor(0xCBD5E1, Graphics.COLOR_TRANSPARENT);
            dc.drawText(rightEdgeX - pctWidth - 6, rowY + textOffsetY, fRow, pxStr, Graphics.TEXT_JUSTIFY_RIGHT);

            dc.setColor(rowColor, Graphics.COLOR_TRANSPARENT);
            dc.drawText(rightEdgeX, rowY + textOffsetY, fRow, pctStr, Graphics.TEXT_JUSTIFY_RIGHT);
        }
    }

    // Bottom Portfolio Pagination Dots Indicator + Active Sync Key / Device ID Badge
    function drawPortfolioDots(dc as Dc, store as PortfolioStore, h as Number, cx as Number) as Void {
        var syncKeyLabel = "KEY: " + store.getSyncKey();
        dc.setColor(0x64748B, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 86) / 100, store.fontMicro, syncKeyLabel, Graphics.TEXT_JUSTIFY_CENTER);

        var allPorts = store.getPortfolios();
        var dotSpan = allPorts.size() * 14;
        var dotStartX = cx - (dotSpan / 2) + 7;
        var dotBarY = h - ((h * 5) / 100);
        for (var pIdx = 0; pIdx < allPorts.size(); pIdx++) {
            if (pIdx == store.activePortfolioIdx) {
                dc.setColor(0x06B6D4, Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(dotStartX + pIdx * 14, dotBarY, 4);
            } else {
                dc.setColor(0x334155, Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(dotStartX + pIdx * 14, dotBarY, 3);
            }
        }
    }

    // Draw 20D Sparkline + SMA20 + Bollinger Bands Chart Box in SymbolDetailView
    function drawSparklineChart(
        dc as Dc,
        store as PortfolioStore,
        spk as Array?,
        px as Float,
        dayLo as Float,
        dayHi as Float,
        sma as Float,
        ub as Float,
        lb as Float,
        showBollinger as Boolean,
        priceColor as Number,
        w as Number,
        h as Number
    ) as Void {
        var chartX = (w * 14) / 100;
        var chartY = (h * 33) / 100;
        var chartW = w - (chartX * 2);
        var chartH = (h * 21) / 100;

        dc.setColor(0x0B0F17, Graphics.COLOR_TRANSPARENT);
        dc.fillRoundedRectangle(chartX - 6, chartY - 4, chartW + 12, chartH + 8, 10);

        if (spk == null || spk.size() <= 1) {
            return;
        }

        var minVal = dayLo;
        var maxVal = dayHi;
        if (px < minVal) { minVal = px; }
        if (px > maxVal) { maxVal = px; }
        if (sma > 0.0) {
            if (sma < minVal) { minVal = sma; }
            if (sma > maxVal) { maxVal = sma; }
        }
        if (showBollinger && ub > 0.0 && lb > 0.0) {
            if (lb < minVal) { minVal = lb; }
            if (ub > maxVal) { maxVal = ub; }
        }
        for (var i = 0; i < spk.size(); i++) {
            var v = store.toFloat(spk[i], px);
            if (v < minVal) { minVal = v; }
            if (v > maxVal) { maxVal = v; }
        }
        var span = maxVal - minVal;
        if (span <= 0.0001) { span = 1.0; }

        // Draw Bollinger Bands (Upper & Lower) if enabled
        if (showBollinger && ub > 0.0 && lb > 0.0) {
            var ubY = chartY + chartH - (((ub - minVal) / span) * chartH).toNumber();
            var lbY = chartY + chartH - (((lb - minVal) / span) * chartH).toNumber();
            dc.setColor(0x1E3A8A, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(1);
            dc.drawLine(chartX, ubY, chartX + chartW, ubY);
            dc.drawLine(chartX, lbY, chartX + chartW, lbY);
        }

        // Draw SMA20 Line in Cyan across the chart
        if (sma > 0.0) {
            var smaY = chartY + chartH - (((sma - minVal) / span) * chartH).toNumber();
            dc.setColor(0x06B6D4, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(2);
            dc.drawLine(chartX, smaY, chartX + chartW, smaY);
        }

        // Primary Price Sparkline Stroke
        dc.setColor(priceColor, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(3);
        var lastX = chartX;
        var lastY = chartY + (chartH / 2);
        for (var k = 0; k < spk.size() - 1; k++) {
            var v1 = store.toFloat(spk[k], px);
            var v2 = store.toFloat(spk[k + 1], px);
            var px1 = chartX + (k * chartW) / (spk.size() - 1);
            var py1 = chartY + chartH - (((v1 - minVal) / span) * chartH).toNumber();
            var px2 = chartX + ((k + 1) * chartW) / (spk.size() - 1);
            var py2 = chartY + chartH - (((v2 - minVal) / span) * chartH).toNumber();
            dc.drawLine(px1, py1, px2, py2);
            lastX = px2;
            lastY = py2;
        }
        dc.setPenWidth(1);

        // Highlight Current Price Dot at end of sparkline
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(lastX, lastY, 4);
        dc.setColor(priceColor, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(lastX, lastY, 2);
    }
}
