import { html, render, useState, useEffect, useCallback, useRef } from '/vendor/preact-htm.js';
import { get, post } from './api.js';
import { addMonths } from './util.js';
import { Icon, Toaster, toast, celebrate } from './ui.js';
import { AuthScreen } from './views/auth.js';
import { HomeView } from './views/home.js';
import { BudgetView } from './views/budget.js';
import { HistoryView } from './views/history.js';
import { SettingsView } from './views/settings.js';

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  if (a === 'mois' && /^\d{4}-\d{2}$/.test(b || '')) return { tab: 'home', ym: b };
  if (a === 'join' && b) return { tab: 'join', code: b };
  if (a === 'budget') return { tab: 'budget' };
  if (a === 'historique') return { tab: 'history' };
  if (a === 'reglages') return { tab: 'settings' };
  return { tab: 'home' };
}

const TABS = [
  ['home', '#/', 'Ce mois', Icon.home],
  ['budget', '#/budget', 'Budget', Icon.list],
  ['history', '#/historique', 'Historique', Icon.chart],
  ['settings', '#/reglages', 'Réglages', Icon.gear],
];

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

  const View = { home: HomeView, budget: BudgetView, history: HistoryView, settings: SettingsView }[route.tab] || HomeView;

  return html`
    <main class="page">
      ${!online && html`<div class="offline-banner">Hors ligne — affichage des dernières données connues</div>`}
      <div class="view" key=${route.tab}>
        <${View} ctx=${ctx} />
      </div>
    </main>
    <div class="tabbar">
      <nav style=${{ '--i': Math.max(0, TABS.findIndex(([k]) => k === route.tab)) }}>
        <span class="tab-indicator" aria-hidden="true"></span>
        ${TABS.map(
          ([key, href, label, I]) => html`<a href=${href} class=${route.tab === key ? 'active' : ''} aria-current=${route.tab === key ? 'page' : undefined}>
            <${I} />${label}
          </a>`
        )}
      </nav>
    </div>
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
