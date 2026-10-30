"""SQLAlchemy models for users, documents, and vector chunks."""

from datetime import datetime
from uuid import UUID, uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, Date, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.config import get_settings
from app.db.session import Base


class User(Base):
    """Represent an application user."""

    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    email: Mapped[str | None] = mapped_column(String, nullable=True)
    full_name: Mapped[str | None] = mapped_column(String(60), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)


class AccountDeletionAudit(Base):
    """Anonymized account-deletion record without a foreign key to the user."""

    __tablename__ = "account_deletion_audits"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    deleted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    reason: Mapped[str] = mapped_column(String(32), nullable=False, default="user_request")


class Document(Base):
    """Represent an uploaded document owned by a user."""

    __tablename__ = "documents"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    unit_id: Mapped[UUID] = mapped_column(ForeignKey("units.id", ondelete="CASCADE"), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    mime_type: Mapped[str] = mapped_column(String, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_path: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)


class Conversation(Base):
    """Represent a user's chat conversation."""

    __tablename__ = "conversations"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    unit_id: Mapped[UUID] = mapped_column(ForeignKey("units.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)


class Message(Base):
    """Represent a message in a conversation."""

    __tablename__ = "messages"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    conversation_id: Mapped[UUID] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    sources: Mapped[list[dict] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)


class Chunk(Base):
    """Represent an embedded text chunk."""

    __tablename__ = "chunks"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    document_id: Mapped[UUID] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    unit_id: Mapped[UUID] = mapped_column(ForeignKey("units.id", ondelete="CASCADE"), nullable=False, index=True)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    embedding: Mapped[list[float]] = mapped_column(Vector(get_settings().embedding_dim), nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)


class Unit(Base):
    __tablename__ = "units"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_units_user_name"),)


class UserPlan(Base):
    __tablename__ = "user_plans"

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    plan: Mapped[str] = mapped_column(String, nullable=False, default="trial")
    message_quota: Mapped[int] = mapped_column(Integer, nullable=False)
    document_quota: Mapped[int] = mapped_column(Integer, nullable=False)
    messages_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    token_balance: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    trial_tokens_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    trial_period_start: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    premium_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    daily_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    daily_date: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    has_purchased: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class Package(Base):
    __tablename__ = "packages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    price_ksh: Mapped[int] = mapped_column(Integer, nullable=False)
    tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    premium_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class PaymentRequest(Base):
    __tablename__ = "payment_requests"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    package_id: Mapped[int] = mapped_column(ForeignKey("packages.id"), nullable=False)
    amount_ksh: Mapped[int] = mapped_column(Integer, nullable=False)
    mpesa_code: Mapped[str] = mapped_column(String(10), nullable=False, unique=True, index=True)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending")
    reject_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(String, nullable=True)


class UsageEvent(Base):
    __tablename__ = "usage_events"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    conversation_id: Mapped[UUID | None] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), nullable=True)
    model: Mapped[str] = mapped_column(String, nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    tokens_charged: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    admin_email: Mapped[str] = mapped_column(String, nullable=False)
    target_user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    change: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RedeemCode(Base):
    __tablename__ = "redeem_codes"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    plan_name: Mapped[str] = mapped_column(String, nullable=False)
    message_quota: Mapped[int] = mapped_column(Integer, nullable=False)
    document_quota: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_days: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    redeemed_by: Mapped[UUID | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    redeemed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    token_grant: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
