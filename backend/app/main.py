"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.api_documents import router as documents_router
from app.api_chat import router as chat_router
from app.config import get_settings
from app.db.models import User
from app.db.session import get_engine

settings = get_settings()
app = FastAPI(title="ClosedAI", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(documents_router)
app.include_router(chat_router)


@app.on_event("startup")
def ensure_default_user() -> None:
    """Create the fixed self-hosted user when it does not exist."""
    if settings.mode != "selfhosted":
        return
    from uuid import UUID

    with Session(get_engine()) as db:
        default_id = UUID("00000000-0000-0000-0000-000000000001")
        if db.get(User, default_id) is None:
            db.add(User(id=default_id))
            db.commit()


@app.get("/health")
def health() -> dict[str, str]:
    """Report whether the API is running."""
    return {"status": "ok"}


# TODO: Add upload, ingestion, search, and conversation routes.
