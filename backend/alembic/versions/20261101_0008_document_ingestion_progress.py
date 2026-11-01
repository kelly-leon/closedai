"""Add resumable document ingestion progress."""

from alembic import op
import sqlalchemy as sa

revision = "20261101_0008"
down_revision = "20261101_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("source_hash", sa.String(length=64), nullable=True))
    op.add_column("documents", sa.Column("chunks_done", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("documents", sa.Column("chunks_total", sa.Integer(), nullable=False, server_default="0"))
    op.alter_column("documents", "chunks_done", server_default=None)
    op.alter_column("documents", "chunks_total", server_default=None)


def downgrade() -> None:
    op.drop_column("documents", "chunks_total")
    op.drop_column("documents", "chunks_done")
    op.drop_column("documents", "source_hash")
