"""O agente: o modelo decide sozinho quando usar cada ferramenta (loop ReAct do LangChain)."""

from datetime import datetime
from zoneinfo import ZoneInfo

from langchain.agents import create_agent
from langchain.chat_models import init_chat_model
from langchain.tools import tool

from . import knowledge, tickets
from .config import MODEL

INSTRUCTIONS = """Você é o assistente do produto. Responda em português do Brasil, de forma direta.
- Para perguntas sobre o produto, use a ferramenta searchKnowledge antes de responder e cite a fonte.
- Se a base não tiver a resposta, diga que não sabe. Não invente.
- Se o cliente pedir atendimento humano ou pedir para abrir um chamado, use a ferramenta openTicket NA HORA, com o que ele já disse. O pedido já é o OK.
- Se a base não resolver e ele não pediu um chamado, ofereça abrir um; com o OK dele, use a ferramenta.
- Nunca condicione o chamado a mais dados. O time humano pede o que faltar.
- Nunca peça número de cartão, senha, token ou documento. Se o cliente enviar, não repita o valor.
- A prioridade é decidida pela triagem do chamado, não por você nem pelo cliente: não ofereça escolher.
- Depois de abrir: se o status for "registrado", informe o número do chamado; se for "aguardando_aprovacao", diga que o chamado foi registrado e aguarda a aprovação do time, sem prometer prazo.
- Não prometa anexar informação depois: diga que, se precisar de mais detalhes, o time vai pedir pelo chamado. Não afirme que alguém já entrou em contato."""


@tool("searchKnowledge")
async def search_knowledge(query: str) -> list[dict]:
    """Busca na base de conhecimento do produto. Use antes de responder sobre o produto."""
    return await knowledge.search(query)


@tool("currentTime")
def current_time(time_zone: str = "America/Sao_Paulo") -> dict:
    """Diz a data e a hora atuais num fuso horário IANA, ex.: America/Sao_Paulo.

    Ferramenta mínima, para copiar: troque por uma chamada à sua API, ao seu banco, a um CRM.
    """
    now = datetime.now(ZoneInfo(time_zone))
    return {"now": now.strftime("%d/%m/%Y %H:%M:%S %Z"), "timeZone": time_zone}


@tool("openTicket")
async def open_ticket(message: str) -> dict:
    """Abre um chamado para o time humano, com o pedido do cliente nas palavras dele."""
    return await tickets.open_ticket(message)


def model():
    # Atendimento precisa responder logo: com o raciocínio padrão, o gpt-5-mini fica
    # segundos em silêncio antes da primeira palavra. Outro provedor não recebe isto.
    extra = {"reasoning_effort": "low"} if MODEL.startswith("openai:gpt-5") else {}
    return init_chat_model(MODEL, **extra)


def build(checkpointer=None):
    return create_agent(
        model(),
        tools=[search_knowledge, current_time, open_ticket],
        system_prompt=INSTRUCTIONS,
        checkpointer=checkpointer,
        name="assistant",
    )
