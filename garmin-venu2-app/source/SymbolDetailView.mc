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

        var fMicro = _store.fontMicro;
        var fRow = (w >= 340) ? _store.fontRow : _store.fontMicro;
        var fVal = (w >= 340) ? _store.fontVal : _store.fontRow;

        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        var item = getCurrentItem();
        if (item == null) {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h / 2, fVal, "No Symbol Data", Graphics.TEXT_JUSTIFY_CENTER);
            return;
        }

        var sym = (item.hasKey("sym") ? item.get("sym") : item.get("s")) as String;
        var curStr = item.hasKey("cur") ? (item.get("cur") as String) : "USD";
        var cur = curStr.equals("USD") ? "$" : "฿";
        var px = _store.getDictFloat(item, "px", "p", 0.0);
        var pct = _store.getDictFloat(item, "pct", "c", 0.0);
        var defaultChg = (pct != -100.0) ? (px - (px / (1.0 + (pct / 100.0)))) : 0.0;
        var chg = _store.getDictFloat(item, "chg", null, defaultChg);
        var sma = _store.getDictFloat(item, "sma", null, px);
        var defaultSmaPct = (sma > 0.0) ? (((px - sma) * 100.0) / sma) : 0.0;
        var sPct = _store.getDictFloat(item, "sPct", null, defaultSmaPct);
        var rsi = _store.getDictFloat(item, "rsi", "rsi14", 50.0);
        var ed = item.hasKey("ed") ? (item.get("ed") as String?) : "";
        var ub = _store.getDictFloat(item, "ub", null, sma);
        var lb = _store.getDictFloat(item, "lb", null, sma);
        var dayHi = _store.getDictFloat(item, "hi", null, px);
        var dayLo = _store.getDictFloat(item, "lo", null, px);
        var alrt = (item.hasKey("alrt") ? item.get("alrt") : "NORMAL") as String;

        // 1. Top Symbol, Next Earnings Date (e-dd/mm/yy) & Alert Status
        var titleStr = "< " + sym;
        if (ed != null && ed.length() > 0) {
            titleStr = titleStr + " · " + ed;
        }
        if (!alrt.equals("NORMAL")) {
            titleStr = titleStr + " · " + alrt;
        }
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 6) / 100, fVal, titleStr, Graphics.TEXT_JUSTIFY_CENTER);

        // 2. Current Price (ราคาปัจจุบัน) & % Change
        var priceColor = MoatWatchLayout.getPnlColor(pct);
        var chgSign = (chg >= 0.0) ? "+" : "";
        dc.setColor(priceColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(
            cx,
            (h * 14) / 100,
            fRow,
            "Now: " + cur + px.format("%.2f") + "  " + chgSign + chg.format("%.2f") + " (" + MoatWatchLayout.formatSignedPct(pct) + ")",
            Graphics.TEXT_JUSTIFY_CENTER
        );

        // 3. Day High (H) & Day Low (L) of the Day + SMA20 Value & % Strip
        dc.setColor(0xE2E8F0, Graphics.COLOR_TRANSPARENT);
        dc.drawText(
            cx,
            (h * 20) / 100,
            fMicro,
            "Day L: " + cur + dayLo.format("%.2f") + "  H: " + cur + dayHi.format("%.2f"),
            Graphics.TEXT_JUSTIFY_CENTER
        );

        var smaSign = (sPct >= 0.0) ? "+" : "";
        var smaLineStr = "SMA20: " + cur + sma.format("%.1f") + " (" + smaSign + sPct.format("%.1f") + "%) · RSI14: " + rsi.format("%.0f");
        if (showBollinger && ub > lb) {
            smaLineStr = smaLineStr + " · BB";
        }
        dc.setColor(0x06B6D4, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (h * 26) / 100, fMicro, smaLineStr, Graphics.TEXT_JUSTIFY_CENTER);

        // 4. Responsive Sparkline + SMA-20 + Bollinger Chart Box
        MoatWatchLayout.drawSparklineChart(
            dc,
            _store,
            item,
            showBollinger,
            priceColor,
            w,
            h
        );

        // 5. Holdings & Target Summary Line
        var sh = _store.toFloat(item.get("sh"), 0.0);
        var avg = _store.getDictFloat(item, "avg", "ac", 0.0);
        var pPct = _store.getDictFloat(item, "pPct", "tPct", 0.0);
        var tgt = _store.getDictFloat(item.get("tgt") != null ? item : item, "tgt", "tg", 0.0);

        dc.setColor(0xCBD5E1, Graphics.COLOR_TRANSPARENT);
        var posLine = (sh > 0.0)
            ? ("Hold: " + sh.format("%.1f") + " @ " + cur + avg.format("%.1f") + " (" + pPct.format("%.1f") + "%)")
            : ("Watchlist · Target: " + cur + tgt.format("%.1f"));
        dc.drawText(cx, (h * 58) / 100, fMicro, posLine, Graphics.TEXT_JUSTIFY_CENTER);

        // 6. WebMemo Note Box at Bottom of Screen (2-Tier Auto-Fit Font + Circle-Chord Multi-Line)
        var note = (item.hasKey("note") ? item.get("note") : item.get("m")) as String?;
        if (note == null || note.length() == 0) {
            note = "No WebMemo attached";
        }
        MoatWatchLayout.drawFittedCircleMemo(dc, _store, note, w, h, cx);
    }
}
