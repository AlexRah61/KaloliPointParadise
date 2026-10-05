import { track } from './analytics';
import { scrollIntoFullView } from './scroll';

// The full film streams as adaptive HLS (480p–1080p). Safari/iOS play it natively; others load hls.js on demand.
export function initFilm(): void {
  const root = document.querySelector<HTMLElement>('[data-film]');
  if (!root) return;
  const video = root.querySelector<HTMLVideoElement>('[data-film-video]')!;
  const button = root.querySelector<HTMLButtonElement>('[data-film-play]')!;
  const status = root.querySelector<HTMLElement>('[data-film-status]');
  const hlsUrl = root.dataset.hls!;
  const mp4Url = root.dataset.mp4!;
  let attached = false;
  let tracked = false;

  async function attach(): Promise<void> {
    if (attached) return;
    attached = true;
    const nativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== '' && !('MediaSource' in window);
    if (nativeHls) {
      video.src = hlsUrl;
      return;
    }
    if ('MediaSource' in window || 'ManagedMediaSource' in window) {
      const { default: Hls } = await import('hls.js/light');
      if (Hls.isSupported()) {
        const hls = new Hls({
          capLevelToPlayerSize: true,
          // Assume a decent connection so playback opens at 1080p rather than the lowest rung.
          abrEwmaDefaultEstimate: 6_000_000,
          maxBufferLength: 24,
          enableWorker: true,
        });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) {
            hls.destroy();
            video.src = mp4Url;
            void video.play().catch(() => undefined);
          }
        });
        hls.loadSource(hlsUrl);
        hls.attachMedia(video);
        return;
      }
    }
    video.src = mp4Url;
  }

  async function play(): Promise<void> {
    root!.dataset.state = 'loading';
    if (status) status.textContent = 'Loading the film…';
    try {
      await attach();
      video.controls = true;
      await video.play();
    } catch {
      root!.dataset.state = 'idle';
      video.controls = true;
      if (status) status.textContent = 'Press play on the video controls to start the film.';
    }
  }

  video.addEventListener('playing', () => {
    root.dataset.state = 'playing';
    if (status) status.textContent = '';
    if (!tracked) {
      tracked = true;
      track('property_film_start');
    }
  });

  button.addEventListener('click', () => void play());

  document.querySelectorAll<HTMLAnchorElement>('[data-film-trigger]').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      // The whole player, not just the section heading, so play/pause and full screen are on screen.
      scrollIntoFullView(root);
      void play().then(() => video.focus({ preventScroll: true }));
    }),
  );

  // Pause politely when the film scrolls out of view.
  new IntersectionObserver(
    ([entry]) => {
      if (entry && !entry.isIntersecting && !video.paused) video.pause();
    },
    { threshold: 0.25 },
  ).observe(root);
}
