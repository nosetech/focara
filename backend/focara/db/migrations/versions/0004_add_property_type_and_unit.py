"""add task_properties value_type and unit

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-19 11:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("task_properties", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("value_type", sa.String(), nullable=False, server_default="string")
        )
        batch_op.add_column(sa.Column("unit", sa.String(), nullable=True))
        batch_op.create_check_constraint("value_type", "value_type IN ('string', 'number', 'date')")
        batch_op.create_check_constraint("unit", "unit IS NULL OR value_type = 'number'")


def downgrade() -> None:
    with op.batch_alter_table("task_properties", schema=None) as batch_op:
        batch_op.drop_constraint("ck_task_properties_unit", type_="check")
        batch_op.drop_constraint("ck_task_properties_value_type", type_="check")
        batch_op.drop_column("unit")
        batch_op.drop_column("value_type")
