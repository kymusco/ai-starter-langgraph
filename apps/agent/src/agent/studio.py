"""Grafos para o LangGraph Studio, no seu computador (`npm run studio`).

O `langgraph dev` traz o próprio armazenamento de conversas, então aqui os grafos nascem
sem checkpointer. As ferramentas usam o mesmo PostgreSQL do app (base e chamados).
"""

import sys
from pathlib import Path

# O `langgraph dev` carrega este arquivo sozinho, fora do pacote: aponta para src/.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agent import assistant, tickets  # noqa: E402

assistant_graph = assistant.build()
tickets_graph = tickets.build_graph()
