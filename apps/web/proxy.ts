import { NextResponse } from 'next/server';

// Quais sites podem embutir o chat (o widget abre /embed num iframe). Separe por
// espaço: "https://loja.com.br https://www.loja.com.br". Sem a variável, qualquer
// site pode: o limite de uso protege o custo, mas restrinja em produção.
//
// Por que aqui e não no headers() do next.config: aquele é calculado no BUILD e fica
// gravado. Mudar a variável depois não mudaria nada, e o widget seguiria aberto a
// qualquer site. Aqui ela é lida a cada requisição.
export function proxy() {
  const allowed = (process.env.WIDGET_ALLOWED_ORIGINS ?? '').trim();
  const res = NextResponse.next();
  res.headers.set('Content-Security-Policy', `frame-ancestors ${allowed || '*'}`);
  return res;
}

export const config = { matcher: '/embed' };
