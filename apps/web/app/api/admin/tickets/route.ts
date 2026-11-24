import { cookies } from 'next/headers';
import { AGENT_URL, agentAuth, readSession, SESSION_COOKIE } from '../../../../lib/security';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!readSession((await cookies()).get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: 'Entre de novo.' }, { status: 401 });
  }
  const r = await fetch(`${AGENT_URL}/admin/tickets`, { cache: 'no-store', headers: agentAuth() }).catch(() => null);
  if (!r?.ok) return Response.json({ error: 'Não consegui carregar os chamados.' }, { status: 502 });
  return Response.json(await r.json());
}
