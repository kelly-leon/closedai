"""Add usage event kind."""

from alembic import op
import sqlalchemy as sa

revision = "20261102_0009"
down_revision = "20261101_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("usage_events", sa.Column("kind", sa.String(length=16), nullable=False, server_default="chat"))
    op.alter_column("usage_events", "kind", server_default=None)


def downgrade() -> None:
    op.drop_column("usage_events", "kind")
