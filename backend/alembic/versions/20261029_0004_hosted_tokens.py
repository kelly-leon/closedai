"""Add hosted token billing tables and plan fields."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20261029_0004"
down_revision = "20261029_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("user_plans", sa.Column("token_balance", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("user_plans", sa.Column("trial_tokens_used", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("user_plans", sa.Column("trial_period_start", sa.DateTime(), nullable=False, server_default=sa.func.now()))
    op.add_column("user_plans", sa.Column("premium_until", sa.DateTime(), nullable=True))
    op.add_column("user_plans", sa.Column("daily_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("user_plans", sa.Column("daily_date", sa.Date(), nullable=True))
    op.add_column("user_plans", sa.Column("has_purchased", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("redeem_codes", sa.Column("token_grant", sa.Integer(), nullable=False, server_default="0"))

    op.create_table(
        "packages", sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False), sa.Column("price_ksh", sa.Integer(), nullable=False),
        sa.Column("tokens", sa.Integer(), nullable=True), sa.Column("premium_days", sa.Integer(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_table(
        "payment_requests", sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("package_id", sa.Integer(), sa.ForeignKey("packages.id"), nullable=False),
        sa.Column("amount_ksh", sa.Integer(), nullable=False), sa.Column("mpesa_code", sa.String(10), nullable=False),
        sa.Column("status", sa.String(), nullable=False), sa.Column("reject_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False), sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("reviewed_by", sa.String(), nullable=True),
    )
    op.create_unique_constraint("uq_payment_requests_mpesa_code", "payment_requests", ["mpesa_code"])
    op.create_index("ix_payment_requests_user_id", "payment_requests", ["user_id"])

    op.create_table(
        "usage_events", sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=True),
        sa.Column("model", sa.String(), nullable=False), sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False), sa.Column("tokens_charged", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_usage_events_user_id", "usage_events", ["user_id"])
    op.create_table(
        "audit_logs", sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("admin_email", sa.String(), nullable=False),
        sa.Column("target_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("change", sa.Text(), nullable=False), sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    packages = sa.table("packages", sa.column("id", sa.Integer), sa.column("name", sa.String),
                        sa.column("price_ksh", sa.Integer), sa.column("tokens", sa.Integer), sa.column("premium_days", sa.Integer))
    op.bulk_insert(packages, [
        {"id": 1, "name": "KSh 50 package", "price_ksh": 50, "tokens": 500, "premium_days": None},
        {"id": 2, "name": "KSh 100 package", "price_ksh": 100, "tokens": 1200, "premium_days": None},
        {"id": 3, "name": "KSh 200 package", "price_ksh": 200, "tokens": 2500, "premium_days": None},
        {"id": 4, "name": "KSh 300 package", "price_ksh": 300, "tokens": 5600, "premium_days": None},
        {"id": 5, "name": "KSh 500 package", "price_ksh": 500, "tokens": 10000, "premium_days": None},
        {"id": 6, "name": "KSh 1000 premium package", "price_ksh": 1000, "tokens": None, "premium_days": 90},
    ])


def downgrade() -> None:
    op.drop_table("audit_logs"); op.drop_table("usage_events"); op.drop_table("payment_requests"); op.drop_table("packages")
    op.drop_column("redeem_codes", "token_grant"); op.drop_column("user_plans", "has_purchased")
    op.drop_column("user_plans", "daily_date"); op.drop_column("user_plans", "daily_count")
    op.drop_column("user_plans", "premium_until"); op.drop_column("user_plans", "trial_period_start")
    op.drop_column("user_plans", "trial_tokens_used"); op.drop_column("user_plans", "token_balance")
