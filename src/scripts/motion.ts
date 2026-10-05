import { prefersReducedMotion, setLenis } from './scroll';

// Quiet, restrained motion. Nothing here runs when the visitor prefers reduced motion.
export async function initMotion(): Promise<void> {
  if (prefersReducedMotion()) return;

  const [{ gsap }, { ScrollTrigger }, { default: Lenis }] = await Promise.all([
    import('gsap'),
    import('gsap/ScrollTrigger'),
    import('lenis'),
  ]);
  gsap.registerPlugin(ScrollTrigger);

  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (!coarse) {
    const lenis = new Lenis({ lerp: 0.11, smoothWheel: true, anchors: false });
    setLenis(lenis);
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  const inFirstViewport = (el: Element) => el.getBoundingClientRect().top < window.innerHeight * 0.92;

  // Text and blocks rise gently into place once.
  const reveals = gsap.utils.toArray<HTMLElement>('[data-reveal]').filter((el) => !inFirstViewport(el));
  gsap.set(reveals, { autoAlpha: 0, y: 26 });
  ScrollTrigger.batch(reveals, {
    start: 'top 88%',
    once: true,
    onEnter: (els) => gsap.to(els, { autoAlpha: 1, y: 0, duration: 1.1, ease: 'power3.out', stagger: 0.09, overwrite: true }),
  });

  // Images open from a slight inset; the photo itself ends at its native scale.
  gsap.utils.toArray<HTMLElement>('[data-reveal-image] .frame').forEach((frame) => {
    if (inFirstViewport(frame)) return;
    const img = frame.querySelector('img');
    const tl = gsap.timeline({ scrollTrigger: { trigger: frame, start: 'top 86%', once: true } });
    tl.fromTo(frame, { clipPath: 'inset(7% 4% 0% 4%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.5, ease: 'power3.out' });
    if (img) tl.fromTo(img, { scale: 1.06 }, { scale: 1, duration: 1.8, ease: 'power3.out', clearProps: 'transform' }, 0);
  });

  // Gentle parallax on full-bleed photographs (5% overscan keeps resolution loss negligible).
  gsap.utils.toArray<HTMLImageElement>('img[data-parallax]').forEach((img) => {
    const trigger = img.closest('section, figure') ?? img;
    gsap.fromTo(
      img,
      { yPercent: -2.4, scale: 1.05 },
      { yPercent: 2.4, scale: 1.05, ease: 'none', scrollTrigger: { trigger, start: 'top bottom', end: 'bottom top', scrub: 0.6 } },
    );
  });

  const heroPan = document.querySelector<HTMLElement>('[data-parallax-hero]');
  const hero = document.querySelector<HTMLElement>('[data-hero]');
  if (heroPan && hero && window.matchMedia('(min-width: 768px)').matches) {
    gsap.to(heroPan, { yPercent: 14, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true } });
  }

  window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
}
