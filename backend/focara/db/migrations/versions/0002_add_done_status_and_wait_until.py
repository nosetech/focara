"""add done status and wait_until

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-18 10:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

OLD = "status IN ('inbox', 'next', 'someday', 'waiting', 'habit')"
NEW = "status IN ('inbox', 'next', 'someday', 'waiting', 'habit', 'done')"


def upgrade() -> None:
    with op.batch_alter_table("tasks", schema=None) as batch_op:
        batch_op.add_column(sa.Column("wait_until", sa.DateTime(), nullable=True))
        batch_op.drop_constraint(op.f("ck_tasks_status"), type_="check")
        batch_op.create_check_constraint(op.f("ck_tasks_status"), NEW)


def downgrade() -> None:
    op.execute("UPDATE tasks SET status = 'next' WHERE status = 'done'")
    with op.batch_alter_table("tasks", schema=None) as batch_op:
        batch_op.drop_constraint(op.f("ck_tasks_status"), type_="check")
        batch_op.create_check_constraint(op.f("ck_tasks_status"), OLD)
        batch_op.drop_column("wait_until")
