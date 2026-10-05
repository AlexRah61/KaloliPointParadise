// Worker entry: Astro handles HTTP; the cron trigger retries lead notifications that failed.
import { handle } from '@astrojs/cloudflare/handler';
import { retryFailedNotifications } from './lib/server/leads';

export default {
  async fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      retryFailedNotifications(env).then((r) => {
        if (r.retried) console.log(`notification retry: ${r.notified}/${r.retried} delivered`);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
