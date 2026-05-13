from fastapi.testclient import TestClient

import app


def test_root_serves_ui():
    client = TestClient(app.app)

    resp = client.get("/")

    assert resp.status_code == 200
    assert "OfflineAI" in resp.text


def test_frontend_scripts_are_served():
    client = TestClient(app.app)

    app_js = client.get("/frontend/app.js")
    tooltip_js = client.get("/frontend/settings-tooltips.js")

    assert app_js.status_code == 200
    assert "FALLBACK_MODEL" in app_js.text
    assert tooltip_js.status_code == 200
    assert "settings-tooltip" in tooltip_js.text


def test_status_reports_offline_without_ollama(monkeypatch):
    monkeypatch.setattr(app, "OLLAMA", "http://127.0.0.1:9")
    client = TestClient(app.app)

    resp = client.get("/api/status")

    assert resp.status_code == 503
    assert resp.json()["ollama"] is False


def test_models_falls_back_when_ollama_unavailable(monkeypatch):
    monkeypatch.setattr(app, "OLLAMA", "http://127.0.0.1:9")
    client = TestClient(app.app)

    resp = client.get("/api/models")

    assert resp.status_code == 200
    data = resp.json()
    assert data["offline"] is True
    assert data["models"][0]["name"] == app.FALLBACK_MODEL


def test_rejects_oversized_body(monkeypatch):
    monkeypatch.setattr(app, "MAX_BODY", 0)
    client = TestClient(app.app)

    resp = client.post(
        "/api/chat",
        content=b"x",
        headers={"content-length": "2", "content-type": "application/json"},
    )

    assert resp.status_code == 413


def test_lan_auth_skips_loopback(monkeypatch):
    monkeypatch.setattr(app, "AUTH_REQUIRED", True)
    monkeypatch.setattr(app, "AUTH_TOKEN", "secret")
    monkeypatch.setattr(app, "OLLAMA", "http://127.0.0.1:9")
    client = TestClient(app.app, client=("127.0.0.1", 51766))

    resp = client.get("/api/status")

    assert resp.status_code == 503


def test_lan_auth_requires_token_for_remote_clients(monkeypatch):
    monkeypatch.setattr(app, "AUTH_REQUIRED", True)
    monkeypatch.setattr(app, "AUTH_TOKEN", "secret")
    monkeypatch.setattr(app, "OLLAMA", "http://127.0.0.1:9")
    client = TestClient(app.app, client=("192.168.68.58", 51755))

    unauth = client.get("/api/status")
    auth = client.get("/api/status", headers={"x-offlineai-token": "secret"})

    assert unauth.status_code == 401
    assert auth.status_code == 503


def test_restart_ollama_endpoint_uses_runtime_helper(monkeypatch):
    async def ready(timeout=12.0):
        return True, ""

    monkeypatch.setattr(app, "_restart_ollama_process", lambda: {"ok": True, "method": "test"})
    monkeypatch.setattr(app, "_wait_for_ollama_ready", ready)
    client = TestClient(app.app, client=("127.0.0.1", 51766))

    resp = client.post("/api/ollama/restart")

    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert resp.json()["method"] == "test"


def test_restart_ollama_endpoint_rejects_unauthenticated_remote_client(monkeypatch):
    monkeypatch.setattr(app, "AUTH_REQUIRED", False)
    monkeypatch.setattr(app, "AUTH_TOKEN", "")
    client = TestClient(app.app, client=("192.168.68.58", 51755))

    resp = client.post("/api/ollama/restart")

    assert resp.status_code == 403
