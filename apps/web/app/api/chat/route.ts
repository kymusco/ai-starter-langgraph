import { AGENT_URL, agentAuth, clientIp, isSameOrigin } from '../../../lib/security';

// O navegador fala só com o web; o web repassa ao agente pela rede privada.
// Assim o agente (e a chave do modelo) nunca fica exposto na internet.
// O visitante chega num cabeçalho, gerado e guardado pelo navegador (app/chat.tsx).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Mensagem maior que isto não chega ao modelo: corta abuso barato (colar um livro).
const MAX_MESSAGE_CHARS = 4000;

type UIMessage = { role?: string; parts?: { type?: string; text?: string }[] };

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return Response.json({ error: 'Origem não permitida.' }, { status: 403 });
  const { id, messages } = (await req.json()) as { id: string; messages: UIMessage[] };
  const last = messages.at(-1);
  const text = (last?.parts ?? []).map((p) => (p.type === 'text' ? p.text ?? '' : '')).join('');
  if (!last || typeof id !== 'string' || !text.trim()) {
    return Response.json({ error: 'Mensagem vazia.' }, { status: 400 });
  }
  if (text.length > MAX_MESSAGE_CHARS) {
    return Response.json({ error: `Mensagem longa demais: o limite é de ${MAX_MESSAGE_CHARS} caracteres.` }, { status: 413 });
  }

  // Quem é o visitante: um id aleatório (122 bits) que o navegador guarda. Não dá para
  // adivinhar o de outra pessoa, e o agente recusa conversa de outro dono. Quem trocar
  // de id para fugir do limite por visitante cai no limite por IP.
  const visitor = req.headers.get('x-visitor-id') ?? '';
  if (!UUID_RE.test(visitor)) {
    return Response.json({ error: 'Visitante inválido. Recarregue a página.' }, { status: 400 });
  }

  const upstream = await fetch(`${AGENT_URL}/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // O token fica só no servidor do web e, no agente, vale apenas para o chat.
      ...agentAuth(),
      // O agente usa estes dois para o limite de uso (middleware/rate-limit.ts).
      'x-visitor-id': visitor,
      'x-client-ip': clientIp(req),
    },
    body: JSON.stringify({
      // Com memória, basta a mensagem nova: o agente carrega o resto do banco.
      messages: [last],
      memory: { thread: id, resource: visitor },
    }),
    signal: req.signal,
  }).catch(() => null);

  // Limite de uso (429) ou indisponível (503): a mensagem do agente vai ao navegador.
  if (upstream && (upstream.status === 429 || upstream.status === 503)) {
    const body = (await upstream.json().catch(() => ({}))) as { error?: string };
    return Response.json({ error: body.error ?? 'Tente de novo em instantes.' }, { status: upstream.status });
  }
  if (!upstream || !upstream.ok || !upstream.body) {
    return Response.json({ error: 'O agente não respondeu. Tente de novo em instantes.' }, { status: 502 });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'text/event-stream',
      'x-vercel-ai-ui-message-stream': upstream.headers.get('x-vercel-ai-ui-message-stream') ?? 'v1',
      // Sem isto, compressão e proxies podem juntar a resposta e entregar tudo no fim.
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
