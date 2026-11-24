"""Do streaming do LangGraph para o formato que o chat entende (UI message stream do AI SDK).

O contrato completo está em docs/contrato-do-agente.md. Em resumo: start, a chamada e o
resultado de cada ferramenta, o texto aos poucos (text-start, text-delta, text-end), finish.
"""

import json
import logging
import uuid
from collections.abc import AsyncIterator
from typing import Any

from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage

log = logging.getLogger("agent.stream")
HEADERS = {
    "x-vercel-ai-ui-message-stream": "v1",
    "cache-control": "no-cache, no-transform",
    "x-accel-buffering": "no",
}


def sse(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"


def _text(chunk: AIMessageChunk) -> str:
    # Em mensagens com blocos (Responses API), `.text` junta só o texto visível.
    t = chunk.text
    return t if isinstance(t, str) else ""


def _output(content: Any) -> Any:
    if isinstance(content, str):
        try:
            return json.loads(content)
        except ValueError:
            return content
    return content


async def ui_stream(agent, payload: dict, config: dict) -> AsyncIterator[str]:
    yield sse({"type": "start", "messageId": str(uuid.uuid4())})
    text_id: str | None = None
    seen_calls: set[str] = set()
    try:
        async for ns, mode, data in agent.astream(payload, config, stream_mode=["messages", "updates"], subgraphs=True):
            # Só o grafo do agente fala com o cliente. O que roda dentro das ferramentas
            # (a triagem do chamado também chama o modelo) fica de fora.
            if ns:
                continue
            if mode == "messages":
                chunk, meta = data
                if isinstance(chunk, AIMessageChunk) and meta.get("langgraph_node") == "model":
                    delta = _text(chunk)
                    if delta:
                        if text_id is None:
                            text_id = f"t-{uuid.uuid4().hex[:8]}"
                            yield sse({"type": "text-start", "id": text_id})
                        yield sse({"type": "text-delta", "id": text_id, "delta": delta})
                continue
            # mode == "updates": mensagens completas de cada passo.
            for update in (data or {}).values():
                for msg in (update or {}).get("messages", []) if isinstance(update, dict) else []:
                    if isinstance(msg, AIMessage):
                        for call in msg.tool_calls:
                            if call["id"] in seen_calls:
                                continue
                            seen_calls.add(call["id"])
                            if text_id is not None:
                                yield sse({"type": "text-end", "id": text_id})
                                text_id = None
                            yield sse({"type": "tool-input-available", "toolCallId": call["id"], "toolName": call["name"], "input": call["args"]})
                    elif isinstance(msg, ToolMessage):
                        yield sse({"type": "tool-output-available", "toolCallId": msg.tool_call_id, "output": _output(msg.content)})
    except Exception as e:  # o cliente vê uma frase; o detalhe fica no log
        log.exception("falha no streaming")
        yield sse({"type": "error", "errorText": "Não foi possível responder agora."})
        del e
    if text_id is not None:
        yield sse({"type": "text-end", "id": text_id})
    yield sse({"type": "finish"})
    yield "data: [DONE]\n\n"
