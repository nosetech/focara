from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Response
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from focara.api.deps import SessionDep
from focara.db.models import Task, TaskLog
from focara.habit_generator import slot_for_datetime
from focara.task_status import (
    InvalidTransition,
    MissingWaitCondition,
    NotCancellable,
    transition,
    validate_waiting,
)

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

Status = Literal["inbox", "next", "someday", "waiting", "done", "cancelled"]
TimeSlot = Literal["morning", "afternoon", "evening"]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]

# 日付として保存する列(DB上は YYYY-MM-DD の文字列)
DATE_FIELDS = ("scheduled_date",)


class TaskFields(BaseModel):
    """作成・更新で共通の任意項目。"""

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
    memo: str | None = None


class TaskCreate(TaskFields):
    title: Title
    status: Status = "inbox"


class TaskUpdate(TaskFields):
    """部分更新。指定した項目だけ更新する。"""

    title: Title | None = None
    status: Status | None = None


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
    habit_id: int | None = None
    occurrence_date: date | None = None
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


def sync_slot_with_fixed(task: Task, requested_slot: str | None = None, *, given: bool) -> None:
    """予定時刻(開始)があるタスクの time_slot を、開始時刻から決まる値にそろえる。

    time_slot が明示指定され、開始時刻と食い違う場合は 422 にする(given は指定の有無)。
    """
    if task.fixed_at is None:
        return
    slot = slot_for_datetime(task.fixed_at)
    if given and requested_slot != slot:
        raise HTTPException(
            422, "予定時刻があるタスクの time_slot は、開始時刻から決まります(変更できません)"
        )
    task.time_slot = slot


def _commit(session: Session) -> None:
    try:
        session.commit()
    except IntegrityError as e:
        session.rollback()
        raise HTTPException(422, f"不正な値です(プロジェクト): {e.orig}") from e


@router.get("", response_model=list[TaskOut])
def list_tasks(
    session: SessionDep,
    status: Status | None = None,
    project_id: int | None = None,
    scheduled_date: date | None = None,
    habit_id: int | None = None,
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
    if habit_id is not None:
        stmt = stmt.where(Task.habit_id == habit_id)
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
    sync_slot_with_fixed(task, task.time_slot, given="time_slot" in body.model_fields_set)
    session.add(task)
    _commit(session)
    return task


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(task_id: int, body: TaskUpdate, session: SessionDep) -> Task:
    task = _get_or_404(session, task_id)
    values = body.model_dump(exclude_unset=True)
    # title / status は NULL にできない
    for key in ("title", "status"):
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
        sync_slot_with_fixed(task, values.get("time_slot"), given="time_slot" in values)
    except HTTPException:
        session.rollback()
        raise
    if new_status is not None and new_status != task.status:
        _transition(session, task, new_status)
        log_if_done(session, task)
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
        raise HTTPException(
            422 if isinstance(e, (MissingWaitCondition, NotCancellable)) else 409, str(e)
        ) from e


def add_log(session: Session, task: Task, action: str, note: str | None = None) -> None:
    """完了・後回しを記録する。子タスクは親idも持たせ、子を削除しても履歴が残るようにする。"""
    session.add(
        TaskLog(task=task, habit_id=task.habit_id, task_title=task.title, action=action, note=note)
    )


def log_if_done(session: Session, task: Task, note: str | None = None) -> None:
    """タスクが完了したら完了を記録する(習慣の次の回は定期処理で先行生成済み)。"""
    if task.status == "done":
        add_log(session, task, "completed", note)


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
        raise HTTPException(
            422 if isinstance(e, (MissingWaitCondition, NotCancellable)) else 409, str(e)
        ) from e
    log_if_done(session, task)
    _commit(session)
    return task


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, session: SessionDep) -> Response:
    task = _get_or_404(session, task_id)
    # 習慣由来の履歴は残す。それ以外の記録はタスクと一緒に消す
    session.execute(delete(TaskLog).where(TaskLog.task_id == task.id, TaskLog.habit_id.is_(None)))
    session.delete(task)
    session.commit()
    return Response(status_code=204)
