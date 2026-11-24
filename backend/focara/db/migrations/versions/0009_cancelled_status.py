"""add cancelled status and habits.auto_cancel_overdue

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-05 15:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

OLD = "status IN ('inbox', 'next', 'someday', 'waiting', 'done')"
NEW = "status IN ('inbox', 'next', 'someday', 'waiting', 'done', 'cancelled')"


def _recreate_tasks(check: str) -> None:
    # tasks の再作成(batch mode の DROP TABLE)で子テーブルの行が CASCADE / SET NULL の影響を
    # 受けるため、退避してから戻す(0006 と同じ。トランザクション内では PRAGMA を切り替えられない)
    op.execute("CREATE TABLE _bak_task_properties AS SELECT * FROM task_properties")
    op.execute("CREATE TABLE _bak_task_logs AS SELECT * FROM task_logs")
    with op.batch_alter_table("tasks", schema=None) as batch_op:
        batch_op.drop_constraint(op.f("ck_tasks_status"), type_="check")
        batch_op.create_check_constraint(op.f("ck_tasks_status"), check)
    op.execute("DELETE FROM task_properties")
    op.execute("DELETE FROM task_logs")
    op.execute("INSERT INTO task_properties SELECT * FROM _bak_task_properties")
    op.execute("INSERT INTO task_logs SELECT * FROM _bak_task_logs")
    op.execute("DROP TABLE _bak_task_properties")
    op.execute("DROP TABLE _bak_task_logs")


def upgrade() -> None:
    with op.batch_alter_table("habits", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "auto_cancel_overdue", sa.Boolean(), server_default=sa.false(), nullable=False
            )
        )
    _recreate_tasks(NEW)


def downgrade() -> None:
    op.execute("UPDATE tasks SET status = 'next' WHERE status = 'cancelled'")
    _recreate_tasks(OLD)
    with op.batch_alter_table("habits", schema=None) as batch_op:
        batch_op.drop_column("auto_cancel_overdue")
