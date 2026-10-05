import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';

type KpWindow = Window & { __kpEvents?: { event: string; params: Record<string, string> }[] };
const events = (page: Page) => page.evaluate(() => ((window as KpWindow).__kpEvents ?? []).map((e) => e.event));
const tracked = (page: Page, name: string) =>
  page.evaluate((n) => ((window as KpWindow).__kpEvents ?? []).filter((e) => e.event === n).map((e) => e.params), name);

test.describe('page', () => {
  test('loads cleanly with complete SEO metadata', { tag: '@phone' }, async ({ page }) => {
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
    await expect(page.locator('h1')).toContainText('Kaloli Point');
    await expect(page.locator('[data-hero]')).toContainText('15–1077 Amau Rd');
    await page.waitForTimeout(1500);
    expect(errors).toEqual([]);
    expect(await events(page)).toContain('property_view');
  });

  test('loads with healthy Core Web Vitals (LCP, CLS) and page weight', async ({ page, browserName }, info) => {
    test.skip(browserName !== 'chromium', 'LCP and layout-shift observers are Chromium-only');
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number; __lcp: number };
      w.__cls = 0;
      w.__lcp = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__cls += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((list) => {
        const all = list.getEntries();
        w.__lcp = all[all.length - 1]?.startTime ?? w.__lcp;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    });
    await page.goto('/');
    await page.waitForLoadState('load');
    await page.waitForTimeout(2500);
    const m = await page.evaluate(() => {
      const w = window as unknown as { __cls: number; __lcp: number };
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      const kb = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).reduce((s, r) => s + r.transferSize, nav.transferSize) / 1024;
      return { lcp: Math.round(w.__lcp), cls: Number(w.__cls.toFixed(3)), ttfb: Math.round(nav.responseStart), kb: Math.round(kb) };
    });
    console.log(`[${info.project.name}] LCP ${m.lcp} ms | CLS ${m.cls} | TTFB ${m.ttfb} ms | initial transfer ${m.kb} KB`);
    expect(m.cls).toBeLessThan(0.1);
    expect(m.lcp).toBeLessThan(4000);
  });

  test('hero shows price, facts and both calls to action', { tag: '@phone' }, async ({ page }) => {
    await page.goto('/');
    const hero = page.locator('[data-hero]');
    await expect(hero).toContainText('$679,000');
    await expect(hero).toContainText('2 Bed · 3 Bath · 1,968 SF · 0.50 Acre');
    await expect(hero).toContainText('Paradise on Hawaiʻi Island');
    await expect(hero.getByRole('link', { name: /request private showing/i })).toBeVisible();
    await expect(hero.getByRole('link', { name: /explore the residence/i })).toBeVisible();
    await expect(hero.getByRole('link', { name: /watch the film/i })).toBeAttached();
    const box = await hero.boundingBox();
    const vp = page.viewportSize()!;
    expect(box!.height).toBeGreaterThanOrEqual(vp.height * 0.95);
  });

  test('hero loop is a separate silent file that never loads with the page or the full film', async ({ page, request }) => {
    const media: string[] = [];
    let atLoad: string[] | null = null;
    page.on('request', (r) => /\/media\//.test(r.url()) && media.push(new URL(r.url()).pathname));
    page.on('load', () => (atLoad = [...media]));
    await page.goto('/');
    const html = await (await request.get('/')).text();
    expect(html, 'the page ships the loop without a source; it is attached after load').not.toMatch(/<video[^>]*data-hero-video[^>]*\ssrc=/);
    const video = page.locator('[data-hero-video]');
    expect(await video.evaluate((v: HTMLVideoElement) => [v.muted, v.loop, v.playsInline, v.preload])).toEqual([true, true, true, 'none']);
    expect(atLoad, 'no video is requested before the page has loaded').toEqual([]);
    await page.waitForTimeout(3500);
    expect(media.filter((p) => p.startsWith('/media/film/')), 'the 56-second film waits for its play button').toEqual([]);
    for (const name of ['wide', 'tall']) {
      const src = (await video.getAttribute(`data-src-${name}`))!;
      const res = await request.get(src);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain('video/mp4');
      expect((await res.body()).length).toBeLessThan(4 * 1024 * 1024);
    }
  });

  test('three levels: tabs switch panels by click and keyboard', async ({ page }) => {
    await page.goto('/');
    const tabs = page.getByRole('tablist', { name: 'The three levels' });
    await tabs.scrollIntoViewIfNeeded();
    await expect(page.locator('#level-1')).toBeVisible();
    await expect(page.locator('#level-2')).toBeHidden();
    await tabs.getByRole('tab', { name: /living level/i }).click();
    await expect(page.locator('#level-2')).toBeVisible();
    await expect(page.locator('#level-1')).toBeHidden();
    await tabs.getByRole('tab', { name: /living level/i }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.getByRole('tab', { name: /primary retreat/i })).toBeFocused();
    await expect(page.locator('#level-3')).toBeVisible();
    await page.locator('#level-3 details summary').click();
    await expect(page.locator('#level-3 .rooms')).toContainText('Primary bedroom');
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

  test('a request started in the sheet is still there when reopened from another CTA', async ({ page }) => {
    await page.goto('/');
    await page.locator('[data-hero]').getByRole('link', { name: /request private showing/i }).click();
    const sheet = page.locator('#showing-sheet');
    await sheet.getByLabel('Full name').fill('Continuity Check');
    await sheet.getByLabel('Preferred time').selectOption('10:00');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await page.evaluate(() => window.scrollTo(0, document.getElementById('gallery')!.offsetTop));
    await page.waitForTimeout(600);
    await page.locator('[data-showing-cta="mobile_sticky"]:visible, [data-showing-cta="desktop_header"]:visible').first().click();
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel('Full name')).toHaveValue('Continuity Check');
    await expect(sheet.getByLabel('Preferred time')).toHaveValue('10:00');
  });

  test('Request Private Showing stays reachable from top to footer and back', { tag: '@phone' }, async ({ page }) => {
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
          form: share('#showing'),
        };
      });

    const top = await probe();
    // Short landscape screens show the header CTA above the fold instead of the hero's.
    expect(top.ctas.filter((c) => c === 'hero' || c === 'desktop_header'), 'a CTA is visible at the top').not.toHaveLength(0);
    expect(top.ctas, 'no duplicate phone bar over the hero').not.toContain('mobile_sticky');

    const max = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    // Every 0.8 screen, but no more than ~45 stops so short landscape screens finish within the timeout.
    const step = Math.max(Math.round(page.viewportSize()!.height * 0.8), Math.ceil(max / 45));
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

  test('no content is cut off at the sides', { tag: '@phone' }, async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(800);
    const cut = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const insideScroller = (el: Element) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          if (['hidden', 'auto', 'scroll', 'clip'].includes(getComputedStyle(p).overflowX)) return true;
        }
        return false;
      };
      return [...document.querySelectorAll('h1, h2, h3, p, li, dt, dd, a, button, label, input, select, textarea')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0 || el.closest('dialog:not([open]), [hidden], .visually-hidden, .skip-link')) return false;
          return (r.right > vw + 1 || r.left < -1) && !insideScroller(el);
        })
        .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 32)}" spans ${Math.round(el.getBoundingClientRect().left)}..${Math.round(el.getBoundingClientRect().right)} of ${vw}`);
    });
    expect(cut).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('the phone action bar never covers controls, fields or the last lines', { tag: '@phone' }, async ({ page }) => {
    await page.goto('/');
    const bar = page.locator('[data-sticky-cta]');
    test.skip(await bar.evaluate((el) => getComputedStyle(el).display === 'none'), 'the action bar exists only on portrait phones');
    const shown = () => bar.evaluate((el) => (el as HTMLElement).dataset.visible === 'true');
    // What a tap on the bar's centre would actually hit.
    const atBar = () =>
      page.evaluate(() => {
        const r = document.querySelector('[data-sticky-cta]')!.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (el?.closest('[data-sticky-cta]')) return 'bar';
        if (el?.closest('.pswp')) return 'gallery';
        if (el?.closest('#mobile-nav')) return 'menu';
        return el?.tagName.toLowerCase() ?? 'none';
      });

    await page.evaluate(() => window.scrollTo(0, document.getElementById('gallery')!.offsetTop));
    await expect.poll(shown).toBe(true);

    await page.locator('a[data-gallery="curated"]').first().click();
    await expect(page.locator('.pswp')).toBeVisible();
    await page.waitForTimeout(500);
    expect(await atBar(), 'gallery viewer and its controls sit above the bar').toBe('gallery');
    await page.keyboard.press('Escape');
    await expect(page.locator('.pswp')).toHaveCount(0);

    await page.locator('[data-menu-toggle]').click();
    await expect(page.locator('#mobile-nav')).toBeVisible();
    expect(await atBar(), 'the open menu covers the bar').toBe('menu');
    await page.keyboard.press('Escape');
    await expect(page.locator('#mobile-nav')).toBeHidden();

    await page.locator('#film').scrollIntoViewIfNeeded();
    await page.locator('[data-film-play]').click();
    await expect(page.locator('[data-film]')).not.toHaveAttribute('data-state', 'idle', { timeout: 20000 });
    await expect.poll(shown, { message: 'the bar steps aside while the film player is in use' }).toBe(false);
    await page.locator('[data-film-video]').evaluate((v: HTMLVideoElement) => v.pause());

    await page.evaluate(() => window.scrollTo(0, document.getElementById('lanais')!.offsetTop));
    await expect.poll(shown).toBe(true);
    await page.locator('#f-name').focus();
    await expect.poll(shown, { message: 'typing in the form hides the bar' }).toBe(false);
    await page.locator('#f-name').blur();

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(700);
    const last = await page.evaluate(() => {
      const line = document.querySelector('.site-footer .copy')!.getBoundingClientRect();
      const b = document.querySelector<HTMLElement>('[data-sticky-cta]')!;
      return { lineBottom: line.bottom, barTop: b.getBoundingClientRect().top, barShown: b.dataset.visible === 'true' };
    });
    if (last.barShown) expect(last.lineBottom, 'the last footer line clears the bar').toBeLessThanOrEqual(last.barTop);
  });

  test('navigation reaches every chapter', { tag: '@phone' }, async ({ page, isMobile }) => {
    await page.goto('/');
    const header = page.locator('[data-header]');
    for (const [label, id] of [['Three levels', 'levels'], ['Film & gallery', 'film'], ['Kaloli Point', 'location']] as const) {
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

  test('gallery opens full screen, navigates by keyboard and closes', { tag: '@phone' }, async ({ page }) => {
    await page.goto('/');
    const tile = page.locator('a[data-gallery="curated"]').first();
    const total = await page.locator('a[data-gallery="curated"]').count();
    expect(total, 'an edited landing-page gallery').toBeGreaterThanOrEqual(8);
    expect(total).toBeLessThanOrEqual(12);
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

  test('all 46 photographs open in one collection, with the viewer inside it', { tag: '@phone' }, async ({ page }) => {
    await page.goto('/');
    const open = page.locator('[data-open-all]');
    await open.scrollIntoViewIfNeeded();
    await open.click();
    const all = page.locator('#all-photos');
    await expect(all).toBeVisible();
    await expect(all.locator('a[data-gallery="all"]')).toHaveCount(46);
    await expect(page.locator('[data-sticky-cta]')).toHaveAttribute('data-visible', 'false');
    await all.locator('a[data-gallery="all"]').nth(5).click();
    const caption = all.locator('.pswp__kp-caption');
    await expect(caption).toContainText('6 / 46');
    await page.waitForTimeout(700);
    await page.keyboard.press('Escape');
    await expect(all.locator('.pswp')).toHaveCount(0);
    await expect(all).toBeVisible();
    // The collection ends in the same showing experience, opened on top of it.
    const end = all.locator('.all-end [data-showing-cta="gallery"]');
    await end.scrollIntoViewIfNeeded();
    await end.click();
    const sheet = page.locator('#showing-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('#showing-form')).toHaveAttribute('data-cta-origin', 'gallery');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(all).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.style.overflow), 'page stays locked under the collection').toBe('hidden');
    await expect(end).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(all).toBeHidden();
    await expect(open).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
  });

  test('the hero pause control never sits on the type', { tag: '@phone' }, async ({ page }) => {
    await page.goto('/');
    const overlaps = await page.evaluate(() => {
      const toggle = document.querySelector<HTMLElement>('[data-hero-toggle]')!;
      toggle.hidden = false; // shown once the loop plays; position it as visitors would see it
      const t = toggle.getBoundingClientRect();
      return [...document.querySelectorAll('[data-hero] .hero-content *')]
        .flatMap((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return [...range.getClientRects()].map((r) => ({ r, text: (el.textContent ?? '').trim().slice(0, 30) }));
        })
        .filter(({ r }) => r.width > 0 && r.right > t.left && r.left < t.right && r.bottom > t.top && r.top < t.bottom)
        .map(({ text }) => text);
    });
    expect(overlaps).toEqual([]);
  });

  test('keyboard only: skip link, visible focus, hero request sheet and back', async ({ page, isMobile, browserName }) => {
    test.skip(isMobile, 'keyboard journey runs on desktop and tablet projects');
    // WebKit, like Safari's default setting, never moves Tab focus to links (Safari users enable "Press Tab to
    // highlight each item"); the link journey is asserted in the Chromium projects.
    test.skip(browserName === 'webkit', 'WebKit Tab skips links by platform design');
    const TAB = 'Tab';
    await page.goto('/');
    await page.keyboard.press(TAB);
    await expect(page.locator('.skip-link')).toBeFocused();
    const problems: string[] = [];
    let onHeroCta = false;
    for (let i = 0; i < 30 && !onHeroCta; i++) {
      await page.keyboard.press(TAB);
      const s = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
        const header = document.querySelector('[data-header]')!.getBoundingClientRect();
        const inHeader = !!el.closest('[data-header]');
        return {
          name: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30),
          hero: el.matches('[data-hero] [data-showing-cta]'),
          ring,
          onScreen: r.bottom > 0 && r.top < innerHeight && r.width > 0,
          underHeader: !inHeader && r.top < header.bottom,
        };
      });
      if (!s) continue;
      if (!s.ring) problems.push(`no focus ring on "${s.name}"`);
      if (!s.onScreen) problems.push(`"${s.name}" focused off screen`);
      if (s.underHeader) problems.push(`"${s.name}" focused under the header`);
      onHeroCta = s.hero;
    }
    expect(onHeroCta, 'the hero CTA is reachable by Tab').toBe(true);
    expect(problems).toEqual([]);
    await page.keyboard.press('Enter');
    const sheet = page.locator('#showing-sheet');
    await expect(sheet).toBeVisible();
    await expect(page.locator('#sheet-title')).toBeFocused();
    await page.keyboard.press(TAB);
    expect(await page.evaluate(() => !!document.activeElement?.closest('#showing-sheet')), 'focus stays inside the sheet').toBe(true);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(page.locator('[data-hero] [data-showing-cta]')).toBeFocused();
  });

  test('hero loops answer byte-range requests, as Safari and iOS require for video', async ({ request }, info) => {
    test.skip(info.project.name !== 'desktop-1440', 'server behaviour, checked once');
    for (const file of ['/media/hero/hero-tall-v1.mp4', '/media/hero/hero-wide-v1.mp4']) {
      const r = await request.get(file, { headers: { Range: 'bytes=0-1' } });
      expect(r.status(), file).toBe(206);
      expect(r.headers()['content-range'], file).toMatch(/^bytes 0-1\/\d{6,}$/);
      expect(r.headers()['content-type'], file).toBe('video/mp4');
      expect((await r.body()).length, file).toBe(2);
    }
  });

  test('every showing entry point is attributed by the API', async ({ page }) => {
    const { CTA_ORIGINS } = await import('../src/lib/server/schema');
    await page.goto('/');
    const origins = await page.locator('[data-showing-cta]').evaluateAll((els) => [...new Set(els.map((e) => (e as HTMLElement).dataset.showingCta))]);
    expect(origins.length).toBeGreaterThanOrEqual(8);
    for (const o of origins) expect(CTA_ORIGINS as readonly string[], `origin ${o}`).toContain(o);
  });

  test('floor plans open the dimensioned versions', async ({ page }) => {
    await page.goto('/');
    const plan = page.locator('a[data-gallery="plans"]').first();
    await plan.scrollIntoViewIfNeeded();
    await expect(plan).toHaveAttribute('data-pswp-caption', /with dimensions/);
  });

  test('property film streams and is tracked', { tag: '@phone' }, async ({ page, browserName }) => {
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

  test('reduced motion leaves all content visible', async ({ page }) => {
    // Same context as every other test, so runs against a deployed site keep analytics quiet.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForTimeout(1200);
    const hidden = await page.evaluate(() => [...document.querySelectorAll('[data-reveal]')].filter((e) => getComputedStyle(e).opacity !== '1').length);
    expect(hidden).toBe(0);
    await page.waitForTimeout(3000);
    expect(await page.locator('[data-hero-video]').evaluate((v: HTMLVideoElement) => v.currentSrc), 'reduced motion keeps the still photograph').toBe('');
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
