from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, exists, select, update
from sqlalchemy.orm import Session

from app.api_documents import current_user
from app.db.models import Chunk, Conversation, Document, Unit
from app.db.session import get_db
from app.storage.factory import get_storage_provider

router = APIRouter(prefix="/units", tags=["units"])


class UnitPayload(BaseModel):
    name: str


def owned_unit(db: Session, unit_id: UUID, user_id: UUID) -> Unit:
    unit = db.scalar(select(Unit).where(Unit.id == unit_id, Unit.user_id == user_id))
    if unit is None:
        raise HTTPException(status_code=404, detail="Unit not found")
    return unit


@router.get("")
def list_units(user_id: UUID = Depends(current_user), db: Session = Depends(get_db)) -> list[dict[str, str]]:
    units = db.scalars(select(Unit).where(Unit.user_id == user_id).order_by(Unit.created_at, Unit.name)).all()
    general = ensure_general(db, user_id, units)
    if general not in units:
        units.append(general)
        units.sort(key=lambda unit: (unit.created_at, unit.name))
    return [{"id": str(unit.id), "name": unit.name} for unit in units]


def ensure_general(db: Session, user_id: UUID, units: list[Unit] | None = None) -> Unit:
    unit = next((item for item in units or () if item.name == "General"), None)
    if unit is None and units is None:
        unit = db.scalar(select(Unit).where(Unit.user_id == user_id, Unit.name == "General"))
    if unit is None:
        unit = Unit(id=uuid4(), user_id=user_id, name="General")
        db.add(unit)
        db.flush()
        for model in (Document, Chunk, Conversation):
            condition = (model.user_id == user_id) & model.unit_id.is_(None)
            if db.scalar(select(exists().where(condition))):
                db.execute(update(model).where(condition).values(unit_id=unit.id))
        db.commit()
    return unit


@router.post("", status_code=201)
def create_unit(payload: UnitPayload, user_id: UUID = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, str]:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Unit name is required")
    if db.scalar(select(Unit).where(Unit.user_id == user_id, Unit.name == name)):
        raise HTTPException(status_code=409, detail="A unit with that name already exists")
    unit = Unit(user_id=user_id, name=name)
    db.add(unit)
    db.commit()
    db.refresh(unit)
    return {"id": str(unit.id), "name": unit.name}


@router.patch("/{unit_id}")
def rename_unit(unit_id: UUID, payload: UnitPayload, user_id: UUID = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, str]:
    unit = owned_unit(db, unit_id, user_id)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Unit name is required")
    if db.scalar(select(Unit).where(Unit.user_id == user_id, Unit.name == name, Unit.id != unit_id)):
        raise HTTPException(status_code=409, detail="A unit with that name already exists")
    unit.name = name
    db.commit()
    return {"id": str(unit.id), "name": unit.name}


@router.delete("/{unit_id}", status_code=204)
def delete_unit(unit_id: UUID, user_id: UUID = Depends(current_user), db: Session = Depends(get_db)) -> None:
    unit = owned_unit(db, unit_id, user_id)
    docs = db.scalars(select(Document).where(Document.user_id == user_id, Document.unit_id == unit_id)).all()
    storage = get_storage_provider()
    for document in docs:
        storage.delete(document.storage_path)
    db.execute(delete(Chunk).where(Chunk.user_id == user_id, Chunk.unit_id == unit_id))
    db.execute(delete(Conversation).where(Conversation.user_id == user_id, Conversation.unit_id == unit_id))
    db.execute(delete(Document).where(Document.user_id == user_id, Document.unit_id == unit_id))
    db.delete(unit)
    db.commit()
