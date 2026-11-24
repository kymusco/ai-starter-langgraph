'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

type Pending = { runId: string; createdAt: string; category?: string; priority?: string; summary?: string; message?: string };
type Recent = { id: number; category: string; priority: string; summary: string; approved_by: string | null; created_at: string };
type Session = { enabled: boolean; name: string | null };

const LABELS: Record<string, string> = {
  cobranca: 'cobrança', tecnico: 'técnico', comercial: 'comercial', outro: 'outro',
  baixa: 'baixa', media: 'média', alta: 'alta',
};
const label = (v?: string) => (v ? LABELS[v] ?? v : '—');
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

async function errorOf(r: Response, fallback: string) {
  const body = (await r.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
}

export default function Admin() {
  const [session, setSession] = useState<Session | null>(null);
  const [pending, setPending] = useState<Pending[] | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/tickets', { cache: 'no-store' }).catch(() => null);
    if (r?.status === 401) return setSession((s) => (s ? { ...s, name: null } : s));
    if (!r?.ok) return setError('Não consegui carregar os chamados.');
    const data = (await r.json()) as { pending: Pending[]; recent: Recent[] };
    setPending(data.pending);
    setRecent(data.recent);
    setError('');
  }, []);

  useEffect(() => {
    fetch('/api/admin/session', { cache: 'no-store' }).then((r) => r.json()).then(setSession).catch(() => setError('Não consegui abrir a tela.'));
  }, []);
  useEffect(() => {
    if (!session?.name) return;
    void load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [session?.name, load]);

  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy('login');
    const r = await fetch('/api/admin/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: f.get('name'), password: f.get('password') }),
    }).catch(() => null);
    setBusy(null);
    if (!r?.ok) return setError(r ? await errorOf(r, 'Não consegui entrar.') : 'Não consegui entrar.');
    const { name } = (await r.json()) as { name: string };
    setError('');
    setSession({ enabled: true, name });
  }

  async function logout() {
    await fetch('/api/admin/session', { method: 'DELETE' }).catch(() => null);
    setPending(null);
    setSession((s) => (s ? { ...s, name: null } : s));
  }

  async function decide(runId: string, approved: boolean) {
    setBusy(runId);
    const r = await fetch(`/api/admin/tickets/${encodeURIComponent(runId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approved }),
    }).catch(() => null);
    setBusy(null);
    if (!r?.ok) setError(r ? await errorOf(r, 'Não consegui registrar a decisão.') : 'Não consegui registrar a decisão.');
    await load();
  }

  if (!session) return <main className="admin"><p className="muted">Carregando…</p></main>;
  if (!session.enabled) {
    return (
      <main className="admin">
        <h1>Aprovação de chamados</h1>
        <p className="muted">Esta tela está desligada. Defina <code>ADMIN_PASSWORD</code> (12 caracteres ou mais) nas variáveis do serviço <code>web</code>.</p>
      </main>
    );
  }
  if (!session.name) {
    return (
      <main className="admin narrow">
        <h1>Aprovação de chamados</h1>
        <form className="login" onSubmit={login}>
          <label>Seu nome<input name="name" autoComplete="name" required maxLength={80} /></label>
          <label>Senha<input name="password" type="password" autoComplete="current-password" required /></label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy === 'login'}>{busy === 'login' ? 'Entrando…' : 'Entrar'}</button>
        </form>
      </main>
    );
  }

  return (
    <main className="admin">
      <header className="admin-head">
        <h1>Aprovação de chamados</h1>
        <span className="muted">{session.name} · <button className="link" onClick={logout}>sair</button></span>
      </header>
      {error && <p className="error">{error}</p>}

      <h2>Aguardando aprovação{pending ? ` (${pending.length})` : ''}</h2>
      {pending === null && <p className="muted">Carregando…</p>}
      {pending?.length === 0 && <p className="muted">Nenhum chamado esperando.</p>}
      <ul className="tickets">
        {pending?.map((t) => (
          <li key={t.runId}>
            <div className="ticket-body">
              <p className="tags"><b>{label(t.priority)}</b> · {label(t.category)} · {when(t.createdAt)}</p>
              <p className="summary">{t.summary}</p>
              {t.message && <details><summary>Pedido do cliente</summary><p>{t.message}</p></details>}
            </div>
            <div className="ticket-actions">
              <button onClick={() => decide(t.runId, true)} disabled={busy === t.runId}>Aprovar</button>
              <button className="secondary" onClick={() => decide(t.runId, false)} disabled={busy === t.runId}>Recusar</button>
            </div>
          </li>
        ))}
      </ul>

      <h2>Chamados abertos</h2>
      {recent.length === 0 && <p className="muted">Nenhum ainda.</p>}
      <ul className="tickets compact">
        {recent.map((t) => (
          <li key={t.id}>
            <div className="ticket-body">
              <p className="tags"><b>#{t.id}</b> · {label(t.priority)} · {label(t.category)} · {when(t.created_at)} · {t.approved_by ? `aprovado por ${t.approved_by}` : 'sem aprovação necessária'}</p>
              <p className="summary">{t.summary}</p>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
