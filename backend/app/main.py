"""FastAPI application entry point."""

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api_documents import router as documents_router
from app.api_chat import router as chat_router
from app.config import get_settings
from app.db.models import User
from app.db.session import get_engine
from app.api_units import router as units_router
from app.api_billing import router as billing_router
from app.db.models import Unit
from sqlalchemy import select

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
app.include_router(units_router)
app.include_router(billing_router)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    if exc.status_code == 402 and isinstance(exc.detail, dict):
        return JSONResponse(status_code=402, content=exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


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
        if db.scalar(select(Unit).where(Unit.user_id == default_id)) is None:
            db.add(Unit(user_id=default_id, name="General"))
            db.commit()


@app.get("/health")
def health() -> dict[str, str]:
    """Report whether the API is running."""
    return {"status": "ok"}


# TODO: Add upload, ingestion, search, and conversation routes.
