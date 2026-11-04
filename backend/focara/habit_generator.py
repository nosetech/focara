"""習慣(親)から子タスクを先行生成し、親の編集に子を同期させる。"""

import logging
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from focara.db.models import Habit, HabitProperty, Task, TaskProperty
from focara.recurrence import next_occurrence

# 実績として残す(未完了ではない)ステータス
CLOSED = ("done", "cancelled")


def _iso(d: date) -> str:
    return d.isoformat()


def slot_for_time(hhmm: str) -> str:
    """開始時刻(HH:MM)から時間帯を決める(フロントの currentSlot と同じ境界)。"""
    hour = int(hhmm[:2])
    return "morning" if hour < 12 else "afternoon" if hour < 18 else "evening"


def fixed_datetime(day: date | str, hhmm: str | None) -> datetime | None:
    """実施日と HH:MM(サーバーのローカル時刻)から UTC の日時を作る。"""
    if hhmm is None:
        return None
    d = date.fromisoformat(day) if isinstance(day, str) else day
    local = datetime.combine(d, time.fromisoformat(hhmm)).astimezone()
    return local.astimezone(UTC)


def _child_property(p: HabitProperty) -> TaskProperty:
    return TaskProperty(key=p.key, value=None, value_type=p.value_type, unit=p.unit)


def generate_children(session: Session, habit: Habit, today: date, ahead_days: int) -> int:
    """今日〜今日+ahead_days の子を、generated_until の翌日から生成して件数を返す。

    unique(habit_id, occurrence_date) により再実行しても重複せず、ユーザーが削除した子は
    generated_until を過ぎているため復活しない。停止中に過ぎた日は遡って作らない。
    終了条件(date 超過 / count 到達)を満たしたら active=False にする。commit は呼び出し側。
    """
    if not habit.active:
        return 0
    end = today + timedelta(days=ahead_days)
    start = max(today, date.fromisoformat(habit.start_date))
    if habit.generated_until:
        start = max(start, date.fromisoformat(habit.generated_until) + timedelta(days=1))
    existing = set(session.scalars(select(Task.occurrence_date).where(Task.habit_id == habit.id)))
    total = len(existing)
    end_date = (
        date.fromisoformat(habit.recurrence_end_date)
        if habit.recurrence_end_type == "date"
        else None
    )
    created = 0
    finished = False
    d = next_occurrence(habit, start - timedelta(days=1))
    while d <= end:
        if end_date is not None and d > end_date:
            finished = True
            break
        if habit.recurrence_end_type == "count" and total >= habit.recurrence_end_count:
            finished = True
            break
        if _iso(d) not in existing:
            session.add(
                Task(
                    title=habit.title,
                    status="next",
                    project_id=habit.project_id,
                    priority=habit.priority,
                    estimate_minutes=habit.estimate_minutes,
                    memo=habit.memo,
                    scheduled_date=_iso(d),
                    time_slot=habit.time_slot,
                    fixed_at=fixed_datetime(d, habit.fixed_start_time),
                    fixed_end_at=fixed_datetime(d, habit.fixed_end_time),
                    habit_id=habit.id,
                    occurrence_date=_iso(d),
                    # プロパティは名前だけ引き継ぎ、値は子ごとに入力する
                    properties=[_child_property(p) for p in habit.properties],
                )
            )
            total += 1
            created += 1
        d = next_occurrence(habit, d)
    if not finished:
        # 次の候補が終了条件を超えているなら終了
        if end_date is not None and d > end_date:
            finished = True
        elif habit.recurrence_end_type == "count" and total >= habit.recurrence_end_count:
            finished = True
    habit.generated_until = _iso(end)
    if finished:
        habit.active = False
    session.flush()
    return created


def generate_all(session: Session, today: date, ahead_days: int) -> int:
    """有効な全習慣の子を生成する(起動時・日付変更時の定期処理)。"""
    habits = list(session.scalars(select(Habit).where(Habit.active.is_(True))))
    created = 0
    for habit in habits:
        # 1件の失敗で他の習慣の生成を止めないよう、習慣ごとにコミット・ロールバックする
        try:
            created += generate_children(session, habit, today, ahead_days)
            session.commit()
        except Exception:  # noqa: BLE001
            session.rollback()
            logging.getLogger(__name__).exception(
                "習慣(id=%s)の子タスク生成に失敗しました", habit.id
            )
    return created


def _future_open_children(habit_id: int, today: date, *, include_today: bool):
    day = _iso(today)
    cond = Task.scheduled_date >= day if include_today else Task.scheduled_date > day
    return (
        select(Task)
        .where(Task.habit_id == habit_id, Task.status.notin_(CLOSED), cond)
        .execution_options(populate_existing=True)
    )


def regenerate_future_children(session: Session, habit: Habit, today: date, ahead_days: int) -> int:
    """ルール・開始日の変更時: 今日より後の未完了の子を削除して再生成する。"""
    for child in session.scalars(_future_open_children(habit.id, today, include_today=False)):
        session.delete(child)
    session.flush()
    # 今日までに生成済みの範囲を基準に、今日の翌日から作り直す
    habit.generated_until = _iso(today - timedelta(days=1))  # 今日の分も対象にする
    return generate_children(session, habit, today, ahead_days)


def sync_fields_to_children(
    session: Session,
    habit: Habit,
    today: date,
    changed: dict[str, object],
    old_time_slot: str | None,
    old_start: str | None = None,
    old_end: str | None = None,
) -> None:
    """タイトル・見積・優先度・プロジェクトを今日以降の未完了の子へ反映する。

    既定枠・予定時刻は、旧い既定値のままの子にだけ反映する(個別変更した子は触らない)。
    """
    shared = {
        k: v
        for k, v in changed.items()
        if k in ("title", "estimate_minutes", "priority", "project_id", "memo")
    }
    for child in session.scalars(_future_open_children(habit.id, today, include_today=True)):
        for key, value in shared.items():
            setattr(child, key, value)
        if "time_slot" in changed and child.time_slot == old_time_slot:
            child.time_slot = changed["time_slot"]
        if "fixed_start_time" in changed or "fixed_end_time" in changed:
            _sync_fixed(child, habit, old_start, old_end)


def _sync_fixed(child: Task, habit: Habit, old_start: str | None, old_end: str | None) -> None:
    day = child.scheduled_date
    if day is None:
        return
    # 子の時刻が旧い既定値のままのときだけ、親の新しい時刻にする
    if child.fixed_at != fixed_datetime(day, old_start):
        return
    if child.fixed_end_at != fixed_datetime(day, old_end):
        return
    child.fixed_at = fixed_datetime(day, habit.fixed_start_time)
    child.fixed_end_at = fixed_datetime(day, habit.fixed_end_time)


def sync_properties_to_children(
    session: Session, habit: Habit, today: date, old: list[tuple[str, str, str | None]]
) -> None:
    """プロパティ項目の変更を今日以降の未完了の子へ反映する。

    追加した項目は値なしで追加し、削除した項目は値が空の子だけ削除する(入力済みは残す)。
    種別・単位を変えた項目は、値が空の子だけ変更する。名前の変更は削除+追加として扱う。
    """
    new = {p.key: (p.value_type, p.unit) for p in habit.properties}
    old_map = {k: (t, u) for k, t, u in old}
    if new == old_map:
        return
    for child in session.scalars(_future_open_children(habit.id, today, include_today=True)):
        for prop in list(child.properties):
            empty = prop.value is None or prop.value == ""
            if prop.key not in new:
                if prop.key in old_map and empty:
                    child.properties.remove(prop)
            elif empty and (prop.value_type, prop.unit) != new[prop.key]:
                prop.value_type, prop.unit = new[prop.key]
        have = {p.key for p in child.properties}
        for hp in habit.properties:
            if hp.key not in have:
                child.properties.append(_child_property(hp))


def remove_future_children(session: Session, habit: Habit, today: date) -> None:
    """一時停止・削除時: 未来(今日より後)で未完了の子を削除する。"""
    session.execute(
        delete(Task).where(
            Task.habit_id == habit.id, Task.status.notin_(CLOSED), Task.scheduled_date > _iso(today)
        )
    )


def resume(session: Session, habit: Habit, today: date, ahead_days: int) -> int:
    """再開: 未来の子を作り直す。"""
    habit.active = True
    return regenerate_future_children(session, habit, today, ahead_days)


def auto_cancel_overdue(session: Session, today: date) -> int:
    """auto_cancel_overdue が ON の習慣について、予定日が今日より前の未完了の子を cancelled にする。

    待ち条件はクリアする。再実行しても対象は未完了の子だけなので冪等。commit は呼び出し側。
    """
    children = session.scalars(
        select(Task)
        .join(Habit, Task.habit_id == Habit.id)
        .where(
            Habit.auto_cancel_overdue.is_(True),
            Task.status.notin_(CLOSED),
            Task.scheduled_date < _iso(today),
        )
    ).all()
    for child in children:
        child.status = "cancelled"
        child.wait_condition = None
        child.wait_until = None
    session.flush()
    return len(children)
