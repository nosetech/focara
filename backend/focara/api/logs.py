from datetime import date, datetime, time, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from focara.api.deps import SessionDep
from focara.api.tasks import (
    Task,
    TaskOut,
    TimeSlot,
    _commit,
    _get_or_404,
    _spawn_if_done,
    _transition,
)
from focara.db.models import TaskLog

router = APIRouter(prefix="/api", tags=["logs"])

LogAction = Literal["completed", "postponed"]
PostponeTarget = Literal["end_of_day", "tomorrow", "date"]


class CompleteBody(BaseModel):
    note: str | None = None


class PostponeBody(BaseModel):
    """後回し先。end_of_day=その日の末尾(夜枠の最後) / tomorrow=翌日 / date=指定日。

    翌日・指定日では time_slot を省略すると現在の時間帯(未設定なら朝)を使い、枠の末尾に並べる。
    """

    target: PostponeTarget = "tomorrow"
    scheduled_date: date | None = None
    time_slot: TimeSlot | None = None
    note: str | None = None


class TaskLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: int
    task_title: str
    action: LogAction
    note: str | None
    created_at: datetime


def _to_out(log: TaskLog) -> TaskLogOut:
    return TaskLogOut(
        id=log.id,
        task_id=log.task_id,
        task_title=log.task.title,
        action=log.action,
        note=log.note,
        created_at=log.created_at,
    )


@router.post("/tasks/{task_id}/complete", response_model=TaskOut)
def complete_task(task_id: int, session: SessionDep, body: CompleteBody | None = None) -> Task:
    """完了にして記録を残す。繰り返しタスクは次の回を生成する。"""
    task = _get_or_404(session, task_id)
    _transition(session, task, "done")
    _spawn_if_done(session, task, body.note if body else None)
    _commit(session)
    return task


@router.post("/tasks/{task_id}/postpone", response_model=TaskOut)
def postpone_task(task_id: int, body: PostponeBody, session: SessionDep) -> Task:
    """予定日・時間帯・実行順を付け替えて、後回しの記録を残す。"""
    task = _get_or_404(session, task_id)
    if task.status == "done":
        raise HTTPException(409, "完了済みのタスクは後回しにできません")
    current = date.fromisoformat(task.scheduled_date) if task.scheduled_date else date.today()
    if body.target == "date":
        if body.scheduled_date is None:
            raise HTTPException(422, "target=date には scheduled_date が必要です")
        day = body.scheduled_date
    elif body.target == "tomorrow":
        day = current + timedelta(days=1)
    else:
        day = current
    slot = body.time_slot or ("evening" if body.target == "end_of_day" else task.time_slot)
    slot = slot or "morning"
    last = session.scalar(
        select(Task.run_order)
        .where(Task.scheduled_date == day.isoformat(), Task.time_slot == slot, Task.id != task.id)
        .order_by(Task.run_order.desc())
        .limit(1)
    )
    task.scheduled_date = day.isoformat()
    task.time_slot = slot
    task.run_order = 0 if last is None else last + 1
    # 日時固定の予定は移動後は意味を持たないため外す
    task.fixed_at = task.fixed_end_at = None
    session.add(TaskLog(task=task, action="postponed", note=body.note))
    _commit(session)
    return task


def _local_start(day: date) -> datetime:
    return datetime.combine(day, time.min).astimezone()


@router.get("/logs", response_model=list[TaskLogOut])
def list_logs(
    session: SessionDep,
    from_date: date | None = None,
    to_date: date | None = None,
    action: LogAction | None = None,
) -> list[TaskLogOut]:
    """日付範囲(ローカル日付、両端含む)の完了・後回しの記録を新しい順に返す。"""
    if from_date and to_date and from_date > to_date:
        raise HTTPException(422, "from_date は to_date 以前にしてください")
    stmt = select(TaskLog).order_by(TaskLog.created_at.desc(), TaskLog.id.desc())
    if from_date is not None:
        stmt = stmt.where(TaskLog.created_at >= _local_start(from_date))
    if to_date is not None:
        stmt = stmt.where(TaskLog.created_at < _local_start(to_date + timedelta(days=1)))
    if action is not None:
        stmt = stmt.where(TaskLog.action == action)
    return [_to_out(log) for log in session.scalars(stmt)]
