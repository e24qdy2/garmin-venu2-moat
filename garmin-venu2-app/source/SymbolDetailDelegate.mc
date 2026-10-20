import Toybox.Lang;
import Toybox.WatchUi;

class SymbolDetailDelegate extends WatchUi.BehaviorDelegate {
    private var _store as PortfolioStore;
    private var _view as SymbolDetailView;

    function initialize(store as PortfolioStore, view as SymbolDetailView) {
        BehaviorDelegate.initialize();
        _store = store;
        _view = view;
    }

    // Physical Top-Right button toggles Bollinger overlay; UP/DOWN cycles symbols
    function onKey(evt as KeyEvent) as Boolean {
        _store.resetSwipeTimer();
        _store.applyBacklightIfEnabled();
        var key = evt.getKey();
        if (key == WatchUi.KEY_ENTER || key == WatchUi.KEY_START) {
            _view.showBollinger = !_view.showBollinger;
            WatchUi.requestUpdate();
            return true;
        } else if (key == WatchUi.KEY_DOWN) {
            _view.nextSymbol();
            return true;
        } else if (key == WatchUi.KEY_UP) {
            _view.prevSymbol();
            return true;
        }
        return false;
    }

    // Touch tap on top header returns to list; tap on chart toggles SMA20 + Bollinger overlay
    function onTap(evt as ClickEvent) as Boolean {
        _store.resetSwipeTimer();
        _store.applyBacklightIfEnabled();
        var coords = evt.getCoordinates();
        if (coords != null && coords.size() >= 2) {
            var y = coords[1];
            var h = _store.screenH;
            if (y < (h * 12) / 100) {
                _store.inDetailView = false;
                WatchUi.popView(WatchUi.SLIDE_RIGHT);
                return true;
            }
        }
        _view.showBollinger = !_view.showBollinger;
        WatchUi.requestUpdate();
        return true;
    }

    // Swipe right returns to portfolio list; Swipe up/down cycles through stocks
    function onSwipe(evt as SwipeEvent) as Boolean {
        _store.resetSwipeTimer();
        _store.applyBacklightIfEnabled();
        var dir = evt.getDirection();
        if (dir == WatchUi.SWIPE_RIGHT) {
            _store.inDetailView = false;
            WatchUi.popView(WatchUi.SLIDE_RIGHT);
            return true;
        } else if (dir == WatchUi.SWIPE_UP || dir == WatchUi.SWIPE_LEFT) {
            _view.nextSymbol();
            return true;
        } else if (dir == WatchUi.SWIPE_DOWN) {
            _view.prevSymbol();
            return true;
        }
        return false;
    }

    // Physical Bottom-Right Back button returns to Portfolio List
    function onBack() as Boolean {
        _store.inDetailView = false;
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }
}
