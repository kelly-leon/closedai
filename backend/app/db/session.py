"""SQLAlchemy engine and session setup."""

from collections.abc import Iterator
import logging
from time import perf_counter

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy import event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import QueuePool

from app.config import get_settings
from app.db.metrics import after_cursor_execute, before_cursor_execute, handle_cursor_error


logger = logging.getLogger(__name__)


class TimedQueuePool(QueuePool):
    def _do_get(self):
        started = perf_counter()
        try:
            return super()._do_get()
        finally:
            elapsed_ms = (perf_counter() - started) * 1000
            if elapsed_ms >= 250:
                logger.warning("slow database pool checkout ms=%.2f", elapsed_ms)


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
        engine_options: dict[str, object] = {
            "connect_args": connect_args,
            "pool_pre_ping": True,
            "pool_recycle": 1800,
        }
        if not url.startswith("sqlite"):
            engine_options.update(
                poolclass=TimedQueuePool,
                pool_size=2,
                max_overflow=1,
                pool_timeout=10,
            )
        _engine = create_engine(url, **engine_options)
        event.listen(_engine, "before_cursor_execute", before_cursor_execute)
        event.listen(_engine, "after_cursor_execute", after_cursor_execute)
        event.listen(_engine, "handle_error", handle_cursor_error)
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
