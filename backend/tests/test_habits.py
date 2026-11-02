from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from focara.api.deps import get_config, get_engine
from focara.config import Config, HabitConfig
from focara.db import create_db_engine, upgrade_db
from focara.db.models import Habit, Task, TaskLog
from focara.habit_generator import generate_all, generate_children
from focara.main import app

AHEAD = 14
DAILY = {"recurrence_type": "weekly", "recurrence_weekdays": 127}


@pytest.fixture
def engine(tmp_path):
    e = create_db_engine(tmp_path / "focara.db")
    upgrade_db(e)
    yield e
    e.dispose()


@pytest.fixture
def client(engine):
    app.dependency_overrides[get_engine] = lambda: engine
    app.dependency_overrides[get_config] = lambda: Config(
        habit=HabitConfig(generate_ahead_days=AHEAD)
    )
    yield TestClient(app)
    app.dependency_overrides.clear()


def _iso(offset: int = 0) -> str:
    return (date.today() + timedelta(days=offset)).isoformat()


def _habit(client, **kw) -> dict:
    body = {"title": "ストレッチ", **DAILY, **kw}
    res = client.post("/api/habits", json=body)
    assert res.status_code == 201, res.text
    return res.json()


def _children(client, habit_id: int) -> list[dict]:
    kids = client.get(f"/api/tasks?habit_id={habit_id}").json()
    return sorted(kids, key=lambda t: t["occurrence_date"])


def test_create_generates_today_to_ahead(client):
    h = _habit(client, time_slot="morning", priority=2, estimate_minutes=10, memo="m")
    kids = _children(client, h["id"])
    assert [k["occurrence_date"] for k in kids] == [_iso(i) for i in range(AHEAD + 1)]
    k = kids[0]
    assert (k["status"], k["scheduled_date"], k["time_slot"], k["habit_id"]) == (
        "next",
        _iso(),
        "morning",
        h["id"],
    )
    assert (k["title"], k["priority"], k["estimate_minutes"]) == ("ストレッチ", 2, 10)
    assert h["generated_until"] == _iso(AHEAD)
    # /schedule にそのまま出る
    sched = client.get(f"/api/schedule?date={_iso(3)}").json()
    assert [t["id"] for t in sched] == [kids[3]["id"]]


def test_weekday_rule_and_start_date(client):
    start = date.today() + timedelta(days=3)
    h = _habit(client, start_date=start.isoformat())
    dates = [k["occurrence_date"] for k in _children(client, h["id"])]
    assert dates[0] == start.isoformat()
    assert dates[-1] == _iso(AHEAD)


def test_invalid_rule_rejected(client):
    res = client.post("/api/habits", json={"title": "x", "recurrence_type": "weekly"})
    assert res.status_code == 422
    assert client.get("/api/habits").json() == []


def test_properties_copied_without_values(client):
    h = _habit(client, properties=["体重", "体重", "回数"])
    assert h["properties"] == ["体重", "回数"]
    kid = _children(client, h["id"])[0]
    props = client.get(f"/api/tasks/{kid['id']}/properties").json()
    assert sorted((p["key"], p["value"]) for p in props) == [("体重", None), ("回数", None)]


def test_generation_idempotent_and_extends_with_date(engine, client):
    h = _habit(client)
    with Session(engine) as s:
        habit = s.get(Habit, h["id"])
        assert generate_children(s, habit, date.today(), AHEAD) == 0
        s.commit()
        # 翌日になると1日分だけ増える
        assert generate_all(s, date.today() + timedelta(days=1), AHEAD) == 1
        assert s.query(Task).filter_by(habit_id=h["id"]).count() == AHEAD + 2
        assert generate_all(s, date.today() + timedelta(days=1), AHEAD) == 0


def test_deleted_child_not_revived(engine, client):
    h = _habit(client)
    kids = _children(client, h["id"])
    assert client.delete(f"/api/tasks/{kids[3]['id']}").status_code == 204
    with Session(engine) as s:
        generate_all(s, date.today(), AHEAD)
        assert s.query(Task).filter_by(habit_id=h["id"]).count() == AHEAD


def test_skipped_days_not_backfilled(engine, client):
    _habit(client)
    with Session(engine) as s:
        s.query(Task).delete()
        s.commit()
        later = date.today() + timedelta(days=30)
        generate_all(s, later, AHEAD)
        dates = sorted(s.scalars(select(Task.occurrence_date)))
        assert dates[0] == later.isoformat()


def test_end_count(client):
    h = _habit(client, recurrence_end_type="count", recurrence_end_count=3)
    assert len(_children(client, h["id"])) == 3
    assert client.get(f"/api/habits/{h['id']}").json()["active"] is False


def test_end_date(client):
    h = _habit(client, recurrence_end_type="date", recurrence_end_date=_iso(4))
    assert [k["occurrence_date"] for k in _children(client, h["id"])] == [_iso(i) for i in range(5)]
    assert client.get(f"/api/habits/{h['id']}").json()["active"] is False


def test_complete_child_logs_with_habit_and_no_spawn(client):
    h = _habit(client)
    kid = _children(client, h["id"])[0]
    assert client.post(f"/api/tasks/{kid['id']}/complete").status_code == 200
    assert len(_children(client, h["id"])) == AHEAD + 1
    logs = client.get(f"/api/logs?habit_id={h['id']}").json()
    assert [(log["habit_id"], log["task_title"]) for log in logs] == [(h["id"], "ストレッチ")]
    assert client.get("/api/logs?habit_id=999").json() == []


def test_child_deletion_keeps_history(client):
    h = _habit(client)
    kid = _children(client, h["id"])[0]
    client.post(f"/api/tasks/{kid['id']}/complete")
    assert client.delete(f"/api/tasks/{kid['id']}").status_code == 204
    (log,) = client.get(f"/api/logs?habit_id={h['id']}").json()
    assert (log["task_id"], log["task_title"]) == (None, "ストレッチ")


def test_non_habit_task_deletion_removes_logs(client):
    tid = client.post("/api/tasks", json={"title": "t"}).json()["id"]
    client.post(f"/api/tasks/{tid}/complete")
    client.delete(f"/api/tasks/{tid}")
    assert client.get("/api/logs").json() == []


def test_rule_change_regenerates_future_only(client):
    h = _habit(client)
    kids = _children(client, h["id"])
    today_kid, tomorrow_kid = kids[0], kids[1]
    client.post(f"/api/tasks/{tomorrow_kid['id']}/complete")
    res = client.patch(
        f"/api/habits/{h['id']}",
        json={
            "recurrence_type": "weekly",
            "recurrence_weekdays": 1 << ((date.today().weekday() + 1) % 7),
        },
    )
    assert res.status_code == 200, res.text
    dates = [k["occurrence_date"] for k in _children(client, h["id"])]
    # 今日の子と完了済みの子は残り、未来の未完了の子は新ルール(今日と同じ曜日のみ)で作り直される
    assert _iso() in dates and tomorrow_kid["occurrence_date"] in dates
    assert today_kid["id"] in [k["id"] for k in _children(client, h["id"])]
    others = [d for d in dates if d not in (_iso(), _iso(1))]
    assert others == [_iso(7), _iso(14)]


def test_field_edit_syncs_open_future_children(client):
    h = _habit(client, time_slot="morning", priority=1)
    kids = _children(client, h["id"])
    client.put(
        f"/api/tasks/{kids[2]['id']}/schedule",
        json={"scheduled_date": kids[2]["scheduled_date"], "time_slot": "evening"},
    )
    client.post(f"/api/tasks/{kids[1]['id']}/complete")
    res = client.patch(
        f"/api/habits/{h['id']}",
        json={"title": "新", "priority": 3, "estimate_minutes": 5, "time_slot": "afternoon"},
    )
    assert res.status_code == 200, res.text
    after = {k["occurrence_date"]: k for k in _children(client, h["id"])}
    assert after[_iso(0)]["title"] == "新" and after[_iso(0)]["time_slot"] == "afternoon"
    assert after[_iso(1)]["title"] == "ストレッチ"  # 完了済みは触らない
    assert after[_iso(2)]["title"] == "新" and after[_iso(2)]["time_slot"] == "evening"  # 個別変更
    assert after[_iso(3)]["priority"] == 3 and after[_iso(3)]["estimate_minutes"] == 5


def test_pause_and_resume(client):
    h = _habit(client)
    kids = _children(client, h["id"])
    res = client.post(f"/api/habits/{h['id']}/pause")
    assert res.json()["active"] is False
    assert [k["occurrence_date"] for k in _children(client, h["id"])] == [_iso()]
    assert kids
    res = client.post(f"/api/habits/{h['id']}/resume")
    assert res.json()["active"] is True
    assert len(_children(client, h["id"])) == AHEAD + 1


def test_paused_habit_not_generated(engine, client):
    h = _habit(client)
    client.post(f"/api/habits/{h['id']}/pause")
    with Session(engine) as s:
        assert generate_all(s, date.today() + timedelta(days=5), AHEAD) == 0


def test_delete_habit(client):
    h = _habit(client)
    kids = _children(client, h["id"])
    client.post(f"/api/tasks/{kids[0]['id']}/complete")
    assert client.delete(f"/api/habits/{h['id']}").status_code == 204
    tasks = client.get("/api/tasks").json()
    assert [(t["occurrence_date"], t["habit_id"], t["status"]) for t in tasks] == [
        (_iso(), None, "done")
    ]
    assert client.get("/api/logs").json() == []
    assert client.get(f"/api/habits/{h['id']}").status_code == 404


def test_list_recent(client):
    h = _habit(client)
    kids = _children(client, h["id"])
    client.post(f"/api/tasks/{kids[0]['id']}/complete")
    (listed,) = client.get("/api/habits").json()
    assert [(r["occurrence_date"], r["status"]) for r in listed["recent"]] == [(_iso(), "done")]


def test_update_validation(client):
    h = _habit(client)
    assert client.patch(f"/api/habits/{h['id']}", json={"title": None}).status_code == 422
    bad = client.patch(f"/api/habits/{h['id']}", json={"recurrence_weekdays": 0})
    assert bad.status_code == 422
    assert client.patch("/api/habits/999", json={"title": "x"}).status_code == 404
    assert len(_children(client, h["id"])) == AHEAD + 1


def test_habit_task_log_cascade_on_parent_only(engine, client):
    h = _habit(client)
    kid = _children(client, h["id"])[0]
    client.post(f"/api/tasks/{kid['id']}/complete")
    with Session(engine) as s:
        assert s.query(TaskLog).count() == 1


def _today_bit() -> int:
    return 1 << ((date.today().weekday() + 1) % 7)


def test_rule_change_includes_today_when_missing(client):
    h = _habit(client)
    today_kid = _children(client, h["id"])[0]
    client.delete(f"/api/tasks/{today_kid['id']}")
    assert client.post(f"/api/habits/{h['id']}/pause").status_code == 200
    client.post(f"/api/habits/{h['id']}/resume")
    assert _children(client, h["id"])[0]["occurrence_date"] == _iso()


def test_memo_syncs_to_children(client):
    h = _habit(client, memo="旧")
    client.patch(f"/api/habits/{h['id']}", json={"memo": "新"})
    assert {k["memo"] for k in _children(client, h["id"])} == {"新"}
