import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

class Venu2MoatApp extends Application.AppBase {
    private var _store as PortfolioStore?;

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state as Dictionary?) as Void {
        _store = new PortfolioStore();
        _store.loadCached();
        _store.startRuntimeTimer();
        _store.fetchRemote();
    }

    function onStop(state as Dictionary?) as Void {
        if (_store != null) {
            _store.stopRuntimeTimer();
        }
    }

    function onSettingsChanged() as Void {
        if (_store != null) {
            _store.loadLocalProperties();
            _store.fetchRemote();
        }
        WatchUi.requestUpdate();
    }

    function getInitialView() as [Views] or [Views, InputDelegates] {
        if (_store == null) {
            _store = new PortfolioStore();
            _store.startRuntimeTimer();
        }
        var view = new Venu2MoatView(_store);
        var delegate = new Venu2MoatDelegate(_store, view);
        return [view, delegate];
    }

    (:glance)
    function getGlanceView() as [GlanceView] or [GlanceView, GlanceViewDelegate] or Null {
        return [new Venu2MoatGlanceView()];
    }
}
