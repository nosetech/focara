from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from focara.api.deps import ConfigDep, SessionDep
from focara.db.models import Habit, HabitProperty, Task
from focara.habit_generator import (
    generate_children,
    regenerate_future_children,
    remove_future_children,
    resume,
    sync_fields_to_children,
)

router = APIRouter(prefix="/api/habits", tags=["habits"])

TimeSlot = Literal["morning", "afternoon", "evening"]
RecurrenceType = Literal["weekly", "monthly", "yearly"]
RecurrenceEndType = Literal["none", "date", "count"]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]

# ルール・開始日の変更は、未来の子を作り直す
RULE_FIELDS = (
    "recurrence_type",
    "recurrence_weekdays",
    "recurrence_month_day",
    "recurrence_month",
    "recurrence_day",
    "recurrence_end_type",
    "recurrence_end_date",
    "recurrence_end_count",
    "start_date",
)
# 子へ反映する項目
SYNC_FIELDS = ("title", "estimate_minutes", "priority", "project_id", "memo", "time_slot")
RECENT_COUNT = 7


class HabitFields(BaseModel):
    project_id: int | None = None
    priority: int | None = None
    estimate_minutes: int | None = Field(default=None, ge=0)
    memo: str | None = None
    time_slot: TimeSlot | None = None
    recurrence_weekdays: int | None = None
    recurrence_month_day: int | None = None
    recurrence_month: int | None = None
    recurrence_day: int | None = None
    recurrence_end_date: date | None = None
    recurrence_end_count: int | None = None


class HabitCreate(HabitFields):
    title: Title
    recurrence_type: RecurrenceType
    recurrence_end_type: RecurrenceEndType = "none"
    start_date: date | None = None  # 省略時は今日
    properties: list[str] = []


class HabitUpdate(HabitFields):
    """部分更新。指定した項目だけ更新する。"""

    title: Title | None = None
    recurrence_type: RecurrenceType | None = None
    recurrence_end_type: RecurrenceEndType | None = None
    start_date: date | None = None
    properties: list[str] | None = None


class Occurrence(BaseModel):
    task_id: int
    occurrence_date: date
    status: str


class HabitOut(HabitFields):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    recurrence_type: RecurrenceType
    recurrence_end_type: RecurrenceEndType
    start_date: date
    active: bool
    generated_until: date | None = None
    properties: list[str] = []
    # 直近の実施状況(今日以前の子を新しい順に最大7件)
    recent: list[Occurrence] = []
    created_at: datetime
    updated_at: datetime


def _to_out(session: Session, habit: Habit) -> HabitOut:
    columns = {c.key: getattr(habit, c.key) for c in Habit.__table__.columns}
    out = HabitOut.model_validate(columns)
    out.properties = [p.key for p in habit.properties]
    rows = session.execute(
        select(Task.id, Task.occurrence_date, Task.status)
        .where(Task.habit_id == habit.id, Task.occurrence_date <= date.today().isoformat())
        .order_by(Task.occurrence_date.desc())
        .limit(RECENT_COUNT)
    )
    out.recent = [Occurrence(task_id=i, occurrence_date=d, status=s) for i, d, s in rows]
    return out


def _get_or_404(session: Session, habit_id: int) -> Habit:
    habit = session.get(Habit, habit_id)
    if habit is None:
        raise HTTPException(404, "習慣が見つかりません")
    return habit


def _columns(values: dict) -> dict:
    return {k: v.isoformat() if isinstance(v, date) else v for k, v in values.items()}


def _unique_keys(keys: list[str]) -> list[str]:
    keys = [k.strip() for k in keys]
    if any(not k for k in keys):
        raise HTTPException(422, "プロパティ名は空にできません")
    return list(dict.fromkeys(keys))


def _commit(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError as e:
        session.rollback()
        raise HTTPException(422, f"不正な値です(プロジェクトまたは繰り返し設定): {e.orig}") from e


@router.get("", response_model=list[HabitOut])
def list_habits(session: SessionDep) -> list[HabitOut]:
    return [_to_out(session, h) for h in session.scalars(select(Habit).order_by(Habit.id))]


@router.get("/{habit_id}", response_model=HabitOut)
def get_habit(habit_id: int, session: SessionDep) -> HabitOut:
    return _to_out(session, _get_or_404(session, habit_id))


@router.post("", response_model=HabitOut, status_code=201)
def create_habit(body: HabitCreate, session: SessionDep, cfg: ConfigDep) -> HabitOut:
    values = body.model_dump(exclude={"properties", "start_date"})
    today = date.today()
    habit = Habit(**_columns(values), start_date=(body.start_date or today).isoformat())
    habit.properties = [HabitProperty(key=k) for k in _unique_keys(body.properties)]
    session.add(habit)
    # CHECK 制約違反は flush で検出する(生成前に不正なルールを弾く)
    try:
        session.flush()
    except IntegrityError as e:
        session.rollback()
        raise HTTPException(422, f"不正な値です(プロジェクトまたは繰り返し設定): {e.orig}") from e
    generate_children(session, habit, today, cfg.habit.generate_ahead_days)
    _commit(session)
    return _to_out(session, habit)


@router.patch("/{habit_id}", response_model=HabitOut)
def update_habit(habit_id: int, body: HabitUpdate, session: SessionDep, cfg: ConfigDep) -> HabitOut:
    habit = _get_or_404(session, habit_id)
    values = body.model_dump(exclude_unset=True)
    for key in ("title", "recurrence_type", "recurrence_end_type", "start_date"):
        if key in values and values[key] is None:
            raise HTTPException(422, f"{key} は null にできません")
    keys = values.pop("properties", None)
    old_time_slot = habit.time_slot
    changed = {k: v for k, v in values.items() if getattr(habit, k) != _columns({k: v})[k]}
    for key, value in _columns(values).items():
        setattr(habit, key, value)
    if keys is not None:
        habit.properties = [HabitProperty(key=k) for k in _unique_keys(keys)]
    try:
        session.flush()
    except IntegrityError as e:
        session.rollback()
        raise HTTPException(422, f"不正な値です(プロジェクトまたは繰り返し設定): {e.orig}") from e
    today = date.today()
    sync = {k: v for k, v in changed.items() if k in SYNC_FIELDS}
    if sync:
        sync_fields_to_children(session, habit, today, sync, old_time_slot)
    if any(k in changed for k in RULE_FIELDS):
        regenerate_future_children(session, habit, today, cfg.habit.generate_ahead_days)
    _commit(session)
    return _to_out(session, habit)


@router.post("/{habit_id}/pause", response_model=HabitOut)
def pause_habit(habit_id: int, session: SessionDep) -> HabitOut:
    """一時停止: 未来の未完了の子を削除し、生成を止める。"""
    habit = _get_or_404(session, habit_id)
    habit.active = False
    remove_future_children(session, habit, date.today())
    _commit(session)
    return _to_out(session, habit)


@router.post("/{habit_id}/resume", response_model=HabitOut)
def resume_habit(habit_id: int, session: SessionDep, cfg: ConfigDep) -> HabitOut:
    habit = _get_or_404(session, habit_id)
    resume(session, habit, date.today(), cfg.habit.generate_ahead_days)
    _commit(session)
    return _to_out(session, habit)


@router.delete("/{habit_id}", status_code=204)
def delete_habit(habit_id: int, session: SessionDep) -> Response:
    """削除: 未来の未完了の子は削除し、過去・完了済みは habit_id=NULL で残す。"""
    habit = _get_or_404(session, habit_id)
    remove_future_children(session, habit, date.today())
    session.flush()
    session.delete(habit)
    session.commit()
    return Response(status_code=204)
