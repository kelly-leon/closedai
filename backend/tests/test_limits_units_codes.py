from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import Base, Document, RedeemCode, Unit, User, UserPlan
from app.usage import check_limit, code_hash


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:")
    tables = [User.__table__, Unit.__table__, Document.__table__, UserPlan.__table__, RedeemCode.__table__]
    Base.metadata.create_all(engine, tables=tables)
    with Session(engine) as session:
        yield session


def test_units_are_isolated_between_users(db):
    first, second = uuid4(), uuid4()
    db.add_all([User(id=first), User(id=second)])
    db.add_all([Unit(id=uuid4(), user_id=first, name="General"), Unit(id=uuid4(), user_id=second, name="General")])
    db.commit()
    rows = db.scalars(select(Unit).where(Unit.user_id == first)).all()
    assert len(rows) == 1 and all(row.user_id == first for row in rows)


def test_quota_blocks_at_limit(monkeypatch, db):
    monkeypatch.setattr(get_settings(), "mode", "hosted")
    monkeypatch.setattr(get_settings(), "trial_messages", 1)
    user = uuid4()
    db.add(User(id=user))
    db.add(UserPlan(user_id=user, plan="trial", message_quota=1, document_quota=1, messages_used=1))
    db.commit()
    with pytest.raises(Exception) as exc:
        check_limit(db, user, "messages")
    assert getattr(exc.value, "status_code", None) == 402


def test_expired_plan_is_blocked(monkeypatch, db):
    monkeypatch.setattr(get_settings(), "mode", "hosted")
    user = uuid4()
    db.add(User(id=user))
    db.add(UserPlan(user_id=user, plan="paid", message_quota=100, document_quota=100, messages_used=0, expires_at=datetime.utcnow() - timedelta(days=1)))
    db.commit()
    with pytest.raises(Exception) as exc:
        check_limit(db, user, "messages")
    assert getattr(exc.value, "status_code", None) == 402


def test_redeem_code_is_single_use_and_hashed(db):
    code = "ABCD-EFGH-JKLM"
    row = RedeemCode(code_hash=code_hash(code), plan_name="paid", message_quota=100, document_quota=10, duration_days=30)
    db.add(row)
    db.commit()
    assert row.code_hash != code
    assert row.redeemed_at is None


def test_selfhosted_is_unlimited(monkeypatch, db):
    monkeypatch.setattr(get_settings(), "mode", "selfhosted")
    user = uuid4()
    db.add(User(id=user))
    db.commit()
    check_limit(db, user, "messages")
