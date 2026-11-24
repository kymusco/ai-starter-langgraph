"""Servidor HTTP do agente. Fala o contrato de docs/contrato-do-agente.md com o app web."""

import hmac
import logging
import re
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from pydantic import BaseModel, Field

from . import assistant, db, knowledge, tickets, usage
from .config import AGENT_API_TOKEN, DEV, MAX_MESSAGE_CHARS, check_production
from .stream import HEADERS, ui_stream

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("agent")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
LOGIN_ATTEMPTS_PER_HOUR = 10

state: dict = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    check_production()
    pool = await db.pool()
    # Conversas e execuções pausadas ficam no PostgreSQL: sobrevivem a reinício e a deploy.
    checkpointer = AsyncPostgresSaver(pool)
    await checkpointer.setup()
    await tickets.ensure_tables()
    await usage.ensure_table()
    tickets.set_checkpointer(checkpointer)
    state["agent"] = assistant.build(checkpointer)
    try:
        await knowledge.sync()
    except Exception:
        # Sem a base o chat ainda responde; o erro fica no log para você ver.
        log.exception("não consegui carregar a base de conhecimento")
    yield
    await db.close()


app = FastAPI(title="agent", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def require_token(authorization: str | None = Header(default=None)) -> None:
    """Só o app web chama o agente. Em `npm run dev`, sem token."""
    if DEV and not AGENT_API_TOKEN:
        return
    sent = (authorization or "").removeprefix("Bearer ").strip()
    if not sent or not hmac.compare_digest(sent.encode(), AGENT_API_TOKEN.encode()):
        raise HTTPException(status_code=401, detail="Token inválido.")


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


@app.get("/health")
async def health():
    return {"ok": True}


class Part(BaseModel):
    type: str
    text: str | None = None


class Message(BaseModel):
    id: str | None = None
    role: str
    parts: list[Part] = Field(default_factory=list)


class Memory(BaseModel):
    thread: str = Field(min_length=1, max_length=200)
    resource: str


class ChatBody(BaseModel):
    messages: list[Message] = Field(min_length=1)
    memory: Memory


@app.post("/chat", dependencies=[Depends(require_token)])
async def chat(body: ChatBody, x_visitor_id: str = Header(default=""), x_client_ip: str = Header(default="desconhecido")):
    if not UUID_RE.match(x_visitor_id) or body.memory.resource != x_visitor_id:
        raise HTTPException(status_code=400, detail="Visitante inválido. Recarregue a página.")
    text = "".join(p.text or "" for p in body.messages[-1].parts if p.type == "text").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Mensagem vazia.")
    if len(text) > MAX_MESSAGE_CHARS:
        raise HTTPException(status_code=413, detail=f"Mensagem longa demais: o limite é de {MAX_MESSAGE_CHARS} caracteres.")
    try:
        refused = await usage.over_limit(x_visitor_id, x_client_ip[:64])
    except Exception:
        log.exception("limite de uso: não consegui contar")
        return JSONResponse({"error": "O assistente está indisponível agora. Tente de novo em instantes."}, status_code=503)
    if refused:
        return JSONResponse({"error": refused, "code": "rate_limited"}, status_code=429)
    # A conversa pertence ao visitante: o id dele faz parte da thread, então ninguém lê a de outro.
    config = {"configurable": {"thread_id": f"{x_visitor_id}:{body.memory.thread}"}}
    payload = {"messages": [{"role": "user", "content": text}]}
    return StreamingResponse(ui_stream(state["agent"], payload, config), media_type="text/event-stream", headers=HEADERS)


# ── Aprovação de chamados (tela /admin do web) ───────────────────────────────

class LoginAttempt(BaseModel):
    ip: str = ""


class Decision(BaseModel):
    approved: bool
    approvedBy: str = Field(min_length=1, max_length=80)


@app.post("/admin/login-attempt", dependencies=[Depends(require_token)])
async def login_attempt(body: LoginAttempt):
    count = await usage.hit(f"login:{(body.ip or 'desconhecido')[:64]}", "hour")
    return {"allowed": count <= LOGIN_ATTEMPTS_PER_HOUR}


@app.get("/admin/tickets", dependencies=[Depends(require_token)])
async def admin_tickets():
    return await tickets.pending_and_recent()


@app.post("/admin/tickets/{run_id}/decision", dependencies=[Depends(require_token)])
async def admin_decision(run_id: str, body: Decision):
    status, payload = await tickets.decide(run_id, body.approved, body.approvedBy.strip())
    return JSONResponse(payload, status_code=status)
