import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

type Win = Window & {
  dataLayer?: ArrayLike<unknown>[];
  gtag?: unknown;
  __kpEvents?: { event: string; params: Record<string, string> }[];
  __gaAt?: number;
};

const GA = /googletagmanager\.com|google-analytics\.com|analytics\.google\.com/;
const FAKE_ID = 'G-TEST0000';
const SUBMIT = /send showing request/i;

// Serve the local test build as if PUBLIC_GA4_ID were set (to a fake ID) and let its CSP allow gtag.js.
async function withGa4(page: Page) {
  await page.route(
    (url) => url.hostname === '127.0.0.1' && url.pathname === '/',
    async (route) => {
      const res = await route.fetch();
      const headers = { ...res.headers() };
      delete headers['content-encoding'];
      delete headers['content-length'];
      if (headers['content-security-policy']) {
        headers['content-security-policy'] = headers['content-security-policy'].replace("script-src 'self'", "script-src 'self' https://www.googletagmanager.com");
      }
      await route.fulfill({ response: res, headers, body: (await res.text()).replace('<body', `<body data-ga4="${FAKE_ID}"`) });
    },
  );
  // Record when gtag.js is first inserted, to prove it never competes with the initial page load.
  await page.addInitScript(() => {
    new MutationObserver((_, obs) => {
      if (document.querySelector('script[src*="googletagmanager.com"]')) {
        (window as Win).__gaAt = performance.now();
        obs.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

async function isolateIp(page: Page) {
  const ip = `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
  await page.route('**/api/showing-request', (route) => route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': ip } }));
}

const dataLayer = (page: Page) => page.evaluate(() => ((window as Win).dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>)));
const gaEvents = async (page: Page, name: string) => (await dataLayer(page)).filter((a) => a[0] === 'event' && a[1] === name);

test.describe('analytics (GA4)', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'desktop-1440' || !!process.env.BASE_URL, 'GA4 checks run once, against the local test build');
  });

  test('stays off when PUBLIC_GA4_ID is absent', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => {
      if (GA.test(r.url())) requests.push(r.url());
    });
    await page.goto('/');
    await page.waitForTimeout(4000);
    expect(requests).toEqual([]);
    expect(await page.evaluate(() => typeof (window as Win).gtag)).toBe('undefined');
    expect(await page.evaluate(() => (window as Win).dataLayer === undefined)).toBe(true);
    expect(await page.evaluate(() => ((window as Win).__kpEvents ?? []).map((e) => e.event))).toContain('property_view');
  });

  test('loads after the page, sends only allowlisted values, and counts a conversion only for a stored request', async ({ page }) => {
    await isolateIp(page);
    await withGa4(page);
    // gtag.js unavailable (blocked/offline): the site and the showing request must work regardless.
    await page.route(GA, (route) => route.abort('blockedbyclient'));

    await page.goto('/');
    await page.waitForFunction(() => ((window as Win).__gaAt ?? 0) > 0, undefined, { timeout: 10_000 });
    const timing = await page.evaluate(() => ({
      gaAt: (window as Win).__gaAt ?? 0,
      loadEnd: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).loadEventEnd,
    }));
    expect(timing.gaAt, 'gtag.js is injected only after the load event').toBeGreaterThanOrEqual(timing.loadEnd);
    expect((await dataLayer(page)).find((a) => a[0] === 'config')?.[1]).toBe(FAKE_ID);
    expect((await dataLayer(page)).filter((a) => a[0] === 'config'), 'exactly one Google tag configuration').toHaveLength(1);
    expect(await page.locator('script[src*="googletagmanager.com"]').count(), 'one gtag.js, no Tag Manager container').toBe(1);
    expect(await page.locator('script[src*="googletagmanager.com/gtm.js"]').count()).toBe(0);
    expect(await gaEvents(page, 'property_view')).toHaveLength(1);

    await page.evaluate(() => window.scrollTo(0, document.getElementById('lanais')!.offsetTop));
    const cta = page.locator('[data-showing-cta="desktop_header"]');
    await expect(cta).toBeVisible();
    await cta.click();
    const form = page.locator('#showing-sheet #showing-form');
    await expect(form).toBeVisible();
    await form.getByLabel('Full name').fill('Analytics Privacy Tester');
    expect(await gaEvents(page, 'showing_form_start')).toEqual([['event', 'showing_form_start', { cta_location: 'desktop_header' }]]);
    expect(await gaEvents(page, 'showing_request_submitted'), 'opening or starting the form is not a conversion').toHaveLength(0);

    const email = `qa+ga4-${Date.now()}@example.com`;
    await form.getByLabel('Phone').fill('(808) 555-0142');
    await form.getByLabel('Email').fill(email);
    await form.getByLabel(/message/i).fill('Private note: gate code 4321');
    await page.waitForTimeout(1000);
    const [resp] = await Promise.all([page.waitForResponse('**/api/showing-request'), form.getByRole('button', { name: SUBMIT }).click()]);
    const body = await resp.json();
    expect(resp.status(), JSON.stringify(body)).toBe(200);
    await expect(page.locator('#showing-dialog')).toBeVisible();

    expect(await gaEvents(page, 'showing_cta_click')).toEqual([['event', 'showing_cta_click', { cta_location: 'desktop_header' }]]);
    expect(await gaEvents(page, 'showing_request_submitted')).toEqual([
      ['event', 'showing_request_submitted', { cta_location: 'desktop_header', tour_type: 'in_person' }],
    ]);
    const sent = JSON.stringify(await dataLayer(page)) + JSON.stringify(await page.evaluate(() => (window as Win).__kpEvents));
    for (const pii of [email, 'Analytics Privacy Tester', '(808) 555-0142', '8085550142', 'gate code', body.leadId, body.eventId, 'DUMMY.TOKEN']) {
      expect(sent, `analytics must not contain ${pii}`).not.toContain(pii);
    }
  });

  test('a rejected or failed request is never reported as a conversion', async ({ page }) => {
    await withGa4(page);
    await page.route(GA, (route) => route.abort('blockedbyclient'));
    const replies = [
      { status: 403, body: { ok: false, error: 'We could not verify this request.' } },
      { status: 500, body: { ok: false, error: 'Your request could not be saved.' } },
    ];
    await page.route('**/api/showing-request', (route) => {
      const r = replies.shift()!;
      return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
    });

    await page.goto('/#showing');
    const form = page.locator('#showing-form');
    await form.getByLabel('Full name').fill('QA Failure');
    await form.getByLabel('Phone').fill('(808) 555-0142');
    await form.getByLabel('Email').fill(`qa+ga4fail-${Date.now()}@example.com`);
    const status = form.locator('[data-form-status]');
    for (const text of ['could not verify', 'could not be saved']) {
      await Promise.all([page.waitForResponse('**/api/showing-request'), form.getByRole('button', { name: SUBMIT }).click()]);
      await expect(status).toContainText(text);
    }
    expect(await gaEvents(page, 'showing_request_submitted')).toHaveLength(0);
    expect(await page.evaluate(() => ((window as Win).__kpEvents ?? []).filter((e) => e.event === 'showing_request_submitted'))).toHaveLength(0);
    await expect(page.locator('#showing-dialog')).toBeHidden();
  });
});
