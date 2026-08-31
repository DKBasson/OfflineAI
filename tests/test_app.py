from fastapi.testclient import TestClient

import app
import services.config as svc_config
import services.ollama as svc_ollama
import routes.ui as routes_ui
import routes.models as routes_models


def test_root_serves_ui():
    client = TestClient(app.app)

    resp = client.get("/")

    assert resp.status_code == 200
    assert "OfflineAI" in resp.text


def test_frontend_fallback_when_react_dist_missing(monkeypatch):
    """When react-dist is missing, GET / returns a helpful fallback page."""
    monkeypatch.setattr(svc_config, "_REACT_MODE", False)
    monkeypatch.setattr(routes_ui, "_REACT_MODE", False)
    client = TestClient(app.app)

    resp = client.get("/")

    assert resp.status_code == 200
    assert "Frontend not built" in resp.text
    assert "npm run build" in resp.text


def test_legacy_frontend_endpoints_removed():
    """Legacy /styles.css and /frontend/* endpoints no longer exist."""
    client = TestClient(app.app)

    styles_resp = client.get("/styles.css")
    frontend_resp = client.get("/frontend/app.js")

    assert styles_resp.status_code == 404
    assert frontend_resp.status_code == 404


def test_status_reports_offline_without_ollama(monkeypatch):
    monkeypatch.setattr(svc_config, "OLLAMA", "http://127.0.0.1:9")
    client = TestClient(app.app)

    resp = client.get("/api/status")

    assert resp.status_code == 503
    assert resp.json()["ollama"] is False


def test_models_falls_back_when_ollama_unavailable(monkeypatch):
    monkeypatch.setattr(svc_config, "OLLAMA", "http://127.0.0.1:9")
    client = TestClient(app.app)

    resp = client.get("/api/models")

    assert resp.status_code == 200
    data = resp.json()
    assert data["offline"] is True
    assert data["models"][0]["name"] == svc_config.FALLBACK_MODEL


def test_rejects_oversized_body(monkeypatch):
    monkeypatch.setattr(svc_config, "MAX_BODY", 0)
    client = TestClient(app.app)

    resp = client.post(
        "/api/chat",
        content=b"x",
        headers={"content-length": "2", "content-type": "application/json"},
    )

    assert resp.status_code == 413


def test_lan_auth_skips_loopback(monkeypatch):
    monkeypatch.setattr(svc_config, "AUTH_REQUIRED", True)
    monkeypatch.setattr(svc_config, "AUTH_TOKEN", "secret")
    monkeypatch.setattr(svc_config, "OLLAMA", "http://127.0.0.1:9")
    client = TestClient(app.app, client=("127.0.0.1", 51766))

    resp = client.get("/api/status")

    assert resp.status_code == 503


def test_lan_auth_requires_token_for_remote_clients(monkeypatch):
    monkeypatch.setattr(svc_config, "AUTH_REQUIRED", True)
    monkeypatch.setattr(svc_config, "AUTH_TOKEN", "secret")
    monkeypatch.setattr(svc_config, "OLLAMA", "http://127.0.0.1:9")
    client = TestClient(app.app, client=("192.168.68.58", 51755))

    unauth = client.get("/api/status")
    auth = client.get("/api/status", headers={"x-offlineai-token": "secret"})

    assert unauth.status_code == 401
    assert auth.status_code == 503


def test_restart_ollama_endpoint_uses_runtime_helper(monkeypatch):
    async def ready(timeout=12.0):
        return True, ""

    monkeypatch.setattr(svc_ollama, "_restart_ollama_process", lambda: {"ok": True, "method": "test"})
    monkeypatch.setattr(svc_ollama, "_wait_for_ollama_ready", ready)
    monkeypatch.setattr(routes_models, "_restart_ollama_process", lambda: {"ok": True, "method": "test"})
    monkeypatch.setattr(routes_models, "_wait_for_ollama_ready", ready)
    client = TestClient(app.app, client=("127.0.0.1", 51766))

    resp = client.post("/api/ollama/restart")

    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert resp.json()["method"] == "test"


def test_restart_ollama_endpoint_rejects_unauthenticated_remote_client(monkeypatch):
    monkeypatch.setattr(svc_config, "AUTH_REQUIRED", False)
    monkeypatch.setattr(svc_config, "AUTH_TOKEN", "")
    client = TestClient(app.app, client=("192.168.68.58", 51755))

    resp = client.post("/api/ollama/restart")

    assert resp.status_code == 403
