"""split habits into parent (habits) and child (tasks)

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-02 12:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

TASK_RECURRENCE_COLUMNS = (
    "recurrence_type",
    "recurrence_weekdays",
    "recurrence_month_day",
    "recurrence_month",
    "recurrence_day",
    "recurrence_end_type",
    "recurrence_end_date",
    "recurrence_end_count",
)

STATUS_NEW = "status IN ('inbox', 'next', 'someday', 'waiting', 'done')"

RECURRENCE_FIELDS = (
    "COALESCE((recurrence_type = 'weekly' AND recurrence_weekdays BETWEEN 1 AND 127"
    " AND recurrence_month_day IS NULL AND recurrence_month IS NULL"
    " AND recurrence_day IS NULL)"
    " OR (recurrence_type = 'monthly' AND recurrence_weekdays IS NULL"
    " AND (recurrence_month_day BETWEEN 1 AND 31 OR recurrence_month_day = -1)"
    " AND recurrence_month IS NULL AND recurrence_day IS NULL)"
    " OR (recurrence_type = 'yearly' AND recurrence_weekdays IS NULL"
    " AND recurrence_month_day IS NULL AND recurrence_month BETWEEN 1 AND 12"
    " AND recurrence_day BETWEEN 1 AND 31), 0)"
)
RECURRENCE_END_FIELDS = (
    "COALESCE((recurrence_end_type = 'none' AND recurrence_end_date IS NULL"
    " AND recurrence_end_count IS NULL)"
    " OR (recurrence_end_type = 'date' AND recurrence_end_date IS NOT NULL"
    " AND recurrence_end_count IS NULL)"
    " OR (recurrence_end_type = 'count' AND recurrence_end_date IS NULL"
    " AND recurrence_end_count >= 1), 0)"
)


def upgrade() -> None:
    op.create_table(
        "habits",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=True),
        sa.Column("estimate_minutes", sa.Integer(), nullable=True),
        sa.Column("memo", sa.Text(), nullable=True),
        sa.Column("time_slot", sa.String(), nullable=True),
        sa.Column("recurrence_type", sa.String(), nullable=False),
        sa.Column("recurrence_weekdays", sa.Integer(), nullable=True),
        sa.Column("recurrence_month_day", sa.Integer(), nullable=True),
        sa.Column("recurrence_month", sa.Integer(), nullable=True),
        sa.Column("recurrence_day", sa.Integer(), nullable=True),
        sa.Column("recurrence_end_type", sa.String(), server_default="none", nullable=False),
        sa.Column("recurrence_end_date", sa.String(length=10), nullable=True),
        sa.Column("recurrence_end_count", sa.Integer(), nullable=True),
        sa.Column("start_date", sa.String(length=10), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("generated_until", sa.String(length=10), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "time_slot IS NULL OR time_slot IN ('morning', 'afternoon', 'evening')",
            name=op.f("ck_habits_time_slot"),
        ),
        sa.CheckConstraint(
            "recurrence_type IN ('weekly', 'monthly', 'yearly')",
            name=op.f("ck_habits_recurrence_type"),
        ),
        sa.CheckConstraint(
            "recurrence_end_type IN ('none', 'date', 'count')",
            name=op.f("ck_habits_recurrence_end_type"),
        ),
        sa.CheckConstraint(RECURRENCE_FIELDS, name=op.f("ck_habits_recurrence_fields")),
        sa.CheckConstraint(RECURRENCE_END_FIELDS, name=op.f("ck_habits_recurrence_end_fields")),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_habits_project_id_projects"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_habits")),
    )
    with op.batch_alter_table("habits", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_habits_project_id"), ["project_id"], unique=False)

    op.create_table(
        "habit_properties",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("habit_id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(
            ["habit_id"],
            ["habits.id"],
            name=op.f("fk_habit_properties_habit_id_habits"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_habit_properties")),
    )
    with op.batch_alter_table("habit_properties", schema=None) as batch_op:
        batch_op.create_index("uq_habit_properties_habit_id_key", ["habit_id", "key"], unique=True)

    # 旧 habit ステータスは通常の next として残す(習慣データは無い前提)
    op.execute("UPDATE tasks SET status = 'next' WHERE status = 'habit'")
    # tasks の再作成(batch mode の DROP TABLE)で ON DELETE CASCADE が働き、子テーブルの行が
    # 消えるため、退避してから戻す(トランザクション内では PRAGMA foreign_keys を切り替えられない)
    op.execute("CREATE TABLE _bak_task_properties AS SELECT * FROM task_properties")
    op.execute("CREATE TABLE _bak_task_logs AS SELECT * FROM task_logs")
    with op.batch_alter_table("tasks", schema=None) as batch_op:
        batch_op.drop_constraint(op.f("ck_tasks_status"), type_="check")
        batch_op.drop_constraint(op.f("ck_tasks_recurrence_type"), type_="check")
        batch_op.drop_constraint(op.f("ck_tasks_recurrence_end_type"), type_="check")
        batch_op.drop_constraint(op.f("ck_tasks_recurrence_fields"), type_="check")
        batch_op.drop_constraint(op.f("ck_tasks_recurrence_end_fields"), type_="check")
        for column in TASK_RECURRENCE_COLUMNS:
            batch_op.drop_column(column)
        batch_op.add_column(sa.Column("habit_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("occurrence_date", sa.String(length=10), nullable=True))
        batch_op.create_check_constraint(op.f("ck_tasks_status"), STATUS_NEW)
        batch_op.create_foreign_key(
            op.f("fk_tasks_habit_id_habits"), "habits", ["habit_id"], ["id"], ondelete="SET NULL"
        )
        batch_op.create_index(
            "uq_tasks_habit_id_occurrence_date", ["habit_id", "occurrence_date"], unique=True
        )

    op.execute("INSERT INTO task_properties SELECT * FROM _bak_task_properties")
    op.execute("INSERT INTO task_logs SELECT * FROM _bak_task_logs")
    op.execute("DROP TABLE _bak_task_properties")
    op.execute("DROP TABLE _bak_task_logs")

    # 履歴: 子を削除しても残るよう task_id を SET NULL にし、タイトルと親idを持たせる
    with op.batch_alter_table("task_logs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("habit_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("task_title", sa.String(), nullable=True))
    op.execute(
        "UPDATE task_logs SET task_title = "
        "(SELECT title FROM tasks WHERE tasks.id = task_logs.task_id)"
    )
    with op.batch_alter_table("task_logs", schema=None) as batch_op:
        batch_op.alter_column("task_title", existing_type=sa.String(), nullable=False)
        batch_op.alter_column("task_id", existing_type=sa.Integer(), nullable=True)
        batch_op.drop_constraint(op.f("fk_task_logs_task_id_tasks"), type_="foreignkey")
        batch_op.create_foreign_key(
            op.f("fk_task_logs_task_id_tasks"), "tasks", ["task_id"], ["id"], ondelete="SET NULL"
        )
        batch_op.create_foreign_key(
            op.f("fk_task_logs_habit_id_habits"),
            "habits",
            ["habit_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade() -> None:
    raise NotImplementedError("0006 のダウングレードは未対応です")
