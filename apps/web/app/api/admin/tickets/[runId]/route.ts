import { cookies } from 'next/headers';
import { AGENT_URL, agentAuth, isSameOrigin, readSession, SESSION_COOKIE } from '../../../../../lib/security';

export async function POST(req: Request, ctx: { params: Promise<{ runId: string }> }) {
  if (!isSameOrigin(req)) return Response.json({ error: 'Origem não permitida.' }, { status: 403 });
  // Quem aprovou vem da sessão, nunca do corpo da requisição.
  const name = readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!name) return Response.json({ error: 'Entre de novo.' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { approved?: unknown } | null;
  if (typeof body?.approved !== 'boolean') return Response.json({ error: 'Decisão inválida.' }, { status: 400 });

  const { runId } = await ctx.params;
  const r = await fetch(`${AGENT_URL}/admin/tickets/${encodeURIComponent(runId)}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...agentAuth() },
    body: JSON.stringify({ approved: body.approved, approvedBy: name }),
  }).catch(() => null);
  if (!r) return Response.json({ error: 'O agente não respondeu.' }, { status: 502 });
  return Response.json(await r.json().catch(() => ({})), { status: r.status });
}
