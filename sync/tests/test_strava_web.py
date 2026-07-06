"""Tests for the Strava web connector's pure helpers (browser paths are covered
by the manual spike documented in the connector docstring)."""

import strava_web


def test_is_configured_reflects_env(monkeypatch):
    monkeypatch.delenv("STRAVA_WEB_EMAIL", raising=False)
    monkeypatch.delenv("STRAVA_WEB_PASSWORD", raising=False)
    assert strava_web.is_configured() is False
    monkeypatch.setenv("STRAVA_WEB_EMAIL", "a@b.com")
    monkeypatch.setenv("STRAVA_WEB_PASSWORD", "secret")
    assert strava_web.is_configured() is True


def test_save_session_keeps_only_strava_cookies():
    captured = {}

    class _Cur:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def execute(self, sql, params=None):
            if params:
                captured["cookies"] = params[0]

    class _Conn:
        def cursor(self): return _Cur()

    cookies = [
        {"name": "_strava4_session", "value": "abc", "domain": ".strava.com", "path": "/", "httpOnly": True, "secure": True, "sameSite": "Lax", "expires": -1},
        {"name": "_ga", "value": "junk", "domain": ".google.com", "path": "/"},          # dropped
    ]
    strava_web._save_session(_Conn(), cookies)
    import json
    kept = json.loads(captured["cookies"])
    names = {c["name"] for c in kept}
    assert "_strava4_session" in names
    assert "_ga" not in names


def test_save_session_noop_without_conn():
    strava_web._save_session(None, [{"name": "_strava4_session", "domain": ".strava.com"}])  # must not raise


def test_upload_photos_unconfigured_returns_failures(monkeypatch):
    monkeypatch.delenv("STRAVA_WEB_EMAIL", raising=False)
    monkeypatch.delenv("STRAVA_WEB_PASSWORD", raising=False)
    out = strava_web.upload_photos([(123, "/tmp/x.png")])
    assert out == [(123, False)]
