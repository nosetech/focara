from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from focara.api.deps import get_engine
from focara.db import create_db_engine, upgrade_db
from focara.db.models import Task, TaskProperty
from focara.main import app
from focara.recurrence import next_occurrence, spawn_next

MON, WED, SUN = 1 << 1, 1 << 3, 1 << 0


@pytest.fixture
def client(tmp_path):
    engine = create_db_engine(tmp_path / "focara.db")
    upgrade_db(engine)
    app.dependency_overrides[get_engine] = lambda: engine
    yield TestClient(app)
    app.dependency_overrides.clear()
    engine.dispose()


def _next(d: date, **rule) -> date:
    return next_occurrence(Task(**rule), d)


def test_weekly_next_weekday():
    # 2026-10-19 は月曜
    assert _next(date(2026, 10, 19), recurrence_type="weekly", recurrence_weekdays=MON | WED) == (
        date(2026, 10, 21)
    )
    # 同じ曜日のみなら翌週
    assert _next(date(2026, 10, 19), recurrence_type="weekly", recurrence_weekdays=MON) == (
        date(2026, 10, 26)
    )
    # 日曜(bit0)
    assert _next(date(2026, 10, 19), recurrence_type="weekly", recurrence_weekdays=SUN) == (
        date(2026, 10, 25)
    )
    # 毎日(全曜日)
    assert _next(date(2026, 10, 19), recurrence_type="weekly", recurrence_weekdays=127) == (
        date(2026, 10, 20)
    )


def test_monthly_boundaries():
    rule = {"recurrence_type": "monthly"}
    assert _next(date(2026, 1, 31), **rule, recurrence_month_day=31) == date(2026, 2, 28)
    assert _next(date(2026, 2, 28), **rule, recurrence_month_day=31) == date(2026, 3, 31)
    assert _next(date(2028, 1, 31), **rule, recurrence_month_day=30) == date(2028, 2, 29)
    assert _next(date(2026, 1, 15), **rule, recurrence_month_day=-1) == date(2026, 1, 31)
    assert _next(date(2026, 1, 31), **rule, recurrence_month_day=-1) == date(2026, 2, 28)
    assert _next(date(2026, 12, 20), **rule, recurrence_month_day=10) == date(2027, 1, 10)


def test_yearly_leap_day():
    rule = {"recurrence_type": "yearly", "recurrence_month": 2, "recurrence_day": 29}
    assert _next(date(2027, 3, 1), **rule) == date(2028, 2, 29)
    assert _next(date(2027, 1, 1), **rule) == date(2027, 2, 28)


def _create(client, **kw):
    body = {"title": "習慣", "status": "next", "project_id": None, **kw}
    res = client.post("/api/tasks", json=body)
    assert res.status_code == 201, res.text
    return res.json()["id"]


def _complete(client, tid):
    return client.post(f"/api/tasks/{tid}/transition", json={"status": "done"})


def _other_tasks(client, tid):
    return [t for t in client.get("/api/tasks").json() if t["id"] != tid]


def test_complete_spawns_next_and_inherits(client):
    project = client.post("/api/projects", json={"name": "p"}).json()["id"]
    tid = _create(
        client,
        project_id=project,
        priority=2,
        estimate_minutes=15,
        memo="メモ",
        scheduled_date="2099-01-05",  # 月曜
        time_slot="morning",
        recurrence_type="weekly",
        recurrence_weekdays=MON,
    )
    assert _complete(client, tid).status_code == 200
    (new,) = _other_tasks(client, tid)
    assert new["title"] == "習慣"
    assert new["project_id"] == project
    assert new["priority"] == 2
    assert new["estimate_minutes"] == 15
    assert new["memo"] is None
    assert new["status"] == "habit"
    assert new["scheduled_date"] == "2099-01-12"
    assert new["time_slot"] == "morning"
    assert new["recurrence_type"] == "weekly"
    # 完了した回からは繰り返しが外れ、再完了しても重複しない
    assert client.get(f"/api/tasks/{tid}").json()["recurrence_type"] is None
    client.post(f"/api/tasks/{tid}/transition", json={"status": "next"})
    _complete(client, tid)
    assert len(_other_tasks(client, tid)) == 1


def test_late_completion_skips_past_dates(client):
    tid = _create(
        client,
        scheduled_date="2020-01-06",
        recurrence_type="weekly",
        recurrence_weekdays=MON,
    )
    _complete(client, tid)
    (new,) = _other_tasks(client, tid)
    assert new["scheduled_date"] > date.today().isoformat()


def test_complete_via_patch_spawns_next(client):
    tid = _create(client, recurrence_type="weekly", recurrence_weekdays=127)
    assert client.patch(f"/api/tasks/{tid}", json={"status": "done"}).status_code == 200
    assert len(_other_tasks(client, tid)) == 1


def test_non_recurring_does_not_spawn(client):
    tid = _create(client)
    _complete(client, tid)
    assert _other_tasks(client, tid) == []


def test_end_date(client):
    tid = _create(
        client,
        scheduled_date="2099-01-05",
        recurrence_type="weekly",
        recurrence_weekdays=MON,
        recurrence_end_type="date",
        recurrence_end_date="2099-01-11",
    )
    _complete(client, tid)
    assert _other_tasks(client, tid) == []


def test_end_count_decrements(client):
    tid = _create(
        client,
        scheduled_date="2099-01-05",
        recurrence_type="weekly",
        recurrence_weekdays=MON,
        recurrence_end_type="count",
        recurrence_end_count=2,
    )
    _complete(client, tid)
    (second,) = _other_tasks(client, tid)
    assert second["recurrence_end_count"] == 1
    _complete(client, second["id"])
    assert len(client.get("/api/tasks").json()) == 2  # 3回目は作られない


def test_stop_recurrence(client):
    tid = _create(client, recurrence_type="weekly", recurrence_weekdays=MON)
    res = client.delete(f"/api/tasks/{tid}/recurrence")
    assert res.status_code == 200
    assert res.json()["recurrence_type"] is None
    _complete(client, tid)
    assert _other_tasks(client, tid) == []


def test_change_recurrence_rule(client):
    tid = _create(client, recurrence_type="weekly", recurrence_weekdays=MON)
    res = client.put(
        f"/api/tasks/{tid}/recurrence",
        json={"recurrence_type": "monthly", "recurrence_month_day": -1},
    )
    assert res.status_code == 200
    body = res.json()
    assert (body["recurrence_type"], body["recurrence_weekdays"]) == ("monthly", None)
    bad = client.put(f"/api/tasks/{tid}/recurrence", json={"recurrence_type": "weekly"})
    assert bad.status_code == 422
    assert (
        client.put("/api/tasks/999/recurrence", json={"recurrence_type": "weekly"}).status_code
        == 404
    )


def test_properties_inherit_keys_without_values(client):
    engine = app.dependency_overrides[get_engine]()
    with Session(engine) as session:
        task = Task(
            title="t",
            status="next",
            recurrence_type="weekly",
            recurrence_weekdays=127,
            properties=[TaskProperty(key="体重", value="62.5")],
        )
        session.add(task)
        session.flush()
        new = spawn_next(session, task, today=date(2026, 10, 19))
        assert [(p.key, p.value) for p in new.properties] == [("体重", None)]
        assert new.scheduled_date == "2026-10-20"
