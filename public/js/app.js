import { html, render, useState, useEffect, useCallback, useRef } from '/vendor/preact-htm.js';
import { get, post } from './api.js';
import { addMonths } from './util.js';
import { Icon, Toaster, toast, celebrate, Avatar, Sheet, useSheet } from './ui.js';
import { AuthScreen } from './views/auth.js';
import { HomeView } from './views/home.js';
import { BudgetView } from './views/budget.js';
import { PersoHomeView, PersoBudgetView, PersoSettingsView } from './views/perso.js';
import { HistoryView } from './views/history.js';
import { SettingsView } from './views/settings.js';

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  if (a === 'mois' && /^\d{4}-\d{2}$/.test(b || '')) return { tab: 'home', ym: b };
  if (a === 'join' && b) return { tab: 'join', code: b };
  if (a === 'budget') return { tab: 'budget' };
  if (a === 'perso') return { tab: b === 'budget' ? 'perso-budget' : b === 'reglages' ? 'perso-settings' : 'perso-home' };
  if (a === 'historique') return { tab: 'history' };
  if (a === 'reglages') return { tab: 'settings' };
  return { tab: 'home' };
}

// Deux espaces, comme deux comptes : le commun du couple et le perso de chacun, chacun avec ses onglets.
const TABS = {
  commun: [
    ['home', '#/', 'Ce mois', Icon.home],
    ['budget', '#/budget', 'Budget', Icon.list],
    ['history', '#/historique', 'Historique', Icon.chart],
    ['settings', '#/reglages', 'Réglages', Icon.gear],
  ],
  perso: [
    ['perso-home', '#/perso', 'Ce mois', Icon.home],
    ['perso-budget', '#/perso/budget', 'Budget', Icon.list],
    ['perso-settings', '#/perso/reglages', 'Réglages', Icon.gear],
  ],
};
/** Pastille du compte actif ; un appui ouvre la liste des comptes (comme Revolut). */
function SpaceSwitch({ space, users, me, household }) {
  const [open, setOpen] = useState(false);
  const accounts = [
    ['commun', household, 'Compte commun du couple', users.slice(0, 2)],
    ['perso', 'Mon compte perso', 'Visible seulement par toi', [me]],
  ];
  const cur = accounts.find(([k]) => k === space);
  return html`
    <button type="button" class="space-chip" onClick=${() => setOpen(true)} aria-haspopup="dialog">
      <span class="avatars">${cur[3].map((u) => html`<${Avatar} key=${u.id} user=${u} small />`)}</span>
      <span class="ellipsis">${space === 'perso' ? 'Perso' : 'Commun'}</span>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
    </button>
    ${open && html`<${AccountSheet} accounts=${accounts} space=${space} onClose=${() => setOpen(false)} />`}
  `;
}

function AccountSheet({ accounts, space, onClose }) {
  const { closing, close } = useSheet(onClose);
  const pick = (k) => {
    if (k !== space) location.hash = TABS[k][0][1];
    close();
  };
  return html`<${Sheet} title="Comptes" onClose=${close} closing=${closing}>
    <ul class="list account-list">
      ${accounts.map(
        ([k, name, sub, people]) => html`<li key=${k} class="clickable ${k === space ? 'on' : ''}" onClick=${() => pick(k)}>
          <span class="avatars">${people.map((u) => html`<${Avatar} key=${u.id} user=${u} />`)}</span>
          <div class="grow">
            <div class="title ellipsis">${name}</div>
            <div class="sub">${sub}</div>
          </div>
          ${k === space && html`<span class="tick-sm">✓</span>`}
        </li>`
      )}
    </ul>
  </${Sheet}>`;
}

// Tirer vers le bas depuis le haut de la page pour recharger (le logo suit le doigt, tourne, puis rebondit).
const PULL_MAX = 130;
const PULL_TRIGGER = 85;
function PullToRefresh() {
  const [dist, setDist] = useState(0);
  const [loading, setLoading] = useState(false);
  const start = useRef(null);
  const distRef = useRef(0);
  useEffect(() => {
    const onStart = (e) => {
      // Pas pendant un panneau ouvert, ni si la page n'est pas tout en haut.
      start.current = window.scrollY <= 0 && !document.querySelector('.sheet-backdrop') ? e.touches[0].clientY : null;
    };
    const onMove = (e) => {
      if (start.current == null) return;
      const dy = e.touches[0].clientY - start.current;
      // Résistance : plus on tire, moins ça descend.
      distRef.current = dy > 0 ? Math.min(PULL_MAX, dy * 0.5) : 0;
      setDist(distRef.current);
    };
    const onEnd = () => {
      if (start.current == null) return;
      start.current = null;
      if (distRef.current >= PULL_TRIGGER) {
        setLoading(true);
        navigator.vibrate?.(10);
        setTimeout(() => location.reload(), 650);
      } else setDist(0);
      distRef.current = 0;
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);
  const y = loading ? PULL_TRIGGER : dist;
  const ready = dist >= PULL_TRIGGER;
  return html`<div
    class="ptr ${loading ? 'loading' : ''} ${ready ? 'ready' : ''} ${start.current == null ? 'settle' : ''}"
    style=${{ transform: `translate(-50%, ${y - 60}px)`, opacity: Math.min(1, y / 50) }}
    aria-hidden="true"
  >
    <img src="/icons/icon.svg" alt="" style=${{ transform: loading ? undefined : `rotate(${dist * 3}deg) scale(${0.6 + Math.min(1, dist / PULL_TRIGGER) * 0.4})` }} />
  </div>`;
}

const spaceOf = (tab) => (tab.startsWith('perso') ? 'perso' : 'commun');

// L'app se rouvre sur le dernier espace utilisé.
try {
  if (!location.hash.replace(/^#\/?/, '') && localStorage.getItem('cc-space') === 'perso') location.hash = '#/perso';
} catch {
  /* stockage indisponible : on reste sur le commun */
}

function App() {
  const [phase, setPhase] = useState('loading'); // loading | setup | login | join | ready | error
  const [route, setRoute] = useState(parseHash);
  const [boot, setBoot] = useState(null);
  const [months, setMonths] = useState({});
  const [ym, setYm] = useState(null);
  const [monthDir, setMonthDir] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const monthsRef = useRef(months);
  monthsRef.current = months;

  const loadBoot = useCallback(async () => {
    const b = await get('/bootstrap');
    setBoot(b);
    return b;
  }, []);

  const setMonthData = useCallback((summary) => {
    const prev = monthsRef.current[summary.ym];
    if (prev && prev.status !== 'complete' && summary.status === 'complete') celebrate();
    setMonths((m) => ({ ...m, [summary.ym]: summary }));
  }, []);

  const loadMonth = useCallback(async (target) => {
    try {
      setMonthData(await get(`/months/${target}`));
    } catch (err) {
      toast(err.message, 'error');
    }
  }, []);

  const init = useCallback(async () => {
    try {
      const st = await get('/state');
      const r = parseHash();
      if (!st.setup) return setPhase('setup');
      if (!st.user) return setPhase(r.tab === 'join' ? 'join' : 'login');
      if (r.tab === 'join') location.hash = '#/';
      const b = await loadBoot();
      setYm((cur) => cur || r.ym || b.current_ym);
      setPhase('ready');
    } catch (err) {
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    init();
    const onHash = () => setRoute(parseHash());
    const onOnline = () => setOnline(navigator.onLine);
    window.addEventListener('hashchange', onHash);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOnline);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOnline);
    };
  }, []);

  useEffect(() => {
    if (route.ym) changeYm(route.ym);
    window.scrollTo(0, 0);
    try {
      if (route.tab !== 'join') localStorage.setItem('cc-space', spaceOf(route.tab));
    } catch {
      /* stockage indisponible */
    }
  }, [route]);

  useEffect(() => {
    if (phase !== 'ready' || !ym) return;
    loadMonth(ym).then(() => {
      // Précharge les mois voisins pour que le changement de mois soit instantané.
      for (const n of [addMonths(ym, -1), addMonths(ym, 1)]) {
        if (!monthsRef.current[n] && n >= boot.settings.start_ym && n <= boot.max_ym) {
          get(`/months/${n}`).then((s) => setMonths((m) => ({ ...m, [n]: s }))).catch(() => {});
        }
      }
    });
  }, [phase, ym]);

  // Sens de glissement quand on change de mois ; remis à zéro une fois l'animation jouée.
  const changeYm = useCallback((next) => {
    setYm((cur) => {
      if (cur && next !== cur) setMonthDir(next > cur ? 'from-right' : 'from-left');
      return next;
    });
  }, []);
  useEffect(() => {
    if (!monthDir) return;
    const t = setTimeout(() => setMonthDir(''), 600);
    return () => clearTimeout(t);
  }, [monthDir]);

  // Quand on revient sur l'app (ou que le réseau revient), on rafraîchit : l'autre a peut-être fait son virement.
  useEffect(() => {
    if (phase !== 'ready') return;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      loadBoot().catch(() => {});
      if (ym) loadMonth(ym);
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [phase, ym]);

  const logout = async () => {
    await post('/logout').catch(() => {});
    if ('caches' in window) await caches.delete('cc-api').catch(() => {});
    setBoot(null);
    setMonths({});
    setYm(null);
    location.hash = '#/';
    setPhase('login');
  };

  if (phase === 'loading') return html`<div class="splash"><img src="/icons/icon.svg" alt="" width="72" height="72" /></div>`;
  if (phase === 'error')
    return html`<div class="auth">
      <img class="auth-logo" src="/icons/icon.svg" alt="" />
      <h1>Oups</h1>
      <p>Impossible de joindre le serveur.</p>
      <button class="btn" onClick=${() => { setPhase('loading'); init(); }}>Réessayer</button>
    </div>`;
  if (phase !== 'ready')
    return html`<${AuthScreen}
        mode=${phase}
        code=${route.code}
        onMode=${setPhase}
        onDone=${() => { setPhase('loading'); init(); }}
      /><${Toaster} />`;

  const ctx = {
    boot,
    me: boot.me,
    users: boot.users,
    settings: boot.settings,
    ym,
    setYm: changeYm,
    monthDir,
    month: months[ym],
    setMonthData,
    loadMonth,
    loadBoot,
    setBoot,
    logout,
  };

  const space = spaceOf(route.tab);
  const tabs = TABS[space];
  const View = { home: HomeView, budget: BudgetView, 'perso-home': PersoHomeView, 'perso-budget': PersoBudgetView, 'perso-settings': PersoSettingsView, history: HistoryView, settings: SettingsView }[route.tab] || HomeView;

  return html`
    <main class="page">
      ${!online && html`<div class="offline-banner">Hors ligne — affichage des dernières données connues</div>`}
      <${SpaceSwitch} space=${space} users=${boot.users} me=${boot.me} household=${boot.settings.household_name} />
      <div class="view" key=${route.tab}>
        <${View} ctx=${ctx} />
      </div>
    </main>
    <div class="tabbar">
      <nav style=${{ '--i': Math.max(0, tabs.findIndex(([k]) => k === route.tab)), '--n': tabs.length }}>
        <span class="tab-indicator" aria-hidden="true"></span>
        ${tabs.map(
          ([key, href, label, I]) => html`<a href=${href} class=${route.tab === key ? 'active' : ''} aria-current=${route.tab === key ? 'page' : undefined}>
            <${I} />${label}
          </a>`
        )}
      </nav>
    </div>
    <${PullToRefresh} />
    <${Toaster} />
  `;
}

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('SW', err));
  // Clic sur une notification alors que l'app est ouverte : on suit le lien.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'navigate' && e.data.url) {
      const hash = new URL(e.data.url, location.origin).hash;
      location.hash = hash || '#/';
    }
  });
}
