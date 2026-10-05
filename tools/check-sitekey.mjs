// Release guard: refuses to deploy a build that would ship a Cloudflare testing site key (or none).
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../dist/client/index.html', import.meta.url), 'utf8');
const key = html.match(/data-sitekey="([^"]*)"/)?.[1] ?? '';
if (!key || /^[123]x0{20}[A-F]{2}$/.test(key)) {
  console.error(`Refusing to deploy: the built Turnstile site key is ${key ? `a testing key (${key})` : 'missing'}. Run "npm run build".`);
  process.exit(1);
}
console.log(`Turnstile site key check passed (${key}).`);
