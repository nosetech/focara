"""add 'duration' to property value_type

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-12 12:00:00.000000
"""

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

_OLD = "value_type IN ('string', 'number', 'date')"
_NEW = "value_type IN ('string', 'number', 'date', 'duration')"


def _swap(table: str, condition: str) -> None:
    with op.batch_alter_table(table, schema=None) as batch_op:
        batch_op.drop_constraint(op.f(f"ck_{table}_value_type"), type_="check")
        batch_op.create_check_constraint(op.f(f"ck_{table}_value_type"), condition)


def upgrade() -> None:
    _swap("task_properties", _NEW)
    _swap("habit_properties", _NEW)


def downgrade() -> None:
    # 'duration' の行は 'string'(秒数の文字列)へ戻してから制約を戻す
    for table in ("task_properties", "habit_properties"):
        op.execute(f"UPDATE {table} SET value_type = 'string' WHERE value_type = 'duration'")
    _swap("task_properties", _OLD)
    _swap("habit_properties", _OLD)
