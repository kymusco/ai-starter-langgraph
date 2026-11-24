// Gera no .env os segredos que faltam (AGENT_API_TOKEN e ADMIN_PASSWORD). Não mostra os valores.
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../.env', import.meta.url);
if (!existsSync(FILE)) {
  console.error('Crie o .env antes: cp .env.example .env');
  process.exit(1);
}

const GEN = {
  AGENT_API_TOKEN: () => randomBytes(32).toString('hex'),
  ADMIN_PASSWORD: () => randomBytes(18).toString('base64url'),
};

let env = readFileSync(FILE, 'utf8');
const created = [];
for (const [name, gen] of Object.entries(GEN)) {
  const line = new RegExp(`^${name}=(.*)$`, 'm');
  if (line.exec(env)?.[1]?.trim()) continue;
  const value = gen();
  env = line.test(env) ? env.replace(line, `${name}=${value}`) : `${env.replace(/\n?$/, '\n')}${name}=${value}\n`;
  created.push(name);
}

writeFileSync(FILE, env);
chmodSync(FILE, 0o600);
console.log(created.length ? `Gerados no .env: ${created.join(', ')}` : 'Os segredos já existem no .env.');
if (created.includes('ADMIN_PASSWORD')) console.log('A senha da tela /admin está no .env (ADMIN_PASSWORD).');
