import argparse
import hashlib
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy.orm import Session
from app.api_billing import ALPHABET, generate_code
from app.db.models import RedeemCode
from app.db.session import get_engine


def normalize(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch.isalnum())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=1)
    parser.add_argument("--tokens", type=int, default=0)
    parser.add_argument("--duration-days", type=int, required=True)
    args = parser.parse_args()
    plain_codes = []
    with Session(get_engine()) as db:
        for _ in range(args.count):
            code = generate_code()
            plain_codes.append(code)
            db.add(RedeemCode(code_hash=hashlib.sha256(normalize(code).encode("ascii")).hexdigest(), plan_name="paid", message_quota=0, document_quota=0, duration_days=args.duration_days, token_grant=args.tokens))
        db.commit()
    print("\n".join(plain_codes))


if __name__ == "__main__":
    main()
