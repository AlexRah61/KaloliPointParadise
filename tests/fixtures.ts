import { test as base, expect } from '@playwright/test';

// Runs against a deployed site must not add test traffic to GA4 or Cloudflare Web Analytics.
// The Cloudflare beacon itself still loads (stubbing it breaks its SRI check); only its report is answered locally.
export const test = base.extend<{ quietAnalytics: void }>({
  quietAnalytics: [
    async ({ context }, use) => {
      if (process.env.BASE_URL) {
        await context.route(/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/, (route) =>
          route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
        );
        await context.route(/\/cdn-cgi\/rum/, (route) => route.fulfill({ status: 204, body: '' }));
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect };
