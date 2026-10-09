import { execSync } from 'child_process';
import { createHmac } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures';

type KpWindow = Window & { __kpEvents?: { event: string; params: Record<string, unknown> }[] };

const hstPlus = (days: number) => {
  const d = new Date(Date.now() - 10 * 3600 * 1000);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const uniqueEmail = (tag: string) => process.env.E2E_VISITOR_EMAIL ?? `qa+${tag}-${Date.now()}@example.com`;
const SUBMIT = /send showing request/i;

// Reads a stored row from the local D1 database (local runs only; deployed runs check via wrangler --remote).
function storedRow(where: string): Record<string, unknown> | null | undefined {
  if (process.env.BASE_URL) return undefined;
  const out = execSync(`npx wrangler d1 execute kaloli-leads --local --json --command "SELECT * FROM showing_requests WHERE ${where}"`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out)[0]?.results?.[0] ?? null;
}

function storedOrigin(leadId: string): string | null | undefined {
  if (!/^KP-\d{6}-[0-9A-Z]{6}$/.test(leadId)) return undefined;
  const row = storedRow(`id = '${leadId}'`);
  return row === undefined ? undefined : ((row?.cta_origin as string | null) ?? null);
}

// Each test gets its own client IP so the per-IP rate limit doesn't couple tests (Cloudflare overwrites this header in production).
async function isolateIp(page: Page) {
  const ip = `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
  await page.route('**/api/showing-request', (route) => route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': ip } }));
}

async function fillValid(page: Page, email: string, { phone = '(808) 555-0142' } = {}) {
  const form = page.locator('#showing-form');
  await form.scrollIntoViewIfNeeded();
  await form.getByLabel('Full name').fill('Peyman QA Tester');
  await form.getByLabel('Email').fill(email);
  if (phone) await form.getByLabel('Phone').fill(phone);
  // Three fields fill faster than a person types; below 800 ms the API answers with a decoy (isLikelyBot).
  await page.waitForTimeout(1000);
  return form;
}

test.describe('showing form', () => {
  test.beforeEach(({}, info) => {
    test.skip(!!process.env.BASE_URL, 'never submit leads to a deployed site from automated tests (it sends real email)');
    test.skip(!['desktop-1440', 'mobile-390', 'webkit-desktop'].includes(info.project.name), 'form flow runs on representative projects');
  });

  test('asks only for a name and an email, with an accessible summary', async ({ page }) => {
    await page.goto('/#showing');
    const form = page.locator('#showing-form');
    await expect(form.locator('input[type="date"], select, input[type="checkbox"]'), 'no dates, times or tick boxes').toHaveCount(0);
    await expect(form.locator('[required]')).toHaveCount(2);
    await form.getByRole('button', { name: SUBMIT }).click();
    const summary = form.locator('[data-error-summary]');
    await expect(summary).toBeVisible();
    await expect(summary).toBeFocused();
    for (const label of ['Full name', 'Email']) {
      await expect(form.getByLabel(label)).toHaveAttribute('aria-invalid', 'true');
    }
    await expect(form.getByLabel('Phone'), 'the phone number is optional').not.toHaveAttribute('aria-invalid', 'true');
    await expect(form.getByLabel(/message/i)).toHaveAccessibleDescription(/preferred days or times/i);
    await form.getByLabel('Email').fill('not-an-email');
    await form.getByRole('button', { name: SUBMIT }).click();
    await expect(form.locator('#e-email')).toHaveText('Enter a valid email address.');
  });

  test('a phone number is optional, but one that is given must be complete', async ({ page }) => {
    await isolateIp(page);
    await page.goto('/#showing');
    const form = await fillValid(page, uniqueEmail('nophone'), { phone: '555' });
    await form.getByRole('button', { name: SUBMIT }).click();
    await expect(form.locator('#e-phone')).toHaveText('Enter a full phone number with area code, or leave it blank.');
    await form.getByLabel('Phone').fill('');
    await page.waitForTimeout(1000);
    const [resp] = await Promise.all([page.waitForResponse('**/api/showing-request'), form.getByRole('button', { name: SUBMIT }).click()]);
    const body = await resp.json();
    expect(resp.status(), JSON.stringify(body)).toBe(200);
    await expect(page.locator('#showing-dialog')).toBeVisible();
    const row = storedRow(`id = '${body.leadId}'`);
    if (row !== undefined) expect(row).toMatchObject({ phone: '', preferred_date: '', source: 'website' });
  });

  test('submits, stores the lead and never claims a confirmed showing', async ({ page }) => {
    await isolateIp(page);
    await page.goto('/?utm_source=meta&utm_medium=paid_social&utm_campaign=qa_launch&fbclid=QA123');
    const form = await fillValid(page, uniqueEmail('ok'));
    await form.getByLabel('Live video tour').check();
    await form.getByLabel(/message/i).fill('QA automated test — please ignore. Weekday mornings suit me.');
    const [resp] = await Promise.all([
      page.waitForResponse('**/api/showing-request'),
      form.getByRole('button', { name: SUBMIT }).click(),
    ]);
    const body = await resp.json();
    expect(resp.status(), JSON.stringify(body)).toBe(200);
    expect(body.leadId).toMatch(/^KP-\d{6}-[0-9A-Z]{6}$/);
    expect(body.eventId, 'a random Meta event ID, not the lead ID').toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const dialog = page.locator('#showing-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#dlg-title')).toBeFocused();
    await expect(dialog).toContainText('Thank you');
    await expect(dialog).toContainText('Your showing request has been sent to the listing agent.');
    await expect(dialog).toContainText('will contact you directly to arrange a time, based on availability');
    await expect(dialog.locator('[data-dlg-warning]')).toHaveText(/not confirmed until the listing agent speaks with you/i);
    await expect(dialog).not.toContainText('Requested');
    await expect(dialog).toContainText('Live video tour');
    await expect(dialog).toContainText(body.leadId);
    await expect(dialog).not.toContainText(/\b(booked|reserved)\b/i);

    const ev = await page.evaluate(() => ((window as KpWindow).__kpEvents ?? []).map((e) => e.event));
    expect(ev).toContain('showing_form_start');
    expect(ev).toContain('showing_request_submitted');
    const leak = await page.evaluate(() => JSON.stringify((window as KpWindow).__kpEvents));
    expect(leak).not.toMatch(/example\.com|555-0142|Peyman/);

    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    const stored = storedOrigin(body.leadId);
    if (stored !== undefined) expect(stored).toBe('inline_form');
    console.log(`LEAD ${body.leadId}`);
  });

  test('the persistent CTA opens the same form in a sheet and the lead records its origin', async ({ page }, info) => {
    await isolateIp(page);
    await page.goto('/');
    await page.evaluate(() => window.scrollTo(0, document.getElementById('lanais')!.offsetTop));
    const y0 = await page.evaluate(() => window.scrollY);
    const origin = info.project.name.startsWith('mobile-') ? 'mobile_sticky' : 'desktop_header';
    const cta = page.locator(`[data-showing-cta="${origin}"]`);
    await expect(cta).toBeVisible();
    await cta.click();

    const sheet = page.locator('#showing-sheet');
    await expect(sheet).toBeVisible();
    await expect(page.locator('#showing-form')).toHaveCount(1);
    const form = sheet.locator('#showing-form');
    await expect(form).toBeVisible();
    await form.getByLabel('Full name').fill('Peyman QA Tester');
    await form.getByLabel('Email').fill(uniqueEmail('sheet'));
    await page.waitForTimeout(1000);
    const [resp] = await Promise.all([page.waitForResponse('**/api/showing-request'), form.getByRole('button', { name: SUBMIT }).click()]);
    const body = await resp.json();
    expect(resp.status(), JSON.stringify(body)).toBe(200);

    await expect(sheet).toBeHidden();
    const dialog = page.locator('#showing-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Request received');
    await expect(dialog).toContainText('based on availability');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('[data-form-home] #showing-form')).toHaveCount(1);
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - y0)).toBeLessThanOrEqual(2);

    const submitted = await page.evaluate(() => ((window as KpWindow).__kpEvents ?? []).find((e) => e.event === 'showing_request_submitted'));
    expect(submitted?.params.cta_location).toBe(origin);
    const stored = storedOrigin(body.leadId);
    if (stored !== undefined) expect(stored).toBe(origin);
    console.log(`LEAD ${body.leadId} via ${origin}`);
  });

  test('browser autofill in the hidden spam trap still stores, emails and counts the request', async ({ page }) => {
    await isolateIp(page);
    await page.goto('/#showing');
    const trap = page.locator('#showing-form .hp input');
    const names = [await trap.getAttribute('name'), await trap.getAttribute('id'), await page.locator('#showing-form .hp label').textContent()];
    for (const n of names) expect(n ?? '', 'nothing about the trap may look like a contact or address field to autofill').not.toMatch(/compan|organi[sz]|\borg\b|name|mail|phone|tel|address|city|zip|postal|country/i);
    const form = await fillValid(page, uniqueEmail('autofill'));
    // What Edge's autofill did to the old "Company" trap: a saved organisation lands in the hidden field.
    await trap.evaluate((el: HTMLInputElement) => (el.value = 'Microsoft'));
    await page.waitForTimeout(1000);
    const [resp] = await Promise.all([page.waitForResponse('**/api/showing-request'), form.getByRole('button', { name: SUBMIT }).click()]);
    const body = await resp.json();
    expect(resp.status(), JSON.stringify(body)).toBe(200);
    expect(body.notified, 'the listing agent is emailed').toBe(true);
    await expect(page.locator('#showing-dialog')).toBeVisible();
    const ev = await page.evaluate(() => ((window as KpWindow).__kpEvents ?? []).map((e) => e.event));
    expect(ev, 'and it counts as a conversion').toContain('showing_request_submitted');
    const stored = storedOrigin(body.leadId);
    if (stored !== undefined) expect(stored, 'stored in D1').toBe('inline_form');
    console.log(`AUTOFILL LEAD ${body.leadId}`);
  });

  test('an impossibly fast submission gets a silent decoy and is not stored', async ({ page }) => {
    const ip = `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}`;
    await page.route('**/api/showing-request', (route) => {
      const sent = JSON.parse(route.request().postData() ?? '{}');
      return route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': ip }, postData: JSON.stringify({ ...sent, elapsedMs: 120 }) });
    });
    await page.goto('/#showing');
    const form = await fillValid(page, uniqueEmail('fast'));
    const [resp] = await Promise.all([page.waitForResponse('**/api/showing-request'), form.getByRole('button', { name: SUBMIT }).click()]);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    await expect(page.locator('#showing-dialog')).toBeVisible();
    const stored = storedOrigin(body.leadId);
    if (stored !== undefined) expect(stored, 'a decoy is never stored').toBeNull();
    console.log(`DECOY ${body.leadId}`);
  });
});

test.describe('showing API', () => {
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== 'desktop-1440', 'API checks run once');
  });

  test('ships the Turnstile widget and GA4 setting that match the environment', async ({ page }) => {
    await page.goto('/');
    const key = (await page.locator('#showing-form').getAttribute('data-sitekey')) ?? '';
    // Local runs use Cloudflare's testing key and no GA4; deployed environments use the real widget and GA4 property.
    expect(/^[123]x0{20}[A-F]{2}$/.test(key), `site key ${key}`).toBe(!process.env.BASE_URL);
    const ga4 = await page.locator('body').getAttribute('data-ga4');
    if (process.env.BASE_URL) expect(ga4).toBe('G-0TEREZSX1F');
    else expect(ga4).toBeNull();
  });

  test('requires a Turnstile token of sane size before anything is stored', async ({ request, baseURL }) => {
    const base = { name: 'QA Person', phone: '8085550142', email: `qa+len-${Date.now()}@example.com` };
    for (const turnstileToken of [undefined, '', 'x'.repeat(2049)]) {
      const res = await request.post('/api/showing-request', { data: { ...base, turnstileToken }, headers: { Origin: baseURL! } });
      expect(res.status(), `token length ${turnstileToken?.length ?? 'none'}`).toBe(400);
    }
  });

  test('rejects wrong method, origin and content type', async ({ request, baseURL }) => {
    expect((await request.get('/api/showing-request')).status()).toBe(405);
    const noOrigin = await request.post('/api/showing-request', { data: {}, headers: { Origin: 'https://evil.example' } });
    expect(noOrigin.status()).toBe(403);
    const wrongType = await request.post('/api/showing-request', { data: 'x=1', headers: { Origin: baseURL!, 'Content-Type': 'application/x-www-form-urlencoded' } });
    expect(wrongType.status()).toBe(415);
    const invalid = await request.post('/api/showing-request', {
      data: { name: 'A', phone: '1', email: 'bad', preferredDate: '2020-01-01', preferredTime: '03:00', turnstileToken: 'x' },
      headers: { Origin: baseURL! },
    });
    // Turnstile runs before form validation: a real widget rejects the fake token; locally the testing secret passes it.
    if (process.env.BASE_URL) {
      expect(invalid.status()).toBe(403);
    } else {
      expect(invalid.status()).toBe(422);
      const errs = (await invalid.json()).errors;
      // Pages loaded before the form lost its date fields still send them, so they are still checked when present.
      expect(Object.keys(errs)).toEqual(expect.arrayContaining(['name', 'phone', 'email', 'preferredDate', 'preferredTime']));
    }
    // Locally the Turnstile test secret accepts any token, so only deployed environments can prove rejection.
    if (process.env.BASE_URL) {
      const badToken = await request.post('/api/showing-request', {
        data: { name: 'QA Person', email: `qa+tok-${Date.now()}@example.com`, turnstileToken: 'invalid-token' },
        headers: { Origin: baseURL! },
      });
      expect(badToken.status()).toBe(403);
    }
  });

  test('a request from a page loaded before the form changed is still accepted', async ({ request, baseURL }) => {
    test.skip(!!process.env.BASE_URL, 'stores a lead');
    const res = await request.post('/api/showing-request', {
      data: {
        name: 'QA Legacy Page',
        phone: '8085550142',
        email: `qa+legacy-${Date.now()}@example.com`,
        preferredDate: hstPlus(5),
        preferredTime: '10:00',
        flexible: true,
        turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
        elapsedMs: 9000,
      },
      headers: { Origin: baseURL!, 'cf-connecting-ip': `10.9.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}` },
    });
    const body = await res.json();
    expect(res.status(), JSON.stringify(body)).toBe(200);
    expect(body.preferred).toMatch(/10:00 AM HST$/);
    expect(storedRow(`id = '${body.leadId}'`)).toMatchObject({ preferred_time: '10:00', flexible: 1 });
  });
});

// The Google Sheet that collects Meta lead-form leads forwards new rows here (tools/meta-lead-sync/Code.gs).
const LOCAL_SYNC_SECRET = existsSync('.dev.vars') ? (/^SHEET_SYNC_SECRET="?([^"\r\n]*)"?\s*$/m.exec(readFileSync('.dev.vars', 'utf8'))?.[1] ?? '') : '';

function signedPost(request: APIRequestContext, payload: unknown, { secret = LOCAL_SYNC_SECRET, ts = Math.floor(Date.now() / 1000) } = {}) {
  const body = JSON.stringify(payload);
  const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return request.post('/api/meta-leads', {
    data: body,
    headers: { 'Content-Type': 'application/json', 'X-KP-Timestamp': String(ts), 'X-KP-Signature': sig },
  });
}

const metaRow = (id: string, values: Record<string, string> = {}) => ({
  key: `l:${id}`,
  row: 2,
  values: {
    id: `l:${id}`,
    created_time: '2026-10-09T05:17:11-05:00',
    ad_id: 'ag:120000000000000001',
    ad_name: 'KaloliUGCVideo',
    adset_id: 'as:120000000000000002',
    adset_name: 'KaloliUGCVideo',
    campaign_id: 'c:120000000000000003',
    campaign_name: 'Hawaii House Sale - Lead Optimization',
    form_id: 'f:2282031765894403',
    form_name: 'book a showing form',
    is_organic: 'false',
    platform: 'ig',
    email: `qa+meta-${id}@example.com`,
    full_name: 'Meta QA Tester',
    phone: 'p:+18085550199',
    lead_status: 'CREATED',
    ...values,
  },
});

test.describe('Meta lead-form leads from the Google Sheet', () => {
  test.beforeEach(({}, info) => {
    test.skip(!!process.env.BASE_URL, 'stores leads and needs the local sync key');
    test.skip(info.project.name !== 'desktop-1440', 'API checks run once');
  });

  test('a signed row is stored once, the listing agent is notified, and a repeat is ignored', async ({ request }) => {
    const id = String(Date.now());
    const payload = { source: 'meta_lead_form', sheet: 'Sheet1', rows: [metaRow(id, { 'when_would_you_like_to_visit?': 'Next week' })] };
    const first = await signedPost(request, payload);
    const out = await first.json();
    expect(first.status(), JSON.stringify(out)).toBe(200);
    expect(out.results).toEqual([expect.objectContaining({ key: `l:${id}`, status: 'inserted', notified: true })]);
    const row = storedRow(`external_id = '${id}'`);
    expect(row).toMatchObject({
      source: 'meta_lead_form',
      name: 'Meta QA Tester',
      email: `qa+meta-${id}@example.com`,
      phone: '+18085550199',
      utm_source: 'instagram',
      utm_medium: 'lead_form',
      utm_campaign: 'Hawaii House Sale - Lead Optimization',
      cta_origin: 'meta_lead_form',
      status: 'notified',
      is_test: 0,
      visitor_email_status: null,
    });
    expect(JSON.parse(String(row!.source_details))).toMatchObject({ form_name: 'book a showing form', answers: { 'when would you like to visit?': 'Next week' } });

    const again = await signedPost(request, payload);
    expect((await again.json()).results).toEqual([expect.objectContaining({ status: 'duplicate', leadId: out.results[0].leadId })]);
  });

  test("Meta's dummy test leads are marked as tests, and rows that are not leads are skipped", async ({ request }) => {
    const id = String(Date.now() + 1);
    const res = await signedPost(request, {
      source: 'meta_lead_form',
      rows: [
        metaRow(id, { email: 'test@meta.com', full_name: '<test lead: dummy data for full_name>', phone: 'p:<test lead: dummy data for phone>' }),
        { key: 'note-row', values: { lead_status: 'note typed into the sheet' } },
      ],
    });
    const out = await res.json();
    expect(out.results.map((r: { status: string }) => r.status)).toEqual(['inserted', 'skipped']);
    expect(storedRow(`external_id = '${id}'`)).toMatchObject({ is_test: 1, source: 'meta_lead_form' });
  });

  test('unsigned, wrongly signed or stale requests are refused', async ({ request }) => {
    const payload = { source: 'meta_lead_form', rows: [metaRow(String(Date.now() + 2))] };
    expect((await request.post('/api/meta-leads', { data: payload })).status()).toBe(401);
    expect((await signedPost(request, payload, { secret: 'not-the-secret' })).status()).toBe(401);
    expect((await signedPost(request, payload, { ts: Math.floor(Date.now() / 1000) - 3600 })).status()).toBe(401);
    expect((await request.get('/api/meta-leads')).status()).toBe(405);
  });
});
