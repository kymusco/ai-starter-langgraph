import asyncio
import json

from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage

from agent.knowledge import CHUNK_CHARS, _chunks
from agent.stream import ui_stream


class FakeAgent:
    """Imita o `astream` do LangGraph: (namespace, modo, dado)."""

    def __init__(self, events):
        self.events = events

    async def astream(self, *_args, **_kwargs):
        for e in self.events:
            yield e


def run(events) -> list[dict]:
    async def collect():
        out = []
        async for line in ui_stream(FakeAgent(events), {}, {}):
            if line.startswith("data: {"):
                out.append(json.loads(line[6:]))
            elif line.strip():
                out.append({"raw": line.strip()})
        return out

    return asyncio.run(collect())


def test_texto_ferramenta_e_ordem():
    call = {"id": "c1", "name": "searchKnowledge", "args": {"query": "reembolso"}}
    evs = run([
        ((), "updates", {"model": {"messages": [AIMessage(content="", tool_calls=[call])]}}),
        ((), "updates", {"tools": {"messages": [ToolMessage(content='{"results": []}', tool_call_id="c1")]}}),
        ((), "messages", (AIMessageChunk(content="Você pode "), {"langgraph_node": "model"})),
        ((), "messages", (AIMessageChunk(content="pedir reembolso."), {"langgraph_node": "model"})),
    ])
    tipos = [e.get("type") or e["raw"] for e in evs]
    assert tipos == ["start", "tool-input-available", "tool-output-available", "text-start", "text-delta", "text-delta", "text-end", "finish", "data: [DONE]"]
    assert evs[1]["toolName"] == "searchKnowledge" and evs[1]["input"] == {"query": "reembolso"}
    assert evs[2]["output"] == {"results": []}
    assert "".join(e.get("delta", "") for e in evs) == "Você pode pedir reembolso."


def test_modelo_dentro_da_ferramenta_nao_vaza():
    evs = run([
        (("tools:abc",), "messages", (AIMessageChunk(content='{"category": "tecnico"}'), {"langgraph_node": "classify"})),
        ((), "messages", (AIMessageChunk(content="Chamado aberto."), {"langgraph_node": "model"})),
    ])
    texto = "".join(e.get("delta", "") for e in evs)
    assert texto == "Chamado aberto."


def test_erro_vira_frase_e_fecha_o_stream():
    class Quebra:
        async def astream(self, *_a, **_k):
            raise RuntimeError("detalhe interno")
            yield  # pragma: no cover

    async def collect():
        return [line async for line in ui_stream(Quebra(), {}, {})]

    linhas = asyncio.run(collect())
    assert any('"type": "error"' in l and "detalhe interno" not in l for l in linhas)
    assert linhas[-1].strip() == "data: [DONE]"


def test_pedacos_da_base():
    texto = "\n\n".join(f"Parágrafo {i}. " + "x" * 300 for i in range(20))
    pedacos = _chunks(texto)
    assert len(pedacos) > 1
    assert all(len(p) <= CHUNK_CHARS + 400 for p in pedacos)
    assert "Parágrafo 0." in pedacos[0] and "Parágrafo 19." in pedacos[-1]
