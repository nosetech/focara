import tomllib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from focara.api import config as config_api
from focara.api.deps import get_config
from focara.config import Config, UiConfig
from focara.main import app


def _get_config() -> dict:
    app.dependency_overrides[get_config] = lambda: Config(ui=UiConfig(day_end_hour=20))
    try:
        res = TestClient(app).get("/api/config")
    finally:
        app.dependency_overrides.clear()
    assert res.status_code == 200
    return res.json()


def test_get_config() -> None:
    body = _get_config()
    pyproject = Path(__file__).parents[1] / "pyproject.toml"
    expected = tomllib.loads(pyproject.read_text())["project"]["version"]
    assert body == {"day_end_hour": 20, "version": expected}


def test_get_config_version_unknown(monkeypatch: pytest.MonkeyPatch) -> None:
    def raise_not_found(name: str) -> str:
        raise config_api.PackageNotFoundError(name)

    monkeypatch.setattr(config_api, "version", raise_not_found)
    assert _get_config()["version"] == "unknown"
