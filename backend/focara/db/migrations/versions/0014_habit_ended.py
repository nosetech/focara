"""add habits.ended and separate ended from paused

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-13 15:00:00.000000
"""

from datetime import date

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 列の追加は ALTER TABLE ADD COLUMN で行う。batch mode だと habits の再作成(DROP TABLE)で
    # 子タスクの habit_id が SET NULL になってしまう
    op.add_column(
        "habits", sa.Column("ended", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    # 従来は終了条件に達すると active=False にしていたため、一時停止と区別できなかった。
    # 停止中で終了条件に達しているものを、子が全て完了済みなら終了、未完了が残るなら有効に戻す。
    conn = op.get_bind()
    today = date.today().isoformat()
    rows = conn.execute(
        sa.text(
            "SELECT h.id,"
            " (SELECT COUNT(*) FROM tasks t WHERE t.habit_id = h.id) AS total,"
            " (SELECT COUNT(*) FROM tasks t WHERE t.habit_id = h.id"
            "  AND t.status NOT IN ('done', 'cancelled')) AS open_count"
            " FROM habits h WHERE h.active = 0 AND ("
            " (h.recurrence_end_type = 'count' AND"
            "  (SELECT COUNT(*) FROM tasks t WHERE t.habit_id = h.id) >= h.recurrence_end_count)"
            " OR (h.recurrence_end_type = 'date' AND h.recurrence_end_date < :today))"
        ),
        {"today": today},
    ).all()
    for habit_id, total, open_count in rows:
        ended = 1 if total > 0 and open_count == 0 else 0
        conn.execute(
            sa.text("UPDATE habits SET active = 1, ended = :ended WHERE id = :id"),
            {"ended": ended, "id": habit_id},
        )


def downgrade() -> None:
    # 終了した習慣は従来どおり停止中(active=False)として表す
    op.execute("UPDATE habits SET active = 0 WHERE ended = 1")
    op.execute("ALTER TABLE habits DROP COLUMN ended")
