from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from focara.api.deps import get_engine
from focara.db import create_db_engine, upgrade_db
from focara.main import app


@pytest.fixture
def client(tmp_path):
    engine = create_db_engine(tmp_path / "focara.db")
    upgrade_db(engine)
    app.dependency_overrides[get_engine] = lambda: engine
    yield TestClient(app)
    app.dependency_overrides.clear()
    engine.dispose()


def _task(client, title="t", **kw):
    return client.post("/api/tasks", json={"title": title, "status": "next", **kw}).json()["id"]


def test_complete_records_log(client):
    a = _task(client, "a")
    res = client.post(f"/api/tasks/{a}/complete", json={"note": "終わった"})
    assert res.status_code == 200
    assert res.json()["status"] == "done"
    logs = client.get("/api/logs").json()
    assert [(x["task_title"], x["action"], x["note"]) for x in logs] == [
        ("a", "completed", "終わった")
    ]
    assert client.post(f"/api/tasks/{a}/complete").status_code == 409


def test_complete_without_body(client):
    a = _task(client)
    assert client.post(f"/api/tasks/{a}/complete").status_code == 200


def test_transition_to_done_also_logs(client):
    a = _task(client)
    client.post(f"/api/tasks/{a}/transition", json={"status": "done"})
    assert len(client.get("/api/logs?action=completed").json()) == 1


def test_complete_recurring_spawns_next(client):
    a = _task(client, recurrence_type="weekly", recurrence_weekdays=127)
    client.post(f"/api/tasks/{a}/complete")
    assert len(client.get("/api/tasks").json()) == 2


def test_postpone_tomorrow_appends(client):
    today = date.today()
    tomorrow = (today + timedelta(days=1)).isoformat()
    other = _task(client, "other")
    client.put(
        f"/api/tasks/{other}/schedule",
        json={"scheduled_date": tomorrow, "time_slot": "morning", "run_order": 3},
    )
    a = _task(client, "a")
    client.put(
        f"/api/tasks/{a}/schedule",
        json={"scheduled_date": today.isoformat(), "time_slot": "morning"},
    )
    res = client.post(f"/api/tasks/{a}/postpone", json={"note": "忙しい"}).json()
    assert (res["scheduled_date"], res["time_slot"], res["run_order"]) == (tomorrow, "morning", 4)
    log = client.get("/api/logs?action=postponed").json()[0]
    assert (log["task_id"], log["note"]) == (a, "忙しい")


def test_postpone_end_of_day_and_date(client):
    a = _task(client)
    client.put(
        f"/api/tasks/{a}/schedule", json={"scheduled_date": "2026-10-20", "time_slot": "morning"}
    )
    res = client.post(f"/api/tasks/{a}/postpone", json={"target": "end_of_day"}).json()
    assert (res["scheduled_date"], res["time_slot"]) == ("2026-10-20", "evening")
    res = client.post(
        f"/api/tasks/{a}/postpone",
        json={"target": "date", "scheduled_date": "2026-11-01", "time_slot": "afternoon"},
    ).json()
    assert (res["scheduled_date"], res["time_slot"]) == ("2026-11-01", "afternoon")
    assert client.post(f"/api/tasks/{a}/postpone", json={"target": "date"}).status_code == 422


def test_postpone_done_rejected(client):
    a = _task(client)
    client.post(f"/api/tasks/{a}/complete")
    assert client.post(f"/api/tasks/{a}/postpone", json={}).status_code == 409
    assert client.post("/api/tasks/999/postpone", json={}).status_code == 404


def test_logs_date_range(client):
    a, b = _task(client, "a"), _task(client, "b")
    client.post(f"/api/tasks/{a}/complete")
    client.post(f"/api/tasks/{b}/postpone", json={})
    today = date.today()
    day = today.isoformat()
    assert len(client.get(f"/api/logs?from_date={day}&to_date={day}").json()) == 2
    past = (today - timedelta(days=1)).isoformat()
    assert client.get(f"/api/logs?to_date={past}").json() == []
    future = (today + timedelta(days=1)).isoformat()
    assert client.get(f"/api/logs?from_date={future}").json() == []
    assert client.get(f"/api/logs?from_date={future}&to_date={day}").status_code == 422
