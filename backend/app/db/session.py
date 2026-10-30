"""SQLAlchemy engine and session setup."""

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    """Provide a declarative base for SQLAlchemy models."""


_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


def get_engine() -> Engine:
    """Create or return the shared SQLAlchemy engine."""
    global _engine, _session_factory
    if _engine is None:
        settings = get_settings()
        connect_args: dict[str, object] = {}
        url = settings.database_url
        if url.startswith(("postgresql://", "postgres://")) and "sslmode=" not in url:
            separator = "&" if "?" in url else "?"
            url = f"{url}{separator}sslmode=require"
        if ":6543/" in url or "pooler.supabase.com" in url:
            connect_args["prepare_threshold"] = 0
        _engine = create_engine(url, connect_args=connect_args)
        _session_factory = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)
    return _engine


def get_db() -> Iterator[Session]:
    """Yield a request-scoped database session."""
    get_engine()
    assert _session_factory is not None
    db = _session_factory()
    try:
        yield db
    finally:
        db.close()
