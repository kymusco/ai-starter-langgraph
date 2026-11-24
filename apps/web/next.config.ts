import { existsSync } from 'node:fs';
import type { NextConfig } from 'next';

// Em desenvolvimento, o .env da raiz vale para os dois apps. Em produção, as
// variáveis vêm do serviço.
if (process.env.NODE_ENV !== 'production' && existsSync('../../.env')) process.loadEnvFile('../../.env');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // O indicador do modo dev cobre o campo de mensagem dentro do widget.
  devIndicators: false,
  async headers() {
    return [
      {
        // O resto do app não entra em iframe de ninguém (protege contra clickjacking).
        source: '/((?!embed).*)',
        headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self'" }],
      },
      // /embed: o cabeçalho sai do proxy.ts, lido a cada requisição (WIDGET_ALLOWED_ORIGINS).
      {
        // O script do widget muda a cada deploy: cache curto.
        source: '/widget.js',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=300' }],
      },
    ];
  },
};

export default nextConfig;
