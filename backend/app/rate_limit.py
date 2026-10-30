"""Small replaceable rate limiter with an in-memory default."""

import threading
import time
from collections import defaultdict, deque
from fastapi import HTTPException


class RateLimitBackend:
    """Interface implemented by future Redis and other shared limiters."""

    def allow(self, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        raise NotImplementedError

    def acquire_concurrency(self, key: str, limit: int) -> bool:
        raise NotImplementedError

    def release_concurrency(self, key: str) -> None:
        raise NotImplementedError


class InMemoryRateLimiter(RateLimitBackend):
    """Process-local limiter; limits are not shared across application instances."""

    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._active: dict[str, int] = defaultdict(int)
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        now = time.monotonic()
        cutoff = now - window_seconds
        with self._lock:
            events = self._events[key]
            while events and events[0] <= cutoff:
                events.popleft()
            if len(events) >= limit:
                retry = max(1, int(events[0] + window_seconds - now))
                return False, retry
            events.append(now)
            return True, 0

    def acquire_concurrency(self, key: str, limit: int) -> bool:
        with self._lock:
            if self._active[key] >= limit:
                return False
            self._active[key] += 1
            return True

    def release_concurrency(self, key: str) -> None:
        with self._lock:
            self._active[key] = max(0, self._active[key] - 1)


limiter = InMemoryRateLimiter()


def rate_limit(key: str, limit: int, window_seconds: int, message: str) -> None:
    allowed, retry_after = limiter.allow(key, limit, window_seconds)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={"code": "rate_limited", "message": message},
            headers={"Retry-After": str(retry_after)},
        )
