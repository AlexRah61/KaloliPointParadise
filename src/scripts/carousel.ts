import { prefersReducedMotion } from './scroll';

const DELAY = 4000;

// Arrows, swipe (scroll snapping), thumbnails and keys; the slideshow stops for good once the visitor takes over.
export function initCarousel(): void {
  const root = document.querySelector<HTMLElement>('[data-carousel]');
  if (!root) return;
  const stage = root.querySelector<HTMLElement>('[data-carousel-stage]')!;
  const track = root.querySelector<HTMLElement>('[data-carousel-track]')!;
  const slides = [...track.children] as HTMLElement[];
  const thumbs = [...root.querySelectorAll<HTMLButtonElement>('[data-carousel-thumb]')];
  const strip = root.querySelector<HTMLElement>('[data-carousel-thumbs]');
  const indexEl = root.querySelector<HTMLElement>('[data-carousel-index]')!;
  const captionEl = root.querySelector<HTMLElement>('[data-carousel-caption]')!;
  const status = root.querySelector<HTMLElement>('[data-carousel-status]')!;
  const toggle = root.querySelector<HTMLButtonElement>('[data-carousel-toggle]')!;
  const n = slides.length;
  let current = 0;
  let playing = !prefersReducedMotion();
  let hovered = false;
  let onScreen = false;
  let near = false;
  let timer = 0;
  // The slide a scripted scroll is travelling to; scroll sync waits until it arrives.
  let heading = -1;

  const behavior = (): ScrollBehavior => (prefersReducedMotion() ? 'auto' : 'smooth');
  const width = () => slides[0]!.getBoundingClientRect().width || track.clientWidth;

  // Neighbours load ahead of time, so a swipe or the slideshow never lands on an empty frame.
  const warm = (i: number) => {
    if (!near) return;
    for (const k of [i, i + 1, i + 2, i - 1]) {
      const img = slides[(k + n) % n]!.querySelector('img');
      if (img && img.loading !== 'eager') img.loading = 'eager';
    }
  };

  const show = (i: number) => {
    current = i;
    slides.forEach((s, k) => (s.inert = k !== i));
    thumbs.forEach((t, k) => t.setAttribute('aria-current', String(k === i)));
    indexEl.textContent = String(i + 1).padStart(2, '0');
    captionEl.textContent = slides[i]!.dataset.caption ?? '';
    warm(i);
    const t = thumbs[i];
    if (strip && t) strip.scrollTo({ left: t.offsetLeft - (strip.clientWidth - t.offsetWidth) / 2, behavior: behavior() });
  };

  const goTo = (i: number, animate = true) => {
    const target = ((i % n) + n) % n;
    const far = Math.abs(target - current) > 1;
    const left = target * width();
    heading = Math.abs(track.scrollLeft - left) < 1 ? -1 : target;
    track.scrollTo({ left, behavior: animate && !far ? behavior() : 'auto' });
    show(target);
  };

  const schedule = () => {
    window.clearTimeout(timer);
    if (!playing || !onScreen || hovered || document.hidden) return;
    timer = window.setTimeout(() => {
      goTo(current + 1);
      schedule();
    }, DELAY);
  };

  const setPlaying = (on: boolean) => {
    playing = on;
    toggle.setAttribute('aria-pressed', String(!on));
    toggle.setAttribute('aria-label', on ? 'Pause slideshow' : 'Play slideshow');
    // Photo changes are announced only while the visitor is in control.
    status.setAttribute('aria-live', on ? 'off' : 'polite');
    schedule();
  };
  const takeOver = () => {
    if (playing) setPlaying(false);
  };

  // A swipe (or any scroll of the track) settles the current photo.
  let frame = 0;
  track.addEventListener(
    'scroll',
    () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const at = track.scrollLeft / width();
        if (heading >= 0) {
          if (Math.abs(at - heading) < 0.02) heading = -1;
          return;
        }
        const i = Math.round(at);
        if (i !== current && i >= 0 && i < n) show(i);
      });
    },
    { passive: true },
  );
  // The visitor's own swipe wins over a scripted scroll still under way.
  const grab = () => {
    heading = -1;
    takeOver();
  };
  track.addEventListener('pointerdown', grab);
  track.addEventListener('wheel', (e) => Math.abs(e.deltaX) > Math.abs(e.deltaY) && grab(), { passive: true });

  root.querySelector('[data-carousel-prev]')!.addEventListener('click', () => {
    takeOver();
    goTo(current - 1);
  });
  root.querySelector('[data-carousel-next]')!.addEventListener('click', () => {
    takeOver();
    goTo(current + 1);
  });
  thumbs.forEach((t, k) =>
    t.addEventListener('click', () => {
      takeOver();
      goTo(k);
    }),
  );
  toggle.addEventListener('click', () => setPlaying(!playing));
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    takeOver();
    goTo(current + (e.key === 'ArrowRight' ? 1 : -1));
  });
  // Keyboard focus anywhere in the carousel (other than its play control) stops the slideshow.
  root.addEventListener('focusin', (e) => {
    const el = e.target as HTMLElement;
    if (el !== toggle && el.matches(':focus-visible')) takeOver();
  });

  stage.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    hovered = true;
    schedule();
  });
  stage.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    hovered = false;
    schedule();
  });

  new IntersectionObserver(
    ([entry]) => {
      near = !!entry?.isIntersecting;
      if (near) warm(current);
    },
    { rootMargin: '50% 0px' },
  ).observe(stage);
  new IntersectionObserver(
    ([entry]) => {
      onScreen = (entry?.intersectionRatio ?? 0) >= 0.5;
      schedule();
    },
    { threshold: [0, 0.5] },
  ).observe(stage);
  document.addEventListener('visibilitychange', schedule);
  // Keep the current photo aligned when the stage changes width (rotation, resize).
  new ResizeObserver(() => track.scrollTo({ left: current * width(), behavior: 'auto' })).observe(track);

  // Leaving the full-screen viewer opened from the carousel lands on the photo last viewed there.
  document.addEventListener('kp:viewer-close', (e) => {
    const { gallery, index } = (e as CustomEvent<{ gallery: string; index: number }>).detail;
    if (gallery !== 'carousel') return;
    goTo(index, false);
    slides[current]!.querySelector('a')?.focus({ preventScroll: true });
  });

  setPlaying(playing);
}
