import { html, useState, useEffect, useRef } from '/vendor/preact-htm.js';
import { CATEGORIES, initial, parseMoney, eur, userColor } from './util.js';

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Durée de l'animation de fermeture des panneaux (doit correspondre au CSS).
const SHEET_OUT_MS = 240;

// ---------- icônes ----------

const svg = (d) => html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const Icon = {
  home: () => svg(html`<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />`),
  list: () => svg(html`<path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1.2" /><circle cx="4.5" cy="12" r="1.2" /><circle cx="4.5" cy="18" r="1.2" />`),
  chart: () => svg(html`<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />`),
  gear: () => svg(html`<circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />`),
  check: () => svg(html`<path d="M5 12.5 10 17 19 7" stroke-width="3" />`),
  left: () => svg(html`<path d="M15 5l-7 7 7 7" />`),
  right: () => svg(html`<path d="M9 5l7 7-7 7" />`),
};

// ---------- animations ----------

const easeOutCubic = (p) => 1 - Math.pow(1 - p, 3);

/** Fait glisser une valeur numérique vers sa cible (au montage : depuis 0). */
export function useTween(target, duration = 800) {
  // Les compteurs restent animés même en mouvement réduit : pas de déplacement à l'écran.
  const start0 = 0;
  const [value, setValue] = useState(start0);
  const current = useRef(start0);
  useEffect(() => {
    if (current.current === target) {
      current.current = target;
      setValue(target);
      return;
    }
    const from = current.current;
    const t0 = performance.now();
    let raf;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / duration);
      current.current = p === 1 ? target : from + (target - from) * easeOutCubic(p);
      setValue(current.current);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return value;
}

/** Montant qui « compte » jusqu'à sa valeur (en euros ronds pendant l'animation, exact à la fin). */
export function Money({ cents }) {
  const v = useTween(cents);
  return eur(v === cents ? cents : Math.round(v / 100) * 100);
}

export function Count({ value, suffix = '' }) {
  return `${Math.round(useTween(value))}${suffix}`;
}

/** Vrai une frame après le montage : permet aux transitions CSS de partir de l'état initial. */
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setMounted(true)));
    return () => cancelAnimationFrame(raf);
  }, []);
  return mounted;
}

// ---------- toasts ----------

let pushToast = () => {};
export function toast(message, type = 'info') {
  pushToast({ message, type, id: Math.random() });
}
export function Toaster() {
  const [t, setT] = useState(null);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    let hide;
    let remove;
    pushToast = (next) => {
      clearTimeout(hide);
      clearTimeout(remove);
      setLeaving(false);
      setT(next);
      hide = setTimeout(() => {
        setLeaving(true);
        remove = setTimeout(() => setT(null), 220);
      }, next.type === 'error' ? 4000 : 2600);
    };
  }, []);
  if (!t) return null;
  return html`<div class="toast ${t.type} ${leaving ? 'leaving' : ''}" role="status" key=${t.id}>${t.message}</div>`;
}

// ---------- confettis ----------

export function celebrate() {
  if (reducedMotion()) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#c6b8ff', '#f6b9d7', '#ffd3b5', '#9fe3c1', '#9fdcf5', '#fff0a0'];
  for (let i = 0; i < 90; i++) {
    const p = document.createElement('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--dx', `${(Math.random() - 0.5) * 200}px`);
    p.style.setProperty('--rot', `${Math.random() * 900 - 450}deg`);
    p.style.animationDuration = `${1.8 + Math.random() * 1.6}s`;
    p.style.animationDelay = `${Math.random() * 0.4}s`;
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 4200);
  navigator.vibrate?.([30, 40, 30]);
}

// ---------- composants ----------

export function Avatar({ user, small }) {
  return html`<div class="avatar ${small ? 'sm' : ''}" style=${{ background: userColor(user?.color) }} aria-hidden="true">
    ${initial(user?.name)}
  </div>`;
}

export function Ring({ value, max, size = 112, stroke = 11, children }) {
  const mounted = useMounted();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : value > 0 ? 1 : 0;
  return html`<div class="ring" style=${{ width: size + 'px', height: size + 'px' }}>
    <svg width=${size} height=${size}>
      <defs>
        <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style=${{ stopColor: 'var(--ring-a)' }} />
          <stop offset="1" style=${{ stopColor: 'var(--ring-b)' }} />
        </linearGradient>
      </defs>
      <circle class="ring-track" cx=${size / 2} cy=${size / 2} r=${r} stroke-width=${stroke} fill="none" />
      <circle
        class="ring-value"
        cx=${size / 2}
        cy=${size / 2}
        r=${r}
        stroke-width=${stroke}
        fill="none"
        stroke-linecap="round"
        stroke-dasharray=${c}
        stroke-dashoffset=${mounted ? c * (1 - ratio) : c}
        style=${{ opacity: ratio > 0 ? 1 : 0 }}
      />
    </svg>
    <div class="ring-label">${children}</div>
  </div>`;
}

export function Bar({ value, max, color }) {
  color = color?.startsWith('#') ? userColor(color) : color;
  const mounted = useMounted();
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : value > 0 ? 1 : 0;
  return html`<div class="bar"><div style=${{ width: `${mounted ? ratio * 100 : 0}%`, background: color }}></div></div>`;
}

/** Fermeture animée d'un panneau : `close()` joue l'animation de sortie puis appelle onClose. */
export function useSheet(onClose) {
  const [closing, setClosing] = useState(false);
  const done = useRef(false);
  const close = () => {
    if (done.current) return;
    done.current = true;
    setClosing(true);
    setTimeout(onClose, SHEET_OUT_MS);
  };
  return { closing, close };
}

export function Sheet({ title, onClose, closing, children }) {
  const sheetRef = useRef();
  const drag = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  // Glisser vers le bas depuis la poignée (ou le titre) pour fermer, comme une app native.
  const onTouchStart = (e) => {
    drag.current = { y: e.touches[0].clientY, dy: 0, t: performance.now() };
    sheetRef.current.style.transition = 'none';
  };
  const onTouchMove = (e) => {
    if (!drag.current) return;
    const dy = Math.max(0, e.touches[0].clientY - drag.current.y);
    drag.current.dy = dy;
    sheetRef.current.style.transform = `translateY(${dy}px)`;
  };
  const onTouchEnd = () => {
    if (!drag.current) return;
    const { dy, t } = drag.current;
    drag.current = null;
    const el = sheetRef.current;
    const fast = dy / (performance.now() - t) > 0.6;
    if (dy > 110 || (fast && dy > 30)) {
      // On part de la position du doigt pour finir la sortie sans à-coup.
      el.style.transition = `transform ${SHEET_OUT_MS}ms cubic-bezier(.4,0,1,1)`;
      el.style.transform = 'translateY(100%)';
      onClose();
    } else {
      el.style.transition = 'transform .3s cubic-bezier(.2,.9,.3,1)';
      el.style.transform = 'translateY(0)';
      setTimeout(() => {
        if (!el) return;
        el.style.transition = '';
        el.style.transform = '';
      }, 300);
    }
  };

  return html`<div class="sheet-backdrop ${closing ? 'closing' : ''}" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="sheet" ref=${sheetRef} role="dialog" aria-modal="true" aria-label=${title}>
      <div class="sheet-handle" onTouchStart=${onTouchStart} onTouchMove=${onTouchMove} onTouchEnd=${onTouchEnd} onTouchCancel=${onTouchEnd}>
        <div class="sheet-grip"></div>
        ${title && html`<h3>${title}</h3>`}
      </div>
      ${children}
    </div>
  </div>`;
}

export function MoneyInput({ value, onInput, big, autofocus, placeholder = '0' }) {
  const ref = useRef();
  useEffect(() => {
    if (autofocus) setTimeout(() => ref.current?.focus(), 320);
  }, []);
  return html`<div class="money-input ${big ? 'big' : ''}">
    <input
      ref=${ref}
      class="input num"
      inputmode="decimal"
      autocomplete="off"
      placeholder=${placeholder}
      value=${value}
      onInput=${(e) => onInput(e.target.value)}
    />
  </div>`;
}

export function CategoryPicker({ value, onChange }) {
  return html`<div class="chips">
    ${CATEGORIES.map(
      ([k, e, l]) => html`<button type="button" class="chip ${value === k ? 'on' : ''}" onClick=${() => onChange(k)}>
        <span>${e}</span>${l}
      </button>`
    )}
  </div>`;
}

export function Switch({ on, onChange, label }) {
  return html`<button type="button" role="switch" aria-checked=${on} aria-label=${label} class="switch ${on ? 'on' : ''}" onClick=${() => onChange(!on)}></button>`;
}

/** Sélecteur à onglets avec une pastille qui glisse sous l'option active. */
export function Segmented({ options, value, onChange }) {
  const index = Math.max(0, options.findIndex(([k]) => k === value));
  return html`<div class="segmented" role="tablist" style=${{ '--n': options.length, '--i': index }}>
    <span class="seg-pill" aria-hidden="true"></span>
    ${options.map(
      ([k, l]) => html`<button type="button" role="tab" aria-selected=${value === k} class=${value === k ? 'on' : ''} onClick=${() => onChange(k)}>${l}</button>`
    )}
  </div>`;
}

export function Skeleton({ lines = 3 }) {
  return html`<div class="card skeleton" aria-busy="true" aria-label="Chargement">
    <div class="row">
      <div class="sk sk-circle"></div>
      <div class="grow">
        <div class="sk" style=${{ width: '60%' }}></div>
        <div class="sk" style=${{ width: '40%', marginTop: '8px' }}></div>
      </div>
    </div>
    ${Array.from({ length: lines }, (_, i) => html`<div class="sk" style=${{ width: `${90 - i * 15}%`, marginTop: '16px' }}></div>`)}
  </div>`;
}

/** Petit hook pour les formulaires : gère "en cours" + message d'erreur. */
export function useSubmit(fn) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err.message || 'Erreur');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

export const moneyOk = (s) => {
  const v = parseMoney(s);
  return v != null && v > 0;
};
