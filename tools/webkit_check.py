"""Open a page in WebKit (Safari's engine) and report errors + a screenshot.
Run with:  xvfb-run -a /usr/bin/python3.12 tools/webkit_check.py page.html out.png [width height] [js-to-run-after-load]"""
import sys
import gi
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2, GLib  # noqa: E402

path, out = sys.argv[1], sys.argv[2]
w, h = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (390, 844)
after = sys.argv[5] if len(sys.argv) > 5 else ""
logs = []

win = Gtk.OffscreenWindow()
win.set_default_size(w, h)
settings = WebKit2.Settings()
settings.set_enable_write_console_messages_to_stdout(True)
settings.set_enable_developer_extras(True)
view = WebKit2.WebView.new_with_settings(settings)
view.set_size_request(w, h)
win.add(view)
win.show_all()

CATCH = """
window.__errs = [];
window.addEventListener('error', e => window.__errs.push('ERROR: ' + e.message + ' @' + (e.filename||'').slice(-30) + ':' + e.lineno + ':' + e.colno));
window.addEventListener('unhandledrejection', e => window.__errs.push('REJECT: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
"""
ucm = view.get_user_content_manager()
ucm.add_script(WebKit2.UserScript.new(CATCH, WebKit2.UserContentInjectedFrames.ALL_FRAMES,
                                      WebKit2.UserScriptInjectionTime.START, None, None))


def report(*_):
    def got(v, res):
        try:
            r = v.evaluate_javascript_finish(res)
            print("RESULT:", r.to_string())
        except Exception as e:  # noqa: BLE001
            print("EVAL FAIL", e)
        snap()
    js = ("(function(){ return JSON.stringify({errs: window.__errs, controls: document.querySelectorAll('#controls .field').length,"
          " pages: document.querySelectorAll('#scaler .page').length, ua: navigator.userAgent.slice(0,80)})})()")
    view.evaluate_javascript(js, -1, None, None, None, got)
    return False


def snap():
    def done(v, res):
        try:
            v.get_snapshot_finish(res).write_to_png(out)
        except Exception:  # noqa: BLE001  (no cairo bindings, or /dev/null)
            pass
        Gtk.main_quit()
    view.get_snapshot(WebKit2.SnapshotRegion.VISIBLE, WebKit2.SnapshotOptions.NONE, None, done)


def on_load(v, ev):
    if ev == WebKit2.LoadEvent.FINISHED:
        def pre():
            if after:
                v.evaluate_javascript(after, -1, None, None, None, None, None)
            GLib.timeout_add(int(sys.argv[6]) if len(sys.argv) > 6 else 1200, report)
            return False
        GLib.timeout_add(1500, pre)


view.connect("load-changed", on_load)
view.load_uri("file://" + path)
GLib.timeout_add(30000, Gtk.main_quit)
Gtk.main()
