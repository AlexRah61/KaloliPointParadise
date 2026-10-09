// Cloudflare GraphQL analytics through the existing Wrangler OAuth login (read-only; the token is never printed).
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { runWrangler } from './config.mjs';

const WRANGLER_CONFIG =
  process.platform === 'win32'
    ? join(process.env.APPDATA ?? '', 'xdg.config', '.wrangler', 'config', 'default.toml')
    : join(process.env.HOME ?? '', '.config', '.wrangler', 'config', 'default.toml');

function readWranglerToken() {
  if (!existsSync(WRANGLER_CONFIG)) return null;
  const toml = readFileSync(WRANGLER_CONFIG, 'utf8');
  const token = /^oauth_token\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  const expires = Date.parse(/^expiration_time\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? '');
  return token ? { token, expires } : null;
}

export function cloudflareToken(accountId) {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  let t = readWranglerToken();
  if (!t || !(t.expires > Date.now() + 5 * 60e3)) {
    // Any Wrangler command refreshes an expired OAuth token; whoami is read-only.
    runWrangler(['whoami'], {
      stdio: 'ignore',
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', ...(accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {}) },
    });
    t = readWranglerToken();
  }
  if (!t) throw new Error('No Cloudflare credentials: run "npx wrangler login" once on this machine.');
  return t.token;
}

export async function cloudflareGraphql(token, query, variables) {
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) throw new Error(`Cloudflare GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data;
}
