import Toybox.Application;
import Toybox.Attention;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.System;
import Toybox.Timer;
import Toybox.WatchUi;

class PortfolioStore {
    public var payload as Dictionary?;
    public var activePortfolioIdx as Number = 0;
    public var scrollRowOffset as Number = 0;
    public var showTotalReturn as Boolean = false;
    public var isSyncing as Boolean = false;
    public var lastStatus as String = "READY";

    // Responsive Layout State (supports 260x260 MIP through 454x454 AMOLED)
    public var screenW as Number = 416;
    public var screenH as Number = 416;
    public var visibleRows as Number = 4;
    public var rowStartY as Number = 136;
    public var rowHeight as Number = 54;

    // Auto-Swipe, Auto-Sort % Change & Optional Always-On Display Settings (synced from Web + Watch Properties)
    public var autoSwipeEnabled as Boolean = true;
    public var autoSwipeSec as Number = 5;
    public var alwaysOnDisplay as Boolean = false;
    public var sortByPctOrder as String = "ASC"; // "ASC" (-% -> +%), "DESC" (+% -> -%), "NONE"
    public var sortByPctMetric as String = "DAY"; // "DAY" or "TOTAL"
    public var inDetailView as Boolean = false;

    // 14-Day Trial & Per-Device Activation Key State (Owner: saharat.bun@icloud.com)
    public var deviceId as String = "V2-88VENU20";
    public var activationKey as String = "";
    public var licenseStatus as String = "TRIAL";
    public var trialDaysLeft as Number = 14;
    public var trialExpired as Boolean = false;
    public var ownerEmail as String = "saharat.bun@icloud.com";

    private var _runtimeTimer as Timer.Timer?;
    private var _swipeElapsedSec as Number = 0;
    private var _quoteRefreshSec as Number = 0;
    private var _backlightTick as Number = 0;

    function initialize() {
        initHardwareDeviceId();
        loadLocalProperties();
    }

    function updateResponsiveMetrics(w as Number, h as Number) as Void {
        screenW = w;
        screenH = h;
        visibleRows = (h < 320) ? 3 : 4;
        rowStartY = (h * 27) / 100;
        var availableH = h - rowStartY - ((h * 9) / 100);
        rowHeight = availableH / visibleRows;
        if (rowHeight < 34) {
            rowHeight = 34;
        }
    }

    function initHardwareDeviceId() as Void {
        var devSettings = System.getDeviceSettings();
        if (devSettings != null && devSettings has :uniqueIdentifier) {
            var uid = devSettings.uniqueIdentifier;
            if (uid != null && uid.length() >= 6) {
                var tail = uid.substring(uid.length() - 8, uid.length());
                if (tail != null) {
                    deviceId = "V2-" + tail.toUpper();
                }
            }
        }
    }

    function loadLocalProperties() as Void {
        var propAsw = Application.Properties.getValue("autoSwipeEnabled") as Boolean?;
        if (propAsw != null) {
            autoSwipeEnabled = propAsw;
        }
        var propSec = Application.Properties.getValue("autoSwipeSec") as Number?;
        if (propSec != null && propSec >= 2 && propSec <= 120) {
            autoSwipeSec = propSec;
        }
        var propAon = Application.Properties.getValue("alwaysOnDisplay") as Boolean?;
        if (propAon != null) {
            alwaysOnDisplay = propAon;
        }
        var propKey = Application.Properties.getValue("activationKey") as String?;
        if (propKey != null && propKey.length() > 0) {
            activationKey = propKey;
        }
    }

    function startRuntimeTimer() as Void {
        if (_runtimeTimer == null) {
            _runtimeTimer = new Timer.Timer();
            _runtimeTimer.start(method(:onRuntimeTick), 1000, true);
        }
        applyBacklightIfEnabled();
    }

    function stopRuntimeTimer() as Void {
        if (_runtimeTimer != null) {
            _runtimeTimer.stop();
            _runtimeTimer = null;
        }
    }

    function resetSwipeTimer() as Void {
        _swipeElapsedSec = 0;
    }

    function applyBacklightIfEnabled() as Void {
        if (alwaysOnDisplay && (Attention has :backlight)) {
            try {
                Attention.backlight(true);
            } catch (ex) {
                // Ignore if backlight temporarily unavailable on simulator/device state
            }
        }
    }

    function onRuntimeTick() as Void {
        // 1. Optional Always-On Display (keep AMOLED/MIP backlight awake every 4 seconds if enabled)
        if (alwaysOnDisplay) {
            _backlightTick += 1;
            if (_backlightTick >= 4) {
                _backlightTick = 0;
                applyBacklightIfEnabled();
            }
        }

        // 2. Auto-Swipe Next Screen / Portfolio every autoSwipeSec (default 5s)
        if (autoSwipeEnabled && !trialExpired && !inDetailView) {
            _swipeElapsedSec += 1;
            if (_swipeElapsedSec >= autoSwipeSec) {
                _swipeElapsedSec = 0;
                stepAutoSwipe();
            }
        }

        // 3. Auto-Refresh Live Quotes & Technicals (SMA20 / RSI14) every 60 seconds
        _quoteRefreshSec += 1;
        if (_quoteRefreshSec >= 60) {
            _quoteRefreshSec = 0;
            if (!isSyncing) {
                fetchRemote();
            }
        }
    }

    // Advances visibleRows (next screen of holdings) or wraps to next portfolio
    function stepAutoSwipe() as Void {
        var list = getPortfolios();
        if (list.size() == 0) {
            return;
        }
        var port = getActivePortfolio();
        if (port == null) {
            return;
        }
        var items = port.get("s") as Array?;
        var itemCount = (items != null) ? items.size() : 0;

        if (scrollRowOffset + visibleRows < itemCount) {
            scrollRowOffset += visibleRows;
        } else {
            scrollRowOffset = 0;
            activePortfolioIdx = (activePortfolioIdx + 1) % list.size();
        }
        WatchUi.requestUpdate();
    }

    function applyRemoteConfigAndLicense(data as Dictionary) as Void {
        if (data.hasKey("cfg")) {
            var cfg = data.get("cfg") as Dictionary?;
            if (cfg != null) {
                if (cfg.hasKey("asw")) {
                    var aswVal = cfg.get("asw") as Number?;
                    autoSwipeEnabled = (aswVal != null && aswVal == 1);
                }
                if (cfg.hasKey("asec")) {
                    var asecVal = cfg.get("asec") as Number?;
                    if (asecVal != null && asecVal >= 2 && asecVal <= 120) {
                        autoSwipeSec = asecVal;
                    }
                }
                if (cfg.hasKey("aon")) {
                    var aonVal = cfg.get("aon") as Number?;
                    alwaysOnDisplay = (aonVal != null && aonVal == 1);
                    if (alwaysOnDisplay) {
                        applyBacklightIfEnabled();
                    }
                }
                if (cfg.hasKey("srt")) {
                    var srtVal = cfg.get("srt") as String?;
                    if (srtVal != null && srtVal.length() > 0) {
                        sortByPctOrder = srtVal;
                    }
                }
                if (cfg.hasKey("smet")) {
                    var smetVal = cfg.get("smet") as String?;
                    if (smetVal != null && smetVal.length() > 0) {
                        sortByPctMetric = smetVal;
                    }
                }
            }
        }

        if (data.hasKey("lic")) {
            var lic = data.get("lic") as Dictionary?;
            if (lic != null) {
                if (lic.hasKey("did")) {
                    var didStr = lic.get("did") as String?;
                    if (didStr != null && didStr.length() > 0) {
                        deviceId = didStr;
                    }
                }
                if (lic.hasKey("st")) {
                    var stStr = lic.get("st") as String?;
                    if (stStr != null) {
                        licenseStatus = stStr;
                    }
                }
                if (lic.hasKey("days")) {
                    var dLeft = lic.get("days") as Number?;
                    if (dLeft != null) {
                        trialDaysLeft = dLeft;
                    }
                }
                if (lic.hasKey("exp")) {
                    var expVal = lic.get("exp") as Number?;
                    trialExpired = (expVal != null && expVal == 1);
                }
                if (lic.hasKey("own")) {
                    var ownStr = lic.get("own") as String?;
                    if (ownStr != null && ownStr.length() > 0) {
                        ownerEmail = ownStr;
                    }
                }
            }
        }
    }

    function loadCached() as Void {
        var saved = Application.Storage.getValue("venu2moat_payload") as Dictionary?;
        if (saved != null) {
            payload = saved;
            applyRemoteConfigAndLicense(saved);
            lastStatus = "CACHED";
        }
    }

    function getSyncKey() as String {
        var key = Application.Properties.getValue("syncKey") as String?;
        if (key == null || key.length() == 0) {
            return "VENU2-88";
        }
        return key;
    }

    function getApiBaseUrl() as String {
        var url = Application.Properties.getValue("apiUrl") as String?;
        if (url == null || url.length() == 0) {
            return "https://moat.readybyte.top";
        }
        return url;
    }

    function fetchRemote() as Void {
        isSyncing = true;
        _quoteRefreshSec = 0;
        lastStatus = "SYNCING";
        var url = getApiBaseUrl() + "/api/watch?key=" + getSyncKey() + "&did=" + deviceId;
        if (activationKey.length() > 0) {
            url = url + "&akey=" + activationKey;
        }
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };
        Communications.makeWebRequest(url, null, options, method(:onReceivePayload));
    }

    function onReceivePayload(responseCode as Number, data as Dictionary or String or Null) as Void {
        isSyncing = false;
        if (responseCode == 200 && data instanceof Dictionary) {
            payload = data as Dictionary;
            applyRemoteConfigAndLicense(payload);
            Application.Storage.setValue("venu2moat_payload", payload);
            lastStatus = "LIVE";
        } else {
            lastStatus = "OFFLINE (" + responseCode.toString() + ")";
        }
        WatchUi.requestUpdate();
    }

    function getPortfolios() as Array {
        if (payload != null && payload.hasKey("p")) {
            return payload.get("p") as Array;
        }
        return [];
    }

    function getActivePortfolio() as Dictionary? {
        var list = getPortfolios();
        if (list.size() == 0) {
            return null;
        }
        if (activePortfolioIdx >= list.size()) {
            activePortfolioIdx = 0;
        }
        return list[activePortfolioIdx] as Dictionary;
    }

    function nextPortfolio() as Void {
        var list = getPortfolios();
        if (list.size() > 0) {
            activePortfolioIdx = (activePortfolioIdx + 1) % list.size();
            scrollRowOffset = 0;
            resetSwipeTimer();
            WatchUi.requestUpdate();
        }
    }

    function prevPortfolio() as Void {
        var list = getPortfolios();
        if (list.size() > 0) {
            activePortfolioIdx = (activePortfolioIdx - 1 + list.size()) % list.size();
            scrollRowOffset = 0;
            resetSwipeTimer();
            WatchUi.requestUpdate();
        }
    }

    // Safe runtime conversion helpers so JSON Numbers (e.g. 45, 284) never crash Float.format("%.2f") on physical Garmin hardware
    function toFloat(val as Object?, fallback as Float) as Float {
        if (val == null) {
            return fallback;
        }
        if (val instanceof Lang.Float) {
            return val as Float;
        }
        if (val instanceof Lang.Number) {
            return (val as Number).toFloat();
        }
        if (val instanceof Lang.Double) {
            return (val as Double).toFloat();
        }
        if (val instanceof Lang.Long) {
            return (val as Long).toFloat();
        }
        return fallback;
    }

    function toNum(val as Object?, fallback as Number) as Number {
        if (val == null) {
            return fallback;
        }
        if (val instanceof Lang.Number) {
            return val as Number;
        }
        if (val instanceof Lang.Float) {
            return (val as Float).toNumber();
        }
        if (val instanceof Lang.Double) {
            return (val as Double).toNumber();
        }
        if (val instanceof Lang.Long) {
            return (val as Long).toNumber();
        }
        return fallback;
    }

    function getDictFloat(dict as Dictionary, key1 as String, key2 as String?, fallback as Float) as Float {
        if (dict.hasKey(key1)) {
            return toFloat(dict.get(key1), fallback);
        }
        if (key2 != null && dict.hasKey(key2)) {
            return toFloat(dict.get(key2), fallback);
        }
        return fallback;
    }
}
