from fastapi.testclient import TestClient

from focara.api.deps import get_config
from focara.config import Config, UiConfig
from focara.main import app


def test_get_config() -> None:
    app.dependency_overrides[get_config] = lambda: Config(ui=UiConfig(day_end_hour=20))
    try:
        res = TestClient(app).get("/api/config")
    finally:
        app.dependency_overrides.clear()
    assert res.status_code == 200
    assert res.json() == {"day_end_hour": 20}
