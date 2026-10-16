"""create core tables

Revision ID: 0001
Revises:
Create Date: 2026-10-16 09:05:31.519381
"""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_projects")),
    )
    op.create_table(
        "tasks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=True),
        sa.Column("estimate_minutes", sa.Integer(), nullable=True),
        sa.Column("scheduled_date", sa.String(length=10), nullable=True),
        sa.Column("time_slot", sa.String(), nullable=True),
        sa.Column("run_order", sa.Integer(), nullable=True),
        sa.Column("fixed_at", sa.DateTime(), nullable=True),
        sa.Column("wait_condition", sa.Text(), nullable=True),
        sa.Column("recurrence", sa.Text(), nullable=True),
        sa.Column("memo", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "status IN ('inbox', 'next', 'someday', 'waiting', 'habit')",
            name=op.f("ck_tasks_status"),
        ),
        sa.CheckConstraint(
            "time_slot IS NULL OR time_slot IN ('morning', 'afternoon', 'evening')",
            name=op.f("ck_tasks_time_slot"),
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_tasks_project_id_projects"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tasks")),
    )
    with op.batch_alter_table("tasks", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_tasks_project_id"), ["project_id"], unique=False)
        batch_op.create_index(
            "ix_tasks_scheduled_date_time_slot_run_order",
            ["scheduled_date", "time_slot", "run_order"],
            unique=False,
        )
        batch_op.create_index("ix_tasks_status", ["status"], unique=False)

    op.create_table(
        "task_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "action IN ('completed', 'postponed')", name=op.f("ck_task_logs_action")
        ),
        sa.ForeignKeyConstraint(
            ["task_id"], ["tasks.id"], name=op.f("fk_task_logs_task_id_tasks"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_task_logs")),
    )
    with op.batch_alter_table("task_logs", schema=None) as batch_op:
        batch_op.create_index(
            "ix_task_logs_task_id_created_at", ["task_id", "created_at"], unique=False
        )

    op.create_table(
        "task_properties",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("value", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(
            ["task_id"],
            ["tasks.id"],
            name=op.f("fk_task_properties_task_id_tasks"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_task_properties")),
    )
    with op.batch_alter_table("task_properties", schema=None) as batch_op:
        batch_op.create_index("uq_task_properties_task_id_key", ["task_id", "key"], unique=True)


def downgrade() -> None:
    with op.batch_alter_table("task_properties", schema=None) as batch_op:
        batch_op.drop_index("uq_task_properties_task_id_key")

    op.drop_table("task_properties")
    with op.batch_alter_table("task_logs", schema=None) as batch_op:
        batch_op.drop_index("ix_task_logs_task_id_created_at")

    op.drop_table("task_logs")
    with op.batch_alter_table("tasks", schema=None) as batch_op:
        batch_op.drop_index("ix_tasks_status")
        batch_op.drop_index("ix_tasks_scheduled_date_time_slot_run_order")
        batch_op.drop_index(batch_op.f("ix_tasks_project_id"))

    op.drop_table("tasks")
    op.drop_table("projects")
