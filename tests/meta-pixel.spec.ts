import type { Page, Request } from '@playwright/test';
import { test, expect } from './fixtures';

// Runs where the Meta Pixel is built in (production builds and the live site); test builds leave it out and skip.
// The real fbevents.js runs, but every hit is answered here, so nothing from a test reaches Meta, Google or the leads DB.
const PIXEL = '2156903424898652';
const PROJECTS = ['desktop-1440', 'iphone-webkit', 'android-chromium'];
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const decode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
};

type Hit = { ev: string; id: string; eid: string; cd: Record<string, string>; raw: string };

// Hits arrive as GET query strings or as POST bodies (form-encoded or multipart).
function parseHit(req: Request): Hit {
  const url = new URL(req.url());
  const params = new URLSearchParams(url.search);
  const body = req.postData() ?? '';
  if (body.includes('Content-Disposition')) for (const m of body.matchAll(/name="([^"]+)"\r?\n\r?\n([^\r\n]*)/g)) params.append(m[1]!, m[2]!);
  else if (body) new URLSearchParams(body).forEach((v, k) => params.append(k, v));
  const cd: Record<string, string> = {};
  params.forEach((v, k) => {
    const m = /^cd\[(.+)\]$/.exec(k);
    if (m) cd[m[1]!] = v;
  });
  return { ev: params.get('ev') ?? '', id: params.get('id') ?? '', eid: params.get('eid') ?? '', cd, raw: decode(`${url.search}\n${body}`) };
}

async function watchPixel(page: Page): Promise<Hit[]> {
  const hits: Hit[] = [];
  await page.route(/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.route(/^https:\/\/connect\.facebook\.net\//, (r) => r.continue());
  await page.route(/^https:\/\/www\.facebook\.com\/tr/, (r) => {
    hits.push(parseHit(r.request()));
    return r.fulfill({ status: 200, contentType: 'image/gif', body: GIF });
  });
  return hits;
}

async function baseCodeCount(page: Page): Promise<number> {
  const n = await page.evaluate(() => [...document.querySelectorAll('script:not([src])')].filter((s) => s.textContent?.includes("fbq('init'")).length);
  test.skip(n === 0, 'This build has no Meta Pixel (test builds leave it out)');
  return n;
}

const named = (hits: Hit[], ev: string) => hits.filter((h) => h.ev === ev);

test.describe('Meta Pixel', () => {
  test.beforeEach(({}, info) => {
    test.skip(!PROJECTS.includes(info.project.name), 'Meta Pixel checks run on one desktop, one iPhone and one Android setup');
  });

  test('the base code runs once per page and sends one PageView, also after in-page navigation', async ({ page }, info) => {
    const blocked: string[] = [];
    const elsewhere: string[] = [];
    page.on('console', (m) => {
      const t = m.text();
      if (!/Content Security Policy/i.test(t) || /Report Only/i.test(t)) return;
      // Since Oct 2026 fbevents.js also calls endpoints on generic cloud hosts (*.run.app, *.on.aws). The policy keeps
      // blocking those on purpose; only a blocked Meta host would break the pixel. The first URL is the blocked one.
      const url = /https?:\/\/[^\s'"]+/.exec(t)?.[0] ?? '';
      if (/^https?:\/\/([^/]+\.)?(facebook\.(com|net)|fbcdn\.net)(\/|$)/i.test(url) || !url) blocked.push(t.slice(0, 200));
      else elsewhere.push(t.slice(0, 200));
    });
    const hits = await watchPixel(page);
    await page.goto('/');
    expect(await baseCodeCount(page), 'one Meta Pixel base code in the page').toBe(1);
    await expect.poll(() => named(hits, 'PageView').length, { timeout: 15_000 }).toBe(1);
    expect(named(hits, 'PageView')[0]!.id).toBe(PIXEL);
    await expect(page.locator('script[src="https://connect.facebook.net/en_US/fbevents.js"]')).toHaveCount(1);

    // Menu links scroll within the page and update the address (pushState): not a new page view.
    const header = page.locator('[data-header]');
    const toggle = header.locator('[data-menu-toggle]');
    if (await toggle.isVisible()) {
      await toggle.click();
      await page.locator('#mobile-nav').getByRole('link', { name: /Gallery$/ }).click();
    } else {
      await header.locator('.nav-desktop').getByRole('link', { name: 'Gallery' }).click();
    }
    await expect(page).toHaveURL(/#gallery$/);
    await page.waitForTimeout(2500);
    expect(named(hits, 'PageView'), 'no second PageView for in-page navigation').toHaveLength(1);
    expect([...new Set(hits.map((h) => h.ev))], 'automatic events are off: only the PageView so far').toEqual(['PageView']);
    expect(blocked, 'the security policy allows the pixel').toEqual([]);
    if (elsewhere.length) info.annotations.push({ type: 'csp-blocked (non-Meta host)', description: elsewhere.join('\n') });
  });

  test('a PageView is sent on the privacy notice too', async ({ page }) => {
    const hits = await watchPixel(page);
    await page.goto('/privacy/');
    expect(await baseCodeCount(page)).toBe(1);
    await expect.poll(() => named(hits, 'PageView').length, { timeout: 15_000 }).toBe(1);
  });

  test('Lead is sent once, only after the request is accepted, without the visitor details', async ({ page }) => {
    const hits = await watchPixel(page);
    // Turnstile and the API answered locally: no lead is stored and no email is sent.
    await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', (r) =>
      r.fulfill({
        contentType: 'application/javascript',
        body: `window.turnstile = {
          render(el, o) { setTimeout(() => o.callback('QA.TOKEN'), 50); return 'w1'; },
          getResponse() { return 'QA.TOKEN'; }, reset() {}, remove() {},
        }; window.kpTurnstileReady && window.kpTurnstileReady();`,
      }),
    );
    const leadId = 'KP-000000-PIXELQA';
    const eventId = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
    let posts = 0;
    await page.route('**/api/showing-request', (r) => {
      posts++;
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, leadId, eventId, notified: true, preferred: '', alternate: '', flexible: false, tourType: 'in_person' }),
      });
    });

    await page.goto('/');
    await baseCodeCount(page);
    await expect.poll(() => named(hits, 'PageView').length, { timeout: 15_000 }).toBe(1);

    const cta = page.locator('[data-hero] [data-showing-cta]');
    await cta.scrollIntoViewIfNeeded();
    await cta.click();
    const form = page.locator('#showing-sheet #showing-form');
    await expect(form).toBeVisible();
    await form.getByLabel('Full name').fill('Pixel Privacy Tester');
    const submit = form.getByRole('button', { name: /send showing request/i });
    await submit.click();
    await expect(form.locator('[aria-invalid="true"]').first(), 'an incomplete form is stopped in the browser').toBeVisible();
    await page.waitForTimeout(1500);
    expect(named(hits, 'Lead'), 'opening, starting or failing the form is not a lead').toHaveLength(0);

    const email = `qa+pixel-${Date.now()}@example.com`;
    await form.getByLabel('Phone').fill('(808) 555-0142');
    await form.getByLabel('Email').fill(email);
    await form.getByLabel(/message/i).fill('Private note: gate code 4321');
    await submit.click();
    await expect(page.locator('#showing-dialog')).toBeVisible();
    await expect.poll(() => named(hits, 'Lead').length, { timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(2500);
    expect(posts).toBe(1);
    expect(named(hits, 'Lead'), 'exactly one Lead per stored request').toHaveLength(1);
    const lead = named(hits, 'Lead')[0]!;
    expect(lead.id).toBe(PIXEL);
    expect(lead.eid, 'the server sends the same event ID to the Conversions API, so Meta keeps one Lead').toBe(eventId);
    expect(lead.cd).toMatchObject({ content_name: 'Request Private Showing', cta_location: 'hero', tour_type: 'in_person' });
    for (const pii of ['Pixel Privacy Tester', email, '555-0142', '8085550142', 'gate code', leadId]) {
      expect(lead.raw, `the Lead must not carry ${pii} in plain text`).not.toContain(pii);
    }
    expect([...new Set(hits.map((h) => h.ev))].sort()).toEqual(['Lead', 'PageView']);
  });

  test('Contact is sent for a click to call the listing agent, not for her email or website', async ({ page }) => {
    const hits = await watchPixel(page);
    await page.goto('/');
    await baseCodeCount(page);
    await expect.poll(() => named(hits, 'PageView').length, { timeout: 15_000 }).toBe(1);
    // Keep the browser on the page: no dialer, mail app or new tab.
    await page.evaluate(() =>
      document.addEventListener('click', (e) => (e.target as Element).closest('a[href^="tel:"], a[href^="mailto:"], a[target="_blank"]') && e.preventDefault(), true),
    );
    const card = page.locator('.site-footer .agent-card');
    await card.scrollIntoViewIfNeeded();
    await card.locator('a[href^="mailto:"]').click();
    await card.locator('a.agent-site').click();
    await page.waitForTimeout(1500);
    expect(named(hits, 'Contact'), 'email and website clicks are not calls').toHaveLength(0);

    await card.locator('a[href^="tel:"]').click();
    await expect.poll(() => named(hits, 'Contact').length, { timeout: 10_000 }).toBe(1);
    expect(named(hits, 'Contact')[0]!.cd).toMatchObject({ content_name: 'Call agent', contact_method: 'phone', cta_location: 'footer' });

    const headerCall = page.locator('[data-header] .header-call');
    if (await headerCall.isVisible()) {
      await headerCall.click();
      await expect.poll(() => named(hits, 'Contact').length, { timeout: 10_000 }).toBe(2);
      expect(named(hits, 'Contact')[1]!.cd).toMatchObject({ contact_method: 'phone', cta_location: 'header' });
    }
    expect([...new Set(hits.map((h) => h.ev))].sort()).toEqual(['Contact', 'PageView']);
  });
});
