import Toybox.Lang;
import Toybox.WatchUi;

class SyncKeyTextPickerDelegate extends WatchUi.TextPickerDelegate {
    private var _store as PortfolioStore;

    function initialize(store as PortfolioStore) {
        TextPickerDelegate.initialize();
        _store = store;
    }

    function onTextEntered(text as String, changed as Boolean) as Boolean {
        if (text != null && text.length() > 0) {
            _store.setCustomSyncKey(text);
        } else {
            _store.setSyncKeyAuto();
        }
        return true;
    }

    function onCancel() as Boolean {
        WatchUi.requestUpdate();
        return true;
    }
}

class Venu2MoatDelegate extends WatchUi.BehaviorDelegate {
    private var _store as PortfolioStore;

    function initialize(store as PortfolioStore, view as Venu2MoatView) {
        BehaviorDelegate.initialize();
        _store = store;
    }

    function launchSyncKeyTextPicker() as Void {
        if (WatchUi has :TextPicker) {
            var initialKey = (_store.configuredSyncKey.length() > 0)
                ? _store.configuredSyncKey
                : _store.hardwareDeviceId;
            WatchUi.pushView(
                new WatchUi.TextPicker(initialKey),
                new SyncKeyTextPickerDelegate(_store),
                WatchUi.SLIDE_UP
            );
        } else {
            _store.loadLocalProperties();
            if (_store.needsSyncKeySetup) {
                _store.setSyncKeyAuto();
            } else {
                _store.closeSyncKeySetup();
                _store.fetchRemote();
            }
        }
    }

    // Physical Top-Right / START Button (handled via KeyEvent so BehaviorDelegate does not intercept touchscreen taps on Venu 2)
    function onKey(evt as KeyEvent) as Boolean {
        var key = evt.getKey();
        if (_store.isSyncKeySetupActive()) {
            _store.applyBacklightIfEnabled();
            if (key == WatchUi.KEY_ENTER || key == WatchUi.KEY_START) {
                if (_store.syncSetupSelectedOption == 0) {
                    _store.setSyncKeyAuto();
                } else {
                    launchSyncKeyTextPicker();
                }
                return true;
            } else if (key == WatchUi.KEY_DOWN || key == WatchUi.KEY_UP) {
                _store.syncSetupSelectedOption = (_store.syncSetupSelectedOption == 0) ? 1 : 0;
                WatchUi.requestUpdate();
                return true;
            }
            return false;
        }
        if (key == WatchUi.KEY_ENTER || key == WatchUi.KEY_START) {
            _store.resetSwipeTimer();
            _store.applyBacklightIfEnabled();
            if (_store.trialExpired) {
                _store.fetchRemote();
                return true;
            }
            _store.showTotalReturn = !_store.showTotalReturn;
            WatchUi.requestUpdate();
            return true;
        }
        return false;
    }

    function onBack() as Boolean {
        if (_store.isSyncKeySetupActive() && !_store.needsSyncKeySetup) {
            return _store.closeSyncKeySetup();
        }
        return false;
    }

    // Long-press Menu -> Open SyncKey Setup / Switcher (AUTO or Custom Key)
    function onMenu() as Boolean {
        _store.resetSwipeTimer();
        _store.openSyncKeySetup();
        return true;
    }

    // Physical DOWN Button (on 5-Button watches: Forerunner 165/265/965, fēnix 8, Enduro 3, Epix Pro)
    function onNextPage() as Boolean {
        _store.resetSwipeTimer();
        _store.applyBacklightIfEnabled();
        if (_store.isSyncKeySetupActive()) {
            _store.syncSetupSelectedOption = (_store.syncSetupSelectedOption == 0) ? 1 : 0;
            WatchUi.requestUpdate();
            return true;
        }
        if (_store.trialExpired) {
            return true;
        }
        var port = _store.getActivePortfolio();
        if (port != null) {
            var items = port.get("s") as Array;
            if (_store.scrollRowOffset + _store.visibleRows < items.size()) {
                _store.scrollRowOffset += 1;
                WatchUi.requestUpdate();
                return true;
            }
        }
        _store.nextPortfolio();
        return true;
    }

    // Physical UP Button (on 5-Button watches: Forerunner 165/265/965, fēnix 8, Enduro 3, Epix Pro)
    function onPreviousPage() as Boolean {
        _store.resetSwipeTimer();
        _store.applyBacklightIfEnabled();
        if (_store.isSyncKeySetupActive()) {
            _store.syncSetupSelectedOption = (_store.syncSetupSelectedOption == 0) ? 1 : 0;
            WatchUi.requestUpdate();
            return true;
        }
        if (_store.trialExpired) {
            return true;
        }
        if (_store.scrollRowOffset > 0) {
            _store.scrollRowOffset -= 1;
            WatchUi.requestUpdate();
            return true;
        }
        _store.prevPortfolio();
        return true;
    }

    // Touch Swipe Handling across 260x260 through 454x454 Garmin Screens
    function onSwipe(evt as SwipeEvent) as Boolean {
        _store.resetSwipeTimer();
        _store.applyBacklightIfEnabled();
        if (_store.isSyncKeySetupActive()) {
            var sDir = evt.getDirection();
            if (sDir == WatchUi.SWIPE_UP || sDir == WatchUi.SWIPE_DOWN) {
                _store.syncSetupSelectedOption = (_store.syncSetupSelectedOption == 0) ? 1 : 0;
                WatchUi.requestUpdate();
            } else if (sDir == WatchUi.SWIPE_RIGHT && !_store.needsSyncKeySetup) {
                _store.closeSyncKeySetup();
            }
            return true;
        }
        if (_store.trialExpired) {
            return true;
        }

        var dir = evt.getDirection();
        var port = _store.getActivePortfolio();
        if (dir == WatchUi.SWIPE_LEFT) {
            _store.nextPortfolio();
            return true;
        } else if (dir == WatchUi.SWIPE_RIGHT) {
            _store.prevPortfolio();
            return true;
        } else if (dir == WatchUi.SWIPE_UP && port != null) {
            var items = port.get("s") as Array;
            if (_store.scrollRowOffset + _store.visibleRows < items.size()) {
                _store.scrollRowOffset += 1;
                WatchUi.requestUpdate();
            }
            return true;
        } else if (dir == WatchUi.SWIPE_DOWN) {
            if (_store.scrollRowOffset > 0) {
                _store.scrollRowOffset -= 1;
                WatchUi.requestUpdate();
            }
            return true;
        }
        return false;
    }

    // Touch Tap & Firm Press Handling -> Open Symbol Detail + Sparkline Chart + SMA20 + Day High/Low + WebMemo View
    function onTap(evt as ClickEvent) as Boolean {
        return handleTouchClick(evt);
    }

    function onHold(evt as ClickEvent) as Boolean {
        return handleTouchClick(evt);
    }

    function handleTouchClick(evt as ClickEvent) as Boolean {
        _store.resetSwipeTimer();
        _store.applyBacklightIfEnabled();

        var coords = evt.getCoordinates();
        if (coords == null || coords.size() < 2) {
            return false;
        }
        var x = coords[0];
        var y = coords[1];
        var w = _store.screenW;
        var h = _store.screenH;

        // Handle Touch Tap on First-Run / Change SyncKey Setup Screen
        if (_store.isSyncKeySetupActive()) {
            // Button 1: [1. AUTO (Hardware Device ID)] at y = 35%..53%
            if (y >= (h * 33) / 100 && y <= (h * 55) / 100) {
                _store.syncSetupSelectedOption = 0;
                _store.setSyncKeyAuto();
                return true;
            }
            // Button 2: [2. SET SYNC KEY] at y = 56%..74%
            if (y > (h * 55) / 100 && y <= (h * 78) / 100) {
                _store.syncSetupSelectedOption = 1;
                launchSyncKeyTextPicker();
                return true;
            }
            // Tapping bottom KEY bar closes modal if already configured
            if (y >= (h * 86) / 100 && !_store.needsSyncKeySetup) {
                _store.closeSyncKeySetup();
                return true;
            }
            return true;
        }

        // Tap on Bottom-Most SyncKey Bar (y >= 88%) opens SyncKey Setup / Switcher anytime
        if (y >= (h * 88) / 100) {
            _store.openSyncKeySetup();
            return true;
        }

        if (_store.trialExpired) {
            _store.fetchRemote();
            return true;
        }

        // Tap on top clock/mode bar toggles Auto-Swipe on/off quickly on watch
        if (y < (h * 8) / 100) {
            _store.autoSwipeEnabled = !_store.autoSwipeEnabled;
            WatchUi.requestUpdate();
            return true;
        }

        // Tap on portfolio title (< US MOAT >) switches portfolio left/right
        if (y >= (h * 8) / 100 && y < (h * 13) / 100) {
            if (x < (w / 2)) {
                _store.prevPortfolio();
            } else {
                _store.nextPortfolio();
            }
            return true;
        }

        // Tap on Net Worth / P&L header toggles Day P&L / Total Return
        if (y >= (h * 13) / 100 && y < (_store.rowStartY - 4)) {
            _store.showTotalReturn = !_store.showTotalReturn;
            WatchUi.requestUpdate();
            return true;
        }

        // Tap on any holding row opens the Individual Stock Chart + SMA20 + Day High/Low + WebMemo screen
        var rowsBottomY = _store.rowStartY + (_store.visibleRows * _store.rowHeight);
        if (y >= (_store.rowStartY - 4) && y <= (rowsBottomY + 14)) {
            var port = _store.getActivePortfolio();
            if (port != null) {
                var items = port.get("s") as Array?;
                if (items != null && items.size() > 0) {
                    var relY = y - _store.rowStartY;
                    if (relY < 0) {
                        relY = 0;
                    }
                    var rowSlot = relY / _store.rowHeight;
                    if (rowSlot < 0) {
                        rowSlot = 0;
                    }
                    if (rowSlot >= _store.visibleRows) {
                        rowSlot = _store.visibleRows - 1;
                    }
                    var itemIdx = _store.scrollRowOffset + rowSlot;
                    if (itemIdx >= items.size()) {
                        itemIdx = items.size() - 1;
                    }
                    if (itemIdx >= 0 && itemIdx < items.size()) {
                        _store.inDetailView = true;
                        var detailView = new SymbolDetailView(_store, itemIdx);
                        var detailDelegate = new SymbolDetailDelegate(_store, detailView);
                        WatchUi.pushView(detailView, detailDelegate, WatchUi.SLIDE_LEFT);
                        return true;
                    }
                }
            }
        }
        return false;
    }
}
