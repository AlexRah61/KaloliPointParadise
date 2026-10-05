import { track } from './analytics';
import { getAttribution } from './attribution';
import { addDays, hstToday, isIsoDate, isLikelyBot, MAX_DAYS_AHEAD, phoneDigits, TOUR_LABEL, TURNSTILE_ACTION } from '../lib/showing-shared';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
      getResponse: (id?: string) => string | undefined;
    };
  }
}

type FieldErrors = Record<string, string>;

interface ApiOk {
  ok: true;
  leadId: string;
  notified: boolean;
  preferred: string;
  alternate: string;
  flexible: boolean;
  tourType: 'in_person' | 'video';
}

const LABELS: Record<string, string> = {
  name: 'Full name',
  phone: 'Phone',
  email: 'Email',
  preferredDate: 'Preferred date',
  preferredTime: 'Preferred time',
  alternateDate: 'Alternative date',
  alternateTime: 'Alternative time',
  message: 'Message',
};

export function initShowingForm(): void {
  const found = document.querySelector<HTMLFormElement>('[data-showing-form]');
  if (!found) return;
  const form: HTMLFormElement = found;
  const dialog = document.querySelector<HTMLDialogElement>('[data-showing-dialog]');
  const sheet = document.querySelector<HTMLDialogElement>('[data-showing-sheet]');
  const sheetSlot = sheet?.querySelector<HTMLElement>('[data-sheet-slot]');
  const home = form.closest<HTMLElement>('[data-form-home]')!;
  const summary = form.querySelector<HTMLElement>('[data-error-summary]')!;
  const summaryList = form.querySelector<HTMLUListElement>('[data-error-list]')!;
  const status = form.querySelector<HTMLElement>('[data-form-status]')!;
  const submit = form.querySelector<HTMLButtonElement>('[data-submit]')!;
  const submitLabel = form.querySelector<HTMLElement>('[data-submit-label]')!;
  const tsHost = form.querySelector<HTMLElement>('[data-turnstile]')!;
  const siteKey = form.dataset.sitekey ?? '';
  const defaultLabel = submitLabel.textContent ?? '';
  let opener: HTMLElement | null = null;

  const today = hstToday();
  const max = addDays(today, MAX_DAYS_AHEAD);
  form.querySelectorAll<HTMLInputElement>('[data-date-input]').forEach((i) => {
    i.min = today;
    i.max = max;
  });

  // ---- analytics: first interaction ----
  let startedAt = 0;
  form.addEventListener('focusin', () => {
    if (startedAt) return;
    startedAt = Date.now();
    track('showing_form_start', { cta_location: form.dataset.ctaOrigin });
    loadTurnstile();
  });

  // ---- Turnstile, loaded only when the form is near the viewport or opened ----
  let widgetId: string | undefined;
  let token = '';
  let tsRequested = false;
  function renderWidget(): void {
    if (!window.turnstile || widgetId !== undefined) return;
    widgetId = window.turnstile.render(tsHost, {
      sitekey: siteKey,
      appearance: 'interaction-only',
      // A challenge widget is 300 px wide; narrow phones get the 150 px compact one so it never widens the page.
      size: window.matchMedia('(max-width: 389px)').matches ? 'compact' : 'normal',
      theme: 'light',
      action: TURNSTILE_ACTION,
      callback: (t: string) => {
        token = t;
      },
      'expired-callback': () => {
        token = '';
      },
      'error-callback': () => {
        token = '';
      },
    });
  }
  function loadTurnstile(): void {
    if (tsRequested || !siteKey) return;
    tsRequested = true;
    const w = window as unknown as Record<string, unknown>;
    w.kpTurnstileReady = () => renderWidget();
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=kpTurnstileReady';
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }
  new IntersectionObserver(
    ([e], obs) => {
      if (e?.isIntersecting) {
        loadTurnstile();
        obs.disconnect();
      }
    },
    { rootMargin: '900px 0px' },
  ).observe(form);

  async function waitForToken(ms = 12000): Promise<string> {
    const t0 = Date.now();
    while (!token && Date.now() - t0 < ms) {
      if (window.turnstile && widgetId !== undefined) token = window.turnstile.getResponse(widgetId) ?? '';
      if (token) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    return token;
  }

  // ---- request sheet: every CTA opens the same form in place, so nobody loses their spot ----
  // Moving an iframe reloads it, so the Turnstile widget is removed first and rendered again after the move.
  function moveForm(target: HTMLElement): void {
    if (form.parentElement === target) return;
    if (window.turnstile && widgetId !== undefined) window.turnstile.remove(widgetId);
    widgetId = undefined;
    token = '';
    target.appendChild(form);
    if (window.turnstile) renderWidget();
    else loadTurnstile();
  }

  let sheetActive = false;
  let lockY = 0;
  const vv = window.visualViewport;
  const syncViewport = () => {
    if (sheet && vv) sheet.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
  };
  vv?.addEventListener('resize', () => {
    if (sheetActive) syncViewport();
  });
  // The visitor's place must not move while the sheet is open (some engines scroll when focusing into a modal).
  // Touch devices only get one-off corrections so the on-screen keyboard can still bring fields into view.
  const finePointer = window.matchMedia('(pointer: fine)');
  const holdScroll = () => {
    if (Math.abs(window.scrollY - lockY) > 1) window.scrollTo(0, lockY);
  };
  const settleScroll = () => {
    holdScroll();
    requestAnimationFrame(holdScroll);
  };

  function openSheet(origin: string, trigger: HTMLElement | null): void {
    if (!sheet || !sheetSlot || sheetActive) return;
    sheetActive = true;
    opener = trigger;
    form.dataset.ctaOrigin = origin;
    home.style.minHeight = `${home.offsetHeight}px`;
    moveForm(sheetSlot);
    syncViewport();
    lockY = window.scrollY;
    if (finePointer.matches) window.addEventListener('scroll', holdScroll, { passive: true });
    sheet.showModal();
    sheet.scrollTop = 0;
    sheet.querySelector<HTMLElement>('#sheet-title')?.focus({ preventScroll: true });
    settleScroll();
    document.documentElement.style.overflow = 'hidden';
  }

  function restoreForm(returnFocus: boolean): void {
    if (!sheetActive) return;
    sheetActive = false;
    window.removeEventListener('scroll', holdScroll);
    moveForm(home);
    home.style.minHeight = '';
    form.dataset.ctaOrigin = 'inline_form';
    if (returnFocus) {
      opener?.focus({ preventScroll: true });
      opener = null;
    }
    settleScroll();
    // The sheet can open over the full photograph collection; keep the page locked until that closes too.
    const otherOpen = [...document.querySelectorAll('dialog[open]')].some((d) => d !== sheet && d !== dialog);
    document.documentElement.style.overflow = otherOpen ? 'hidden' : '';
  }

  if (sheet) {
    document.addEventListener('click', (e) => {
      const a = (e.target as Element | null)?.closest<HTMLAnchorElement>('a[data-showing-cta]');
      if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      openSheet(a.dataset.showingCta || 'unknown', a);
    });
    sheet.addEventListener('close', () => restoreForm(true));
    sheet.querySelector('[data-sheet-close]')?.addEventListener('click', () => sheet.close());
    let downOnBackdrop = false;
    sheet.addEventListener('pointerdown', (e) => {
      downOnBackdrop = e.target === sheet;
    });
    sheet.addEventListener('click', (e) => {
      if (downOnBackdrop && e.target === sheet) sheet.close();
      downOnBackdrop = false;
    });
  }

  // ---- validation ----
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
  const value = (name: string) => (field(name)?.value ?? '').trim();

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    const name = value('name');
    if (name.length < 2) errors.name = 'Enter your full name.';
    const digits = phoneDigits(value('phone'));
    if (digits.length < 10 || digits.length > 15) errors.phone = 'Enter a phone number the agent can call, including area code.';
    const email = value('email');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'Enter a valid email address.';
    const d = value('preferredDate');
    if (!isIsoDate(d)) errors.preferredDate = 'Choose a preferred date.';
    else if (d < today || d > max) errors.preferredDate = `Choose a date between today and ${MAX_DAYS_AHEAD} days from now.`;
    if (!value('preferredTime')) errors.preferredTime = 'Choose a preferred time.';
    const ad = value('alternateDate');
    const at = value('alternateTime');
    if (ad && !isIsoDate(ad)) errors.alternateDate = 'Choose a valid alternative date.';
    else if (ad && (ad < today || ad > max)) errors.alternateDate = `Choose a date between today and ${MAX_DAYS_AHEAD} days from now.`;
    if (ad && !at) errors.alternateTime = 'Choose a time for your alternative date.';
    if (at && !ad) errors.alternateDate = 'Choose a date for your alternative time.';
    if (value('message').length > 1000) errors.message = 'Please keep the message under 1,000 characters.';
    return errors;
  }

  function clearErrors(): void {
    summary.hidden = true;
    summaryList.replaceChildren();
    form.querySelectorAll<HTMLElement>('[data-error-for]').forEach((p) => (p.textContent = ''));
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  }

  function showErrors(errors: FieldErrors): void {
    const entries = Object.entries(errors);
    if (!entries.length) return;
    if (errors.alternateDate || errors.alternateTime) form.querySelector<HTMLDetailsElement>('[data-alt]')!.open = true;
    for (const [name, msg] of entries) {
      const el = field(name);
      el?.setAttribute('aria-invalid', 'true');
      const p = form.querySelector<HTMLElement>(`[data-error-for="${name}"]`);
      if (p) p.textContent = msg;
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `#${el?.id ?? ''}`;
      a.textContent = `${LABELS[name] ?? name}: ${msg}`;
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        el?.focus();
      });
      li.appendChild(a);
      summaryList.appendChild(li);
    }
    summary.hidden = false;
    summary.focus();
  }

  form.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    if (t.getAttribute('aria-invalid') === 'true') {
      t.removeAttribute('aria-invalid');
      const p = form.querySelector<HTMLElement>(`[data-error-for="${(t as HTMLInputElement).name}"]`);
      if (p) p.textContent = '';
    }
  });

  function busy(on: boolean, label?: string): void {
    submit.disabled = on;
    submit.setAttribute('aria-busy', String(on));
    submitLabel.textContent = on ? (label ?? 'Sending…') : defaultLabel;
  }

  // ---- submit ----
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors();
    status.textContent = '';
    const errors = validate();
    if (Object.keys(errors).length) {
      showErrors(errors);
      return;
    }

    busy(true, 'Verifying…');
    loadTurnstile();
    const tsToken = await waitForToken();
    if (!tsToken) {
      busy(false);
      status.textContent = 'We could not verify this request yet. Please wait a moment and try again, or call the listing agent.';
      return;
    }

    busy(true, 'Sending your request…');
    const fd = new FormData(form);
    const payload = {
      name: value('name'),
      phone: value('phone'),
      email: value('email'),
      preferredDate: value('preferredDate'),
      preferredTime: value('preferredTime'),
      alternateDate: value('alternateDate') || undefined,
      alternateTime: value('alternateTime') || undefined,
      flexible: fd.get('flexible') === '1',
      tourType: fd.get('tourType') === 'video' ? 'video' : 'in_person',
      message: value('message') || undefined,
      company: value('company'),
      elapsedMs: startedAt ? Date.now() - startedAt : 0,
      turnstileToken: tsToken,
      ctaOrigin: form.dataset.ctaOrigin || 'inline_form',
      attribution: getAttribution(),
    };

    let res: Response | null = null;
    try {
      res = await fetch('/api/showing-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      res = null;
    }
    const data = (await res?.json().catch(() => null)) as (ApiOk & { error?: string; errors?: FieldErrors }) | null;
    busy(false);
    token = '';
    if (window.turnstile && widgetId !== undefined) window.turnstile.reset(widgetId);

    if (res?.ok && data?.ok) {
      // The conversion means "accepted and persisted": decoy successes for bot-like submissions are never counted.
      if (data.leadId && !isLikelyBot(payload.company, payload.elapsedMs)) {
        track('showing_request_submitted', { cta_location: payload.ctaOrigin, tour_type: data.tourType });
      }
      form.reset();
      if (sheetActive) {
        restoreForm(false);
        sheet?.close();
      }
      openDialog(data);
      return;
    }
    if (res?.status === 422 && data?.errors) {
      showErrors(data.errors);
      return;
    }
    status.textContent =
      data?.error ??
      'Something went wrong and your request was not sent. Please try again, or call the listing agent directly.';
  });

  // ---- confirmation dialog ----
  function openDialog(data: ApiOk): void {
    if (!dialog) return;
    const body = dialog.querySelector<HTMLElement>('[data-dlg-body]')!;
    const times = dialog.querySelector<HTMLElement>('[data-dlg-times]')!;
    const ref = dialog.querySelector<HTMLElement>('[data-dlg-ref]')!;
    const agentName = 'Misti Tyrin';
    const paras = data.notified
      ? [
          'Your showing request has been sent to the listing agent.',
          `${agentName} will contact you directly by phone to confirm the date and time based on availability.`,
        ]
      : [
          'Your request has been received and saved.',
          `We could not deliver it to the listing agent automatically just now and will keep retrying. To be sure it reaches her, please call ${agentName} at (808) 756-8811.`,
        ];
    body.replaceChildren(...paras.map((t) => Object.assign(document.createElement('p'), { textContent: t })));

    const rows: [string, string][] = [['Requested', data.preferred]];
    if (data.alternate) rows.push(['Alternative', data.alternate]);
    rows.push(['Showing type', TOUR_LABEL[data.tourType]]);
    if (data.flexible) rows.push(['Flexible', 'Yes']);
    times.replaceChildren(
      ...rows.flatMap(([k, v]) => [
        Object.assign(document.createElement('dt'), { textContent: k }),
        Object.assign(document.createElement('dd'), { textContent: v }),
      ]),
    );
    ref.textContent = `Reference ${data.leadId}`;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('#dlg-title')?.focus();
  }

  dialog?.querySelector('[data-dlg-close]')?.addEventListener('click', () => dialog.close());
  dialog?.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog?.addEventListener('close', () => {
    const back = opener && opener.isConnected ? opener : submit;
    opener = null;
    back.focus({ preventScroll: true });
  });
}
