import Toybox.Lang;
import Toybox.WatchUi;

class Venu2MoatDelegate extends WatchUi.BehaviorDelegate {
    private var _store as PortfolioStore;

    function initialize(store as PortfolioStore, view as Venu2MoatView) {
        BehaviorDelegate.initialize();
        _store = store;
    }

    // Physical Top-Right / START Button (handled via KeyEvent so BehaviorDelegate does not intercept touchscreen taps on Venu 2)
    function onKey(evt as KeyEvent) as Boolean {
        var key = evt.getKey();
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

    // Long-press Menu -> Trigger fresh network sync & license check
    function onMenu() as Boolean {
        _store.resetSwipeTimer();
        _store.fetchRemote();
        return true;
    }

    // Physical DOWN Button (on 5-Button watches: Forerunner 165/265/965, fēnix 8, Enduro 3, Epix Pro)
    function onNextPage() as Boolean {
        _store.resetSwipeTimer();
        _store.applyBacklightIfEnabled();
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

        if (_store.trialExpired) {
            _store.fetchRemote();
            return true;
        }

        var coords = evt.getCoordinates();
        if (coords == null || coords.size() < 2) {
            return false;
        }
        var x = coords[0];
        var y = coords[1];
        var w = _store.screenW;
        var h = _store.screenH;

        // Tap on top clock/mode bar toggles Auto-Swipe on/off quickly on watch
        if (y < (h * 9) / 100) {
            _store.autoSwipeEnabled = !_store.autoSwipeEnabled;
            WatchUi.requestUpdate();
            return true;
        }

        // Tap on portfolio title (< US MOAT >) switches portfolio left/right
        if (y >= (h * 9) / 100 && y < (h * 15) / 100) {
            if (x < (w / 2)) {
                _store.prevPortfolio();
            } else {
                _store.nextPortfolio();
            }
            return true;
        }

        // Tap on Net Worth / P&L header toggles Day P&L / Total Return
        if (y >= (h * 15) / 100 && y < (_store.rowStartY - 6)) {
            _store.showTotalReturn = !_store.showTotalReturn;
            WatchUi.requestUpdate();
            return true;
        }

        // Tap on any holding row opens the Individual Stock Chart + SMA20 + Day High/Low + WebMemo screen
        var rowsBottomY = _store.rowStartY + (_store.visibleRows * _store.rowHeight);
        if (y >= (_store.rowStartY - 6) && y <= (rowsBottomY + 14)) {
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
