from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from focara.api.deps import SessionDep
from focara.db.models import Task, TaskLog
from focara.recurrence import clear_recurrence, spawn_next
from focara.task_status import InvalidTransition, MissingWaitCondition, transition, validate_waiting

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

Status = Literal["inbox", "next", "someday", "waiting", "habit", "done"]
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
    fixed_end_at: AwareDatetime | None = None
    wait_condition: str | None = None
    wait_until: AwareDatetime | None = None
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


class TaskTransition(BaseModel):
    """ステータス遷移。waiting にする場合は待ち条件または待ち日時を指定する。"""

    status: Status
    wait_condition: str | None = None
    wait_until: AwareDatetime | None = None


class TaskOut(TaskFields):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    status: Status
    project_order: int | None = None
    created_at: datetime
    updated_at: datetime


def _to_columns(values: dict) -> dict:
    return {k: v.isoformat() if k in DATE_FIELDS and v else v for k, v in values.items()}


def _get_or_404(session: Session, task_id: int) -> Task:
    task = session.get(Task, task_id)
    if task is None:
        raise HTTPException(404, "タスクが見つかりません")
    return task


def _check_fixed_range(task: Task) -> None:
    if task.fixed_end_at is None:
        return
    if task.fixed_at is None:
        raise HTTPException(422, "fixed_end_at には fixed_at の指定が必要です")
    if task.fixed_end_at <= task.fixed_at:
        raise HTTPException(422, "fixed_end_at は fixed_at より後にしてください")


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
        # プロジェクト内の並び順(未設定は末尾)
        stmt = stmt.where(Task.project_id == project_id).order_by(None)
        stmt = stmt.order_by(Task.project_order.is_(None), Task.project_order, Task.id)
    if scheduled_date is not None:
        stmt = stmt.where(Task.scheduled_date == scheduled_date.isoformat())
    return list(session.scalars(stmt))


@router.get("/{task_id}", response_model=TaskOut)
def get_task(task_id: int, session: SessionDep) -> Task:
    return _get_or_404(session, task_id)


@router.post("", response_model=TaskOut, status_code=201)
def create_task(body: TaskCreate, session: SessionDep) -> Task:
    task = Task(**_to_columns(body.model_dump()))
    if task.status != "waiting" and (
        task.wait_condition is not None or task.wait_until is not None
    ):
        raise HTTPException(422, "待ち条件は waiting のタスクにのみ指定できます")
    if task.status == "waiting":
        try:
            validate_waiting(task)
        except InvalidTransition as e:
            raise HTTPException(422, str(e)) from e
    _check_fixed_range(task)
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
    new_status = values.pop("status", None)
    if (new_status or task.status) != "waiting" and (
        values.get("wait_condition") is not None or values.get("wait_until") is not None
    ):
        raise HTTPException(422, "待ち条件は waiting のタスクにのみ指定できます")
    if "project_id" in values and values["project_id"] != task.project_id:
        task.project_order = None
    for key, value in _to_columns(values).items():
        setattr(task, key, value)
    try:
        _check_fixed_range(task)
    except HTTPException:
        session.rollback()
        raise
    if new_status is not None and new_status != task.status:
        _transition(session, task, new_status)
        _spawn_if_done(session, task)
    elif task.status == "waiting":
        try:
            validate_waiting(task)
        except InvalidTransition as e:
            raise HTTPException(422, str(e)) from e
    _commit(session)
    return task


def _transition(session: Session, task: Task, new_status: str) -> None:
    try:
        transition(task, new_status)
    except InvalidTransition as e:
        session.rollback()
        raise HTTPException(422 if isinstance(e, MissingWaitCondition) else 409, str(e)) from e


def _spawn_if_done(session: Session, task: Task, note: str | None = None) -> None:
    """タスクが完了したら完了を記録し、繰り返しタスクなら次の回を生成する。"""
    if task.status == "done":
        session.add(TaskLog(task=task, action="completed", note=note))
        spawn_next(session, task)


@router.post("/{task_id}/transition", response_model=TaskOut)
def transition_task(task_id: int, body: TaskTransition, session: SessionDep) -> Task:
    task = _get_or_404(session, task_id)
    # 待ち条件は waiting への遷移時のみ受け付ける
    if body.status == "waiting":
        task.wait_condition = body.wait_condition
        task.wait_until = body.wait_until
    elif body.wait_condition is not None or body.wait_until is not None:
        raise HTTPException(422, "待ち条件は waiting への遷移時のみ指定できます")
    try:
        transition(task, body.status)
    except InvalidTransition as e:
        session.rollback()
        # 必須項目の不足は 422、遷移自体の禁止は 409
        raise HTTPException(422 if isinstance(e, MissingWaitCondition) else 409, str(e)) from e
    _spawn_if_done(session, task)
    _commit(session)
    return task


class RecurrenceRule(BaseModel):
    """繰り返しルールの設定・変更。整合性は DB の制約で検証する。"""

    recurrence_type: RecurrenceType
    recurrence_weekdays: int | None = None
    recurrence_month_day: int | None = None
    recurrence_month: int | None = None
    recurrence_day: int | None = None
    recurrence_end_type: RecurrenceEndType = "none"
    recurrence_end_date: date | None = None
    recurrence_end_count: int | None = None


@router.put("/{task_id}/recurrence", response_model=TaskOut)
def set_recurrence(task_id: int, body: RecurrenceRule, session: SessionDep) -> Task:
    task = _get_or_404(session, task_id)
    if task.status == "done":
        raise HTTPException(409, "完了済みのタスクには繰り返しを設定できません")
    for key, value in _to_columns(body.model_dump()).items():
        setattr(task, key, value)
    _commit(session)
    return task


@router.delete("/{task_id}/recurrence", response_model=TaskOut)
def stop_recurrence(task_id: int, session: SessionDep) -> Task:
    task = _get_or_404(session, task_id)
    clear_recurrence(task)
    _commit(session)
    return task


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, session: SessionDep) -> Response:
    session.delete(_get_or_404(session, task_id))
    session.commit()
    return Response(status_code=204)
