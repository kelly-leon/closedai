"""Add anonymized account deletion audit.

Revision ID: 20261030_0006
Revises: 20261029_0005
"""

from alembic import op
import sqlalchemy as sa


revision = "20261030_0006"
down_revision = "20261029_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "account_deletion_audits",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=False),
        sa.Column("reason", sa.String(length=32), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("account_deletion_audits")
