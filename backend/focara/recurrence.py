"""繰り返しタスク: 次回日付の算出と、完了時の次の回の生成。"""

import calendar
from datetime import date, timedelta

from sqlalchemy.orm import Session

from focara.db.models import Task, TaskProperty

RECURRENCE_COLUMNS = (
    "recurrence_type",
    "recurrence_weekdays",
    "recurrence_month_day",
    "recurrence_month",
    "recurrence_day",
    "recurrence_end_date",
    "recurrence_end_count",
)


def _clamp_day(year: int, month: int, day: int) -> date:
    """その日がない月は月末に寄せる(月次の -1 は月末)。"""
    last = calendar.monthrange(year, month)[1]
    return date(year, month, last if day == -1 else min(day, last))


def next_occurrence(task: Task, after: date) -> date:
    """繰り返しルールに従い、after より後で最初の日付を返す。"""
    if task.recurrence_type == "weekly":
        mask = task.recurrence_weekdays
        for i in range(1, 8):
            d = after + timedelta(days=i)
            if mask >> ((d.weekday() + 1) % 7) & 1:  # bit0=日 ... bit6=土
                return d
    elif task.recurrence_type == "monthly":
        year, month = after.year, after.month
        while True:
            d = _clamp_day(year, month, task.recurrence_month_day)
            if d > after:
                return d
            year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    elif task.recurrence_type == "yearly":
        year = after.year
        while True:
            d = _clamp_day(year, task.recurrence_month, task.recurrence_day)
            if d > after:
                return d
            year += 1
    raise ValueError("繰り返しが設定されていません")


def clear_recurrence(task: Task) -> None:
    for column in RECURRENCE_COLUMNS:
        setattr(task, column, None)
    task.recurrence_end_type = "none"


def spawn_next(session: Session, task: Task, today: date | None = None) -> Task | None:
    """完了した繰り返しタスクの次の回を作る(終了条件を満たす場合は作らない)。

    次回日付は、予定日と完了日のうち遅い方より後で最初の該当日。
    完了が遅れた場合は、過ぎた回を飛ばして未来の日付にする。
    繰り返し設定は次の回へ移し、完了した回からは外す(再完了で重複生成しないため)。
    """
    if task.recurrence_type is None:
        return None
    today = today or date.today()
    base = today
    if task.scheduled_date:
        base = max(base, date.fromisoformat(task.scheduled_date))
    nxt = next_occurrence(task, base)

    end_count = task.recurrence_end_count
    if task.recurrence_end_type == "count":
        # 回数は完了した回を含めた総回数。残りが無ければ生成しない
        if end_count <= 1:
            clear_recurrence(task)
            return None
        end_count -= 1
    elif task.recurrence_end_type == "date" and nxt > date.fromisoformat(task.recurrence_end_date):
        clear_recurrence(task)
        return None

    new = Task(
        title=task.title,
        status="habit",
        project_id=task.project_id,
        priority=task.priority,
        estimate_minutes=task.estimate_minutes,
        scheduled_date=nxt.isoformat(),
        time_slot=task.time_slot,
        recurrence_end_type=task.recurrence_end_type,
        **{c: getattr(task, c) for c in RECURRENCE_COLUMNS},
    )
    new.recurrence_end_count = end_count
    # プロパティは名前だけ引き継ぎ、値は引き継がない
    new.properties = [TaskProperty(key=p.key, value=None) for p in task.properties]
    session.add(new)
    clear_recurrence(task)
    return new
