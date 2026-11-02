import asyncio
from uuid import uuid4

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import app.api_documents as documents_api
from app.db.models import Base, Chunk, Document, Unit, User, UserPlan


@pytest.fixture
def hosted_db(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine, tables=[User.__table__, Unit.__table__, Document.__table__, Chunk.__table__, UserPlan.__table__])
    monkeypatch.setattr(documents_api.get_settings(), "mode", "hosted")
    monkeypatch.setattr(documents_api.get_settings(), "storage_provider", "supabase")
    with Session(engine) as db:
        yield db


def _unit(db):
    user_id, unit_id = uuid4(), uuid4()
    db.add_all([User(id=user_id), Unit(id=unit_id, user_id=user_id, name="General")])
    db.commit()
    return user_id, unit_id


def test_upload_url_quota_blocks_before_supabase(hosted_db, monkeypatch):
    user_id, unit_id = _unit(hosted_db)

    def blocked(*args):
        raise HTTPException(status_code=402, detail={"code": "limit_reached"})

    monkeypatch.setattr(documents_api, "check_limit", blocked)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(documents_api.create_document_upload_url(
            documents_api.DocumentUploadRequest(filename="notes.txt", size_bytes=10, mime_type="text/plain", unit_id=unit_id),
            user_id,
            hosted_db,
        ))
    assert exc.value.status_code == 402


def test_register_rejects_foreign_or_missing_object(hosted_db, monkeypatch):
    user_id, unit_id = _unit(hosted_db)
    foreign = uuid4()

    with pytest.raises(HTTPException) as exc:
        asyncio.run(documents_api.register_document(
            documents_api.DocumentRegistration(storage_path=f"{foreign}/file.pdf", filename="file.pdf", mime_type="application/pdf", size_bytes=10, unit_id=unit_id),
            BackgroundTasks(), user_id, hosted_db,
        ))
    assert exc.value.status_code == 403

    class MissingProvider:
        def object_info(self, key):
            raise FileNotFoundError(key)

    monkeypatch.setattr(documents_api, "get_storage_provider", lambda: MissingProvider())
    with pytest.raises(HTTPException) as exc:
        asyncio.run(documents_api.register_document(
            documents_api.DocumentRegistration(storage_path=f"{user_id}/missing.txt", filename="missing.txt", mime_type="text/plain", size_bytes=10, unit_id=unit_id),
            BackgroundTasks(), user_id, hosted_db,
        ))
    assert exc.value.status_code == 404


@pytest.mark.parametrize("metadata,filename,size,mime,status", [
    ({"size": 999999999, "mimetype": "text/plain"}, "large.txt", 999999999, "text/plain", 413),
    ({"size": 10, "mimetype": "text/plain"}, "wrong.exe", 10, "application/octet-stream", 415),
])
def test_register_rejects_invalid_object(hosted_db, monkeypatch, metadata, filename, size, mime, status):
    user_id, unit_id = _unit(hosted_db)

    class ObjectProvider:
        def object_info(self, key):
            return metadata

    monkeypatch.setattr(documents_api, "get_storage_provider", lambda: ObjectProvider())
    payload = documents_api.DocumentRegistration(
        storage_path=f"{user_id}/{'file.txt' if filename.endswith('.txt') else 'file.exe'}",
        filename=filename, mime_type=mime, size_bytes=size, unit_id=unit_id,
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(documents_api.register_document(payload, BackgroundTasks(), user_id, hosted_db))
    assert exc.value.status_code == status


def test_register_accepts_matching_object(hosted_db, monkeypatch):
    user_id, unit_id = _unit(hosted_db)

    class ObjectProvider:
        def object_info(self, key):
            return {"size": 10, "mimetype": "text/plain"}

    monkeypatch.setattr(documents_api, "get_storage_provider", lambda: ObjectProvider())
    payload = documents_api.DocumentRegistration(
        storage_path=f"{user_id}/file.txt", filename="notes.txt",
        mime_type="text/plain", size_bytes=10, unit_id=unit_id,
    )
    result = asyncio.run(documents_api.register_document(payload, BackgroundTasks(), user_id, hosted_db))
    assert result["status"] == "pending"


def test_register_rejects_mismatched_mime_type(hosted_db, monkeypatch):
    user_id, unit_id = _unit(hosted_db)

    class ObjectProvider:
        def object_info(self, key):
            return {"size": 10, "mimetype": "application/pdf"}

    monkeypatch.setattr(documents_api, "get_storage_provider", lambda: ObjectProvider())
    payload = documents_api.DocumentRegistration(
        storage_path=f"{user_id}/file.pdf", filename="notes.pdf",
        mime_type="text/plain", size_bytes=10, unit_id=unit_id,
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(documents_api.register_document(payload, BackgroundTasks(), user_id, hosted_db))
    assert exc.value.status_code == 422


def test_delete_document_enforces_ownership(hosted_db):
    owner, unit_id = _unit(hosted_db)
    document = Document(id=uuid4(), user_id=owner, unit_id=unit_id, filename="owned.txt", mime_type="text/plain", size_bytes=1, storage_path=f"{owner}/owned.txt", source_hash="hash", status="ready")
    hosted_db.add(document)
    hosted_db.commit()
    with pytest.raises(HTTPException) as exc:
        documents_api.delete_document(document.id, uuid4(), hosted_db)
    assert exc.value.status_code == 404


def test_delete_document_storage_failure_still_removes_rows(hosted_db, monkeypatch):
    owner, unit_id = _unit(hosted_db)
    document = Document(id=uuid4(), user_id=owner, unit_id=unit_id, filename="owned.txt", mime_type="text/plain", size_bytes=1, storage_path=f"{owner}/owned.txt", source_hash="hash", status="ready")
    hosted_db.add(document)
    hosted_db.commit()

    class FailingProvider:
        def delete(self, key):
            raise RuntimeError("storage unavailable")

    monkeypatch.setattr(documents_api, "get_storage_provider", lambda: FailingProvider())
    documents_api.delete_document(document.id, owner, hosted_db)
    assert hosted_db.get(Document, document.id) is None


def test_delete_document_retry_is_idempotent(hosted_db, monkeypatch):
    owner, unit_id = _unit(hosted_db)
    document = Document(id=uuid4(), user_id=owner, unit_id=unit_id, filename="owned.txt", mime_type="text/plain", size_bytes=1, storage_path=f"{owner}/owned.txt", source_hash="hash", status="ready")
    hosted_db.add(document)
    hosted_db.commit()

    class DeletingProvider:
        def delete(self, key):
            pass

    monkeypatch.setattr(documents_api, "get_storage_provider", lambda: DeletingProvider())
    documents_api.delete_document(document.id, owner, hosted_db)
    documents_api.delete_document(document.id, owner, hosted_db)
