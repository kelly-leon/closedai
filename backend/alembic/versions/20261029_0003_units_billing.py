"""Add units, usage plans, and redeem codes."""

from alembic import op
import sqlalchemy as sa

revision = "20261029_0003"
down_revision = "20261028_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "units",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "name", name="uq_units_user_name"),
    )
    op.create_index("ix_units_user_id", "units", ["user_id"])

    op.add_column("documents", sa.Column("unit_id", sa.Uuid(), nullable=True))
    op.add_column("chunks", sa.Column("unit_id", sa.Uuid(), nullable=True))
    op.add_column("conversations", sa.Column("unit_id", sa.Uuid(), nullable=True))
    op.create_foreign_key("fk_documents_unit_id_units", "documents", "units", ["unit_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_chunks_unit_id_units", "chunks", "units", ["unit_id"], ["id"], ondelete="CASCADE")
    op.create_foreign_key("fk_conversations_unit_id_units", "conversations", "units", ["unit_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_documents_unit_id", "documents", ["unit_id"])
    op.create_index("ix_chunks_unit_id", "chunks", ["unit_id"])
    op.create_index("ix_conversations_unit_id", "conversations", ["unit_id"])

    op.execute("""
        INSERT INTO units (id, user_id, name, created_at)
        SELECT gen_random_uuid(), user_id, 'General', CURRENT_TIMESTAMP
        FROM (
            SELECT id AS user_id FROM users
            UNION SELECT DISTINCT user_id FROM documents
            UNION SELECT DISTINCT user_id FROM chunks
            UNION SELECT DISTINCT user_id FROM conversations
        ) owned_users
        WHERE NOT EXISTS (SELECT 1 FROM units WHERE units.user_id = owned_users.user_id AND units.name = 'General')
    """)
    op.execute("UPDATE documents d SET unit_id = u.id FROM units u WHERE u.user_id = d.user_id AND u.name = 'General' AND d.unit_id IS NULL")
    op.execute("UPDATE chunks c SET unit_id = u.id FROM units u WHERE u.user_id = c.user_id AND u.name = 'General' AND c.unit_id IS NULL")
    op.execute("UPDATE conversations c SET unit_id = u.id FROM units u WHERE u.user_id = c.user_id AND u.name = 'General' AND c.unit_id IS NULL")
    op.alter_column("documents", "unit_id", nullable=False)
    op.alter_column("chunks", "unit_id", nullable=False)
    op.alter_column("conversations", "unit_id", nullable=False)

    op.create_table(
        "user_plans",
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("plan", sa.String(), nullable=False),
        sa.Column("message_quota", sa.Integer(), nullable=False),
        sa.Column("document_quota", sa.Integer(), nullable=False),
        sa.Column("messages_used", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "redeem_codes",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("plan_name", sa.String(), nullable=False),
        sa.Column("message_quota", sa.Integer(), nullable=False),
        sa.Column("document_quota", sa.Integer(), nullable=False),
        sa.Column("duration_days", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("redeemed_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("redeemed_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_redeem_codes_code_hash", "redeem_codes", ["code_hash"])
    op.create_index("ix_redeem_codes_redeemed_by", "redeem_codes", ["redeemed_by"])


def downgrade() -> None:
    op.drop_table("redeem_codes")
    op.drop_table("user_plans")
    op.drop_constraint("fk_conversations_unit_id_units", "conversations", type_="foreignkey")
    op.drop_constraint("fk_chunks_unit_id_units", "chunks", type_="foreignkey")
    op.drop_constraint("fk_documents_unit_id_units", "documents", type_="foreignkey")
    op.drop_column("conversations", "unit_id")
    op.drop_column("chunks", "unit_id")
    op.drop_column("documents", "unit_id")
    op.drop_table("units")
