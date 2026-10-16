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
from focara.db.models import Project, Task, TaskLog, TaskProperty


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
        t.logs.append(TaskLog(action="completed"))
        s.add(t)
        s.commit()
        assert t.status == "inbox"
        s.delete(t)
        s.commit()
        assert s.query(TaskProperty).count() == 0
        assert s.query(TaskLog).count() == 0

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
