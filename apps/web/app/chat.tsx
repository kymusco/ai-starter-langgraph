'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';

// O que o agente está fazendo com cada ferramenta, em linguagem de gente.
const TOOL_NAMES: Record<string, string> = {
  searchKnowledge: 'a base de conhecimento',
  currentTime: 'o relógio',
  openTicket: 'o time de suporte (abrindo chamado)',
};
function toolLabel(tool: string, state: string | undefined): string {
  const name = TOOL_NAMES[tool] ?? tool;
  if (state === 'output-available') return `✓ consultou ${name}`;
  if (state === 'output-error') return `⚠ não conseguiu consultar ${name}`;
  return `🔎 consultando ${name}…`;
}

// O servidor manda o motivo ({"error": "..."}), como no limite de uso. Sem motivo, o genérico.
function errorText(error: Error): string {
  try {
    const parsed = JSON.parse(error.message) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {}
  return 'Não foi possível responder agora.';
}

/**
 * Quem é o visitante: um id aleatório guardado neste navegador. A memória do agente
 * separa as conversas por ele, e o limite de uso conta por ele.
 *
 * Por que localStorage e não cookie: dentro do widget (um iframe em OUTRO site), o
 * cookie vira de terceiro e o navegador não o manda. Troque pelo id do usuário
 * logado quando o app tiver login.
 */
const VISITOR_KEY = 'ai-starter:visitor';
function visitorId(): string {
  let id = localStorage.getItem(VISITOR_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}

// Distância do fim (px) em que a pessoa ainda conta como "acompanhando" a resposta.
const NEAR_BOTTOM = 80;

const Thinking = () => (
  <span className="thinking" role="status" aria-label="O assistente está pensando">
    <i /><i /><i />
  </span>
);

export function Chat({ variant = 'page' }: { variant?: 'page' | 'embed' }) {
  const [input, setInput] = useState('');
  const [away, setAway] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const following = useRef(true);
  // Durante a rolagem suave do botão, as posições do meio não são a pessoa subindo.
  const jumping = useRef(false);
  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/chat', headers: () => ({ 'x-visitor-id': visitorId() }) }),
    [],
  );
  const { messages, sendMessage, regenerate, status, error, stop } = useChat({ transport });
  const busy = status === 'submitted' || status === 'streaming';
  const last = messages.at(-1);
  const lastHasText = last?.role === 'assistant' && last.parts.some((p) => p.type === 'text' && p.text.trim());

  // Acompanha a resposta, a não ser que a pessoa tenha subido para reler.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [messages, status, error]);

  // O campo cresce com o texto, até o limite do CSS.
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [input]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
    if (jumping.current && !near) return;
    jumping.current = false;
    following.current = near;
    setAway(!near);
  }

  function toBottom() {
    const el = listRef.current;
    if (!el) return;
    jumping.current = true;
    following.current = true;
    setAway(false);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }

  // A pessoa mexeu durante o salto: quem manda é ela.
  function cancelJump() {
    jumping.current = false;
  }

  function send() {
    const text = input.trim();
    if (!text || busy) return;
    following.current = true;
    setAway(false);
    sendMessage({ text });
    setInput('');
    fieldRef.current?.focus();
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send();
  }

  // Enter envia, Shift+Enter quebra a linha. No celular, Enter é só quebra de linha.
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    if (window.matchMedia('(pointer: coarse)').matches) return;
    e.preventDefault();
    send();
  }

  return (
    <main className={`chat ${variant}`}>
      <header>
        <h1>Assistente</h1>
        <p>Pergunte sobre o produto. As respostas vêm da base de conhecimento.</p>
      </header>

      <div className="thread">
        <ol className="messages" ref={listRef} onScroll={onScroll} onWheel={cancelJump} onTouchMove={cancelJump} role="log" aria-label="Conversa">
          {messages.length === 0 && (
            <li className="empty">Experimente: “Qual é a política de reembolso?”</li>
          )}
          {messages.map((m) => (
            <li key={m.id} className={m.role}>
              {m.parts.map((part, i) => {
                if (part.type === 'text') {
                  // O modelo responde em Markdown. O componente não executa HTML vindo dele.
                  return m.role === 'assistant'
                    ? <div key={i} className="md"><ReactMarkdown>{part.text}</ReactMarkdown></div>
                    : <p key={i}>{part.text}</p>;
                }
                if (part.type.startsWith('tool-') && 'state' in part) {
                  return <p key={i} className="tool">{toolLabel(part.type.slice(5), part.state)}</p>;
                }
                return null;
              })}
              {busy && m === last && m.role === 'assistant' && !lastHasText && <Thinking />}
            </li>
          ))}
          {busy && last?.role === 'user' && <li className="assistant"><Thinking /></li>}
        </ol>
        {away && (
          <button type="button" className="to-bottom" onClick={toBottom} aria-label="Ir para o fim da conversa">↓</button>
        )}
      </div>

      {error && (
        <p className="error">
          {errorText(error)} <button type="button" onClick={() => regenerate()}>Tentar de novo</button>
        </p>
      )}

      <form className="composer" onSubmit={onSubmit}>
        <textarea
          ref={fieldRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Escreva sua pergunta"
          aria-label="Mensagem"
          maxLength={4000}
          autoFocus={variant === 'page'}
        />
        {busy ? (
          <button type="button" onClick={stop}>Parar</button>
        ) : (
          <button type="submit" disabled={!input.trim()}>Enviar</button>
        )}
      </form>
      <p className="hint">Enter envia · Shift + Enter quebra a linha</p>
    </main>
  );
}
