"""Chamados: um grafo com passos fixos e aprovação humana.

    classify (o modelo classifica) ──▶ approve (pausa se a prioridade for alta) ──▶ save

Cada chamado é uma execução própria (thread `ticket-<id>`), guardada pelo checkpointer no
PostgreSQL: uma execução pausada sobrevive a reinício e a deploy. Quem aprova é a tela
/admin do web, que retoma a execução com a decisão.
"""

import uuid
from typing import Literal, TypedDict

from langchain.chat_models import init_chat_model
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from pydantic import BaseModel, Field

from .config import MODEL
from .db import pool


class Classification(BaseModel):
    category: Literal["cobranca", "tecnico", "comercial", "outro"]
    priority: Literal["baixa", "media", "alta"] = Field(
        description="alta: sistema fora do ar, cobrança indevida ou perda de dinheiro agora"
    )
    summary: str = Field(description="resumo em uma frase, em português")


class TicketState(TypedDict, total=False):
    run_id: str
    message: str
    category: str
    priority: str
    summary: str
    approved: bool
    approved_by: str | None
    ticket_id: int | None


async def ensure_tables() -> None:
    p = await pool()
    async with p.connection() as conn:
        await conn.execute(
            """CREATE TABLE IF NOT EXISTS tickets (
                 id serial PRIMARY KEY, run_id text UNIQUE NOT NULL, category text NOT NULL,
                 priority text NOT NULL, summary text NOT NULL, message text NOT NULL,
                 approved_by text, created_at timestamptz NOT NULL DEFAULT now())"""
        )
        # As execuções, para listar as pausadas sem varrer os checkpoints.
        await conn.execute(
            """CREATE TABLE IF NOT EXISTS ticket_runs (
                 run_id text PRIMARY KEY, status text NOT NULL, category text, priority text,
                 summary text, message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())"""
        )


async def _classify(state: TicketState) -> TicketState:
    model = init_chat_model(MODEL).with_structured_output(Classification)
    c: Classification = await model.ainvoke(
        "Classifique este pedido de suporte. Responda só com os campos pedidos.\n\n" + state["message"]
    )
    p = await pool()
    async with p.connection() as conn:
        await conn.execute(
            "UPDATE ticket_runs SET category = %s, priority = %s, summary = %s WHERE run_id = %s",
            (c.category, c.priority, c.summary, state["run_id"]),
        )
    return {"category": c.category, "priority": c.priority, "summary": c.summary}


async def _approve(state: TicketState) -> TicketState:
    if state["priority"] != "alta":
        return {"approved": True, "approved_by": None}
    # Pausa aqui. A execução fica no banco até alguém decidir no /admin.
    decision = interrupt({"summary": state["summary"], "priority": state["priority"]})
    return {"approved": bool(decision.get("approved")), "approved_by": decision.get("approvedBy")}


async def _save(state: TicketState) -> TicketState:
    p = await pool()
    async with p.connection() as conn:
        if not state.get("approved"):
            await conn.execute("UPDATE ticket_runs SET status = 'rejected' WHERE run_id = %s", (state["run_id"],))
            return {"ticket_id": None}
        # Uma execução grava um chamado só, mesmo com dois cliques em "aprovar".
        row = await (
            await conn.execute(
                """INSERT INTO tickets (run_id, category, priority, summary, message, approved_by)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON CONFLICT (run_id) DO UPDATE SET run_id = EXCLUDED.run_id RETURNING id""",
                (state["run_id"], state["category"], state["priority"], state["summary"], state["message"], state.get("approved_by")),
            )
        ).fetchone()
        await conn.execute("UPDATE ticket_runs SET status = 'saved' WHERE run_id = %s", (state["run_id"],))
    return {"ticket_id": row["id"]}


def build_graph(checkpointer=None):
    g = StateGraph(TicketState)
    g.add_node("classify", _classify)
    g.add_node("approve", _approve)
    g.add_node("save", _save)
    g.add_edge(START, "classify")
    g.add_edge("classify", "approve")
    g.add_edge("approve", "save")
    g.add_edge("save", END)
    return g.compile(checkpointer=checkpointer, name="open-ticket")


_graph = None


def set_checkpointer(checkpointer) -> None:
    global _graph
    _graph = build_graph(checkpointer)


def _config(run_id: str) -> dict:
    return {"configurable": {"thread_id": f"ticket-{run_id}"}}


async def open_ticket(message: str) -> dict:
    """Abre um chamado. Prioridade alta para e espera aprovação; as outras gravam na hora."""
    run_id = str(uuid.uuid4())
    p = await pool()
    async with p.connection() as conn:
        await conn.execute("INSERT INTO ticket_runs (run_id, status, message) VALUES (%s, 'running', %s)", (run_id, message))
    result = await _graph.ainvoke({"run_id": run_id, "message": message}, _config(run_id))
    if result.get("__interrupt__"):
        async with p.connection() as conn:
            await conn.execute("UPDATE ticket_runs SET status = 'pending' WHERE run_id = %s", (run_id,))
        return {"status": "aguardando_aprovacao", "priority": result["priority"], "summary": result["summary"]}
    return {"status": "registrado", "ticket": result.get("ticket_id"), "priority": result["priority"], "summary": result["summary"]}


async def pending_and_recent() -> dict:
    p = await pool()
    async with p.connection() as conn:
        pending = await (
            await conn.execute(
                "SELECT run_id, created_at, category, priority, summary, message FROM ticket_runs WHERE status = 'pending' ORDER BY created_at DESC LIMIT 50"
            )
        ).fetchall()
        recent = await (
            await conn.execute(
                "SELECT id, category, priority, summary, approved_by, created_at FROM tickets ORDER BY id DESC LIMIT 20"
            )
        ).fetchall()
    return {
        "pending": [
            {"runId": r["run_id"], "createdAt": r["created_at"].isoformat(), "category": r["category"],
             "priority": r["priority"], "summary": r["summary"], "message": r["message"]}
            for r in pending
        ],
        "recent": [{**r, "created_at": r["created_at"].isoformat()} for r in recent],
    }


async def decide(run_id: str, approved: bool, approved_by: str) -> tuple[int, dict]:
    """Retoma a execução pausada. Devolve (status HTTP, corpo)."""
    p = await pool()
    async with p.connection() as conn:
        # Atômico: dois cliques ao mesmo tempo, só um decide.
        row = await (
            await conn.execute(
                "UPDATE ticket_runs SET status = 'deciding' WHERE run_id = %s AND status = 'pending' RETURNING run_id",
                (run_id,),
            )
        ).fetchone()
        if not row:
            exists = await (await conn.execute("SELECT status FROM ticket_runs WHERE run_id = %s", (run_id,))).fetchone()
            return (404, {"error": "Chamado não encontrado."}) if not exists else (409, {"error": "Este chamado já foi decidido."})
    try:
        await _graph.ainvoke(Command(resume={"approved": approved, "approvedBy": approved_by}), _config(run_id))
    except Exception:
        async with p.connection() as conn:
            await conn.execute("UPDATE ticket_runs SET status = 'pending' WHERE run_id = %s AND status = 'deciding'", (run_id,))
        return 502, {"error": "Não consegui concluir a decisão."}
    return 200, {"ok": True, "approved": approved}
