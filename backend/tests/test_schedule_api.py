import pytest
from fastapi.testclient import TestClient

from focara.api.deps import get_engine
from focara.db import create_db_engine, upgrade_db
from focara.main import app

DAY = "2026-10-20"


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


def _assign(client, tid, slot, **kw):
    return client.put(
        f"/api/tasks/{tid}/schedule", json={"scheduled_date": DAY, "time_slot": slot, **kw}
    )


def test_assign_appends_to_slot_end(client):
    a, b = _task(client, "a"), _task(client, "b")
    assert _assign(client, a, "morning").json()["run_order"] == 0
    res = _assign(client, b, "morning")
    assert res.status_code == 200
    assert res.json()["run_order"] == 1
    assert res.json()["scheduled_date"] == DAY


def test_day_list_ordered_by_slot_then_order(client):
    ids = {n: _task(client, n) for n in "abcd"}
    _assign(client, ids["a"], "evening", run_order=0)
    _assign(client, ids["b"], "morning", run_order=1)
    _assign(client, ids["c"], "morning", run_order=0)
    _assign(client, ids["d"], "afternoon", run_order=0)
    res = client.get(f"/api/schedule?date={DAY}")
    assert [t["title"] for t in res.json()] == ["c", "b", "d", "a"]
    assert client.get("/api/schedule?date=2026-10-21").json() == []


def test_day_list_excludes_done_by_default(client):
    a = _task(client, "a")
    _assign(client, a, "morning")
    client.post(f"/api/tasks/{a}/transition", json={"status": "done"})
    assert client.get(f"/api/schedule?date={DAY}").json() == []
    assert len(client.get(f"/api/schedule?date={DAY}&include_done=true").json()) == 1


def test_fixed_datetime_task(client):
    a = _task(client, "meeting")
    res = _assign(
        client,
        a,
        "afternoon",
        fixed_at="2026-10-20T14:00:00+09:00",
        fixed_end_at="2026-10-20T15:00:00+09:00",
    )
    assert res.status_code == 200
    body = res.json()
    assert body["fixed_at"].startswith("2026-10-20T05:00:00")
    assert body["fixed_end_at"].startswith("2026-10-20T06:00:00")


def test_fixed_end_validation(client):
    a = _task(client)
    assert (
        _assign(client, a, "morning", fixed_end_at="2026-10-20T15:00:00+09:00").status_code == 422
    )
    res = _assign(
        client,
        a,
        "morning",
        fixed_at="2026-10-20T15:00:00+09:00",
        fixed_end_at="2026-10-20T14:00:00+09:00",
    )
    assert res.status_code == 422
    assert client.get(f"/api/tasks/{a}").json()["scheduled_date"] is None
    res = client.patch(f"/api/tasks/{a}", json={"fixed_end_at": "2026-10-20T14:00:00+09:00"})
    assert res.status_code == 422


def test_invalid_assign(client):
    a = _task(client)
    assert _assign(client, a, "night").status_code == 422
    assert (
        client.put(
            "/api/tasks/999/schedule", json={"scheduled_date": DAY, "time_slot": "morning"}
        ).status_code
        == 404
    )


def test_unassign(client):
    a = _task(client)
    _assign(client, a, "morning")
    body = client.delete(f"/api/tasks/{a}/schedule").json()
    assert body["scheduled_date"] is None and body["time_slot"] is None
    assert body["run_order"] is None


def test_reorder(client):
    a, b, c = (_task(client, n) for n in "abc")
    for t in (a, b, c):
        _assign(client, t, "morning")
    body = {"scheduled_date": DAY, "time_slot": "morning", "task_ids": [c, a, b]}
    res = client.put("/api/schedule/order", json=body)
    assert res.status_code == 200
    assert [t["title"] for t in res.json()] == ["c", "a", "b"]
    day = client.get(f"/api/schedule?date={DAY}").json()
    assert [t["title"] for t in day] == ["c", "a", "b"]


def test_reorder_rejects_mismatch(client):
    a, b = _task(client, "a"), _task(client, "b")
    _assign(client, a, "morning")
    _assign(client, b, "evening")
    base = {"scheduled_date": DAY, "time_slot": "morning"}
    assert client.put("/api/schedule/order", json={**base, "task_ids": [a, b]}).status_code == 422
    assert client.put("/api/schedule/order", json={**base, "task_ids": []}).status_code == 422
    assert client.put("/api/schedule/order", json={**base, "task_ids": [a, a]}).status_code == 422
