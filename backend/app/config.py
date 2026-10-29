"""Application configuration loaded from environment variables."""

from functools import lru_cache
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    """Define supported environment-based application settings."""

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env",
        extra="ignore",
    )

    mode: Literal["selfhosted", "hosted"] = "selfhosted"
    auth_provider: Literal["none", "supabase"] = "none"
    storage_provider: Literal["local", "supabase"] = "local"
    embedding_provider: Literal["local", "voyage", "openai"] = "local"
    database_url: str = "postgresql+psycopg://closedai:closedai@localhost:5432/closedai"
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-5-20250929"
    top_k: int = 6
    similarity_threshold: float = 0.2
    max_tool_rounds: int = 6
    chat_history_limit: int = 20
    embedding_dim: int = 384
    embedding_batch_size: int = 32
    ingest_timeout_seconds: int = 600
    upload_dir: str = "./uploads"
    supabase_bucket: str = "documents"
    max_file_size_mb: int = 50
    allowed_extensions: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["pdf", "docx", "txt", "md"])
    openai_api_key: str = ""
    openai_embedding_model: str = "text-embedding-3-small"
    voyage_api_key: str = ""
    voyage_embedding_model: str = "voyage-2"
    local_embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["http://localhost:3000"])
    supabase_url: str = ""
    supabase_jwt_secret: str = ""
    supabase_service_key: str = ""
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_id: str = ""
    trial_messages: int = 20
    trial_documents: int = 3
    admin_api_key: str = ""

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: object) -> object:
        """Parse comma-separated CORS origins from the environment."""
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @field_validator("allowed_extensions", mode="before")
    @classmethod
    def parse_allowed_extensions(cls, value: object) -> object:
        """Parse comma-separated file extensions from the environment."""
        if isinstance(value, str):
            return [item.strip().lower().lstrip(".") for item in value.split(",") if item.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    """Return cached application settings."""
    return Settings()
