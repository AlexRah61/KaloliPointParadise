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

  // The label beside the pause control names the beat on screen (times come from tools/build-media.mjs).
  const beatEl = hero.querySelector<HTMLElement>('[data-hero-beat]');
  const beats = JSON.parse(video.dataset.beats ?? '[]') as { t: number; label: string; n: number }[];
  let beatShown = 0;
  const syncBeat = () => {
    if (!beatEl || beats.length < 2) return;
    let i = 0;
    while (i + 1 < beats.length && video.currentTime >= beats[i + 1]!.t) i++;
    if (i === beatShown) return;
    beatShown = i;
    const label = beatEl.querySelector('[data-beat-label]')!;
    // The closing dissolve already shows the opening beat, so the wrap to 0 s changes nothing.
    if (label.textContent === beats[i]!.label) return;
    const num = beatEl.querySelector<HTMLElement>('[data-beat-n]')!;
    num.textContent = String(beats[i]!.n).padStart(2, '0');
    label.textContent = beats[i]!.label;
    // Only the words fade; the chip behind them stays solid so they never lose contrast.
    for (const el of [num, label]) el.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 450, easing: 'ease-out' });
  };
  if ('requestVideoFrameCallback' in video) {
    const onFrame = () => {
      syncBeat();
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  } else {
    (video as HTMLVideoElement).addEventListener('timeupdate', syncBeat);
  }

  const show = () => {
    hero.dataset.video = 'playing';
    if (toggle) toggle.hidden = false;
    if (beatEl) beatEl.hidden = false;
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
    if (beatEl) beatEl.hidden = true;
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
