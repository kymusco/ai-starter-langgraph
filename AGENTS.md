# Instruções para agentes de IA

## Estrutura

- `apps/agent`: servidor Python (FastAPI, porta 8000) com LangGraph. Dependências pelo `uv`
  (`uv add <pacote>`, nunca `pip install` solto); o `uv.lock` vai no repositório.
  - `src/agent/main.py`: rotas HTTP, token e limite de uso. Segue `docs/contrato-do-agente.md`.
  - `src/agent/assistant.py`: o agente e as ferramentas. Ferramenta nova: uma função com
    `@tool("nomeEmCamelCase")` e uma docstring que diz quando usar; registre em `build()`.
  - `src/agent/tickets.py`: grafo com passos fixos e aprovação humana (`interrupt`).
  - `src/agent/stream.py`: streaming do LangGraph para o formato do chat (AI SDK).
  - `docs/`: a base de conhecimento (Markdown).
- `apps/web`: Next.js (App Router). `app/api/chat/route.ts` repassa a conversa ao agente.
  `app/chat.tsx` é o chat, usado pela página (`/`) e pelo widget (`/embed`). `app/admin` aprova
  chamados.

## Regras

- **O agente é privado.** Não exponha `apps/agent` na internet. O `web` chama com
  `AGENT_API_TOKEN`; sem ele o agente não sobe em produção.
- **Segredo só no servidor.** Chaves de modelo ficam no `agent`. Nada com `NEXT_PUBLIC_`
  carrega segredo.
- **Variável nova:** documente em `.env.example` e declare no serviço certo do `kymus.yaml`
  (`secret: true` quando for segredo). Referência a outro serviço: `${{ servico.VARIAVEL }}`.
- **Conversa pertence ao visitante:** a `thread_id` do LangGraph é `<x-visitor-id>:<thread>`.
  Não aceite id de conversa sem o dono.
- **Mudou o pedido ou a resposta do chat?** Atualize `docs/contrato-do-agente.md`.
- **Modelo dentro de ferramenta** não fala com o cliente: o `stream.py` só repassa o nó `model`
  do grafo principal.
- **Testes:** `npm test` (pytest). O streaming tem teste sem banco nem chave.
- **Conexão com o banco** é sempre a `DATABASE_URL`, montada no `kymus.yaml` com as referências
  do `db`. Não escreva host, usuário ou senha no código.
