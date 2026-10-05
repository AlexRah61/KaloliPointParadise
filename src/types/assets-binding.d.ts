// The static-assets binding is added to the Worker by @astrojs/cloudflare at build time, so `wrangler types`
// (which reads wrangler.jsonc) does not list it. Both Env declarations from worker-configuration.d.ts get it.
interface Env {
  ASSETS: Fetcher;
}
declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
  }
}
