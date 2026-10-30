"""Document upload and management API routes."""

import mimetypes
import re
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
from app.rate_limit import rate_limit
from app.ingest.parse import verify_file_signature

router = APIRouter(prefix="/documents", tags=["documents"])
bearer = HTTPBearer(auto_error=False)


async def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> UUID:
    """Resolve and provision the authenticated database user."""
    provider = get_auth_provider()
    claims = provider.get_claims(credentials)
    subject = claims["sub"] if "sub" in claims else provider.get_user_id(credentials)
    user_id = UUID(str(subject))
    user = db.get(User, user_id)
    metadata = claims.get("user_metadata")
    full_name = metadata.get("full_name") if isinstance(metadata, dict) else claims.get("full_name")
    email = str(claims["email"]) if claims.get("email") else None
    if user is not None:
        changed = False
        if email and user.email != email:
            user.email = email
            changed = True
        if full_name and isinstance(full_name, str) and full_name.strip() and user.full_name != full_name.strip():
            user.full_name = full_name.strip()
            changed = True
        if changed:
            db.commit()
        return user_id
    if user is None:
        db.add(User(id=user_id, email=email, full_name=str(full_name).strip() if isinstance(full_name, str) else None))
        try:
            db.commit()
        except Exception:
            db.rollback()
            user = db.get(User, user_id)
            if user is None:
                raise
            if user.email is None and claims.get("email"):
                user.email = str(claims["email"])
                db.commit()
    return user_id


class DocumentRegistration(BaseModel):
    """Metadata for a file already stored in hosted storage."""

    storage_path: str
    filename: str
    mime_type: str
    size_bytes: int
    unit_id: UUID


class DocumentUploadRequest(BaseModel):
    filename: str
    size_bytes: int
    mime_type: str
    unit_id: UUID


def _validate_file(filename: str, size_bytes: int) -> str:
    settings = get_settings()
    extension = Path(filename).suffix.lower().lstrip(".")
    if extension not in settings.allowed_extensions:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: .{extension}")
    if size_bytes > settings.max_file_size_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File exceeds the configured size limit")
    return extension


def _sanitize_filename(filename: str) -> str:
    filename = Path(filename.replace("\\", "/")).name
    filename = re.sub(r"[\x00-\x1f\x7f]+", "-", filename).strip(" .")
    return filename or "document"


def _object_metadata(metadata: dict[str, object], key: str) -> tuple[int, str]:
    nested = metadata.get("metadata")
    if isinstance(nested, dict):
        metadata = nested
    raw_size = metadata.get("size") if metadata.get("size") is not None else metadata.get("contentLength")
    raw_type = metadata.get("mimetype") if metadata.get("mimetype") is not None else metadata.get("content_type")
    if raw_size is None or raw_type is None:
        raise HTTPException(status_code=422, detail=f"Object metadata is unavailable for {key}")
    try:
        return int(raw_size), str(raw_type).split(";", 1)[0].strip().lower()
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"Invalid object metadata for {key}")


@router.post("/upload-url")
async def create_document_upload_url(payload: DocumentUploadRequest, user_id: UUID = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, str]:
    settings = get_settings()
    if settings.mode != "hosted":
        raise HTTPException(status_code=404, detail="Signed uploads are only available in hosted mode")
    if db.scalar(select(Unit).where(Unit.id == payload.unit_id, Unit.user_id == user_id)) is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    _validate_file(payload.filename, payload.size_bytes)
    rate_limit(f"uploads:{user_id}", 20, 3600, "You've uploaded too many files recently. Please try again later.")
    check_limit(db, user_id, "documents")
    rate_limit(f"uploads:{user_id}", 20, 3600, "You've uploaded too many files recently. Please try again later.")
    filename = _sanitize_filename(payload.filename)
    extension = Path(filename).suffix.lower().lstrip(".")
    storage_path = f"{user_id}/{uuid4()}.{extension}"
    provider = get_storage_provider()
    signed = provider.create_signed_upload_url(storage_path)  # type: ignore[attr-defined]
    return {**signed, "storage_path": storage_path}


@router.post("", status_code=202)
async def upload_document(background_tasks: BackgroundTasks, unit_id: UUID, file: UploadFile = File(...), user_id: UUID = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, str]:
    """Upload and ingest a document in self-hosted mode."""
    settings = get_settings()
    if settings.mode != "selfhosted":
        raise HTTPException(status_code=404, detail="Use the document register endpoint in hosted mode")
    if db.scalar(select(Unit).where(Unit.id == unit_id, Unit.user_id == user_id)) is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    check_limit(db, user_id, "documents")
    rate_limit(f"uploads:{user_id}", 20, 3600, "You've uploaded too many files recently. Please try again later.")
    content = await file.read()
    _validate_file(file.filename or "", len(content))
    try:
        verify_file_signature(file.filename or "", content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
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
    prefix = f"{user_id}/"
    if not payload.storage_path.startswith(prefix):
        raise HTTPException(status_code=403, detail="Storage path is outside the current user's folder")
    provider = get_storage_provider()
    try:
        metadata = provider.object_info(payload.storage_path)  # type: ignore[attr-defined]
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Uploaded object not found")
    real_size, real_type = _object_metadata(metadata, payload.storage_path)
    if real_size != payload.size_bytes:
        raise HTTPException(status_code=422, detail="Uploaded file size does not match the declared size")
    expected_type = payload.mime_type.split(";", 1)[0].strip().lower()
    if expected_type and real_type != expected_type:
        raise HTTPException(status_code=422, detail="Uploaded file type does not match the declared type")
    if real_size > get_settings().max_file_size_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File exceeds the configured size limit")
    extension = Path(payload.storage_path).suffix.lower().lstrip(".")
    if extension not in get_settings().allowed_extensions:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: .{extension}")
    try:
        read = getattr(provider, "read", None)
        if read is not None:
            verify_file_signature(payload.filename, read(payload.storage_path))
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    check_limit(db, user_id, "documents")
    document_id = uuid4()
    document = Document(id=document_id, user_id=user_id, unit_id=payload.unit_id, filename=_sanitize_filename(payload.filename), mime_type=real_type, size_bytes=real_size, storage_path=payload.storage_path, status="pending")
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
    return [{"id": str(document.id), "filename": document.filename, "status": document.status, "error_message": document.error_message} for document in documents]


@router.get("/{document_id}")
def document_details(document_id: UUID, user_id: UUID = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, object]:
    """Return status and metadata for one owned document."""
    document = db.scalar(select(Document).where(Document.id == document_id, Document.user_id == user_id))
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"id": str(document.id), "filename": document.filename, "mime_type": document.mime_type, "size_bytes": document.size_bytes, "status": document.status, "error_message": document.error_message, "created_at": document.created_at.isoformat()}


@router.post("/{document_id}/retry", status_code=202)
def retry_document(document_id: UUID, background_tasks: BackgroundTasks, user_id: UUID = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, str]:
    """Reset a failed owned document and queue it for ingestion again."""
    document = db.scalar(select(Document).where(Document.id == document_id, Document.user_id == user_id))
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if document.status != "failed":
        raise HTTPException(status_code=409, detail="Only failed documents can be retried")
    document.status = "pending"
    document.error_message = None
    db.commit()
    background_tasks.add_task(ingest_document, document_id, user_id)
    return {"id": str(document_id), "status": "pending"}


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
