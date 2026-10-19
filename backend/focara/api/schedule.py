from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import AwareDatetime, BaseModel, model_validator
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from focara.api.deps import SessionDep
from focara.api.tasks import TaskOut, TimeSlot, _check_fixed_range, _commit, _get_or_404
from focara.db.models import TIME_SLOTS, Task

router = APIRouter(prefix="/api", tags=["schedule"])


class ScheduleAssign(BaseModel):
    """日付・時間帯への割り当て。run_order 省略時は枠の末尾に並べる。"""

    scheduled_date: date
    time_slot: TimeSlot
    run_order: int | None = None
    fixed_at: AwareDatetime | None = None
    fixed_end_at: AwareDatetime | None = None


class ReorderBody(BaseModel):
    """同じ日付・時間帯のタスクを、指定した順に並べ替える。"""

    scheduled_date: date
    time_slot: TimeSlot
    task_ids: list[int]

    @model_validator(mode="after")
    def _unique(self):
        if len(set(self.task_ids)) != len(self.task_ids):
            raise ValueError("task_ids に重複があります")
        return self


def _slot_tasks(session: Session, day: date, slot: str) -> list[Task]:
    stmt = (
        select(Task)
        .where(Task.scheduled_date == day.isoformat(), Task.time_slot == slot)
        .order_by(Task.run_order.is_(None), Task.run_order, Task.id)
    )
    return list(session.scalars(stmt))


@router.put("/tasks/{task_id}/schedule", response_model=TaskOut)
def assign_schedule(task_id: int, body: ScheduleAssign, session: SessionDep) -> Task:
    task = _get_or_404(session, task_id)
    if body.run_order is None:
        last = session.scalar(
            select(func.max(Task.run_order)).where(
                Task.scheduled_date == body.scheduled_date.isoformat(),
                Task.time_slot == body.time_slot,
                Task.id != task.id,
            )
        )
        run_order = 0 if last is None else last + 1
    else:
        run_order = body.run_order
    task.scheduled_date = body.scheduled_date.isoformat()
    task.time_slot = body.time_slot
    task.run_order = run_order
    task.fixed_at = body.fixed_at
    task.fixed_end_at = body.fixed_end_at
    try:
        _check_fixed_range(task)
    except HTTPException:
        session.rollback()
        raise
    _commit(session)
    return task


@router.delete("/tasks/{task_id}/schedule", response_model=TaskOut)
def unassign_schedule(task_id: int, session: SessionDep) -> Task:
    task = _get_or_404(session, task_id)
    task.scheduled_date = task.time_slot = task.run_order = None
    task.fixed_at = task.fixed_end_at = None
    _commit(session)
    return task


@router.get("/schedule", response_model=list[TaskOut])
def list_day(session: SessionDep, date: date, include_done: bool = False) -> list[Task]:
    """指定日のタスクを、時間帯(朝→昼→夜)→実行順で返す。時間帯未設定は末尾。"""
    slot_rank = case({s: i for i, s in enumerate(TIME_SLOTS)}, value=Task.time_slot, else_=99)
    stmt = (
        select(Task)
        .where(Task.scheduled_date == date.isoformat())
        .order_by(slot_rank, Task.run_order.is_(None), Task.run_order, Task.id)
    )
    if not include_done:
        stmt = stmt.where(Task.status != "done")
    return list(session.scalars(stmt))


@router.put("/schedule/order", response_model=list[TaskOut])
def reorder(body: ReorderBody, session: SessionDep) -> list[Task]:
    tasks = _slot_tasks(session, body.scheduled_date, body.time_slot)
    by_id = {t.id: t for t in tasks}
    if set(body.task_ids) != set(by_id):
        raise HTTPException(
            422, "task_ids は指定した日付・時間帯の全タスクを過不足なく含めてください"
        )
    for i, tid in enumerate(body.task_ids):
        by_id[tid].run_order = i
    _commit(session)
    return [by_id[tid] for tid in body.task_ids]
