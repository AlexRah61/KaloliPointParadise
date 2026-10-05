// Map scale buttons: each reloads the Google embed at its own zoom (a click on the current one resets the view).
export function initMap(): void {
  const frame = document.querySelector<HTMLElement>('[data-map-frame]');
  const iframe = frame?.querySelector<HTMLIFrameElement>('iframe');
  const views = [...document.querySelectorAll<HTMLButtonElement>('[data-map-view]')];
  if (!frame || !iframe || !views.length) return;
  for (const view of views) {
    view.addEventListener('click', () => {
      views.forEach((v) => v.setAttribute('aria-pressed', String(v === view)));
      frame.toggleAttribute('data-satellite', view.hasAttribute('data-satellite'));
      iframe.src = view.dataset.mapView!;
    });
  }
}
