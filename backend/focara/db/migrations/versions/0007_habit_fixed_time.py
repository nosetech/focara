"""add habits.fixed_start_time / fixed_end_time

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-05 10:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

FIXED_TIME = (
    "COALESCE((fixed_start_time IS NULL AND fixed_end_time IS NULL)"
    " OR ((fixed_start_time GLOB '[01][0-9]:[0-5][0-9]'"
    " OR fixed_start_time GLOB '2[0-3]:[0-5][0-9]')"
    " AND (fixed_end_time IS NULL"
    " OR ((fixed_end_time GLOB '[01][0-9]:[0-5][0-9]'"
    " OR fixed_end_time GLOB '2[0-3]:[0-5][0-9]')"
    " AND fixed_end_time > fixed_start_time))), 0)"
)


def upgrade() -> None:
    with op.batch_alter_table("habits", schema=None) as batch_op:
        batch_op.add_column(sa.Column("fixed_start_time", sa.String(length=5), nullable=True))
        batch_op.add_column(sa.Column("fixed_end_time", sa.String(length=5), nullable=True))
        batch_op.create_check_constraint(op.f("ck_habits_fixed_time"), FIXED_TIME)


def downgrade() -> None:
    with op.batch_alter_table("habits", schema=None) as batch_op:
        batch_op.drop_constraint(op.f("ck_habits_fixed_time"), type_="check")
        batch_op.drop_column("fixed_end_time")
        batch_op.drop_column("fixed_start_time")
