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

TASK_STATUSES = ("inbox", "next", "someday", "waiting", "habit", "done")
TIME_SLOTS = ("morning", "afternoon", "evening")
TASK_LOG_ACTIONS = ("completed", "postponed")
RECURRENCE_TYPES = ("weekly", "monthly", "yearly")
RECURRENCE_END_TYPES = ("none", "date", "count")
PROPERTY_TYPES = ("string", "number", "date")


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
        CheckConstraint(
            "recurrence_type IS NULL OR " + _in("recurrence_type", RECURRENCE_TYPES),
            name="recurrence_type",
        ),
        CheckConstraint(
            _in("recurrence_end_type", RECURRENCE_END_TYPES), name="recurrence_end_type"
        ),
        # 週次は曜日ビットマスク必須、月次は日にち必須、年次は月日必須。他タイプの項目は NULL
        CheckConstraint(
            "COALESCE((recurrence_type IS NULL AND recurrence_weekdays IS NULL"
            " AND recurrence_month_day IS NULL AND recurrence_month IS NULL"
            " AND recurrence_day IS NULL AND recurrence_end_type = 'none')"
            " OR (recurrence_type = 'weekly' AND recurrence_weekdays BETWEEN 1 AND 127"
            " AND recurrence_month_day IS NULL AND recurrence_month IS NULL"
            " AND recurrence_day IS NULL)"
            " OR (recurrence_type = 'monthly' AND recurrence_weekdays IS NULL"
            " AND (recurrence_month_day BETWEEN 1 AND 31 OR recurrence_month_day = -1)"
            " AND recurrence_month IS NULL AND recurrence_day IS NULL)"
            " OR (recurrence_type = 'yearly' AND recurrence_weekdays IS NULL"
            " AND recurrence_month_day IS NULL AND recurrence_month BETWEEN 1 AND 12"
            " AND recurrence_day BETWEEN 1 AND 31), 0)",
            name="recurrence_fields",
        ),
        # 終了条件: 日付なら終了日、回数なら1以上の回数が必須。他は NULL
        CheckConstraint(
            "COALESCE((recurrence_end_type = 'none' AND recurrence_end_date IS NULL"
            " AND recurrence_end_count IS NULL)"
            " OR (recurrence_end_type = 'date' AND recurrence_end_date IS NOT NULL"
            " AND recurrence_end_count IS NULL)"
            " OR (recurrence_end_type = 'count' AND recurrence_end_date IS NULL"
            " AND recurrence_end_count >= 1), 0)",
            name="recurrence_end_fields",
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
    # プロジェクト内の並び順(小さいほど先頭。NULL は末尾)
    project_order: Mapped[int | None] = mapped_column(Integer)
    priority: Mapped[int | None] = mapped_column(Integer)
    estimate_minutes: Mapped[int | None] = mapped_column(Integer)
    # 予定日(日付 YYYY-MM-DD。ユーザーのローカル日付)と時間帯・実行順
    scheduled_date: Mapped[str | None] = mapped_column(String(10))
    time_slot: Mapped[str | None] = mapped_column(String)
    run_order: Mapped[int | None] = mapped_column(Integer)
    # 日時が決まっている予定(UTC)
    fixed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    fixed_end_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    # 条件待ち: 待ち条件(相手の名前・メモ)と、待ち日時(UTC。経過すると next に戻る)
    wait_condition: Mapped[str | None] = mapped_column(Text)
    wait_until: Mapped[datetime | None] = mapped_column(UTCDateTime)
    # 繰り返し設定。タイプ(週次/月次/年次)ごとに使う項目が異なる
    recurrence_type: Mapped[str | None] = mapped_column(String)
    # 週次: 曜日のビットマスク(bit0=日, bit1=月, ... bit6=土)。複数選択可
    recurrence_weekdays: Mapped[int | None] = mapped_column(Integer)
    # 月次: 1〜31 の日にち、-1 は月末。その日がない月は月末に実行する
    recurrence_month_day: Mapped[int | None] = mapped_column(Integer)
    # 年次: 月(1〜12)と日(1〜31。2/29 を許容)
    recurrence_month: Mapped[int | None] = mapped_column(Integer)
    recurrence_day: Mapped[int | None] = mapped_column(Integer)
    # 終了条件(共通): none=設定なし / date=終了日(YYYY-MM-DD) / count=繰り返す回数
    recurrence_end_type: Mapped[str] = mapped_column(
        String, nullable=False, default="none", server_default="none"
    )
    recurrence_end_date: Mapped[str | None] = mapped_column(String(10))
    recurrence_end_count: Mapped[int | None] = mapped_column(Integer)
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
    __table_args__ = (
        CheckConstraint(_in("value_type", PROPERTY_TYPES), name="value_type"),
        # 単位を持てるのは数値プロパティのみ
        CheckConstraint("unit IS NULL OR value_type = 'number'", name="unit"),
        Index("uq_task_properties_task_id_key", "task_id", "key", unique=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    key: Mapped[str] = mapped_column(String, nullable=False)
    value: Mapped[str | None] = mapped_column(Text)
    # 種別。value は常に文字列で保存し、number は数値、date は YYYY-MM-DD として検証済み
    value_type: Mapped[str] = mapped_column(
        String, nullable=False, default="string", server_default="string"
    )
    unit: Mapped[str | None] = mapped_column(String)

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
