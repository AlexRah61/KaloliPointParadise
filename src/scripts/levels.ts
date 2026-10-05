// Level selector: without JavaScript all three levels are simply listed; with it they become tabs.
export function initLevelTabs(): void {
  const list = document.querySelector<HTMLElement>('[data-level-tabs]');
  if (!list) return;
  const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls') ?? ''));
  if (!tabs.length || panels.some((p) => !p)) return;

  const select = (index: number, focus: boolean) => {
    tabs.forEach((tab, i) => {
      const on = i === index;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      panels[i]!.hidden = !on;
    });
    if (focus) tabs[index]!.focus();
  };

  panels.forEach((p, i) => {
    p!.setAttribute('role', 'tabpanel');
    p!.setAttribute('aria-labelledby', tabs[i]!.id);
    p!.tabIndex = 0;
  });
  list.hidden = false;
  select(0, false);

  tabs.forEach((tab, i) => tab.addEventListener('click', () => select(i, false)));
  list.addEventListener('keydown', (e) => {
    const current = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    const next =
      e.key === 'ArrowRight' ? (current + 1) % tabs.length
      : e.key === 'ArrowLeft' ? (current - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? tabs.length - 1
      : -1;
    if (next < 0) return;
    e.preventDefault();
    select(next, true);
  });
}
