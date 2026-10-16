from datetime import UTC, datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    TypeDecorator,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from focara.db.base import Base

TASK_STATUSES = ("inbox", "next", "someday", "waiting", "habit")
TIME_SLOTS = ("morning", "afternoon", "evening")
TASK_LOG_ACTIONS = ("completed", "postponed")


class UTCDateTime(TypeDecorator):
    """日時を UTC で保存する。timezone なしの値は拒否し、取り出し時は UTC の aware にする。"""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("timezone 付きの datetime を指定してください")
        return value.astimezone(UTC).replace(tzinfo=None)

    def process_result_value(self, value, dialect):
        return None if value is None else value.replace(tzinfo=UTC)


def _now() -> datetime:
    return datetime.now(UTC)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=_now, onupdate=_now, nullable=False
    )

    tasks: Mapped[list["Task"]] = relationship(back_populates="project")


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint(_in("status", TASK_STATUSES), name="status"),
        CheckConstraint(
            "time_slot IS NULL OR " + _in("time_slot", TIME_SLOTS),
            name="time_slot",
        ),
        Index(
            "ix_tasks_scheduled_date_time_slot_run_order",
            "scheduled_date",
            "time_slot",
            "run_order",
        ),
        Index("ix_tasks_status", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="inbox")
    project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), index=True
    )
    priority: Mapped[int | None] = mapped_column(Integer)
    estimate_minutes: Mapped[int | None] = mapped_column(Integer)
    # 予定日(日付 YYYY-MM-DD。ユーザーのローカル日付)と時間帯・実行順
    scheduled_date: Mapped[str | None] = mapped_column(String(10))
    time_slot: Mapped[str | None] = mapped_column(String)
    run_order: Mapped[int | None] = mapped_column(Integer)
    # 日時が決まっている予定(UTC)
    fixed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    wait_condition: Mapped[str | None] = mapped_column(Text)
    recurrence: Mapped[str | None] = mapped_column(Text)
    memo: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=_now, onupdate=_now, nullable=False
    )

    project: Mapped[Project | None] = relationship(back_populates="tasks")
    properties: Mapped[list["TaskProperty"]] = relationship(
        back_populates="task", cascade="all, delete-orphan"
    )
    logs: Mapped[list["TaskLog"]] = relationship(
        back_populates="task", cascade="all, delete-orphan"
    )


class TaskProperty(Base):
    __tablename__ = "task_properties"
    __table_args__ = (Index("uq_task_properties_task_id_key", "task_id", "key", unique=True),)

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    key: Mapped[str] = mapped_column(String, nullable=False)
    value: Mapped[str | None] = mapped_column(Text)

    task: Mapped[Task] = relationship(back_populates="properties")


class TaskLog(Base):
    """完了・後回しの記録。"""

    __tablename__ = "task_logs"
    __table_args__ = (
        CheckConstraint(_in("action", TASK_LOG_ACTIONS), name="action"),
        Index("ix_task_logs_task_id_created_at", "task_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    action: Mapped[str] = mapped_column(String, nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now, nullable=False)

    task: Mapped[Task] = relationship(back_populates="logs")
