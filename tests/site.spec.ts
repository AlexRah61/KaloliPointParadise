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
    expect(media.filter((p) => p.startsWith('/media/film/')), 'the full film waits for its play button').toEqual([]);
    for (const name of ['wide', 'tall']) {
      const src = (await video.getAttribute(`data-src-${name}`))!;
      const res = await request.get(src);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain('video/mp4');
      // The 13 s eight-beat trailer: 1600x900 wide ~4.0 MiB, 864x1080 tall ~2.4 MiB, loaded only after the page.
      expect((await res.body()).length).toBeLessThan(4.5 * 1024 * 1024);
    }
  });

  test('three levels: tabs switch photo, description, rooms and plan together, by click and keyboard', async ({ page }) => {
    await page.goto('/');
    const tabs = page.getByRole('tablist', { name: 'The three levels' });
    await tabs.scrollIntoViewIfNeeded();
    await expect(page.locator('#level-1')).toBeVisible();
    await expect(page.locator('#level-2')).toBeHidden();
    const expected = [
      { tab: /garden level/i, room: 'Covered lanai', dim: '34′0″ × 31′6″', plan: 'Level 1 · with dimensions', photo: /covered lanai/i },
      { tab: /living level/i, room: 'Family room', dim: '26′8″ × 13′11″', plan: 'Level 2 · with dimensions', photo: /family room/i },
      { tab: /primary retreat/i, room: 'Primary bedroom', dim: '26′9″ × 19′10″', plan: 'Level 3 · with dimensions', photo: /primary bedroom/i },
    ];
    for (const [i, e] of expected.entries()) {
      await tabs.getByRole('tab', { name: e.tab }).click();
      const panel = page.locator(`#level-${i + 1}`);
      await expect(panel).toBeVisible();
      await expect(tabs.getByRole('tab', { name: e.tab })).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('[data-level-panel]:visible')).toHaveCount(1);
      await expect(panel.locator('.rooms')).toBeVisible();
      await expect(panel.locator('.rooms')).toContainText(e.room);
      await expect(panel.locator('.rooms')).toContainText(e.dim);
      await expect(panel.locator('a[data-gallery="plans"]')).toHaveAttribute('data-pswp-caption', e.plan);
      await expect(panel.locator('a[data-gallery="levels"]')).toHaveAttribute('aria-label', e.photo);
    }
    await tabs.getByRole('tab', { name: /living level/i }).click();
    await tabs.getByRole('tab', { name: /living level/i }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.getByRole('tab', { name: /primary retreat/i })).toBeFocused();
    await expect(page.locator('#level-3')).toBeVisible();
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

  test('the hero pause control and beat label never sit on the type', { tag: '@phone' }, async ({ page }) => {
    await page.goto('/');
    const overlaps = await page.evaluate(() => {
      // Both are shown once the loop plays; position them as visitors would see them.
      const controls = ['[data-hero-toggle]', '[data-hero-beat]']
        .map((s) => {
          const el = document.querySelector<HTMLElement>(s)!;
          el.hidden = false;
          return el.getBoundingClientRect();
        })
        .filter((r) => r.width > 0); // the beat label is not shown on short landscape screens
      const header = document.querySelector('[data-header]')!.getBoundingClientRect();
      const texts = [...document.querySelectorAll('[data-hero] .hero-content *, [data-header] a, [data-header] button')].flatMap((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return [...range.getClientRects()].map((r) => ({ r, text: (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 30) }));
      });
      const hits = controls.flatMap((t) =>
        texts.filter(({ r }) => r.width > 0 && r.right > t.left && r.left < t.right && r.bottom > t.top && r.top < t.bottom).map(({ text }) => text),
      );
      if (controls.some((t) => t.left < 0 || t.right > innerWidth || t.top < header.bottom)) hits.push('control outside the hero area');
      return hits;
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
    for (const file of ['/media/hero/hero-tall-v2.mp4', '/media/hero/hero-wide-v2.mp4']) {
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
    await expect(page.getByText('Misti R. Tyrin', { exact: true }), 'one agent card, in the footer').toHaveCount(1);
    await page.evaluate(() => document.addEventListener('click', (e) => (e.target as Element).closest('a[href^="tel:"]') && e.preventDefault(), true));
    const tel = page.locator('.site-footer .agent-card a[href^="tel:"]');
    await expect(tel).toHaveAttribute('href', 'tel:+18087568811');
    await tel.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await tel.click();
    expect(await tracked(page, 'agent_contact_click')).toEqual([{ cta_location: 'footer', contact_method: 'phone' }]);
  });

  test('the header shows the listing agent’s number beside the section links', { tag: '@phone' }, async ({ page }) => {
    await page.goto('/');
    const { width: vw, height: vh } = page.viewportSize()!;
    const call = page.locator('[data-header] .header-call');
    if (vw < 360 || (vw < 640 && vh <= 500)) {
      // No room beside the brand and the menu: the menu carries the number.
      await expect(call).toBeHidden();
      await page.locator('[data-menu-toggle]').click();
      await expect(page.locator('#mobile-nav a[href="tel:+18087568811"]')).toBeVisible();
      return;
    }
    await expect(call).toBeVisible();
    await expect(call).toHaveAttribute('href', 'tel:+18087568811');
    await expect(call).toHaveAccessibleName(/Contact agent.*\(808\) 756-8811/);
    const numberWidth = await call.locator('.call-number').evaluate((el) => el.getBoundingClientRect().width);
    if (vw >= 768) expect(numberWidth, 'the number itself is readable').toBeGreaterThan(60);
    const nav = page.locator('[data-header] .nav-desktop');
    if (await nav.isVisible()) {
      const link = (await nav.getByRole('link', { name: 'Kaloli Point' }).boundingBox())!;
      const box = (await call.boundingBox())!;
      expect(box.x, 'right after Kaloli Point').toBeGreaterThan(link.x + link.width);
      expect(Math.abs(box.y + box.height / 2 - (link.y + link.height / 2)), 'on the same line').toBeLessThan(6);
    }
    const fits = await page.evaluate(() => {
      const bar = document.querySelector('[data-header] .bar')!.getBoundingClientRect();
      const boxes = ['.brand', '.nav-desktop', '.header-call', '.header-cta', '.menu-toggle']
        .map((s) => document.querySelector(`[data-header] ${s}`))
        .filter((el): el is Element => !!el && getComputedStyle(el).display !== 'none')
        .map((el) => el.getBoundingClientRect());
      const links = [...document.querySelectorAll('[data-header] .nav-desktop a')].map((a) => a.getBoundingClientRect());
      return boxes.every((r, i) => (i === 0 || r.left >= boxes[i - 1]!.right) && r.right <= bar.right + 1) && links.every((r) => r.height < 40);
    });
    expect(fits, 'one line, nothing overlapping').toBe(true);
    await page.evaluate(() => document.addEventListener('click', (e) => (e.target as Element).closest('a[href^="tel:"]') && e.preventDefault(), true));
    await call.click();
    expect(await tracked(page, 'agent_contact_click')).toEqual([{ cta_location: 'header', contact_method: 'phone' }]);
  });

  test('the footer introduces the listing agent with her portrait, direct lines and website', { tag: '@phone' }, async ({ page }) => {
    await page.goto('/');
    const card = page.locator('.site-footer .agent-card');
    await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const img = card.locator('img');
    await expect(img).toHaveAttribute('alt', /Misti R\. Tyrin/);
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    await expect(card.getByText('Misti R. Tyrin', { exact: true })).toBeVisible();
    await expect(card.getByText('Principal Broker & Owner · Iokua Real Estate')).toBeVisible();
    await expect(card.locator('a[href="tel:+18087568811"]')).toHaveText('(808) 756-8811');
    await expect(card.locator('a[href="mailto:mrstyrin@gmail.com"]')).toHaveText('mrstyrin@gmail.com');
    const site = card.getByRole('link', { name: /Visit Misti’s website/ });
    await expect(site).toHaveAttribute('href', 'https://misti.iokuarealestate.com/');
    await expect(site).toHaveAttribute('target', '_blank');
    await expect(site).toHaveAttribute('rel', /noopener/);
    await page.evaluate(() => document.addEventListener('click', (e) => (e.target as Element).closest('a[target="_blank"]') && e.preventDefault(), true));
    await site.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await site.click();
    expect(await tracked(page, 'agent_contact_click')).toEqual([{ cta_location: 'footer', contact_method: 'website' }]);
  });

  test('the map shows the property, zooms between scales and links to directions and the Puna district', { tag: '@phone' }, async ({ page }) => {
    await page.goto('/');
    const order = await page.evaluate(() => [...document.querySelectorAll('section[id]')].map((s) => s.id));
    expect(order.indexOf('map'), 'after the showing request').toBeGreaterThan(order.indexOf('showing'));
    const section = page.locator('#map');
    await section.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    const map = section.locator('iframe[data-map]');
    await expect(map).toHaveAttribute('title', /15-1077 Amau Rd/);
    await expect(map).toHaveAttribute('src', /q=19\.615055,-154\.95381&z=14&/);
    await expect(map).toBeVisible();
    for (const [name, src] of [['Island', /&z=9&/], ['Lot', /&z=18&t=k&/], ['Neighborhood', /&z=14&/]] as const) {
      const button = section.getByRole('button', { name: new RegExp(`^${name}`) });
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(map).toHaveAttribute('src', src);
    }
    await expect(section.getByRole('link', { name: /Explore Puna district/ })).toHaveAttribute('href', 'https://iokuarealestate.com/neighborhoods/puna');
    await expect(section.getByRole('link', { name: /Get directions/ })).toHaveAttribute('href', /maps\/dir\/\?api=1&destination=19\.615055,-154\.95381$/);
  });

  test('Watch the film brings the whole player, controls included, into view', { tag: '@phone' }, async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(500);
    await page.locator('[data-hero] [data-film-trigger]').click();
    const player = page.locator('[data-film]');
    await expect(player).not.toHaveAttribute('data-state', 'idle', { timeout: 20000 });
    // Let the smooth scroll settle.
    let last = -1;
    await expect.poll(async () => {
      const y = await page.evaluate(() => window.scrollY);
      const settled = y === last;
      last = y;
      return settled;
    }, { intervals: [300] }).toBe(true);
    const box = await page.evaluate(() => {
      const r = document.querySelector('[data-film]')!.getBoundingClientRect();
      const header = document.querySelector('[data-header]')!.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, headerBottom: header.bottom, vh: window.innerHeight };
    });
    expect(box.top, 'player top clears the header').toBeGreaterThanOrEqual(box.headerBottom - 1);
    expect(box.bottom, 'player bottom edge (play/pause, full screen) is on screen').toBeLessThanOrEqual(box.vh + 1);
    await expect(page.locator('[data-film-video]')).toHaveJSProperty('controls', true);
    await page.locator('[data-film-video]').evaluate((v: HTMLVideoElement) => v.pause());
  });

  test('three lanais: one exterior shows all three, each with its own labelled view', { tag: '@phone' }, async ({ page }) => {
    await page.goto('/');
    const section = page.locator('#lanais');
    await expect(section.locator('#lanais-title')).toContainText('Three lanais');
    const facade = section.locator('.facade a[data-gallery="lanais"]');
    await facade.scrollIntoViewIfNeeded();
    await expect(facade).toHaveAttribute('aria-label', /covered lanai.*wraparound lanai.*top-floor lanai/i);
    const pins = await section.locator('.pin .pin-dot').evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        const f = el.closest('.facade-frame')!.getBoundingClientRect();
        return { inside: r.left >= f.left && r.right <= f.right && r.top >= f.top && r.bottom <= f.bottom, visible: r.width > 0 };
      }),
    );
    expect(pins).toEqual(Array(3).fill({ inside: true, visible: true }));
    const box = await facade.boundingBox();
    expect(box!.width, 'the exterior is a principal, full-width image').toBeGreaterThanOrEqual(page.viewportSize()!.width * 0.98);
    const views = section.locator('.lanai-views > li');
    await expect(views).toHaveCount(3);
    for (const [i, name] of ['Covered lanai', 'Wraparound lanai', 'Top-floor lanai'].entries()) {
      await expect(views.nth(i).locator('.view-name')).toHaveText(name);
      await expect(views.nth(i).locator('.view-level')).toContainText(['Garden level', 'Living level', 'Primary retreat'][i]!);
      await views.nth(i).scrollIntoViewIfNeeded();
      await expect.poll(() => views.nth(i).locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    }
    expect(await views.nth(1).locator('img').evaluate((img: HTMLImageElement) => img.currentSrc), 'the owners’ retouched wraparound photo').toContain('lanai-wraparound');
  });

  test('light to night ends on the Milky Way, uncropped, large and never under text', { tag: '@phone' }, async ({ page }) => {
    await page.goto('/');
    const night = page.locator('#evenings .night-media');
    await night.scrollIntoViewIfNeeded();
    await expect.poll(() => night.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    const m = await page.evaluate(() => {
      const media = document.querySelector('#evenings .night-media')!;
      const img = media.querySelector('img')!;
      const r = media.getBoundingClientRect();
      const ir = img.getBoundingClientRect();
      const texts = [...document.querySelectorAll('#evenings .night-copy *')].map((el) => el.getBoundingClientRect());
      const overlap = texts.some((t) => t.width > 0 && t.right > r.left && t.left < r.right && t.bottom > r.top && t.top < r.bottom);
      return {
        ratio: ir.width / ir.height,
        natural: img.naturalWidth / img.naturalHeight,
        fit: getComputedStyle(img).objectFit,
        h: r.height,
        w: r.width,
        vh: window.innerHeight,
        vw: window.innerWidth,
        overlap,
        bg: getComputedStyle(media.closest('.night')!).backgroundImage,
        mask: (() => {
          const s = getComputedStyle(media);
          return s.maskImage && s.maskImage !== 'none' ? s.maskImage : (s.webkitMaskImage ?? '');
        })(),
      };
    });
    expect(Math.abs(m.ratio - m.natural), 'shown at its own proportions').toBeLessThan(0.01);
    expect(m.fit).toBe('contain');
    expect(m.overlap, 'no text over the photograph').toBe(false);
    expect(m.bg).toContain('gradient');
    expect(m.mask.match(/linear-gradient/g) ?? [], 'feathered into the field on all four edges').toHaveLength(2);
    if (m.vw >= 900 || (m.vh <= 500 && m.vw >= 560)) expect(m.h, 'as tall as the screen allows').toBeGreaterThanOrEqual(Math.min(m.vh * 0.85, 1195, m.vw * 0.7));
    else expect(m.w, 'full width on phones').toBeGreaterThanOrEqual(Math.min(m.vw - 60, 540));
    const order = await page.evaluate(() => [...document.querySelectorAll('main > section, main > div > section, body section[id]')].map((s) => s.id).filter(Boolean));
    expect(order.indexOf('evenings'), 'after Kaloli Point').toBeGreaterThan(order.indexOf('location'));
    expect(order.indexOf('evenings'), 'before the showing request').toBeLessThan(order.indexOf('showing'));
  });

  test('the hero loop names each beat as it plays', async ({ page, browserName }) => {
    test.skip(browserName === 'chromium', 'Playwright Chromium has no H.264 decoder');
    await page.goto('/');
    const beat = page.locator('[data-hero-beat]');
    await expect(beat).toBeVisible({ timeout: 20000 });
    const seen = new Set<string>();
    for (let i = 0; i < 16 && seen.size < 4; i++) {
      seen.add((await beat.locator('[data-beat-label]').textContent())!.trim());
      await page.waitForTimeout(900);
    }
    expect(seen.size, `labels seen: ${[...seen].join(', ')}`).toBeGreaterThanOrEqual(4);
    expect(await beat.getAttribute('aria-hidden')).toBe('true');
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
