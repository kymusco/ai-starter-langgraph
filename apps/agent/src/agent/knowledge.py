"""Base de conhecimento (RAG): os arquivos de docs/ viram vetores no PostgreSQL (pgvector).

A cada subida, o agente compara o conteúdo com o que já está no banco. Mudou? Recarrega.
Não mudou? Não gasta embedding de novo. Vale também para um deploy novo.
"""

import hashlib
import logging
from pathlib import Path

from langchain.embeddings import init_embeddings

from .config import EMBEDDING_MODEL
from .db import pool

log = logging.getLogger("agent.knowledge")
DOCS_DIR = Path(__file__).resolve().parents[2] / "docs"
CHUNK_CHARS = 1200
OVERLAP = 150

_embedder = None


def embedder():
    global _embedder
    if _embedder is None:
        _embedder = init_embeddings(EMBEDDING_MODEL)
    return _embedder


def _chunks(text: str) -> list[str]:
    """Pedaços por parágrafo, até CHUNK_CHARS, com um pouco de sobreposição."""
    out, cur = [], ""
    for para in [p.strip() for p in text.split("\n\n") if p.strip()]:
        if cur and len(cur) + len(para) > CHUNK_CHARS:
            out.append(cur)
            cur = cur[-OVERLAP:] + "\n\n" + para
        else:
            cur = f"{cur}\n\n{para}" if cur else para
    if cur:
        out.append(cur)
    return out


def _docs() -> list[tuple[str, str]]:
    return [(p.name, p.read_text(encoding="utf-8")) for p in sorted(DOCS_DIR.glob("*.md"))]


async def sync() -> None:
    """Recarrega a base se os documentos mudaram. Uma réplica por vez (trava no banco)."""
    docs = _docs()
    digest = hashlib.sha256("\0".join(f"{n}\0{t}" for n, t in docs).encode()).hexdigest()
    p = await pool()
    async with p.connection() as conn:
        await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
        await conn.execute(
            "CREATE TABLE IF NOT EXISTS knowledge_state (id int PRIMARY KEY, digest text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())"
        )
        # Trava entre réplicas: só uma recarrega; as outras esperam e veem o hash novo.
        await conn.execute("SELECT pg_advisory_lock(hashtext('knowledge_sync'))")
        try:
            row = await (await conn.execute("SELECT digest FROM knowledge_state WHERE id = 1")).fetchone()
            if row and row["digest"] == digest:
                log.info("base de conhecimento em dia (%d arquivos)", len(docs))
                return
            pieces = [(name, c) for name, text in docs for c in _chunks(text)]
            vectors = await embedder().aembed_documents([c for _, c in pieces]) if pieces else []
            dim = len(vectors[0]) if vectors else 1536
            await conn.execute("DROP TABLE IF EXISTS knowledge_chunks")
            await conn.execute(
                f"CREATE TABLE knowledge_chunks (id serial PRIMARY KEY, source text NOT NULL, content text NOT NULL, embedding vector({dim}) NOT NULL)"
            )
            for (source, content), vec in zip(pieces, vectors):
                await conn.execute(
                    "INSERT INTO knowledge_chunks (source, content, embedding) VALUES (%s, %s, %s::vector)",
                    (source, content, str(vec)),
                )
            await conn.execute(
                "INSERT INTO knowledge_state (id, digest) VALUES (1, %s) ON CONFLICT (id) DO UPDATE SET digest = EXCLUDED.digest, updated_at = now()",
                (digest,),
            )
            log.info("base de conhecimento recarregada: %d pedaços de %d arquivos", len(pieces), len(docs))
        finally:
            await conn.execute("SELECT pg_advisory_unlock(hashtext('knowledge_sync'))")


async def search(query: str, k: int = 4) -> list[dict]:
    vec = await embedder().aembed_query(query)
    p = await pool()
    async with p.connection() as conn:
        rows = await (
            await conn.execute(
                "SELECT source, content, 1 - (embedding <=> %s::vector) AS score FROM knowledge_chunks ORDER BY embedding <=> %s::vector LIMIT %s",
                (str(vec), str(vec), k),
            )
        ).fetchall()
    return [{"source": r["source"], "content": r["content"], "score": round(float(r["score"]), 3)} for r in rows]
