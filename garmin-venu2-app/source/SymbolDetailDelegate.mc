import Toybox.Lang;
import Toybox.WatchUi;

class SymbolDetailDelegate extends WatchUi.BehaviorDelegate {
    private var _view as SymbolDetailView;

    function initialize(view as SymbolDetailView) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    // Top-Right Select button toggles SMA20 / Bollinger overlay
    function onSelect() as Boolean {
        _view.showBollinger = !_view.showBollinger;
        WatchUi.requestUpdate();
        return true;
    }

    // Bottom-Right Back button or right-swipe returns to Portfolio List
    function onBack() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }
}
