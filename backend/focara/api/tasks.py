from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from focara.api.deps import SessionDep
from focara.db.models import Task

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

Status = Literal["inbox", "next", "someday", "waiting", "habit"]
TimeSlot = Literal["morning", "afternoon", "evening"]
RecurrenceType = Literal["weekly", "monthly", "yearly"]
RecurrenceEndType = Literal["none", "date", "count"]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]

# 日付として保存する列(DB上は YYYY-MM-DD の文字列)
DATE_FIELDS = ("scheduled_date", "recurrence_end_date")


class TaskFields(BaseModel):
    """作成・更新で共通の任意項目。繰り返し設定の整合性は DB の制約で検証する。"""

    project_id: int | None = None
    priority: int | None = None
    estimate_minutes: int | None = Field(default=None, ge=0)
    scheduled_date: date | None = None
    time_slot: TimeSlot | None = None
    run_order: int | None = None
    fixed_at: AwareDatetime | None = None
    wait_condition: str | None = None
    recurrence_type: RecurrenceType | None = None
    recurrence_weekdays: int | None = None
    recurrence_month_day: int | None = None
    recurrence_month: int | None = None
    recurrence_day: int | None = None
    recurrence_end_type: RecurrenceEndType = "none"
    recurrence_end_date: date | None = None
    recurrence_end_count: int | None = None
    memo: str | None = None


class TaskCreate(TaskFields):
    title: Title
    status: Status = "inbox"


class TaskUpdate(TaskFields):
    """部分更新。指定した項目だけ更新する。"""

    title: Title | None = None
    status: Status | None = None
    recurrence_end_type: RecurrenceEndType | None = None


class TaskOut(TaskFields):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    status: Status
    created_at: datetime
    updated_at: datetime


def _to_columns(values: dict) -> dict:
    return {k: v.isoformat() if k in DATE_FIELDS and v else v for k, v in values.items()}


def _get_or_404(session: Session, task_id: int) -> Task:
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(404, "タスクが見つかりません")
    return task


def _commit(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError as e:
        session.rollback()
        raise HTTPException(422, f"不正な値です(プロジェクトまたは繰り返し設定): {e.orig}") from e


@router.get("", response_model=list[TaskOut])
def list_tasks(
    session: SessionDep,
    status: Status | None = None,
    project_id: int | None = None,
    scheduled_date: date | None = None,
) -> list[Task]:
    stmt = select(Task).order_by(Task.id)
    if status is not None:
        stmt = stmt.where(Task.status == status)
    if project_id is not None:
        stmt = stmt.where(Task.project_id == project_id)
    if scheduled_date is not None:
        stmt = stmt.where(Task.scheduled_date == scheduled_date.isoformat())
    return list(session.scalars(stmt))


@router.get("/{task_id}", response_model=TaskOut)
def get_task(task_id: int, session: SessionDep) -> Task:
    return _get_or_404(session, task_id)


@router.post("", response_model=TaskOut, status_code=201)
def create_task(body: TaskCreate, session: SessionDep) -> Task:
    task = Task(**_to_columns(body.model_dump()))
    session.add(task)
    _commit(session)
    return task


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, body: TaskUpdate, session: SessionDep) -> Task:
    task = _get_or_404(session, task_id)
    values = body.model_dump(exclude_unset=True)
    # title / status / recurrence_end_type は NULL にできない
    for key in ("title", "status", "recurrence_end_type"):
        if key in values and values[key] is None:
            raise HTTPException(422, f"{key} は null にできません")
    for key, value in _to_columns(values).items():
        setattr(task, key, value)
    _commit(session)
    return task


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, session: SessionDep) -> Response:
    session.delete(_get_or_404(session, task_id))
    session.commit()
    return Response(status_code=204)
