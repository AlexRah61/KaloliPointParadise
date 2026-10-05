// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://kalolipointparadisehawaii.com',
  trailingSlash: 'ignore',
  output: 'static',
  session: false,
  // Astro 7 defaults to JSX whitespace rules; keep HTML-aware spacing for editorial inline text.
  compressHTML: true,
  adapter: cloudflare({
    // Optimise every image at build time with sharp; nothing is transformed at request time.
    imageService: 'compile',
  }),
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/api/') && !page.endsWith('/404/'),
    }),
  ],
  image: {
    responsiveStyles: false,
  },
  build: {
    inlineStylesheets: 'auto',
  },
  prefetch: false,
  devToolbar: { enabled: false },
});
