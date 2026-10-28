"""Create ClosedAI document tables and vector index."""

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from app.config import get_settings

revision = "20261028_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table("users", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("email", sa.String(), nullable=True), sa.Column("created_at", sa.DateTime(), nullable=False))
    op.create_table("documents", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False), sa.Column("filename", sa.String(), nullable=False), sa.Column("mime_type", sa.String(), nullable=False), sa.Column("size_bytes", sa.Integer(), nullable=False), sa.Column("storage_path", sa.String(), nullable=False), sa.Column("status", sa.String(), nullable=False), sa.Column("error_message", sa.Text(), nullable=True), sa.Column("created_at", sa.DateTime(), nullable=False))
    op.create_index("ix_documents_user_id", "documents", ["user_id"])
    op.create_table("chunks", sa.Column("id", sa.Uuid(), primary_key=True), sa.Column("document_id", sa.Uuid(), sa.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False), sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False), sa.Column("chunk_index", sa.Integer(), nullable=False), sa.Column("content", sa.Text(), nullable=False), sa.Column("page_number", sa.Integer(), nullable=True), sa.Column("embedding", Vector(get_settings().embedding_dim), nullable=False), sa.Column("created_at", sa.DateTime(), nullable=False))
    op.create_index("ix_chunks_user_id", "chunks", ["user_id"])
    op.create_index("ix_chunks_document_id", "chunks", ["document_id"])
    op.execute("CREATE INDEX ix_chunks_embedding_cosine ON chunks USING hnsw (embedding vector_cosine_ops)")


def downgrade() -> None:
    op.drop_table("chunks")
    op.drop_table("documents")
    op.drop_table("users")
    op.execute("DROP EXTENSION IF EXISTS vector")
