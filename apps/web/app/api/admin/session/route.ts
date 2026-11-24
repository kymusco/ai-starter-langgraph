import { cookies } from 'next/headers';
import {
  adminEnabled, agentAuth, AGENT_URL, clientIp, createSession, isHttps, isSameOrigin, passwordMatches, readSession, SESSION_COOKIE, SESSION_SECONDS,
} from '../../../../lib/security';

export const dynamic = 'force-dynamic';

export async function GET() {
  const name = readSession((await cookies()).get(SESSION_COOKIE)?.value);
  return Response.json({ enabled: adminEnabled(), name });
}

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return Response.json({ error: 'Origem não permitida.' }, { status: 403 });
  if (!adminEnabled()) return Response.json({ error: 'A aprovação está desligada: defina ADMIN_PASSWORD.' }, { status: 503 });

  // Sem conseguir contar a tentativa, não confere a senha.
  const attempt = await fetch(`${AGENT_URL}/admin/login-attempt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...agentAuth() },
    body: JSON.stringify({ ip: clientIp(req) }),
  }).then((r) => (r.ok ? (r.json() as Promise<{ allowed: boolean }>) : null)).catch(() => null);
  if (!attempt) return Response.json({ error: 'Serviço indisponível. Tente de novo em instantes.' }, { status: 503 });
  if (!attempt.allowed) return Response.json({ error: 'Muitas tentativas. Tente de novo em uma hora.' }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { name?: unknown; password?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!name) return Response.json({ error: 'Diga o seu nome: ele fica registrado na aprovação.' }, { status: 400 });
  if (!passwordMatches(password)) return Response.json({ error: 'Senha incorreta.' }, { status: 401 });

  (await cookies()).set(SESSION_COOKIE, createSession(name), {
    httpOnly: true, sameSite: 'strict', secure: isHttps(req), path: '/', maxAge: SESSION_SECONDS,
  });
  return Response.json({ name });
}

export async function DELETE(req: Request) {
  if (!isSameOrigin(req)) return Response.json({ error: 'Origem não permitida.' }, { status: 403 });
  (await cookies()).delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
