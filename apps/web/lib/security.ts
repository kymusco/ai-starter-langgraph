import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const AGENT_URL = process.env.AGENT_URL || 'http://localhost:8000';

/** O token do web no agente (AGENT_API_TOKEN). Fica só no servidor, nunca vai ao navegador. */
export function agentAuth(): Record<string, string> {
  const t = process.env.AGENT_API_TOKEN;
  return t ? { authorization: `Bearer ${t}` } : {};
}
export const SESSION_COOKIE = 'admin_session';
export const SESSION_SECONDS = 8 * 60 * 60;
const MIN_PASSWORD = 12;

/**
 * A chamada veio de uma página deste mesmo endereço? O widget passa: ele roda em
 * /embed, servido por este app. Isto barra OUTRO SITE no navegador. Um script fora
 * do navegador forja o cabeçalho: contra ele, quem protege o custo é o limite de uso.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').split(',')[0].trim().toLowerCase();
  try {
    return !!host && new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

/** O IP de quem chamou, como o proxy da frente repassa. */
export function clientIp(req: Request): string {
  const h = req.headers;
  return h.get('cf-connecting-ip') ?? h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0].trim() ?? 'desconhecido';
}

export function isHttps(req: Request): boolean {
  return (req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '')) === 'https';
}

/** Sem senha (ou curta demais), a tela de aprovação fica fechada. */
function adminPassword(): string | null {
  const p = process.env.ADMIN_PASSWORD ?? '';
  return p.length >= MIN_PASSWORD ? p : null;
}
export const adminEnabled = () => adminPassword() !== null;

const sha = (s: string) => createHash('sha256').update(s).digest();
const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

export function passwordMatches(candidate: string): boolean {
  const p = adminPassword();
  return !!p && same(sha(candidate), sha(p));
}

function sign(payload: string, password: string): string {
  return createHmac('sha256', `admin-session:${password}`).update(payload).digest('base64url');
}

/** Sessão sem estado: nome + validade, assinados. Trocar a senha derruba todas. */
export function createSession(name: string): string {
  const p = adminPassword();
  if (!p) throw new Error('admin desligado');
  const payload = `${Buffer.from(name).toString('base64url')}.${Math.floor(Date.now() / 1000) + SESSION_SECONDS}`;
  return `${payload}.${sign(payload, p)}`;
}

/** O nome de quem está logado, ou null. */
export function readSession(token: string | undefined): string | null {
  const p = adminPassword();
  if (!p || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payload = `${parts[0]}.${parts[1]}`;
  if (!same(Buffer.from(parts[2]), Buffer.from(sign(payload, p)))) return null;
  if (Number(parts[1]) <= Date.now() / 1000) return null;
  return Buffer.from(parts[0], 'base64url').toString();
}
