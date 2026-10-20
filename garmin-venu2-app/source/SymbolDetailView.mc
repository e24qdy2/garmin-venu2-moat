import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Responsive Symbol Detail View (260x260 through 454x454):
// Displays Current Price (Now), Day High (H) & Day Low (L), SMA20 + Bollinger Bands, 20D Sparkline, Position & WebMemo
class SymbolDetailView extends WatchUi.View {
    private var _store as PortfolioStore;
    public var itemIdx as Number = 0;
    public var showBollinger as Boolean = true;

    function initialize(store as PortfolioStore, idx as Number) {
        View.initialize();
        _store = store;
        itemIdx = idx;
        var propBb = Application.Properties.getValue("showBollinger") as Boolean?;
        if (propBb != null) {
            showBollinger = propBb;
        }
    }

    function onShow() as Void {
        _store.inDetailView = true;
        _store.applyBacklightIfEnabled();
    }

    function onHide() as Void {
        _store.inDetailView = false;
    }

    function getCurrentItem() as Dictionary? {
        var port = _store.getActivePortfolio();
        if (port == null) {
            return null;
        }
        var items = port.get("s") as Array?;
        if (items == null || items.size() == 0) {
            return null;
        }
        if (itemIdx < 0) {
            itemIdx = 0;
        }
        if (itemIdx >= items.size()) {
            itemIdx = items.size() - 1;
        }
        return items[itemIdx] as Dictionary;
    }

    function nextSymbol() as Void {
        var port = _store.getActivePortfolio();
        if (port != null) {
            var items = port.get("s") as Array?;
            if (items != null && items.size() > 0) {
                itemIdx = (itemIdx + 1) % items.size();
                WatchUi.requestUpdate();
            }
        }
    }

    function prevSymbol() as Void {
        var port = _store.getActivePortfolio();
        if (port != null) {
            var items = port.get("s") as Array?;
            if (items != null && items.size() > 0) {
                itemIdx = (itemIdx - 1 + items.size()) % items.size();
                WatchUi.requestUpdate();
            }
        }
    }

    function onUpdate(dc as Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;

        if (dc has :setAntiAlias) {
            dc.setAntiAlias(true);
        }

        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        var item = getCurrentItem();
        if (item == null) {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h / 2, Graphics.FONT_SMALL, "No Symbol Data", Graphics.TEXT_JUSTIFY_CENTER);
            return;
        }

        var sym = (item.hasKey("sym") ? item.get("sym") : item.get("s")) as String;
        var curStr = item.hasKey("cur") ? (item.get("cur") as String) : "USD";
        var cur = curStr.equals("USD") ? "$" : "฿";
        var px = _store.getDictFloat(item, "px", "p", 0.0);
        var pct = _store.getDictFloat(item, "pct", "c", 0.0);
        var sma = _store.getDictFloat(item, "sma", null, px);
        var ub = _store.getDictFloat(item, "ub", null, sma);
        var lb = _store.getDictFloat(item, "lb", null, sma);
        var dayHi = _store.getDictFloat(item, "hi", null, px);
        var dayLo = _store.getDictFloat(item, "lo", null, px);
        var alrt = (item.hasKey("alrt") ? item.get("alrt") : "NORMAL") as String;

        // 1. Top Symbol & Alert Status
        var titleStr = "< " + sym;
        if (!alrt.equals("NORMAL")) {
            titleStr = titleStr + " · " + alrt;
        }
        var symFont = (h < 320) ? Graphics.FONT_XTINY : Graphics.FONT_SMALL;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 4) / 100, symFont, titleStr, Graphics.TEXT_JUSTIFY_CENTER);

        // 2. Current Price (ราคาปัจจุบัน) & % Change
        var isUp = (pct >= 0.0);
        var priceColor = isUp ? 0x10B981 : 0xF43F5E;
        var sign = isUp ? "+" : "";
        dc.setColor(priceColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(
            cx,
            (h * 12) / 100,
            Graphics.FONT_XTINY,
            "Now: " + cur + px.format("%.2f") + " (" + sign + pct.format("%.2f") + "%)",
            Graphics.TEXT_JUSTIFY_CENTER
        );

        // 3. Day High (H) & Day Low (L) of the Day + SMA20 Value Strip
        dc.setColor(0xE2E8F0, Graphics.COLOR_TRANSPARENT);
        dc.drawText(
            cx,
            (h * 19) / 100,
            Graphics.FONT_XTINY,
            "Day L: " + cur + dayLo.format("%.2f") + "  H: " + cur + dayHi.format("%.2f"),
            Graphics.TEXT_JUSTIFY_CENTER
        );

        var smaLineStr = "SMA20: " + cur + sma.format("%.2f");
        if (showBollinger && ub > lb) {
            smaLineStr = smaLineStr + " · BB ON";
        }
        dc.setColor(0x06B6D4, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 25) / 100, Graphics.FONT_XTINY, smaLineStr, Graphics.TEXT_JUSTIFY_CENTER);

        // 4. Responsive Sparkline + SMA-20 + Bollinger Chart Box
        var chartX = (w * 14) / 100;
        var chartY = (h * 33) / 100;
        var chartW = w - (chartX * 2);
        var chartH = (h * 20) / 100;

        dc.setColor(0x0B0F17, Graphics.COLOR_TRANSPARENT);
        dc.fillRoundedRectangle(chartX - 6, chartY - 4, chartW + 12, chartH + 8, 10);

        var spk = (item.hasKey("spk") ? item.get("spk") : item.get("sp")) as Array?;
        if (spk != null && spk.size() > 1) {
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
                var v = _store.toFloat(spk[i], px);
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
                var v1 = _store.toFloat(spk[k], px);
                var v2 = _store.toFloat(spk[k + 1], px);
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

        // 5. Holdings & Target Summary Line
        var sh = _store.toFloat(item.get("sh"), 0.0);
        var avg = _store.getDictFloat(item, "avg", "ac", 0.0);
        var pPct = _store.getDictFloat(item, "pPct", "tPct", 0.0);
        var tgt = _store.getDictFloat(item, "tgt", "tg", 0.0);

        dc.setColor(0xCBD5E1, Graphics.COLOR_TRANSPARENT);
        var posLine = (sh > 0.0)
            ? ("Hold: " + sh.format("%.1f") + " @ " + cur + avg.format("%.1f") + " (" + pPct.format("%.1f") + "%)")
            : ("Watchlist · Target: " + cur + tgt.format("%.1f"));
        dc.drawText(cx, (h * 56) / 100, Graphics.FONT_XTINY, posLine, Graphics.TEXT_JUSTIFY_CENTER);

        // 6. WebMemo Note Box at Bottom of Screen
        var note = (item.hasKey("note") ? item.get("note") : item.get("m")) as String?;
        if (note == null || note.length() == 0) {
            note = "No WebMemo attached";
        }
        dc.setColor(0x06B6D4, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 63) / 100, Graphics.FONT_XTINY, "WEBMEMO", Graphics.TEXT_JUSTIFY_CENTER);

        var fittedNote = Graphics.fitTextToArea(note, Graphics.FONT_XTINY, w - ((w * 26) / 100), (h * 18) / 100, true);
        if (fittedNote == null) {
            fittedNote = (note.length() > 26) ? (note.substring(0, 26) + "...") : note;
        }
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(
            cx,
            (h * 70) / 100,
            Graphics.FONT_XTINY,
            fittedNote,
            Graphics.TEXT_JUSTIFY_CENTER
        );
    }
}
