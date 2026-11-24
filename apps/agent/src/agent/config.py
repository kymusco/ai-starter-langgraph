"""Configuração lida do ambiente. Tudo que muda entre o seu computador e a nuvem vem daqui."""

import os
from pathlib import Path

# No `npm run dev`, o .env da raiz vale para os dois apps. Em produção, as variáveis vêm do serviço.
if os.environ.get("AGENT_DEV") == "1":
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parents[4] / ".env")


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


# `npm run dev` liga isto. Em produção fica desligado, e o agente exige o token.
DEV = os.environ.get("AGENT_DEV") == "1"

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://app:app@localhost:5432/app")

# provedor:modelo, como o LangChain entende. Trocar de provedor = trocar aqui e pôr a chave dele.
MODEL = os.environ.get("MODEL", "openai:gpt-5-mini")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "openai:text-embedding-3-small")

# O token do app web. Ele só chega ao chat e à aprovação de chamados.
AGENT_API_TOKEN = os.environ.get("AGENT_API_TOKEN", "").strip()
MIN_TOKEN_CHARS = 32

LIMIT_VISITOR_HOUR = _int("CHAT_LIMIT_VISITOR_HOUR", 30)
LIMIT_IP_HOUR = _int("CHAT_LIMIT_IP_HOUR", 100)
LIMIT_TOTAL_DAY = _int("CHAT_LIMIT_TOTAL_DAY", 2000)
MAX_MESSAGE_CHARS = 4000


def check_production() -> None:
    """Sem token, o agente não sobe em produção: chat aberto gastaria a sua chave de modelo."""
    if DEV:
        return
    if len(AGENT_API_TOKEN) < MIN_TOKEN_CHARS:
        raise RuntimeError(
            f"AGENT_API_TOKEN precisa ter {MIN_TOKEN_CHARS} caracteres ou mais. Gere com: npm run secrets"
        )
