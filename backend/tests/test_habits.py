from datetime import UTC, date, datetime, time, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from focara.api.deps import get_config, get_engine
from focara.config import Config, HabitConfig
from focara.db import create_db_engine, upgrade_db
from focara.db.models import Habit, Task, TaskLog
from focara.habit_generator import (
    auto_cancel_overdue,
    carry_over_overdue,
    generate_all,
    generate_children,
)
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
    assert [p["key"] for p in h["properties"]] == ["体重", "回数"]
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


def test_memo_sync_skips_individually_edited_child(client):
    h = _habit(client, memo="旧")
    kids = _children(client, h["id"])
    client.patch(f"/api/tasks/{kids[0]['id']}", json={"memo": "個別"})
    client.patch(f"/api/habits/{h['id']}", json={"memo": "新"})
    memos = [k["memo"] for k in _children(client, h["id"])]
    assert memos[0] == "個別"
    assert set(memos[1:]) == {"新"}


def test_memo_added_to_habit_without_memo(client):
    h = _habit(client)
    client.patch(f"/api/habits/{h['id']}", json={"memo": "新"})
    assert {k["memo"] for k in _children(client, h["id"])} == {"新"}


def test_memo_sync_skips_child_whose_memo_was_cleared(client):
    h = _habit(client, memo="旧")
    kids = _children(client, h["id"])
    client.patch(f"/api/tasks/{kids[0]['id']}", json={"memo": None})
    client.patch(f"/api/habits/{h['id']}", json={"memo": "新"})
    memos = [k["memo"] for k in _children(client, h["id"])]
    assert memos[0] is None
    assert set(memos[1:]) == {"新"}


def _local_utc(day: str, hhmm: str) -> datetime:
    return datetime.combine(date.fromisoformat(day), time.fromisoformat(hhmm)).astimezone(UTC)


def _fixed(k: dict) -> tuple[datetime | None, datetime | None]:
    f = lambda v: datetime.fromisoformat(v) if v else None  # noqa: E731
    return f(k["fixed_at"]), f(k["fixed_end_at"])


def test_fixed_time_applies_to_children_with_slot(client):
    h = _habit(client, fixed_start_time="14:30", fixed_end_time="15:00", time_slot="morning")
    assert (h["fixed_start_time"], h["fixed_end_time"], h["time_slot"]) == (
        "14:30",
        "15:00",
        "afternoon",
    )
    for k in _children(client, h["id"]):
        day = k["occurrence_date"]
        assert _fixed(k) == (_local_utc(day, "14:30"), _local_utc(day, "15:00"))
        assert k["time_slot"] == "afternoon"


def test_fixed_start_only(client):
    h = _habit(client, fixed_start_time="07:00")
    k = _children(client, h["id"])[0]
    assert _fixed(k) == (_local_utc(k["occurrence_date"], "07:00"), None)
    assert k["time_slot"] == "morning"


@pytest.mark.parametrize(
    "body",
    [
        {"fixed_end_time": "10:00"},
        {"fixed_start_time": "10:00", "fixed_end_time": "10:00"},
        {"fixed_start_time": "11:00", "fixed_end_time": "10:00"},
        {"fixed_start_time": "25:00"},
        {"fixed_start_time": "9:00"},
    ],
)
def test_fixed_time_invalid_rejected(client, body):
    res = client.post("/api/habits", json={"title": "x", **DAILY, **body})
    assert res.status_code == 422


def test_fixed_time_update_validation(client):
    h = _habit(client, fixed_start_time="10:00", fixed_end_time="11:00")
    assert (
        client.patch(f"/api/habits/{h['id']}", json={"fixed_start_time": None}).status_code == 422
    )
    assert (
        client.patch(f"/api/habits/{h['id']}", json={"fixed_end_time": "09:00"}).status_code == 422
    )


def test_fixed_time_change_syncs_only_default_children(client):
    h = _habit(client, fixed_start_time="09:00", fixed_end_time="10:00")
    kids = _children(client, h["id"])
    own = kids[2]
    client.put(
        f"/api/tasks/{own['id']}/schedule",
        json={
            "scheduled_date": own["scheduled_date"],
            "time_slot": "evening",
            "fixed_at": _local_utc(own["scheduled_date"], "19:00").isoformat(),
        },
    )
    client.post(f"/api/tasks/{kids[1]['id']}/complete")
    res = client.patch(
        f"/api/habits/{h['id']}", json={"fixed_start_time": "13:00", "fixed_end_time": None}
    )
    assert res.status_code == 200, res.text
    assert res.json()["time_slot"] == "afternoon"
    after = {k["occurrence_date"]: k for k in _children(client, h["id"])}
    assert _fixed(after[_iso(0)]) == (_local_utc(_iso(0), "13:00"), None)
    assert after[_iso(0)]["time_slot"] == "afternoon"
    assert _fixed(after[_iso(1)]) == (_local_utc(_iso(1), "09:00"), _local_utc(_iso(1), "10:00"))
    assert _fixed(after[_iso(2)])[0] == _local_utc(_iso(2), "19:00")
    assert after[_iso(2)]["time_slot"] == "evening"
    assert _fixed(after[_iso(3)]) == (_local_utc(_iso(3), "13:00"), None)


def test_property_keys_sync_to_children(client):
    h = _habit(client, properties=["体重", "回数"])
    kids = _children(client, h["id"])
    filled, done = kids[1], kids[2]
    props = client.get(f"/api/tasks/{filled['id']}/properties").json()
    weight = next(p for p in props if p["key"] == "体重")
    res = client.patch(f"/api/tasks/{filled['id']}/properties/{weight['id']}", json={"value": "60"})
    assert res.status_code == 200, res.text
    client.post(f"/api/tasks/{done['id']}/complete")

    res = client.patch(f"/api/habits/{h['id']}", json={"properties": ["回数", "メモ"]})
    assert res.status_code == 200, res.text
    assert [p["key"] for p in res.json()["properties"]] == ["回数", "メモ"]

    def keys(task_id: int) -> list[str]:
        return sorted(p["key"] for p in client.get(f"/api/tasks/{task_id}/properties").json())

    assert keys(kids[0]["id"]) == ["メモ", "回数"]  # 追加・削除(空のもの)
    assert keys(filled["id"]) == ["メモ", "体重", "回数"]  # 値入りは残す
    assert keys(done["id"]) == ["体重", "回数"]  # 完了済みは触らない


def test_property_reorder_keeps_order(client):
    h = _habit(client, properties=["a", "b"])
    res = client.patch(f"/api/habits/{h['id']}", json={"properties": ["b", "a"]})
    assert res.status_code == 200, res.text
    assert [p["key"] for p in res.json()["properties"]] == ["b", "a"]


def test_property_types_and_units_inherited_and_synced(client):
    h = _habit(
        client,
        properties=[
            {"key": "体重", "value_type": "number", "unit": "kg"},
            {"key": "日付", "value_type": "date"},
            "メモ",
        ],
    )
    assert h["properties"] == [
        {"key": "体重", "value_type": "number", "unit": "kg"},
        {"key": "日付", "value_type": "date", "unit": None},
        {"key": "メモ", "value_type": "string", "unit": None},
    ]
    kids = _children(client, h["id"])

    def props(task_id: int) -> dict:
        rows = client.get(f"/api/tasks/{task_id}/properties").json()
        return {p["key"]: (p["value_type"], p["unit"], p["value"]) for p in rows}

    assert props(kids[0]["id"]) == {
        "体重": ("number", "kg", None),
        "日付": ("date", None, None),
        "メモ": ("string", None, None),
    }
    # 値が入った子の項目は、種別・単位を変えても触らない
    weight = next(
        p for p in client.get(f"/api/tasks/{kids[1]['id']}/properties").json() if p["key"] == "体重"
    )
    assert (
        client.patch(
            f"/api/tasks/{kids[1]['id']}/properties/{weight['id']}", json={"value": "60"}
        ).status_code
        == 200
    )
    res = client.patch(
        f"/api/habits/{h['id']}",
        json={"properties": [{"key": "体重", "value_type": "number", "unit": "g"}]},
    )
    assert res.status_code == 200, res.text
    assert props(kids[0]["id"]) == {"体重": ("number", "g", None)}
    assert props(kids[1]["id"])["体重"] == ("number", "kg", "60")


def test_property_unit_only_for_number(client):
    res = client.post(
        "/api/habits",
        json={"title": "x", **DAILY, "properties": [{"key": "a", "unit": "kg"}]},
    )
    assert res.status_code == 422
    res = client.post(
        "/api/habits",
        json={"title": "x", **DAILY, "properties": [{"key": "a", "value_type": "bad"}]},
    )
    assert res.status_code == 422


def _cancel(client, task_id: int):
    return client.post(f"/api/tasks/{task_id}/transition", json={"status": "cancelled"})


def test_cancel_child_and_restore(client):
    h = _habit(client)
    kid = _children(client, h["id"])[0]
    res = _cancel(client, kid["id"])
    assert res.status_code == 200
    assert res.json()["status"] == "cancelled"
    # done <-> cancelled の直接遷移は不可、cancelled -> next は可
    assert (
        client.post(f"/api/tasks/{kid['id']}/transition", json={"status": "done"}).status_code
        == 409
    )
    res = client.post(f"/api/tasks/{kid['id']}/transition", json={"status": "next"})
    assert res.json()["status"] == "next"
    client.post(f"/api/tasks/{kid['id']}/complete")
    assert _cancel(client, kid["id"]).status_code == 409


def test_cancel_clears_wait_condition(client):
    h = _habit(client)
    kid = _children(client, h["id"])[0]
    client.post(
        f"/api/tasks/{kid['id']}/transition",
        json={"status": "waiting", "wait_condition": "返事待ち"},
    )
    res = _cancel(client, kid["id"]).json()
    assert (res["status"], res["wait_condition"], res["wait_until"]) == ("cancelled", None, None)


def test_cancel_normal_task_rejected(client):
    tid = client.post("/api/tasks", json={"title": "x"}).json()["id"]
    assert _cancel(client, tid).status_code == 422
    res = client.patch(f"/api/tasks/{tid}", json={"status": "cancelled"})
    assert res.status_code == 422
    assert client.get(f"/api/tasks/{tid}").json()["status"] == "inbox"


def test_cancelled_child_excluded_from_schedule_and_postpone(client):
    h = _habit(client)
    kid = _children(client, h["id"])[0]
    _cancel(client, kid["id"])
    ids = [t["id"] for t in client.get(f"/api/schedule?date={_iso()}").json()]
    assert kid["id"] not in ids
    ids = [t["id"] for t in client.get(f"/api/schedule?date={_iso()}&include_done=true").json()]
    assert kid["id"] in ids
    assert client.post(f"/api/tasks/{kid['id']}/postpone", json={}).status_code == 409


def test_recent_includes_cancelled(client):
    h = _habit(client)
    kid = _children(client, h["id"])[0]
    _cancel(client, kid["id"])
    (listed,) = client.get("/api/habits").json()
    assert [(r["occurrence_date"], r["status"]) for r in listed["recent"]] == [
        (_iso(), "cancelled")
    ]


def test_delete_habit_keeps_cancelled_child(client):
    h = _habit(client)
    kids = _children(client, h["id"])
    _cancel(client, kids[0]["id"])
    assert client.delete(f"/api/habits/{h['id']}").status_code == 204
    tasks = client.get("/api/tasks").json()
    assert [(t["occurrence_date"], t["habit_id"], t["status"]) for t in tasks] == [
        (_iso(), None, "cancelled")
    ]


def test_auto_cancel_overdue(engine, client):
    on = _habit(client, auto_cancel_overdue=True)
    off = _habit(client, title="off")
    assert on["auto_cancel_overdue"] is True and off["auto_cancel_overdue"] is False
    tomorrow = date.today() + timedelta(days=1)
    with Session(engine) as s:
        # 当日分(今日)は対象外、昨日以前が対象
        s.add(
            Task(
                title="old",
                status="next",
                habit_id=on["id"],
                occurrence_date=_iso(-3),
                scheduled_date=_iso(-3),
            )
        )
        s.add(
            Task(
                title="old-off",
                status="next",
                habit_id=off["id"],
                occurrence_date=_iso(-3),
                scheduled_date=_iso(-3),
            )
        )
        s.commit()
        assert auto_cancel_overdue(s, tomorrow) == 2  # on の昨日(=今日)分 + -3 日の分
        s.commit()
        assert auto_cancel_overdue(s, tomorrow) == 0  # 冪等
        by = {(t.habit_id, t.scheduled_date): t.status for t in s.query(Task)}
    assert by[(on["id"], _iso(-3))] == "cancelled"
    assert by[(on["id"], _iso())] == "cancelled"
    assert by[(on["id"], _iso(1))] == "next"
    assert by[(off["id"], _iso(-3))] == "next"
    assert by[(off["id"], _iso())] == "next"


def test_auto_cancel_skips_today(engine, client):
    h = _habit(client, auto_cancel_overdue=True)
    with Session(engine) as s:
        assert auto_cancel_overdue(s, date.today()) == 0
        assert s.query(Task).filter_by(habit_id=h["id"], status="cancelled").count() == 0


def test_auto_cancel_flag_editable(client):
    h = _habit(client)
    res = client.patch(f"/api/habits/{h['id']}", json={"auto_cancel_overdue": True})
    assert res.json()["auto_cancel_overdue"] is True
    assert (
        client.patch(f"/api/habits/{h['id']}", json={"auto_cancel_overdue": None}).status_code
        == 422
    )


def test_progress_excludes_cancelled_habit_child(client):
    pid = client.post("/api/projects", json={"name": "a"}).json()["id"]
    hid = _habit(client, project_id=pid)["id"]
    kids = client.get("/api/tasks", params={"habit_id": hid}).json()
    before = client.get(f"/api/projects/{pid}").json()["task_count"]
    client.post(f"/api/tasks/{kids[0]['id']}/transition", json={"status": "cancelled"})
    assert client.get(f"/api/projects/{pid}").json()["task_count"] == before - 1


def _t(habit_id, offset, **kw):
    return Task(
        title="t",
        status=kw.pop("status", "next"),
        habit_id=habit_id,
        occurrence_date=_iso(offset),
        scheduled_date=_iso(offset),
        **kw,
    )


def test_carry_over_overdue(engine, client):
    off = _habit(client, title="off")
    on = _habit(client, title="on", auto_cancel_overdue=True)
    fixed = datetime(2020, 1, 1, tzinfo=UTC)
    with Session(engine) as s:
        # 今日・同じ枠に既存の子(run_order 0..1)
        today_child = s.query(Task).filter_by(habit_id=off["id"], occurrence_date=_iso()).one()
        today_child.time_slot, today_child.run_order = "morning", 1
        old3 = _t(
            off["id"], -3, time_slot="morning", run_order=0, fixed_at=fixed, fixed_end_at=fixed
        )
        old1 = _t(off["id"], -1, time_slot="morning", run_order=0)
        done = _t(off["id"], -2, status="done")
        canc = _t(off["id"], -4, status="cancelled")
        on_old = _t(on["id"], -2)
        s.add_all([old3, old1, done, canc, on_old])
        s.commit()
        assert carry_over_overdue(s, date.today()) == 2
        s.commit()
        assert carry_over_overdue(s, date.today()) == 0  # 冪等
        s.refresh(old3), s.refresh(old1)
        assert old3.scheduled_date == old1.scheduled_date == _iso()
        assert (old3.run_order, old1.run_order) == (2, 3)  # 古い順に枠の末尾へ
        assert old3.fixed_at is None and old3.fixed_end_at is None
        assert old3.occurrence_date == _iso(-3)
        assert done.scheduled_date == _iso(-2) and canc.scheduled_date == _iso(-4)
        assert on_old.scheduled_date == _iso(-2)
        # 繰り越した日の occurrence_date の子は再生成されない
        generate_children(s, s.get(Habit, off["id"]), date.today(), AHEAD)
        assert s.query(Task).filter_by(habit_id=off["id"], occurrence_date=_iso(-3)).count() == 1


def test_duration_property_inherited_by_children(client):
    h = _habit(client, properties=[{"key": "作業時間", "value_type": "duration"}])
    assert h["properties"] == [{"key": "作業時間", "value_type": "duration", "unit": None}]
    kid = _children(client, h["id"])[0]
    rows = client.get(f"/api/tasks/{kid['id']}/properties").json()
    assert [(p["key"], p["value_type"], p["value"]) for p in rows] == [
        ("作業時間", "duration", None)
    ]
    res = client.patch(
        f"/api/tasks/{kid['id']}/properties/{rows[0]['id']}", json={"value": "00:30:00"}
    )
    assert res.json()["value"] == "1800"
    bad = client.post(
        "/api/habits",
        json={
            "title": "x",
            **DAILY,
            "properties": [{"key": "a", "value_type": "duration", "unit": "分"}],
        },
    )
    assert bad.status_code == 422
