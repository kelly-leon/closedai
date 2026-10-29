"""Document upload and management API routes."""

from pathlib import Path
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth.factory import get_auth_provider
from app.config import get_settings
from app.db.models import Chunk, Document, Unit, User
from app.db.session import get_db
from app.ingest.pipeline import ingest_document
from app.storage.factory import get_storage_provider
from app.usage import check_limit

router = APIRouter(prefix="/documents", tags=["documents"])
bearer = HTTPBearer(auto_error=False)


async def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> UUID:
    """Resolve and provision the authenticated database user."""
    user_id = UUID(get_auth_provider().get_user_id(credentials))
    user = db.get(User, user_id)
    if user is None:
        db.add(User(id=user_id))
        db.commit()
    return user_id


class DocumentRegistration(BaseModel):
    """Metadata for a file already stored in hosted storage."""

    storage_path: str
    filename: str
    mime_type: str
    size_bytes: int
    unit_id: UUID


def _validate_file(filename: str, size_bytes: int) -> str:
    settings = get_settings()
    extension = Path(filename).suffix.lower().lstrip(".")
    if extension not in settings.allowed_extensions:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: .{extension}")
    if size_bytes > settings.max_file_size_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File exceeds the configured size limit")
    return extension


@router.post("", status_code=202)
async def upload_document(background_tasks: BackgroundTasks, unit_id: UUID, file: UploadFile = File(...), user_id: UUID = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, str]:
    """Upload and ingest a document in self-hosted mode."""
    settings = get_settings()
    if settings.mode != "selfhosted":
        raise HTTPException(status_code=404, detail="Use the document register endpoint in hosted mode")
    if db.scalar(select(Unit).where(Unit.id == unit_id, Unit.user_id == user_id)) is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    check_limit(db, user_id, "documents")
    content = await file.read()
    _validate_file(file.filename or "", len(content))
    document_id = uuid4()
    storage_path = f"{user_id}/{document_id}/{file.filename}"
    get_storage_provider().save(storage_path, content)
    document = Document(id=document_id, user_id=user_id, unit_id=unit_id, filename=file.filename or "upload", mime_type=file.content_type or "application/octet-stream", size_bytes=len(content), storage_path=storage_path, status="pending")
    db.add(document)
    db.commit()
    background_tasks.add_task(ingest_document, document_id, user_id)
    return {"id": str(document_id), "status": "pending"}


@router.post("/register", status_code=202)
async def register_document(payload: DocumentRegistration, background_tasks: BackgroundTasks, user_id: UUID = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, str]:
    """Register an existing hosted storage object for ingestion."""
    if get_settings().mode != "hosted":
        raise HTTPException(status_code=404, detail="Registration is only available in hosted mode")
    _validate_file(payload.filename, payload.size_bytes)
    if db.scalar(select(Unit).where(Unit.id == payload.unit_id, Unit.user_id == user_id)) is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    check_limit(db, user_id, "documents")
    document_id = uuid4()
    document = Document(id=document_id, user_id=user_id, unit_id=payload.unit_id, filename=payload.filename, mime_type=payload.mime_type, size_bytes=payload.size_bytes, storage_path=payload.storage_path, status="pending")
    db.add(document)
    db.commit()
    background_tasks.add_task(ingest_document, document_id, user_id)
    return {"id": str(document_id), "status": "pending"}


@router.get("")
def list_documents(unit_id: UUID, user_id: UUID = Depends(current_user), db: Session = Depends(get_db)) -> list[dict[str, object]]:
    """List documents owned by the current user."""
    if db.scalar(select(Unit).where(Unit.id == unit_id, Unit.user_id == user_id)) is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    documents = db.scalars(select(Document).where(Document.user_id == user_id, Document.unit_id == unit_id).order_by(Document.created_at.desc())).all()
    return [{"id": str(document.id), "filename": document.filename, "status": document.status} for document in documents]


@router.get("/{document_id}")
def document_details(document_id: UUID, user_id: UUID = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, object]:
    """Return status and metadata for one owned document."""
    document = db.scalar(select(Document).where(Document.id == document_id, Document.user_id == user_id))
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"id": str(document.id), "filename": document.filename, "mime_type": document.mime_type, "size_bytes": document.size_bytes, "status": document.status, "error_message": document.error_message, "created_at": document.created_at.isoformat()}


@router.delete("/{document_id}", status_code=204)
def delete_document(document_id: UUID, user_id: UUID = Depends(current_user), db: Session = Depends(get_db)) -> None:
    """Delete stored content, chunks, and the owned document row."""
    document = db.scalar(select(Document).where(Document.id == document_id, Document.user_id == user_id))
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    db.execute(delete(Chunk).where(Chunk.document_id == document_id, Chunk.user_id == user_id))
    get_storage_provider().delete(document.storage_path)
    db.delete(document)
    db.commit()
