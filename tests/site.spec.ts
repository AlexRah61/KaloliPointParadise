import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

type KpWindow = Window & { __kpEvents?: { event: string; params: Record<string, string> }[] };
const events = (page: Page) => page.evaluate(() => ((window as KpWindow).__kpEvents ?? []).map((e) => e.event));
const tracked = (page: Page, name: string) =>
  page.evaluate((n) => ((window as KpWindow).__kpEvents ?? []).filter((e) => e.event === n).map((e) => e.params), name);

test.describe('page', () => {
  test('loads cleanly with complete SEO metadata', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto('/');
    await expect(page).toHaveTitle('15–1077 Amau Rd, Keaau, HI 96749 | Kaloli Point Residence');
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', 'https://kalolipointparadisehawaii.com/');
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /^https:\/\/kalolipointparadisehawaii\.com\/_astro\/.+\.jpg$/);
    await expect(page.locator('meta[name=description]')).toHaveAttribute('content', /Kaloli Point/);
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? '{}');
    expect(ld['@type']).toBe('RealEstateListing');
    expect(ld.offers.price).toBe(679000);
    expect(ld.mainEntity.numberOfBedrooms).toBe(2);
    expect(ld.mainEntity.floorSize.value).toBe(1968);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1')).toContainText('15–1077');
    await page.waitForTimeout(1500);
    expect(errors).toEqual([]);
    expect(await events(page)).toContain('property_view');
  });

  test('hero shows price, facts and both calls to action', async ({ page }) => {
    await page.goto('/');
    const hero = page.locator('[data-hero]');
    await expect(hero).toContainText('$679,000');
    await expect(hero).toContainText('2 Bed · 3 Bath · 1,968 SF · 0.50 AC');
    await expect(hero.getByRole('link', { name: /request private showing/i })).toBeVisible();
    await expect(hero.getByRole('link', { name: /watch the property film/i })).toBeAttached();
    const box = await hero.boundingBox();
    const vp = page.viewportSize()!;
    expect(box!.height).toBeGreaterThanOrEqual(vp.height * 0.95);
  });

  test('hero CTA opens the request sheet in place and is tracked', async ({ page }) => {
    await page.goto('/');
    const cta = page.locator('[data-hero]').getByRole('link', { name: /request private showing/i });
    await cta.scrollIntoViewIfNeeded();
    const y0 = await page.evaluate(() => window.scrollY);
    await cta.click();
    const sheet = page.locator('#showing-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Request Private Showing' })).toBeVisible();
    await expect(sheet.locator('#showing-form')).toHaveCount(1);
    await expect(page.locator('#showing-form')).toHaveCount(1);
    await expect(sheet.getByRole('button', { name: /send showing request/i })).toBeAttached();
    expect(await page.evaluate(() => window.scrollY)).toBe(y0);
    expect(await tracked(page, 'showing_cta_click')).toEqual([{ cta_location: 'hero' }]);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(page.locator('[data-form-home] #showing-form')).toHaveCount(1);
    await expect(cta).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(y0);
  });

  test('Request Private Showing stays reachable from top to footer and back', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(700);
    const probe = () =>
      page.evaluate(() => {
        const vh = window.innerHeight;
        const vw = window.innerWidth;
        const usable = (el: Element) => {
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) return false;
          if (!(el as HTMLElement).checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
          const hit = document.elementFromPoint(
            Math.min(Math.max(r.left + r.width / 2, 1), vw - 1),
            Math.min(Math.max(r.top + r.height / 2, 1), vh - 1),
          );
          return !!hit && (hit === el || el.contains(hit));
        };
        const share = (sel: string) => {
          const r = document.querySelector(sel)!.getBoundingClientRect();
          return Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0)) / vh;
        };
        return {
          y: Math.round(window.scrollY),
          ctas: [...document.querySelectorAll<HTMLElement>('[data-showing-cta]')].filter(usable).map((e) => e.dataset.showingCta!),
          form: Math.max(share('#showing'), share('#experience')),
        };
      });

    const top = await probe();
    // Short landscape screens show the header CTA above the fold instead of the hero's.
    expect(top.ctas.filter((c) => c === 'hero' || c === 'desktop_header'), 'a CTA is visible at the top').not.toHaveLength(0);
    expect(top.ctas, 'no duplicate phone bar over the hero').not.toContain('mobile_sticky');

    const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    const step = Math.round(page.viewportSize()!.height * 0.8);
    const stops: number[] = [];
    for (let y = 0; y < max; y += step) stops.push(y);
    stops.push(max, Math.round(max * 0.66), Math.round(max * 0.33), 0);

    const problems: string[] = [];
    for (const y of stops) {
      await page.evaluate((v) => window.scrollTo(0, v), y);
      await page.waitForTimeout(450);
      const s = await probe();
      const persistent = s.ctas.filter((c) => c === 'desktop_header' || c === 'mobile_sticky');
      if (s.form < 0.3 && !s.ctas.includes('hero') && persistent.length === 0) problems.push(`no CTA at y=${s.y} (${s.ctas.join(',') || 'none'})`);
      if (s.ctas.length === 0 && s.form < 0.2) problems.push(`nothing actionable at y=${s.y}`);
      if (s.form >= 0.42 && persistent.length) problems.push(`duplicate ${persistent.join(',')} over the form at y=${s.y}`);
      if (s.ctas.includes('desktop_header') && s.ctas.includes('mobile_sticky')) problems.push(`header + bar together at y=${s.y}`);
    }
    expect(problems).toEqual([]);

    // Mid-page: the persistent control opens the sheet without moving the page.
    await page.evaluate(() => window.scrollTo(0, document.getElementById('gallery')!.offsetTop));
    await page.waitForTimeout(450);
    const mid = await probe();
    const origin = mid.ctas.find((c) => c === 'desktop_header' || c === 'mobile_sticky');
    expect(origin, `persistent CTA at gallery (${mid.ctas.join(',')})`).toBeTruthy();
    const trigger = page.locator(`[data-showing-cta="${origin}"]`);
    await trigger.click();
    await expect(page.locator('#showing-sheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#showing-sheet')).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - mid.y)).toBeLessThanOrEqual(2);
    expect(await events(page)).toContain('showing_cta_click');
  });

  test('navigation reaches every chapter', async ({ page, isMobile }) => {
    await page.goto('/');
    const header = page.locator('[data-header]');
    for (const [label, id] of [['Lanais', 'lanais'], ['Gallery', 'gallery'], ['Kaloli Point', 'location']] as const) {
      const toggle = header.locator('[data-menu-toggle]');
      if (await toggle.isVisible()) {
        await toggle.click();
        await expect(page.locator('#mobile-nav')).toBeVisible();
        await page.locator('#mobile-nav').getByRole('link', { name: label }).click();
        await expect(page.locator('#mobile-nav')).toBeHidden();
      } else {
        await header.locator('.nav-desktop').getByRole('link', { name: label }).click();
      }
      await expect(page.locator(`#${id} h2`).first()).toBeInViewport({ timeout: 8000 });
    }
    if (isMobile) {
      const toggle = header.locator('[data-menu-toggle]');
      await toggle.click();
      await page.keyboard.press('Escape');
      await expect(page.locator('#mobile-nav')).toBeHidden();
      await expect(toggle).toBeFocused();
    }
  });

  test('gallery opens full screen, navigates by keyboard and closes', async ({ page }) => {
    await page.goto('/');
    const tile = page.locator('a[data-gallery="collection"]').first();
    const total = await page.locator('a[data-gallery="collection"]').count();
    await tile.scrollIntoViewIfNeeded();
    await tile.click();
    const pswp = page.locator('.pswp');
    await expect(pswp).toBeVisible();
    await expect(pswp).toHaveAttribute('role', 'dialog');
    const caption = page.locator('.pswp__kp-caption');
    await expect(caption).toContainText(`1 / ${total}`);
    await page.waitForTimeout(700);
    await page.keyboard.press('ArrowRight');
    await expect(caption).toContainText(`2 / ${total}`);
    const img = page.locator('.pswp__item img.pswp__img').first();
    await expect(img).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pswp).toHaveCount(0);
    expect(await events(page)).toContain('gallery_open');
  });

  test('floor plans open the dimensioned versions', async ({ page }) => {
    await page.goto('/');
    const plan = page.locator('a[data-gallery="plans"]').first();
    await plan.scrollIntoViewIfNeeded();
    await expect(plan).toHaveAttribute('data-pswp-caption', /with dimensions/);
  });

  test('property film streams and is tracked', async ({ page, browserName }) => {
    await page.goto('/');
    await page.locator('#film').scrollIntoViewIfNeeded();
    await page.locator('[data-film-play]').click();
    const player = page.locator('[data-film]');
    if (browserName === 'chromium') {
      await expect(player).toHaveAttribute('data-state', 'playing', { timeout: 20000 });
      const t = await page.locator('[data-film-video]').evaluate((v: HTMLVideoElement) => new Promise<number>((r) => setTimeout(() => r(v.currentTime), 1500)));
      expect(t).toBeGreaterThan(0.3);
      expect(await events(page)).toContain('property_film_start');
    } else {
      await expect(player).not.toHaveAttribute('data-state', 'idle', { timeout: 20000 });
    }
  });

  test('every image declares dimensions and a responsive srcset', async ({ page }) => {
    await page.goto('/');
    const bad = await page.evaluate(() =>
      [...document.querySelectorAll('img')]
        .filter((i) => !i.getAttribute('width') || !i.getAttribute('height') || (i.closest('picture') && !i.closest('picture')!.querySelector('source[type="image/avif"]')))
        .map((i) => i.src),
    );
    expect(bad).toEqual([]);
  });

  test('reduced motion leaves all content visible', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForTimeout(1200);
    const hidden = await page.evaluate(() => [...document.querySelectorAll('[data-reveal]')].filter((e) => getComputedStyle(e).opacity !== '1').length);
    expect(hidden).toBe(0);
    expect(await page.evaluate(() => document.documentElement.classList.contains('lenis'))).toBe(false);
    await ctx.close();
  });

  test('phone links dial the listing agent and are tracked', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => document.addEventListener('click', (e) => (e.target as Element).closest('a[href^="tel:"]') && e.preventDefault(), true));
    const tel = page.locator('#agent a[href^="tel:"]');
    await expect(tel).toHaveAttribute('href', 'tel:+18087568811');
    await tel.scrollIntoViewIfNeeded();
    await tel.click();
    expect(await tracked(page, 'agent_contact_click')).toEqual([{ cta_location: 'agent', contact_method: 'phone' }]);
  });

  test('no serious accessibility violations', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1000);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.length} nodes — ${v.nodes[0]?.target}`)).toEqual([]);
  });

  test('robots, sitemap, privacy and 404 are served', async ({ page, request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toMatch(/Sitemap: https:\/\/kalolipointparadisehawaii\.com\/sitemap-index\.xml|Disallow: \//);
    expect((await request.get('/sitemap-index.xml')).status()).toBe(200);
    expect((await request.get('/privacy/')).status()).toBe(200);
    const missing = await request.get('/no-such-page');
    expect(missing.status()).toBe(404);
    await page.goto('/no-such-page');
    await expect(page.locator('h1')).toContainText('nowhere');
  });
});
