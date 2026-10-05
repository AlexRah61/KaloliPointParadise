import { track } from './analytics';
import { prefersReducedMotion } from './scroll';

interface Slide {
  src: string;
  srcset?: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
}

function slidesFor(name: string): { anchors: HTMLAnchorElement[]; slides: Slide[] } {
  const anchors = [...document.querySelectorAll<HTMLAnchorElement>(`a[data-gallery="${CSS.escape(name)}"]`)];
  const slides = anchors.map((a) => ({
    src: a.dataset.pswpSrc ?? a.href,
    srcset: a.dataset.pswpSrcset,
    width: Number(a.dataset.pswpWidth),
    height: Number(a.dataset.pswpHeight),
    alt: a.querySelector('img')?.alt ?? '',
    caption: a.dataset.pswpCaption ?? '',
  }));
  return { anchors, slides };
}

async function open(name: string, index: number, opener: HTMLElement | null): Promise<void> {
  const [{ default: PhotoSwipe }] = await Promise.all([import('photoswipe'), import('photoswipe/style.css')]);
  const { slides } = slidesFor(name);
  if (!slides.length) return;
  // Inside a modal dialog (the full collection) the viewer must live in the dialog's top layer too.
  const host = opener?.closest<HTMLDialogElement>('dialog[open]') ?? undefined;

  const pswp = new PhotoSwipe({
    dataSource: slides,
    index,
    appendToEl: host,
    bgOpacity: 0.97,
    showHideAnimationType: 'fade',
    preload: [1, 2],
    wheelToZoom: true,
    imageClickAction: 'zoom-or-close',
    tapAction: 'toggle-controls',
    closeTitle: 'Close gallery (Esc)',
    zoomTitle: 'Zoom photo',
    arrowPrevTitle: 'Previous photo',
    arrowNextTitle: 'Next photo',
    errorMsg: 'This photo could not be loaded.',
    mainClass: 'kp-pswp',
  });

  pswp.on('uiRegister', () => {
    pswp.ui?.registerElement({
      name: 'kp-caption',
      order: 9,
      isButton: false,
      appendTo: 'root',
      onInit: (el) => {
        el.setAttribute('aria-live', 'polite');
        const update = () => {
          const s = pswp.currSlide?.data as Partial<Slide> | undefined;
          el.textContent = s ? `${s.caption ?? ''}  ·  ${pswp.currIndex + 1} / ${slides.length}` : '';
        };
        pswp.on('change', update);
        update();
      },
    });
  });
  pswp.on('afterInit', () => {
    const root = pswp.element;
    root?.setAttribute('role', 'dialog');
    root?.setAttribute('aria-modal', 'true');
    root?.setAttribute('aria-label', 'Photo gallery');
  });
  pswp.on('destroy', () => {
    opener?.focus({ preventScroll: true });
  });
  pswp.init();
  track('gallery_open', { gallery_name: name });
}

// "View all 46 photographs": a full-screen dialog of every photograph, grouped by chapter.
function initAllPhotos(): void {
  const dialog = document.querySelector<HTMLDialogElement>('[data-all-photos]');
  if (!dialog) return;
  let opener: HTMLElement | null = null;
  document.querySelectorAll<HTMLButtonElement>('[data-open-all]').forEach((btn) =>
    btn.addEventListener('click', () => {
      opener = btn;
      document.documentElement.style.overflow = 'hidden';
      dialog.showModal();
      dialog.scrollTop = 0;
      dialog.querySelector<HTMLElement>('#all-title')?.focus({ preventScroll: true });
      track('gallery_open', { gallery_name: 'all' });
    }),
  );
  dialog.querySelector('[data-all-close]')?.addEventListener('click', () => dialog.close());
  // Escape belongs to the photo viewer while it is open; only then does it close the collection.
  dialog.addEventListener('cancel', (e) => {
    if (dialog.querySelector('.pswp')) e.preventDefault();
  });
  dialog.addEventListener('close', () => {
    document.documentElement.style.overflow = '';
    opener?.focus({ preventScroll: true });
  });
  dialog.querySelectorAll<HTMLAnchorElement>('.all-nav a').forEach((a) =>
    a.addEventListener('click', (e) => {
      const target = dialog.querySelector<HTMLElement>(a.getAttribute('href') ?? '');
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }),
  );
}

export function initGallery(): void {
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest<HTMLAnchorElement>('a[data-gallery]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    const name = a.dataset.gallery!;
    const { anchors } = slidesFor(name);
    void open(name, Math.max(0, anchors.indexOf(a)), a);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-open-gallery]').forEach((btn) =>
    btn.addEventListener('click', () => void open(btn.dataset.openGallery!, 0, btn)),
  );
  initAllPhotos();
}
