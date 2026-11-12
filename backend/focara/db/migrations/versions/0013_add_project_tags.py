"""add project_tags

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-12 13:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "project_tags",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_id", "name", name="uq_project_tags_project_name"),
    )
    op.create_index(op.f("ix_project_tags_project_id"), "project_tags", ["project_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_project_tags_project_id"), table_name="project_tags")
    op.drop_table("project_tags")
