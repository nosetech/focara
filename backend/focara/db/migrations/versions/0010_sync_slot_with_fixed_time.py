"""予定時刻(fixed_at)があるタスクの time_slot を、開始時刻から決まる値にそろえる

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-12 10:00:00.000000
"""

from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def _slot(hour: int) -> str:
    return "morning" if hour < 12 else "afternoon" if hour < 18 else "evening"


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, fixed_at, time_slot FROM tasks WHERE fixed_at IS NOT NULL")
    ).fetchall()
    for task_id, fixed_at, time_slot in rows:
        # fixed_at は UTC の naive 日時で保存されている。時間帯はサーバーのローカル時刻で判定する
        local = datetime.fromisoformat(str(fixed_at)).replace(tzinfo=UTC).astimezone()
        slot = _slot(local.hour)
        if slot != time_slot:
            conn.execute(
                sa.text("UPDATE tasks SET time_slot = :slot WHERE id = :id"),
                {"slot": slot, "id": task_id},
            )


def downgrade() -> None:
    # 食い違っていた元の枠は復元できない
    pass
