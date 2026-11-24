"""Uma conexão (pool) com o PostgreSQL para o app inteiro: conversas, vetores, chamados e limites."""

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from .config import DATABASE_URL

_pool: AsyncConnectionPool | None = None


async def pool() -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        # autocommit e prepare_threshold=None: é o que o checkpointer do LangGraph pede.
        _pool = AsyncConnectionPool(
            DATABASE_URL,
            min_size=1,
            max_size=10,
            open=False,
            kwargs={"autocommit": True, "prepare_threshold": None, "row_factory": dict_row},
        )
        await _pool.open(wait=True, timeout=30)
    return _pool


async def close() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
