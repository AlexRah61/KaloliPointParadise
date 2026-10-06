import type { Locator, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';

type KpWindow = Window & { __kpEvents?: { event: string; params: Record<string, string> }[] };
const events = (page: Page) => page.evaluate(() => ((window as KpWindow).__kpEvents ?? []).map((e) => e.event));
const tracked = (page: Page, name: string) =>
  page.evaluate((n) => ((window as KpWindow).__kpEvents ?? []).filter((e) => e.event === n).map((e) => e.params), name);

// A right-to-left swipe across the target: real touch where the browser lets tests synthesise it, a trackpad
// swipe on desktops, and on mobile WebKit (no synthetic touch) the scroll the swipe would make.
async function swipe(page: Page, target: Locator, browserName: string, hasTouch: boolean): Promise<void> {
  const box = (await target.boundingBox())!;
  // The fixed header covers the top of the viewport; aim at the part of the target visitors can see.
  const header = await page.locator('[data-header]').boundingBox();
  const top = Math.max(box.y, header ? header.y + header.height : 0);
  const bottom = Math.min(box.y + box.height, page.viewportSize()!.height);
  const x = box.x + box.width / 2;
  const y = (top + bottom) / 2;
  if (browserName === 'chromium' && hasTouch) {
    const cdp = await page.context().newCDPSession(page);
    const from = box.x + box.width * 0.8;
    const to = box.x + box.width * 0.2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y }] });
    for (let k = 1; k <= 10; k++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from + ((to - from) * k) / 10, y }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else if (!hasTouch) {
    await page.mouse.move(x, y);
    await page.mouse.wheel(box.width * 0.6, 0);
  } else {
    const track = target.locator('[data-carousel-track]');
    await track.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true });
    await track.evaluate((el) => el.scrollBy({ left: el.clientWidth * 0.6 }));
  }
}

// Waits until the carousel track rests on photo i (zero-based).
const settled = (track: Locator, i: number) =>
  expect
    .poll(() => track.evaluate((el) => el.scrollLeft / el.firstElementChild!.getBoundingClientRect().width))
    .toBeCloseTo(i, 1);

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
    await expect(hero.getByRole('heading', { level: 1 })).toHaveAccessibleName('Island Living at Kaloli Point');
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

    await page.locator('[data-carousel] .slide:not([inert]) a').click();
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
    for (const [label, id] of [['Gallery', 'gallery'], ['Three levels', 'levels'], ['Film', 'film'], ['Kaloli Point', 'location']] as const) {
      // Menu links read "02Gallery": match the label at the end, so "Film" cannot match another link.
      const name = new RegExp(`${label}$`);
      const toggle = header.locator('[data-menu-toggle]');
      if (await toggle.isVisible()) {
        await toggle.click();
        await expect(page.locator('#mobile-nav')).toBeVisible();
        await page.locator('#mobile-nav').getByRole('link', { name }).click();
        await expect(page.locator('#mobile-nav')).toBeHidden();
      } else {
        await header.locator('.nav-desktop').getByRole('link', { name }).click();
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

  test('the gallery follows the residence, and the film follows the gallery before the architecture', { tag: '@phone' }, async ({ page }) => {
    await page.goto('/');
    const order = await page.evaluate(() => [...document.querySelectorAll('#residence, #gallery, #levels, #lanais, #film, #location')].map((s) => s.id));
    expect(order).toEqual(['residence', 'gallery', 'film', 'levels', 'lanais', 'location']);
    expect(await page.evaluate(() => document.getElementById('residence')!.nextElementSibling?.id)).toBe('gallery');
    expect(await page.evaluate(() => !!document.getElementById('gallery')!.nextElementSibling?.querySelector('#film'))).toBe(true);
    expect(await page.evaluate(() => document.getElementById('film')!.closest('section')!.nextElementSibling?.id)).toBe('levels');
    await expect(page.locator('#gallery-title'), 'the gallery is introduced by its label alone').toHaveText('Gallery');
  });

  test('property specifications are shown by default and can be collapsed and expanded', { tag: '@phone' }, async ({ page }) => {
    await page.goto('/');
    const specs = page.locator('#levels details.specs');
    await expect(specs).toHaveAttribute('open', '');
    await specs.scrollIntoViewIfNeeded();
    await expect(specs.locator('.spec-list')).toBeVisible();
    await specs.locator('summary').click();
    await expect(specs.locator('.spec-list')).toBeHidden();
    await specs.locator('summary').click();
    await expect(specs.locator('.spec-list')).toBeVisible();
  });

  test('the carousel holds every photograph in the owners’ order, and moves by thumbnail, arrow, key and swipe', { tag: '@phone' }, async ({ page, browserName, hasTouch }) => {
    await page.goto('/');
    await expect(page.locator('[data-open-all]')).toHaveText('View all photographs');
    const files = (sel: string) =>
      page.locator(sel).evaluateAll((as) => as.map((a) => (a as HTMLElement).dataset.pswpSrc!.split('/').pop()!.split('.')[0]!));
    const order = await files('[data-carousel] a[data-gallery="carousel"]');
    const album = await files('a[data-gallery="all"]');
    expect(order).toHaveLength(45);
    expect([...order].sort(), 'every photograph, once').toEqual([...album].sort());
    expect(album, 'the low-quality ocean film still is gone').not.toContain('film-ocean-aerial');
    expect(order.slice(0, 3), 'in the agent’s order').toEqual(['DJI_20261001133743_0632_D', 'C04A4658', 'C04A4729']);
    expect(order.slice(19, 22), 'the stair follows the primary desk').toEqual(['C04A4821', 'film-stair-light', 'C04A4975']);
    expect(order.slice(28, 32), 'the night sky follows the front elevation').toEqual(['listing-sunset-yard', 'listing-sunset-house', 'C04A4635', 'listing-night-sky']);
    const rest = order.slice(32);
    expect(rest, 'then the others in album order').toEqual(album.filter((f) => rest.includes(f)));

    const carousel = page.locator('[data-carousel]');
    const stage = carousel.locator('[data-carousel-stage]');
    const track = carousel.locator('[data-carousel-track]');
    const index = carousel.locator('[data-carousel-index]');
    await stage.scrollIntoViewIfNeeded();
    await carousel.locator('[data-carousel-thumb="3"]').click();
    await expect(index).toHaveText('04');
    await expect(carousel.locator('[data-carousel-toggle]'), 'choosing a photo stops the slideshow').toHaveAttribute('aria-pressed', 'true');
    await expect(carousel.locator('.slide:not([inert])')).toHaveAttribute('aria-label', '4 of 45');
    await carousel.locator('[data-carousel-next]').click();
    await expect(index).toHaveText('05');
    await carousel.locator('[data-carousel-prev]').click();
    await expect(index).toHaveText('04');
    await carousel.locator('[data-carousel-next]').focus();
    await page.keyboard.press('ArrowRight');
    await expect(index).toHaveText('05');
    await settled(track, 4);
    await swipe(page, stage, browserName, hasTouch);
    await expect(index).toHaveText('06');
    await expect(carousel.locator('[data-carousel-thumb="5"]')).toHaveAttribute('aria-current', 'true');
    await expect(carousel.locator('[data-carousel-caption]')).not.toHaveText('');
  });

  test('the carousel plays every four seconds until the visitor takes over', { tag: '@phone' }, async ({ page, browserName, hasTouch }) => {
    await page.clock.install();
    await page.goto('/');
    const carousel = page.locator('[data-carousel]');
    const stage = carousel.locator('[data-carousel-stage]');
    const index = carousel.locator('[data-carousel-index]');
    const toggle = carousel.locator('[data-carousel-toggle]');
    await stage.scrollIntoViewIfNeeded();
    await expect(stage).toBeInViewport({ ratio: 0.5 });
    await expect(index).toHaveText('01');
    await page.clock.runFor(4100);
    await expect(index).toHaveText('02');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await page.clock.runFor(8200);
    await expect(index, 'paused').toHaveText('02');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await page.clock.runFor(4100);
    await expect(index).toHaveText('03');
    await settled(carousel.locator('[data-carousel-track]'), 2);
    await swipe(page, stage, browserName, hasTouch);
    await expect(index, 'a swipe moves one photo').toHaveText('04');
    await expect(toggle, 'and stops the slideshow for good').toHaveAttribute('aria-pressed', 'true');
    await page.clock.runFor(8200);
    await expect(index).toHaveText('04');
  });

  test('a photo opens full size with the same counter, thumbnails, arrows and swipe, and the carousel waits where the visitor left off', { tag: '@phone' }, async ({ page, browserName, hasTouch }) => {
    await page.goto('/');
    const carousel = page.locator('[data-carousel]');
    const index = carousel.locator('[data-carousel-index]');
    await carousel.locator('[data-carousel-stage]').scrollIntoViewIfNeeded();
    await carousel.locator('[data-carousel-thumb="4"]').click();
    await expect(index).toHaveText('05');
    await settled(carousel.locator('[data-carousel-track]'), 4);
    await carousel.locator('.slide:not([inert]) a').click();
    const pswp = page.locator('.pswp');
    await expect(pswp).toBeVisible();
    await expect(pswp).toHaveAttribute('role', 'dialog');
    const count = pswp.locator('.kp-count');
    const thumbs = pswp.locator('.kp-thumbs button');
    await expect(count).toHaveText('05 / 45');
    await expect(thumbs).toHaveCount(45);
    await expect(thumbs.nth(4)).toHaveAttribute('aria-current', 'true');
    await expect(pswp.locator('.pswp__counter'), 'one counter only').toHaveCount(0);
    await page.waitForTimeout(700);
    await page.keyboard.press('ArrowRight');
    await expect(count).toHaveText('06 / 45');
    await thumbs.nth(9).click();
    await expect(count).toHaveText('10 / 45');
    await expect(thumbs.nth(9)).toHaveAttribute('aria-current', 'true');
    let last = 10;
    if (!hasTouch) {
      await page.mouse.move(20, 200);
      await pswp.locator('.pswp__button--arrow--next').click();
      last = 11;
    } else if (browserName === 'chromium') {
      await page.waitForTimeout(500);
      await swipe(page, pswp.locator('.pswp__scroll-wrap'), browserName, hasTouch);
      last = 11;
    }
    await expect(count).toHaveText(`${last} / 45`);
    await page.keyboard.press('Escape');
    await expect(pswp).toHaveCount(0);
    await expect(index, 'the carousel waits on the last photo viewed').toHaveText(String(last));
    expect(await events(page)).toContain('gallery_open');
  });

  test('the residence spans the page and leaves the front of the house to the carousel', { tag: '@phone' }, async ({ page }) => {
    await page.goto('/');
    const residence = page.locator('#residence');
    await expect(residence.locator('img, figure'), 'no repeat of the carousel’s first photograph').toHaveCount(0);
    await expect(page.locator('[data-carousel] .slide').first().locator('a')).toHaveAttribute('data-pswp-src', /DJI_20261001133743_0632_D/);
    const span = await residence.evaluate((s) => {
      const box = s.querySelector('.container')!;
      const cs = getComputedStyle(box);
      const inner = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return { facts: s.querySelector('.facts-line')!.getBoundingClientRect().width / inner, statement: s.querySelector('.statement')!.getBoundingClientRect().width / inner };
    });
    expect(span.facts, 'facts run the full width').toBeGreaterThan(0.99);
    expect(span.statement, 'the statement runs the full width').toBeGreaterThan(0.99);
  });

  test('all 45 photographs open in one collection, with the viewer inside it', { tag: '@phone' }, async ({ page }) => {
    await page.goto('/');
    const open = page.locator('[data-open-all]');
    await open.scrollIntoViewIfNeeded();
    await open.click();
    const all = page.locator('#all-photos');
    await expect(all).toBeVisible();
    await expect(all.locator('a[data-gallery="all"]')).toHaveCount(45);
    await expect(page.locator('[data-sticky-cta]')).toHaveAttribute('data-visible', 'false');
    await all.locator('a[data-gallery="all"]').nth(5).click();
    const caption = all.locator('.pswp__kp-caption');
    await expect(caption).toContainText('06 / 45');
    await expect(caption.locator('.kp-thumbs button'), 'the same full-size experience as the carousel').toHaveCount(45);
    await page.waitForTimeout(700);
    await page.keyboard.press('ArrowRight');
    await expect(caption).toContainText('07 / 45');
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
    await expect(map).toHaveAttribute('src', /q=19\.61513,-154\.95389&z=14&/);
    await expect(map).toBeVisible();
    for (const [name, src] of [['Island', /&z=9&/], ['Lot', /&z=18&t=k&/], ['Neighborhood', /&z=14&/]] as const) {
      const button = section.getByRole('button', { name: new RegExp(`^${name}`) });
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(map).toHaveAttribute('src', src);
    }
    await expect(section.getByRole('link', { name: /Explore Puna district/ })).toHaveAttribute('href', 'https://iokuarealestate.com/neighborhoods/puna');
    await expect(section.getByRole('link', { name: /Get directions/ })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/dir//15-1077+Ama+U+Rd,+Keaau,+HI+96749/data=!4m9!4m8!1m1!4e1!1m5!1m1!1s0x0:0x0!2m2!1d-154.95389!2d19.61513',
    );
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

  test('light to night: four owner photographs in two offset pairs, ending on the stars', { tag: '@phone' }, async ({ page }) => {
    await page.goto('/');
    const section = page.locator('#evenings');
    await expect(section.locator('#evenings-title')).toHaveText('From rainbows to the stars.');
    await expect(section).not.toContainText(/milky way/i);
    const moments = section.locator('.moment');
    await expect(moments).toHaveCount(4);
    for (const [i, label] of ['01 Daylight', '02 Sunset', '03 Dusk', '04 Night'].entries()) {
      await expect(moments.nth(i).locator('.time')).toHaveText(label);
      await moments.nth(i).scrollIntoViewIfNeeded();
      await expect.poll(() => moments.nth(i).locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    }
    const boxes = await moments.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top + scrollY, bottom: r.bottom + scrollY };
      }),
    );
    const box = (i: number) => boxes[i]!;
    if (page.viewportSize()!.width >= 768) {
      for (const [a, b] of [[0, 1], [2, 3]] as const) {
        expect(box(b).left, `${a + 1} and ${b + 1} side by side`).toBeGreaterThanOrEqual(box(a).right);
        expect(box(b).top, `${b + 1} drops below ${a + 1}`).toBeGreaterThan(box(a).top);
        expect(box(b).top, `${b + 1} still beside ${a + 1}`).toBeLessThan(box(a).bottom);
      }
      expect(box(2).top, 'dusk below daylight, never over it').toBeGreaterThan(box(0).bottom);
      expect(box(3).top, 'night below sunset, never over it').toBeGreaterThan(box(1).bottom);
    } else {
      for (let i = 1; i < 4; i++) expect(box(i).top, 'stacked on phones').toBeGreaterThan(box(i - 1).bottom);
    }
    const night = await moments.nth(3).locator('img').evaluate((img: HTMLImageElement) => {
      const r = img.getBoundingClientRect();
      return { natural: img.naturalWidth / img.naturalHeight, shown: r.width / r.height };
    });
    expect(Math.abs(night.natural - night.shown), 'the 3:4 night photograph fills its 3:4 frame uncropped').toBeLessThan(0.01);
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
