"""Request-scoped database timing metrics."""

from contextvars import ContextVar
from dataclasses import dataclass, field
from time import perf_counter


@dataclass
class DatabaseMetrics:
    query_count: int = 0
    query_ms: float = 0.0
    query_starts: list[float] = field(default_factory=list)


current_database_metrics: ContextVar[DatabaseMetrics | None] = ContextVar(
    "current_database_metrics", default=None
)


def before_cursor_execute(*_args: object) -> None:
    metrics = current_database_metrics.get()
    if metrics is not None:
        metrics.query_count += 1
        metrics.query_starts.append(perf_counter())


def after_cursor_execute(*_args: object) -> None:
    metrics = current_database_metrics.get()
    if metrics is not None and metrics.query_starts:
        metrics.query_ms += (perf_counter() - metrics.query_starts.pop()) * 1000


def handle_cursor_error(*_args: object) -> None:
    metrics = current_database_metrics.get()
    if metrics is not None and metrics.query_starts:
        metrics.query_ms += (perf_counter() - metrics.query_starts.pop()) * 1000
