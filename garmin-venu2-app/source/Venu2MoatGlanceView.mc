import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

(:glance)
class Venu2MoatGlanceView extends WatchUi.GlanceView {

    function initialize() {
        GlanceView.initialize();
    }

    function onUpdate(dc as Dc) as Void {
        var h = dc.getHeight();
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        var cached = Application.Storage.getValue("venu2moat_v3") as Dictionary?;
        if (cached == null) {
            cached = Application.Storage.getValue("venu2moat_payload") as Dictionary?;
        }
        var netWorthStr = "THB 1,482,910";
        var dayPnlStr = "+18,420 (+1.25%)";
        var isPositive = true;
        var isExpired = false;

        if (cached != null) {
            if (cached.hasKey("lic")) {
                var lic = cached.get("lic") as Dictionary?;
                if (lic != null && lic.hasKey("exp")) {
                    var expVal = lic.get("exp") as Number?;
                    isExpired = (expVal != null && expVal == 1);
                }
            }
            if (isExpired) {
                netWorthStr = "TRIAL 14D EXPIRED";
                dayPnlStr = "saharat.bun@icloud.com";
                isPositive = false;
            } else if (cached.hasKey("tot")) {
                var bc = cached.get("bc") as String?;
                var curPrefix = (bc != null && bc.equals("USD")) ? "$" : "฿";
                var tot = cached.get("tot") as Dictionary;
                var val = tot.get("val") as Number;
                var dp = tot.get("dp") as Number;
                var dPct = tot.get("dPct") as Float;
                isPositive = (dp >= 0);
                netWorthStr = curPrefix + val.toString();
                var sign = isPositive ? "+" : "";
                dayPnlStr = sign + curPrefix + dp.toString() + " (" + sign + dPct.format("%.2f") + "%)";
            }
        }

        // Header label
        dc.setColor(0x06B6D4, Graphics.COLOR_TRANSPARENT);
        dc.drawText(4, 6, Graphics.FONT_XTINY, "GARMINMOAT PORTFOLIO", Graphics.TEXT_JUSTIFY_LEFT);

        // Total Net Worth or Trial Expired Alert
        dc.setColor(isExpired ? 0xF43F5E : Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(4, h / 2 - 10, Graphics.FONT_SMALL, netWorthStr, Graphics.TEXT_JUSTIFY_LEFT);

        // Day P&L Delta or Owner Contact
        var deltaColor = isExpired ? 0x06B6D4 : (isPositive ? 0x10B981 : 0xF43F5E);
        dc.setColor(deltaColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(4, h - 24, Graphics.FONT_XTINY, dayPnlStr, Graphics.TEXT_JUSTIFY_LEFT);
    }
}
