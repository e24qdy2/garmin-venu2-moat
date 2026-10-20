import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// 416x416 Symbol Detail View: Sparkline + SMA20 + Bollinger + Target Alert + WebMemo Note
class SymbolDetailView extends WatchUi.View {
    private var _item as Dictionary;
    public var showBollinger as Boolean = true;

    function initialize(item as Dictionary) {
        View.initialize();
        _item = item;
        var propBb = Application.Properties.getValue("showBollinger") as Boolean?;
        if (propBb != null) {
            showBollinger = propBb;
        }
    }

    function onUpdate(dc as Dc) as Void {
        var w = dc.getWidth();
        var cx = w / 2;

        if (dc has :setAntiAlias) {
            dc.setAntiAlias(true);
        }

        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        var sym = _item.get("sym") as String;
        var cur = (_item.get("cur") as String).equals("USD") ? "$" : "฿";
        var px = _item.get("px") as Float;
        var pct = _item.get("pct") as Float;
        var alrt = _item.get("alrt") as String;

        // Top Symbol & Alert Status
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 24, Graphics.FONT_SMALL, sym, Graphics.TEXT_JUSTIFY_CENTER);

        var isUp = (pct >= 0);
        var priceColor = isUp ? 0x10B981 : 0xF43F5E;
        var sign = isUp ? "+" : "";
        dc.setColor(priceColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(
            cx,
            56,
            Graphics.FONT_XTINY,
            cur + px.format("%.2f") + " (" + sign + pct.format("%.2f") + "%)",
            Graphics.TEXT_JUSTIFY_CENTER
        );

        // Alert Banner Pill if Target Hit or Stop Breached
        if (!alrt.equals("NORMAL")) {
            var alrtColor = alrt.equals("TARGET_HIT") ? 0x10B981 : (alrt.equals("STOP_BREACH") ? 0xF43F5E : 0xF59E0B);
            dc.setColor(alrtColor, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, 80, Graphics.FONT_XTINY, "[" + alrt + "]", Graphics.TEXT_JUSTIFY_CENTER);
        }

        // Sparkline + SMA-20 Chart Box (x: 56..360, y: 108..210)
        var chartX = 56;
        var chartY = 108;
        var chartW = w - 112;
        var chartH = 96;

        dc.setColor(0x0B0F17, Graphics.COLOR_TRANSPARENT);
        dc.fillRoundedRectangle(chartX - 8, chartY - 6, chartW + 16, chartH + 12, 12);

        var spk = _item.get("spk") as Array?;
        var sma = _item.get("sma") as Array?;
        if (spk != null && spk.size() > 1) {
            var minVal = 9999999.0;
            var maxVal = -9999999.0;
            for (var i = 0; i < spk.size(); i++) {
                var v = (spk[i] as Float).toFloat();
                if (v < minVal) { minVal = v; }
                if (v > maxVal) { maxVal = v; }
            }
            var span = maxVal - minVal;
            if (span <= 0.0001) { span = 1.0; }

            // Optional SMA-20 overlay line
            if (showBollinger && sma != null && sma.size() == spk.size()) {
                dc.setColor(0x06B6D4, Graphics.COLOR_TRANSPARENT);
                dc.setPenWidth(1);
                for (var j = 0; j < sma.size() - 1; j++) {
                    var x1 = chartX + (j * chartW) / (sma.size() - 1);
                    var y1 = chartY + chartH - (((sma[j] as Float) - minVal) / span * chartH).toNumber();
                    var x2 = chartX + ((j + 1) * chartW) / (sma.size() - 1);
                    var y2 = chartY + chartH - (((sma[j + 1] as Float) - minVal) / span * chartH).toNumber();
                    dc.drawLine(x1, y1, x2, y2);
                }
            }

            // Primary Sparkline Stroke
            dc.setColor(priceColor, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(3);
            for (var k = 0; k < spk.size() - 1; k++) {
                var px1 = chartX + (k * chartW) / (spk.size() - 1);
                var py1 = chartY + chartH - (((spk[k] as Float) - minVal) / span * chartH).toNumber();
                var px2 = chartX + ((k + 1) * chartW) / (spk.size() - 1);
                var py2 = chartY + chartH - (((spk[k + 1] as Float) - minVal) / span * chartH).toNumber();
                dc.drawLine(px1, py1, px2, py2);
            }
            dc.setPenWidth(1);
        }

        // Holdings & Target Summary Line
        var sh = _item.get("sh") as Float;
        var avg = _item.get("avg") as Float;
        var pPct = _item.get("pPct") as Float;
        var tgt = _item.get("tgt") as Float;

        dc.setColor(0xCBD5E1, Graphics.COLOR_TRANSPARENT);
        var posLine = (sh > 0)
            ? ("Hold: " + sh.format("%.1f") + " @ " + cur + avg.format("%.1f") + " (" + pPct.format("%.1f") + "%)")
            : ("Watchlist · Target: " + cur + tgt.format("%.1f"));
        dc.drawText(cx, 220, Graphics.FONT_XTINY, posLine, Graphics.TEXT_JUSTIFY_CENTER);

        // WebMemo Note Box at Bottom of 416x416 Screen
        var note = _item.get("note") as String?;
        if (note == null || note.length() == 0) {
            note = "No WebMemo attached";
        }
        dc.setColor(0x06B6D4, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 254, Graphics.FONT_XTINY, "WEBMEMO", Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(
            cx,
            280,
            Graphics.FONT_XTINY,
            Graphics.fitTextToArea(note, Graphics.FONT_XTINY, w - 108, 76, true),
            Graphics.TEXT_JUSTIFY_CENTER
        );
    }
}
