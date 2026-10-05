import { prefersReducedMotion } from './scroll';

type NetworkInfo = { saveData?: boolean; effectiveType?: string };

// The silent hero loop: never part of the first render, never on reduced motion, Save-Data or 2G/3G,
// paused whenever the hero is off screen, and the photograph stays if autoplay is refused or the file fails.
export function initHeroLoop(): void {
  const hero = document.querySelector<HTMLElement>('[data-hero]');
  const video = hero?.querySelector<HTMLVideoElement>('[data-hero-video]');
  if (!hero || !video) return;
  const toggle = hero.querySelector<HTMLButtonElement>('[data-hero-toggle]');
  const net = (navigator as Navigator & { connection?: NetworkInfo }).connection;
  const constrained = !!net?.saveData || /^(slow-2g|2g|3g)$/.test(net?.effectiveType ?? '');
  if (prefersReducedMotion() || constrained) return;

  const src = window.matchMedia('(max-width: 767px) and (min-height: 501px)').matches ? video.dataset.srcTall : video.dataset.srcWide;
  if (!src) return;

  let started = false;
  let onScreen = true;
  let userPaused = false;
  const play = () => {
    if (started && onScreen && !userPaused && !document.hidden) void video.play().catch(() => undefined);
  };
  const show = () => {
    hero.dataset.video = 'playing';
    if (toggle) toggle.hidden = false;
  };

  video.addEventListener(
    'playing',
    () => {
      // Reveal only once a decoded frame is actually on screen, so the dissolve never shows a blank frame.
      if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(show);
      else show();
    },
    { once: true },
  );
  video.addEventListener('error', () => {
    delete hero.dataset.video;
    if (toggle) toggle.hidden = true;
  });

  const start = () => {
    started = true;
    video.muted = true;
    video.src = src;
    play();
  };
  const whenIdle = () => ('requestIdleCallback' in window ? requestIdleCallback(start, { timeout: 2500 }) : setTimeout(start, 300));
  if (document.readyState === 'complete') whenIdle();
  else window.addEventListener('load', whenIdle, { once: true });

  new IntersectionObserver(([entry]) => {
    onScreen = !!entry?.isIntersecting;
    if (onScreen) play();
    else video.pause();
  }).observe(hero);
  document.addEventListener('visibilitychange', () => (document.hidden ? video.pause() : play()));

  toggle?.addEventListener('click', () => {
    userPaused = !userPaused;
    toggle.setAttribute('aria-pressed', String(userPaused));
    toggle.setAttribute('aria-label', userPaused ? 'Play background video' : 'Pause background video');
    if (userPaused) video.pause();
    else play();
  });
}
