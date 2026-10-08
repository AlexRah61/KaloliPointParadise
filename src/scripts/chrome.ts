// Header switches from transparent (over the hero photo) to solid once the hero is behind it.
export function initHeader(): void {
  const header = document.querySelector<HTMLElement>('[data-header]');
  if (!header) return;
  const hero = document.querySelector<HTMLElement>('[data-hero]');
  if (hero) {
    const io = new IntersectionObserver(
      ([entry]) => {
        if (header.querySelector('[aria-expanded="true"]')) return;
        header.dataset.state = entry?.isIntersecting ? 'over-hero' : 'solid';
      },
      // 2px below the header edge, so a chapter landing flush under the header counts as "past the hero".
      { rootMargin: `-${header.offsetHeight + 2}px 0px 0px 0px`, threshold: 0 },
    );
    io.observe(hero);
  } else {
    header.dataset.state = 'solid';
  }

  const toggle = header.querySelector<HTMLButtonElement>('[data-menu-toggle]');
  const nav = header.querySelector<HTMLElement>('[data-mobile-nav]');
  if (!toggle || !nav) return;

  const setOpen = (open: boolean, restoreFocus = true) => {
    toggle.setAttribute('aria-expanded', String(open));
    header.dataset.menu = open ? 'open' : 'closed';
    nav.hidden = !open;
    document.documentElement.style.overflow = open ? 'hidden' : '';
    if (open) nav.querySelector<HTMLAnchorElement>('a')?.focus();
    else if (restoreFocus) toggle.focus();
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  nav.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[data-menu-link]')) setOpen(false, false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') setOpen(false);
  });
  window.matchMedia('(min-width: 1280px)').addEventListener('change', (m) => {
    if (m.matches) setOpen(false, false);
  });
}

// One persistent "Request a Private or Virtual Tour" entry point:
// - header CTA (tablet/desktop/landscape) steps back only while the closing showing chapter fills the screen;
// - phone action bar appears once the hero CTA is gone and hides while the showing chapter is on screen, a field
//   has focus, a dialog is open, or the started film is on screen (its native controls sit along the bottom edge).
export function initPersistentCta(): void {
  const header = document.querySelector<HTMLElement>('[data-header]');
  const bar = document.querySelector<HTMLElement>('[data-sticky-cta]');
  // Track the hero button itself: on phones its wrapper also holds the stacked remote-buyer note.
  const heroCta =
    document.querySelector<HTMLElement>('[data-hero-cta] [data-showing-cta]') ?? document.querySelector<HTMLElement>('[data-hero-cta]');
  const film = document.querySelector<HTMLElement>('[data-film]');
  const dialogs = [...document.querySelectorAll<HTMLDialogElement>('dialog')];
  const zones = ['#showing']
    .map((s) => document.querySelector<HTMLElement>(s))
    .filter((el): el is HTMLElement => !!el);

  let heroCtaVisible = !!heroCta;
  let typing = false;
  let filmVisible = false;
  const share = new Map<Element, number>();
  const update = () => {
    const formOnScreen = [...share.values()].some((v) => v >= 0.35);
    const filmInUse = filmVisible && !!film && film.dataset.state !== 'idle';
    const dialogOpen = dialogs.some((d) => d.open);
    if (header) header.dataset.cta = formOnScreen ? 'muted' : 'shown';
    if (bar) bar.dataset.visible = String(!heroCtaVisible && !formOnScreen && !typing && !filmInUse && !dialogOpen);
  };

  if (heroCta) {
    const headerH = header?.offsetHeight ?? 0;
    // The hero CTA holds the bar back until its centre has scrolled up under the fixed header.
    new IntersectionObserver(
      ([e]) => {
        if (!e) return;
        heroCtaVisible = e.boundingClientRect.top + e.boundingClientRect.height / 2 > headerH;
        update();
      },
      { rootMargin: `-${headerH}px 0px 0px 0px`, threshold: [0, 0.25, 0.5, 0.75, 1] },
    ).observe(heroCta);
  }
  if (zones.length) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) share.set(e.target, e.intersectionRect.height / window.innerHeight);
        update();
      },
      { threshold: Array.from({ length: 101 }, (_, i) => i / 100) },
    );
    zones.forEach((z) => io.observe(z));
  }
  if (film) {
    new IntersectionObserver(([e]) => {
      filmVisible = !!e?.isIntersecting;
      update();
    }).observe(film);
    new MutationObserver(update).observe(film, { attributes: true, attributeFilter: ['data-state'] });
  }
  dialogs.forEach((d) => new MutationObserver(update).observe(d, { attributes: true, attributeFilter: ['open'] }));

  // The on-screen keyboard and the bar never compete for the same strip of screen.
  const isField = (t: EventTarget | null) => t instanceof HTMLElement && t.matches('input, select, textarea');
  document.addEventListener('focusin', (e) => {
    if (!isField(e.target)) return;
    typing = true;
    update();
  });
  document.addEventListener('focusout', (e) => {
    if (!isField(e.target)) return;
    typing = false;
    requestAnimationFrame(() => {
      if (!isField(document.activeElement)) update();
    });
  });
  update();
}
