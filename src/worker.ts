// Worker entry: Astro handles HTTP; the cron trigger retries lead notifications that failed.
import { handle } from '@astrojs/cloudflare/handler';
import { retryFailedNotifications } from './lib/server/leads';
import { securityHeaders } from './lib/security-headers.mjs';

const headerOptions = {
  ga: !!import.meta.env.PUBLIC_GA4_ID,
  meta: !!import.meta.env.PUBLIC_META_PIXEL_ID,
  noindex: import.meta.env.PUBLIC_NOINDEX === 'true',
};

// Pages reach the Worker first (assets.run_worker_first) because _headers cannot vary the CSP nonce per response.
function secureHtml(res: Response): Response {
  if (!(res.headers.get('Content-Type') ?? '').includes('text/html')) return res;
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const headers = new Headers(res.headers);
  for (const [name, value] of securityHeaders({ ...headerOptions, nonce })) headers.set(name, value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    return secureHtml(await handle(request, env, ctx));
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      retryFailedNotifications(env).then((r) => {
        if (r.retried) console.log(`notification retry: ${r.notified}/${r.retried} delivered`);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
