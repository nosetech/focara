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


def test_complete_does_not_spawn_next(client):
    a = _task(client)
    client.post(f"/api/tasks/{a}/complete")
    assert len(client.get("/api/tasks").json()) == 1


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
    assert (res["scheduled_date"], res["time_slot"], res["run_order"]) == (tomorrow, "morning", 1)
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


def test_postpone_end_of_day_uses_given_slot_and_appends(client):
    for slot in ("morning", "afternoon"):
        other = _task(client, f"other-{slot}")
        client.put(
            f"/api/tasks/{other}/schedule",
            json={"scheduled_date": "2026-10-20", "time_slot": slot, "run_order": 4},
        )
        a = _task(client, f"a-{slot}")
        client.put(
            f"/api/tasks/{a}/schedule",
            json={"scheduled_date": "2026-10-20", "time_slot": slot, "run_order": 0},
        )
        res = client.post(
            f"/api/tasks/{a}/postpone", json={"target": "end_of_day", "time_slot": slot}
        ).json()
        assert (res["scheduled_date"], res["time_slot"], res["run_order"]) == (
            "2026-10-20",
            slot,
            1,
        )


def test_postpone_goes_last_even_with_null_run_order(client):
    """run_order 未設定のタスクが混在しても、後回しで次のタスクは並び順どおりに回る。"""
    day = "2026-10-20"
    m1, m2 = (_task(client, n, priority=2) for n in ("m1", "m2"))
    low = _task(client, "low", priority=3)
    for tid, order in ((m1, 0), (m2, 1)):
        client.put(
            f"/api/tasks/{tid}/schedule",
            json={"scheduled_date": day, "time_slot": "afternoon", "run_order": order},
        )
    # タスク詳細からの設定と同じく run_order を付けずに割り当てる
    client.patch(f"/api/tasks/{low}", json={"scheduled_date": day, "time_slot": "afternoon"})

    def titles():
        return [t["title"] for t in client.get(f"/api/schedule?date={day}").json()]

    assert titles() == ["m1", "m2", "low"]
    client.post(
        f"/api/tasks/{m1}/postpone", json={"target": "end_of_day", "time_slot": "afternoon"}
    )
    assert titles() == ["m2", "low", "m1"]
    client.post(
        f"/api/tasks/{m2}/postpone", json={"target": "end_of_day", "time_slot": "afternoon"}
    )
    assert titles() == ["low", "m1", "m2"]


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


def test_postpone_fixed_task_clears_fixed_time_and_moves_to_slot_end(client):
    from datetime import datetime

    at = datetime(2026, 10, 20, 9, 0).astimezone().isoformat()
    a = client.post(
        "/api/tasks",
        json={"title": "a", "status": "next", "scheduled_date": "2026-10-20", "fixed_at": at},
    ).json()
    assert a["time_slot"] == "morning"
    res = client.post(
        f"/api/tasks/{a['id']}/postpone", json={"target": "end_of_day", "time_slot": "afternoon"}
    ).json()
    assert res["fixed_at"] is None and res["fixed_end_at"] is None
    assert res["time_slot"] == "afternoon"
