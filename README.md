# AI Starter — LangGraph

Um app de IA completo, pronto para editar e publicar, com o agente em **Python**:

- **Chat** em Next.js, com a resposta chegando em tempo real, e um **widget** para pôr em
  qualquer site.
- **Agente** com [LangGraph](https://langchain-ai.github.io/langgraph/): ferramentas, memória
  por conversa e busca na base de conhecimento do seu produto (RAG).
- **Chamados com aprovação humana**: o agente abre chamados; os urgentes esperam alguém
  aprovar na tela `/admin` antes de gravar.
- **PostgreSQL com pgvector**: conversas, execuções pausadas, vetores e os dados do seu app no
  mesmo banco.

```
navegador ──▶ web (Next.js, público) ──token──▶ agent (Python + LangGraph, privado) ──▶ db (PostgreSQL + pgvector)
```

O agente não tem endereço público: só o `web` fala com ele, com um token. A chave do modelo
mora só no agente.

Existe também a [versão em TypeScript, com Mastra](https://github.com/kymusco/ai-starter). Os
dois usam o mesmo chat: ele conversa com o agente por um [contrato HTTP](docs/contrato-do-agente.md),
não importa o framework.

## Rodar no seu computador

Precisa de Node 22.13+, [uv](https://docs.astral.sh/uv/) e Docker (para o banco).

```bash
cp .env.example .env      # ponha a sua OPENAI_API_KEY
npm run secrets           # gera o token do agente e a senha do /admin no .env
npm install               # instala o web e o agente (uv sync)
npm run db                # cria o PostgreSQL com pgvector no Docker (depois: npm run db:start)
npm run dev               # agente em :8000, chat em http://localhost:3000
```

O agente carrega `apps/agent/docs` como base de conhecimento na primeira subida e de novo
sempre que os documentos mudarem, inclusive num novo deploy.

## Agente e grafo: os dois modos

- **Agente** (`src/agent/assistant.py`): o modelo decide sozinho quando usar cada ferramenta.
  Bom para conversa aberta.
- **Grafo** (`src/agent/tickets.py`): passos fixos, na ordem que você define. Bom para processo
  com regra:

  ```
  classify (o modelo classifica) ──▶ approve (pausa se a prioridade for alta) ──▶ save (grava em tickets)
  ```

  O agente usa o grafo pela ferramenta `openTicket`. Uma execução pausada fica salva no
  PostgreSQL (checkpointer do LangGraph) e sobrevive a reinício e a deploy.

## Gerenciar os agentes

| quero… | onde |
|---|---|
| ver o grafo, conversar e inspecionar o estado passo a passo | **LangGraph Studio**, no seu computador: `npm run studio` |
| aprovar ou recusar chamados urgentes | **`/admin`** do web, com seu nome e a `ADMIN_PASSWORD` |
| ver o rastro de cada conversa (modelo, ferramentas, tokens, tempo) | **LangSmith**, opcional: `LANGSMITH_TRACING=true` e a sua chave no `.env` |

O Studio é uma página do LangSmith que se conecta ao servidor local do LangGraph, e pede uma
conta (há plano gratuito). Para desligar o envio de rastros, deixe `LANGSMITH_TRACING` fora do
`.env`: nada sai do seu computador.

O `/admin` é um exemplo de como retomar uma execução pausada a partir do seu próprio app:
troque pela tela, pelo e-mail ou pelo sistema de chamados que você já usa.

## Publicar na Kymus

```bash
npx kymus login              # escolha o projeto e o alcance "também criar serviços"
npx kymus deploy --env sandbox
```

O `kymus.yaml` descreve os três serviços e como eles se ligam: o `deploy` cria o banco, o
agente e o chat, envia a pasta de cada um (`apps/agent`, `apps/web`) e implanta, nessa ordem.
O banco e a senha dele nascem na hora. Os segredos (chave do modelo, `AGENT_API_TOKEN` e
`ADMIN_PASSWORD`) saem do `.env`: o `deploy` pergunta se pode levá-los, como segredo do
serviço, nunca no pacote. Só o `web` ganha endereço público.

O build do agente instala as dependências pelo `uv.lock`. Sem o token, o agente não sobe em
produção.

Produção só pelo nome: `npx kymus deploy --env production`.

## Pôr o assistente em outro site (widget)

Uma linha, em qualquer página (HTML, WordPress, outro framework):

```html
<script src="https://SEU-ENDERECO/widget.js" async></script>
```

Aparece um botão no canto; o chat abre num painel (tela cheia no celular). Opcionais:
`data-color="#2f4f3a"`, `data-position="left"`, `data-label="Fale com a gente"`.
Para testar localmente: `npx serve examples -l 5500` e abra `http://localhost:5500/widget-demo.html`.

Em produção, diga quais sites podem exibir o widget, nas variáveis do `web`:
`WIDGET_ALLOWED_ORIGINS="https://loja.com.br https://www.loja.com.br"`.

## Limite de uso

Cada mensagem custa dinheiro de modelo, e a rota do chat é pública. O agente conta no
PostgreSQL (vale com várias réplicas e sobrevive a deploy) e recusa com uma mensagem amigável
quando passa de um limite:

| variável | padrão | o quê |
|---|---|---|
| `CHAT_LIMIT_VISITOR_HOUR` | 30 | mensagens por visitante por hora |
| `CHAT_LIMIT_IP_HOUR` | 100 | mensagens por endereço IP por hora |
| `CHAT_LIMIT_TOTAL_DAY` | 2000 | teto do dia para o app inteiro (a rede de segurança do custo) |

Mensagens com mais de 4.000 caracteres são recusadas antes de chegar ao modelo.

## Onde mexer

| quero… | arquivo |
|---|---|
| mudar o comportamento do agente | `apps/agent/src/agent/assistant.py` |
| dar uma ferramenta nova ao agente | `apps/agent/src/agent/assistant.py` (copie `current_time`) |
| criar um processo com passos e aprovação | `apps/agent/src/agent/tickets.py` |
| trocar a base de conhecimento | `apps/agent/docs/` (o próximo deploy recarrega; no local, reinicie o agente) |
| trocar o modelo ou o provedor | `MODEL` e `EMBEDDING_MODEL` no `.env` |
| mudar a tela | `apps/web/app/chat.tsx` e `globals.css` (a página e o widget usam o mesmo componente) |
| mudar a tela de aprovação | `apps/web/app/admin/page.tsx` |
| mudar o botão do widget | `apps/web/public/widget.js` |

### Trocar de provedor

`MODEL` aceita `provedor:modelo`, como o LangChain entende: `anthropic:claude-sonnet-4-5`,
`google_genai:gemini-2.5-flash`. Instale o pacote do provedor (`cd apps/agent && uv add
langchain-anthropic`) e ponha a chave dele (`ANTHROPIC_API_KEY`). O `EMBEDDING_MODEL` precisa de
um provedor que gere embeddings; ao trocá-lo, a base é recarregada na próxima subida.

## Licença

MIT
