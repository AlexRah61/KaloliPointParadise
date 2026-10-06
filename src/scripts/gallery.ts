import { track } from './analytics';
import { prefersReducedMotion } from './scroll';

interface Slide {
  src: string;
  srcset?: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
  thumb?: string;
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
    thumb: a.dataset.thumb,
  }));
  return { anchors, slides };
}

async function open(name: string, index: number, opener: HTMLElement | null): Promise<void> {
  const [{ default: PhotoSwipe }] = await Promise.all([import('photoswipe'), import('photoswipe/style.css')]);
  const { slides } = slidesFor(name);
  if (!slides.length) return;
  // Inside a modal dialog (the full collection) the viewer must live in the dialog's top layer too.
  const host = opener?.closest<HTMLDialogElement>('dialog[open]') ?? undefined;
  const strip = slides.length > 1 && slides.every((s) => s.thumb);
  const pad = (n: number) => String(n).padStart(2, '0');

  const pswp = new PhotoSwipe({
    dataSource: slides,
    index,
    appendToEl: host,
    bgOpacity: 1,
    showHideAnimationType: 'fade',
    preload: [1, 2],
    counter: false,
    // Room below the photo for the caption and thumbnail strip, and beside it for the arrows on wide screens.
    paddingFn: (viewport) => {
      const wide = viewport.x >= 768;
      return { top: 56, bottom: strip ? (wide ? 168 : 128) : 56, left: wide ? 88 : 0, right: wide ? 88 : 0 };
    },
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
        const bar = document.createElement('p');
        bar.className = 'kp-bar';
        bar.setAttribute('aria-live', 'polite');
        const count = bar.appendChild(document.createElement('span'));
        count.className = 'kp-count';
        const caption = bar.appendChild(document.createElement('span'));
        caption.className = 'kp-cap';
        el.appendChild(bar);

        const thumbs = strip
          ? slides.map((s, i) => {
              const b = document.createElement('button');
              b.type = 'button';
              b.setAttribute('aria-label', `Photo ${i + 1}: ${s.caption || s.alt}`);
              const img = b.appendChild(document.createElement('img'));
              img.src = s.thumb!;
              img.alt = '';
              img.loading = 'lazy';
              b.addEventListener('click', () => pswp.goTo(i));
              return b;
            })
          : [];
        const row = document.createElement('div');
        row.className = 'kp-thumbs';
        thumbs.forEach((t) => row.appendChild(t));
        if (strip) el.appendChild(row);

        const update = (smooth = true) => {
          const i = pswp.currIndex;
          const s = pswp.currSlide?.data as Partial<Slide> | undefined;
          count.textContent = `${pad(i + 1)} / ${pad(slides.length)}`;
          caption.textContent = s?.caption ?? '';
          thumbs.forEach((t, k) => t.setAttribute('aria-current', String(k === i)));
          const t = thumbs[i];
          const behavior = smooth && !prefersReducedMotion() ? 'smooth' : 'auto';
          if (t) row.scrollTo({ left: t.offsetLeft - (row.clientWidth - t.offsetWidth) / 2, behavior });
        };
        pswp.on('change', () => update());
        // The strip is laid out only once the viewer is in the page.
        pswp.on('afterInit', () => update(false));
        update(false);
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
    document.dispatchEvent(new CustomEvent('kp:viewer-close', { detail: { gallery: name, index: pswp.currIndex } }));
    opener?.focus({ preventScroll: true });
  });
  pswp.init();
  track('gallery_open', { gallery_name: name });
}

// "View all photographs": a full-screen dialog of every photograph, grouped by chapter.
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
