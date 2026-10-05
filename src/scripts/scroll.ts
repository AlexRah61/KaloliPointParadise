export const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Chapters land flush under the fixed header in its scrolled (solid) state; their own top padding provides
// the breathing room.
const headerOffset = (): number => {
  const solid = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h-solid'));
  return Number.isFinite(solid) && solid > 0 ? solid : (document.querySelector<HTMLElement>('[data-header]')?.offsetHeight ?? 0);
};

export function scrollToTarget(target: HTMLElement, focus = true): void {
  const top = target.getBoundingClientRect().top + window.scrollY - headerOffset();
  window.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  if (focus) {
    const heading = target.matches('h1, h2, h3') ? target : target.querySelector<HTMLElement>('h2, h3');
    const el = heading ?? target;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  }
}

// Brings an element fully into view below the header: centred when it fits, bottom edge on screen when it does not
// (a video's native controls run along its bottom edge).
export function scrollIntoFullView(el: HTMLElement): void {
  const header = headerOffset();
  const r = el.getBoundingClientRect();
  const room = window.innerHeight - header;
  const top = r.height <= room ? r.top - header - (room - r.height) / 2 : r.bottom - window.innerHeight;
  window.scrollTo({ top: window.scrollY + top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

// Same-page anchor links (#id and /#id) go through one smooth, header-aware scroll.
export function initAnchors(): void {
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest<HTMLAnchorElement>('a[href*="#"]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (a.hasAttribute('data-gallery') || a.hasAttribute('data-film-trigger') || a.closest('dialog')) return;
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
