import { prefersReducedMotion } from './scroll';

// Quiet, purposeful motion on native scrolling: chapter headings rise once, a few major photographs open from
// a slight inset, and full-bleed photographs drift a little. Nothing runs when reduced motion is preferred.
export async function initMotion(): Promise<void> {
  if (prefersReducedMotion()) return;

  const [{ gsap }, { ScrollTrigger }] = await Promise.all([import('gsap'), import('gsap/ScrollTrigger')]);
  gsap.registerPlugin(ScrollTrigger);

  const inFirstViewport = (el: Element) => el.getBoundingClientRect().top < window.innerHeight * 0.92;

  // Reveals are driven by IntersectionObserver rather than cached scroll positions, so content reached by a
  // header link or a long jump fades in on arrival. Opacity only (never visibility): unrevealed text stays in
  // the accessibility tree and in find-in-page.
  const reveals = gsap.utils.toArray<HTMLElement>('[data-reveal]').filter((el) => !inFirstViewport(el));
  gsap.set(reveals, { opacity: 0, y: 18 });
  const arrived = new Set<HTMLElement>();
  let frame = 0;
  const revealIo = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        revealIo.unobserve(e.target);
        arrived.add(e.target as HTMLElement);
      }
      if (!arrived.size || frame) return;
      frame = requestAnimationFrame(() => {
        gsap.to([...arrived], { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.08, overwrite: true, clearProps: 'transform' });
        arrived.clear();
        frame = 0;
      });
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  reveals.forEach((el) => revealIo.observe(el));

  const frames = gsap.utils.toArray<HTMLElement>('[data-reveal-image] .frame').filter((f) => !inFirstViewport(f));
  const settleImg = (f: Element) => {
    const img = f.querySelector('img');
    return img && !img.hasAttribute('data-parallax') ? img : null;
  };
  gsap.set(frames, { clipPath: 'inset(6% 3% 0% 3%)' });
  gsap.set(frames.map(settleImg).filter(Boolean), { scale: 1.05 });
  const imageIo = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        imageIo.unobserve(e.target);
        const img = settleImg(e.target);
        gsap.to(e.target, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.3, ease: 'power3.out', clearProps: 'clipPath' });
        if (img) gsap.to(img, { scale: 1, duration: 1.6, ease: 'power3.out', clearProps: 'transform' });
      }
    },
    { rootMargin: '0px 0px -10% 0px' },
  );
  frames.forEach((f) => imageIo.observe(f));

  // Parallax only where it reads as depth: large screens with a fine pointer.
  if (window.matchMedia('(min-width: 768px) and (pointer: fine)').matches) {
    gsap.utils.toArray<HTMLImageElement>('img[data-parallax]').forEach((img) => {
      const trigger = img.closest('section, figure, [id]') ?? img;
      gsap.fromTo(
        img,
        { yPercent: -2.4, scale: 1.05 },
        { yPercent: 2.4, scale: 1.05, ease: 'none', scrollTrigger: { trigger, start: 'top bottom', end: 'bottom top', scrub: 0.6 } },
      );
    });
    const heroPan = document.querySelector<HTMLElement>('[data-parallax-hero]');
    const hero = document.querySelector<HTMLElement>('[data-hero]');
    if (heroPan && hero) {
      gsap.to(heroPan, { yPercent: 12, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true } });
    }
  }

  window.addEventListener('load', () => ScrollTrigger.refresh(), { once: true });
}
