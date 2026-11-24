"""Limite de uso no PostgreSQL: vale com várias réplicas e sobrevive a deploy."""

import random

from .config import LIMIT_IP_HOUR, LIMIT_TOTAL_DAY, LIMIT_VISITOR_HOUR
from .db import pool


async def ensure_table() -> None:
    p = await pool()
    async with p.connection() as conn:
        await conn.execute(
            """CREATE TABLE IF NOT EXISTS chat_usage (
                 key text NOT NULL, window_start timestamptz NOT NULL, count integer NOT NULL DEFAULT 0,
                 PRIMARY KEY (key, window_start))"""
        )


async def hit(key: str, window: str) -> int:
    """Soma 1 ao contador da chave na janela atual e devolve o total. Atômico."""
    p = await pool()
    async with p.connection() as conn:
        row = await (
            await conn.execute(
                """INSERT INTO chat_usage (key, window_start, count) VALUES (%s, date_trunc(%s, now()), 1)
                   ON CONFLICT (key, window_start) DO UPDATE SET count = chat_usage.count + 1 RETURNING count""",
                (key, window),
            )
        ).fetchone()
        if random.random() < 0.01:
            await conn.execute("DELETE FROM chat_usage WHERE window_start < now() - interval '2 days'")
    return row["count"]


async def over_limit(visitor: str, ip: str) -> str | None:
    """A frase para o cliente se passou de um limite, ou None.

    O teto do dia vem por ÚLTIMO: quem já está bloqueado não gasta a cota dos outros.
    """
    if await hit(f"visitor:{visitor}", "hour") > LIMIT_VISITOR_HOUR:
        return "Você enviou muitas mensagens em pouco tempo. Tente de novo daqui a pouco."
    if await hit(f"ip:{ip}", "hour") > LIMIT_IP_HOUR:
        return "Muitas mensagens saindo da sua rede. Tente de novo daqui a pouco."
    if await hit("total", "day") > LIMIT_TOTAL_DAY:
        return "O assistente atingiu o limite de atendimentos de hoje. Tente amanhã."
    return None
