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

// Safari, and iOS in particular, only plays MP4 when byte-range requests are answered with 206 Partial Content.
// Static assets reply 200 with the whole file, so the hero loops (versioned, a few MB) are sliced here.
async function servePartial(request: Request, env: Env): Promise<Response> {
  const asset = await env.ASSETS.fetch(new Request(request.url, { method: 'GET' }));
  if (!asset.ok) return asset;
  const headers = new Headers(asset.headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  const m = /^bytes=(\d*)-(\d*)$/.exec((request.headers.get('Range') ?? '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return new Response(request.method === 'HEAD' ? null : asset.body, { status: 200, headers });
  const body = await asset.arrayBuffer();
  const size = body.byteLength;
  const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  const end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start >= size || start > end) {
    headers.delete('Content-Length');
    headers.set('Content-Range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(request.method === 'HEAD' ? null : body.slice(start, end + 1), { status: 206, headers });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/media/hero/') && (request.method === 'GET' || request.method === 'HEAD')) {
      return servePartial(request, env);
    }
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
