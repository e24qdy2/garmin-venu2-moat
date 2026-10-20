import Toybox.Lang;
import Toybox.WatchUi;

class Venu2MoatDelegate extends WatchUi.BehaviorDelegate {
    private var _store as PortfolioStore;

    function initialize(store as PortfolioStore, view as Venu2MoatView) {
        BehaviorDelegate.initialize();
        _store = store;
    }

    // Physical Top-Right / START Button -> Toggle Day P&L vs Total Return (or re-verify license if expired)
    function onSelect() as Boolean {
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

    // Touch Tap Handling -> Open Symbol Detail + Sparkline Chart + WebMemo View
    function onTap(evt as ClickEvent) as Boolean {
        _store.resetSwipeTimer();
        _store.applyBacklightIfEnabled();

        if (_store.trialExpired) {
            _store.fetchRemote();
            return true;
        }

        var coords = evt.getCoordinates();
        var y = coords[1];
        var h = _store.screenH;

        // Tap on top clock/mode bar toggles Auto-Swipe on/off quickly on watch
        if (y < (h * 10) / 100) {
            _store.autoSwipeEnabled = !_store.autoSwipeEnabled;
            WatchUi.requestUpdate();
            return true;
        }

        // Tap on header toggles Day P&L / Total Return
        if (y >= (h * 14) / 100 && y < _store.rowStartY) {
            _store.showTotalReturn = !_store.showTotalReturn;
            WatchUi.requestUpdate();
            return true;
        }

        // Tap on a holding row
        var rowsBottomY = _store.rowStartY + (_store.visibleRows * _store.rowHeight);
        if (y >= _store.rowStartY && y <= rowsBottomY) {
            var rowSlot = (y - _store.rowStartY) / _store.rowHeight;
            var itemIdx = _store.scrollRowOffset + rowSlot;
            var port = _store.getActivePortfolio();
            if (port != null) {
                var items = port.get("s") as Array;
                if (itemIdx >= 0 && itemIdx < items.size()) {
                    var item = items[itemIdx] as Dictionary;
                    _store.inDetailView = true;
                    var detailView = new SymbolDetailView(item);
                    var detailDelegate = new SymbolDetailDelegate(detailView);
                    WatchUi.pushView(detailView, detailDelegate, WatchUi.SLIDE_LEFT);
                    return true;
                }
            }
        }
        return false;
    }
}
