"""FastAPI application entry point."""

import json
import logging
import threading
from contextvars import ContextVar
from datetime import datetime, timedelta
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import select, text

from app.api_documents import router as documents_router
from app.api_chat import router as chat_router
from app.config import get_settings
from app.db.models import User
from app.db.session import get_engine
from app.api_units import router as units_router
from app.api_billing import router as billing_router
from app.db.models import Unit

logging.getLogger("pypdf").setLevel(logging.ERROR)
request_id_context: ContextVar[str] = ContextVar("request_id", default="")


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if not getattr(record, "request_id", None):
            record.request_id = request_id_context.get()  # type: ignore[attr-defined]
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "level": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
        }
        request_id = getattr(record, "request_id", None)
        if request_id:
            payload["request_id"] = request_id
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload)


handler = logging.StreamHandler()
handler.setFormatter(JsonFormatter())
handler.addFilter(RequestIdFilter())
root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)
root_logger.handlers.clear()
root_logger.addHandler(handler)

settings = get_settings()
app = FastAPI(title="ClosedAI", version="0.1.0")


def validate_startup_config() -> None:
    if settings.mode == "hosted" and settings.auth_provider == "none":
        raise RuntimeError("Hosted mode requires AUTH_PROVIDER=supabase (AUTH_PROVIDER=none is not supported).")
    if settings.auth_provider == "supabase" and not settings.supabase_url.strip():
        raise RuntimeError("AUTH_PROVIDER=supabase requires SUPABASE_URL.")


validate_startup_config()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(documents_router)
app.include_router(chat_router)
app.include_router(units_router)
app.include_router(billing_router)


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID", str(uuid4()))
    request.state.request_id = request_id
    token = request_id_context.set(request_id)
    try:
        response = await call_next(request)
    finally:
        request_id_context.reset(token)
    response.headers["X-Request-ID"] = request_id
    logging.getLogger("closedai.request").info(
        "request method=%s path=%s status=%s",
        request.method,
        request.url.path,
        response.status_code,
        extra={"request_id": request_id},
    )
    return response


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    if exc.status_code == 402 and isinstance(exc.detail, dict):
        return JSONResponse(status_code=402, content=exc.detail)
    request_id = getattr(request.state, "request_id", str(uuid4()))
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail, "request_id": request_id}, headers={"X-Request-ID": request_id})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = getattr(request.state, "request_id", str(uuid4()))
    logging.getLogger("closedai.request").exception(
        "Unhandled request error request_id=%s",
        request_id,
        extra={"request_id": request_id},
    )
    return JSONResponse(status_code=500, content={"detail": "Internal server error", "request_id": request_id}, headers={"X-Request-ID": request_id})


def recover_interrupted_documents() -> int:
    cutoff = datetime.utcnow() - timedelta(minutes=2)
    with Session(get_engine()) as db:
        from app.db.models import Document
        documents = db.scalars(
            select(Document).where(
                Document.status.in_(["pending", "processing"]),
                Document.created_at < cutoff,
            )
        ).all()
        for document in documents:
            document.status = "failed"
            document.error_message = "Interrupted. Please re-upload."
        db.commit()
        count = len(documents)
    logging.getLogger(__name__).info("Startup document recovery fixed %s interrupted documents", count)
    return count


def _warm_embedding_model() -> None:
    try:
        from app.embeddings.factory import get_embedding_provider
        get_embedding_provider().embed_documents(["warm up"])
        logging.getLogger(__name__).info("Embedding model warm-up completed")
    except Exception as exc:
        logging.getLogger(__name__).warning("Embedding model warm-up failed: %s", exc)


@app.on_event("startup")
def startup_tasks() -> None:
    """Create the fixed self-hosted user when it does not exist."""
    recover_interrupted_documents()
    if settings.mode == "selfhosted":
        from uuid import UUID
        with Session(get_engine()) as db:
            default_id = UUID("00000000-0000-0000-0000-000000000001")
            if db.get(User, default_id) is None:
                db.add(User(id=default_id))
                db.commit()
            if db.scalar(select(Unit).where(Unit.user_id == default_id)) is None:
                db.add(Unit(user_id=default_id, name="General"))
                db.commit()
    threading.Thread(target=_warm_embedding_model, daemon=True, name="embedding-warmup").start()


@app.get("/health")
def health() -> dict[str, str]:
    """Report API health, deployment mode, and database connectivity."""
    with get_engine().connect() as connection:
        connection.execute(text("SELECT 1"))
    return {"status": "ok", "mode": settings.mode, "version": app.version or "unknown"}


# TODO: Add upload, ingestion, search, and conversation routes.
