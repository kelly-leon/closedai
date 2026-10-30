"""Store the hosted Supabase user's full name."""

from alembic import op
import sqlalchemy as sa

revision = "20261029_0005"
down_revision = "20261029_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("full_name", sa.String(length=60), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "full_name")
