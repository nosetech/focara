import sqlite3
from datetime import UTC, datetime, timedelta, timezone

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError, StatementError
from sqlalchemy.orm import Session

from focara.db import create_db_engine, upgrade_db
from focara.db.base import Base
from focara.db.models import Habit, Project, Task, TaskLog, TaskProperty


@pytest.fixture
def engine(tmp_path):
    e = create_db_engine(tmp_path / "sub" / "focara.db")
    upgrade_db(e)
    yield e
    e.dispose()


def test_creates_db_file_and_all_tables(tmp_path):
    path = tmp_path / "data" / "focara.db"
    e = create_db_engine(path)
    upgrade_db(e)
    assert path.is_file()
    names = set(inspect(e).get_table_names())
    assert {"projects", "tasks", "task_properties", "task_logs"} <= names
    e.dispose()


def test_upgrade_is_idempotent(engine):
    upgrade_db(engine)


def test_models_match_migrations(engine):
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={"compare_type": True})
        assert compare_metadata(ctx, Base.metadata) == []


def test_drift_is_detected(engine):
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE tasks ADD COLUMN extra TEXT"))
    with engine.connect() as conn:
        ctx = MigrationContext.configure(conn, opts={"compare_type": True})
        assert compare_metadata(ctx, Base.metadata) != []


def test_connection_pragmas(engine):
    with engine.connect() as conn:
        assert conn.execute(text("PRAGMA journal_mode")).scalar() == "wal"
        assert conn.execute(text("PRAGMA foreign_keys")).scalar() == 1
        assert conn.execute(text("PRAGMA busy_timeout")).scalar() == 5000


def test_constraints_and_cascade(engine):
    with Session(engine) as s:
        t = Task(title="a")
        t.properties.append(TaskProperty(key="weight", value="60"))
        t.logs.append(TaskLog(action="completed", task_title="a"))
        s.add(t)
        s.commit()
        assert t.status == "inbox"
        s.delete(t)
        s.commit()
        assert s.query(TaskProperty).count() == 0
        # 履歴は子(タスク)を削除しても残る
        assert s.query(TaskLog).one().task_id is None

    with Session(engine) as s:
        s.add(Task(title="x", status="bogus"))
        with pytest.raises(IntegrityError):
            s.commit()

    with Session(engine) as s:
        s.add(Task(title="x", project_id=999))
        with pytest.raises(IntegrityError):
            s.commit()


def test_project_delete_nullifies_task_project(engine):
    with Session(engine) as s:
        p = Project(name="p")
        t = Task(title="a", project=p)
        s.add(t)
        s.commit()
        s.delete(p)
        s.commit()
        s.refresh(t)
        assert t.project_id is None


def test_datetime_stored_as_utc(engine):
    jst = timezone(timedelta(hours=9))
    with Session(engine) as s:
        s.add(Task(title="a", fixed_at=datetime(2026, 1, 1, 9, 0, tzinfo=jst)))
        s.commit()
        t = s.query(Task).one()
        assert t.fixed_at == datetime(2026, 1, 1, 0, 0, tzinfo=UTC)
        assert t.created_at.tzinfo is UTC
        with pytest.raises(StatementError):
            s.add(Task(title="b", fixed_at=datetime(2026, 1, 1)))
            s.flush()
    raw = sqlite3.connect(engine.url.database).execute("SELECT fixed_at FROM tasks").fetchone()[0]
    assert raw.startswith("2026-01-01 00:00:00")


def _habit(**fields):
    return Habit(title="r", start_date="2026-01-01", **fields)


@pytest.mark.parametrize(
    "fields",
    [
        {"recurrence_type": "weekly", "recurrence_weekdays": 0b0101010},
        {"recurrence_type": "weekly", "recurrence_weekdays": 127},
        {"recurrence_type": "monthly", "recurrence_month_day": 31},
        {"recurrence_type": "monthly", "recurrence_month_day": -1},
        {"recurrence_type": "yearly", "recurrence_month": 2, "recurrence_day": 29},
        {
            "recurrence_type": "weekly",
            "recurrence_weekdays": 127,
            "recurrence_end_type": "date",
            "recurrence_end_date": "2026-12-31",
        },
        {
            "recurrence_type": "monthly",
            "recurrence_month_day": 1,
            "recurrence_end_type": "count",
            "recurrence_end_count": 10,
        },
    ],
)
def test_valid_recurrence(engine, fields):
    with Session(engine) as s:
        s.add(_habit(**fields))
        s.commit()


@pytest.mark.parametrize(
    "fields",
    [
        {"recurrence_type": "daily"},
        {"recurrence_type": "weekly"},
        {"recurrence_type": "weekly", "recurrence_weekdays": 0},
        {"recurrence_type": "weekly", "recurrence_weekdays": 128},
        {"recurrence_type": "weekly", "recurrence_weekdays": 1, "recurrence_month_day": 1},
        {"recurrence_type": "monthly", "recurrence_month_day": 0},
        {"recurrence_type": "monthly", "recurrence_month_day": 32},
        {"recurrence_type": "yearly", "recurrence_month": 13, "recurrence_day": 1},
        {"recurrence_type": "yearly", "recurrence_month": 1},
        {"recurrence_type": "weekly", "recurrence_weekdays": 1, "recurrence_end_type": "date"},
        {
            "recurrence_type": "weekly",
            "recurrence_weekdays": 1,
            "recurrence_end_type": "date",
            "recurrence_end_date": "2026-12-31",
            "recurrence_end_count": 3,
        },
        {
            "recurrence_type": "weekly",
            "recurrence_weekdays": 1,
            "recurrence_end_type": "count",
            "recurrence_end_count": 0,
        },
        {"recurrence_type": "weekly", "recurrence_weekdays": 1, "recurrence_end_type": "forever"},
    ],
)
def test_invalid_recurrence(engine, fields):
    with Session(engine) as s:
        s.add(_habit(**fields))
        with pytest.raises(IntegrityError):
            s.commit()


def test_habit_child_unique_and_set_null(engine):
    with Session(engine) as s:
        h = _habit(recurrence_type="weekly", recurrence_weekdays=127)
        s.add(h)
        s.flush()
        s.add(Task(title="c", habit_id=h.id, occurrence_date="2026-01-02", status="next"))
        s.commit()
        s.add(Task(title="d", habit_id=h.id, occurrence_date="2026-01-02", status="next"))
        with pytest.raises(IntegrityError):
            s.commit()
        s.rollback()
        # 親を削除すると子は habit_id=NULL で残り、履歴は消える
        s.add(TaskLog(task=s.query(Task).one(), habit_id=h.id, task_title="c", action="completed"))
        s.commit()
        s.delete(h)
        s.commit()
        assert s.query(Task).one().habit_id is None
        assert s.query(TaskLog).count() == 0


def test_habit_status_rejected(engine):
    with Session(engine) as s:
        s.add(Task(title="x", status="habit"))
        with pytest.raises(IntegrityError):
            s.commit()


def test_migration_0006_keeps_existing_data(tmp_path):
    e = create_db_engine(tmp_path / "m.db")
    upgrade_db(e, "0005")
    with e.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO tasks (id, title, status, recurrence_end_type, created_at, updated_at)"
                " VALUES (1, 'a', 'habit', 'none', '2026-01-01', '2026-01-01')"
            )
        )
        conn.execute(text("INSERT INTO task_properties (task_id, key) VALUES (1, 'k')"))
        conn.execute(
            text(
                "INSERT INTO task_logs (task_id, action, created_at)"
                " VALUES (1, 'completed', '2026-01-01')"
            )
        )
    upgrade_db(e)
    with Session(e) as s:
        assert s.query(Task).one().status == "next"
        log = s.query(TaskLog).one()
        assert (log.task_id, log.task_title) == (1, "a")
        assert s.query(TaskProperty).one().key == "k"
    e.dispose()


def test_migration_0010_syncs_slot_with_fixed_at(tmp_path):
    engine = create_db_engine(tmp_path / "m.db")
    upgrade_db(engine, "0009")
    local = datetime(2026, 10, 20, 14, 0).astimezone().astimezone(UTC)
    with engine.begin() as c:
        c.execute(
            text(
                "INSERT INTO tasks (title, status, time_slot, fixed_at, created_at, updated_at)"
                " VALUES (:t, 'next', :s, :f, '2026-10-01 00:00:00', '2026-10-01 00:00:00')"
            ),
            [
                {"t": "a", "s": "morning", "f": local.replace(tzinfo=None).isoformat(sep=" ")},
                {"t": "b", "s": "evening", "f": None},
            ],
        )
    upgrade_db(engine, "0010")
    with engine.connect() as c:
        rows = dict(c.execute(text("SELECT title, time_slot FROM tasks")).fetchall())
    assert rows == {"a": "afternoon", "b": "evening"}
