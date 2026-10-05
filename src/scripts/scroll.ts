import type Lenis from 'lenis';

export const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let lenis: Lenis | null = null;
export const setLenis = (l: Lenis | null): void => {
  lenis = l;
};
export const getLenis = (): Lenis | null => lenis;

const headerOffset = (): number => (document.querySelector<HTMLElement>('[data-header]')?.offsetHeight ?? 0) + 8;

export function scrollToTarget(target: HTMLElement, focus = true): void {
  if (lenis) {
    lenis.scrollTo(target, { offset: -headerOffset(), duration: 1.4 });
  } else {
    const top = target.getBoundingClientRect().top + window.scrollY - headerOffset();
    window.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }
  if (focus) {
    const heading = target.matches('h1, h2, h3') ? target : target.querySelector<HTMLElement>('h2, h3');
    const el = heading ?? target;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  }
}

// Same-page anchor links (#id and /#id) go through one smooth, header-aware scroll.
export function initAnchors(): void {
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest<HTMLAnchorElement>('a[href*="#"]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (a.hasAttribute('data-gallery') || a.hasAttribute('data-film-trigger')) return;
    // Showing CTAs open the request sheet instead (handled in form.ts) wherever the sheet exists.
    if (a.hasAttribute('data-showing-cta') && document.querySelector('[data-showing-sheet]')) return;
    const url = new URL(a.href, location.href);
    if (url.pathname !== location.pathname || !url.hash) return;
    const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (!target) return;
    e.preventDefault();
    history.pushState(null, '', url.hash);
    scrollToTarget(target);
  });
}
