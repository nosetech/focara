"""add habit_properties.value_type / unit

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-05 12:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("habit_properties", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("value_type", sa.String(), server_default="string", nullable=False)
        )
        batch_op.add_column(sa.Column("unit", sa.String(), nullable=True))
        batch_op.create_check_constraint(
            op.f("ck_habit_properties_value_type"),
            "value_type IN ('string', 'number', 'date')",
        )
        batch_op.create_check_constraint(
            op.f("ck_habit_properties_unit"), "unit IS NULL OR value_type = 'number'"
        )


def downgrade() -> None:
    with op.batch_alter_table("habit_properties", schema=None) as batch_op:
        batch_op.drop_constraint(op.f("ck_habit_properties_unit"), type_="check")
        batch_op.drop_constraint(op.f("ck_habit_properties_value_type"), type_="check")
        batch_op.drop_column("unit")
        batch_op.drop_column("value_type")
