"""タスクのステータス遷移ルールと、条件待ちタスクの自動復帰。"""

from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from focara.db.models import Task


class InvalidTransition(ValueError):
    """許可されていないステータス遷移、または遷移に必要な項目の不足。"""


# done は完了済み。やり直す場合は next にだけ戻せる。それ以外は相互に遷移できる。
_ACTIVE = {"inbox", "next", "someday", "waiting", "habit"}
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    **{s: (_ACTIVE - {s}) | {"done"} for s in _ACTIVE},
    "done": {"next"},
}


def validate_waiting(task: Task) -> None:
    if not (task.wait_condition or "").strip() and task.wait_until is None:
        raise InvalidTransition(
            "waiting には待ち条件(wait_condition)または待ち日時(wait_until)が必要です"
        )


def transition(task: Task, new_status: str) -> None:
    """task のステータスを変更する。待ち条件の項目は呼び出し側で先に設定しておく。"""
    old = task.status
    if new_status not in ALLOWED_TRANSITIONS.get(old, set()):
        raise InvalidTransition(f"{old} から {new_status} へは遷移できません")
    task.status = new_status
    if new_status == "waiting":
        validate_waiting(task)
    elif old == "waiting":
        task.wait_condition = None
        task.wait_until = None


def release_due_waiting(session: Session, now: datetime | None = None) -> int:
    """待ち日時を過ぎた waiting タスクを next に戻し、戻した件数を返す。"""
    now = now or datetime.now(UTC)
    ids = list(
        session.scalars(select(Task.id).where(Task.status == "waiting", Task.wait_until <= now))
    )
    if ids:
        session.execute(
            update(Task)
            .where(Task.id.in_(ids))
            .values(status="next", wait_condition=None, wait_until=None, updated_at=now)
        )
    session.commit()
    return len(ids)
