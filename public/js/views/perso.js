import { html, useState, useEffect } from '/vendor/preact-htm.js';
import { get, post, patch, put, del } from '../api.js';
import { Sheet, useSheet, useSubmit, Bar, Money, MoneyInput, CategoryPicker, Skeleton, toast } from '../ui.js';
import { eur, catEmoji, catLabel, catTile, shortDate, parseMoney, centsToInput, defaultDateFor, CATEGORIES } from '../util.js';
import { MonthHeader } from './home.js';
import { ItemSheet } from './item-sheet.js';

const ENDPOINT = `${location.origin}/api/wallet/tx`;

function TxRow({ tx, onClick }) {
  return html`<li class="clickable" onClick=${onClick}>
    <div class="emoji" style=${catTile(tx.category || 'autre')}>${tx.category ? catEmoji(tx.category) : '❓'}</div>
    <div class="grow">
      <div class="title ellipsis">${tx.merchant || 'Paiement Apple Pay'}</div>
      <div class="sub ellipsis">${shortDate(tx.date)}${tx.card ? ` · ${tx.card}` : ''}</div>
    </div>
    <div class="amount num neg">${eur(tx.amount_cents)}</div>
  </li>`;
}

function ClassifySheet({ tx, onDone, onClose }) {
  const { closing, close } = useSheet(onClose);
  const [busy, setBusy] = useState(false);
  const act = async (fn) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      onDone();
      close();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  };
  return html`<${Sheet} title=${tx.merchant || 'Paiement Apple Pay'} onClose=${close} closing=${closing}>
    <p class="muted num" style=${{ marginTop: 0 }}>${eur(tx.amount_cents)} · ${shortDate(tx.date)}${tx.card ? ` · ${tx.card}` : ''}</p>
    <div class="field">
      <span>Catégorie</span>
      <${CategoryPicker} value=${tx.category} onChange=${(c) => act(() => patch(`/perso/tx/${tx.id}`, { category: c }))} />
    </div>
    <p class="small muted">Les prochains paiements chez ce commerçant seront classés pareil automatiquement.</p>
    <div class="btn-row">
      <button type="button" class="btn danger" disabled=${busy} onClick=${() => confirm('Supprimer ce paiement ?') && act(() => del(`/perso/tx/${tx.id}`))}>Supprimer</button>
    </div>
  </${Sheet}>`;
}

function BudgetSheet({ initial, onDone, onClose }) {
  const { closing, close } = useSheet(onClose);
  const [cat, setCat] = useState(initial.category);
  const [amount, setAmount] = useState(centsToInput(initial.amount_cents));
  const { busy, error, run } = useSubmit(async () => {
    const cents = parseMoney(amount || '0');
    if (cents == null) throw new Error('Montant invalide');
    await put('/perso/budgets', { category: cat, amount_cents: cents });
    onDone();
    close();
  });
  return html`<${Sheet} title="Budget du mois" onClose=${close} closing=${closing}>
    <form onSubmit=${run}>
      <label class="field">
        <span>Montant par mois</span>
        <${MoneyInput} value=${amount} onInput=${setAmount} big autofocus />
      </label>
      <div class="field" style=${{ marginTop: '16px' }}>
        <span>Catégorie</span>
        <${CategoryPicker} value=${cat} onChange=${setCat} />
      </div>
      <p class="small muted">Mets 0 pour retirer ce budget.</p>
      ${error && html`<div class="error-msg">${error}</div>`}
      <div class="btn-row"><button class="btn" disabled=${busy}>Enregistrer</button></div>
    </form>
  </${Sheet}>`;
}

function Copy({ label, value }) {
  const copy = () => navigator.clipboard.writeText(value).then(() => toast(`${label} copié`), () => toast('Copie impossible', 'error'));
  return html`<div class="field">
    <span>${label}</span>
    <div class="row">
      <input class="input grow" readonly value=${value} onFocus=${(e) => e.target.select()} />
      <button type="button" class="btn secondary small" onClick=${copy}>Copier</button>
    </div>
  </div>`;
}

function WalletSheet({ token, onClose }) {
  const { closing, close } = useSheet(onClose);
  return html`<${Sheet} title="Connecter Apple Pay" onClose=${close} closing=${closing}>
    <p class="small muted" style=${{ marginTop: 0 }}>Ce code n'est affiché qu'une fois. Garde cette fenêtre ouverte le temps de créer le raccourci.</p>
    <${Copy} label="Adresse" value=${ENDPOINT} />
    <${Copy} label="En-tête Authorization" value=${`Bearer ${token}`} />
    <ol class="small">
      <li>Ouvre <b>Raccourcis</b> → <b>Automatisation</b> → <b>+</b> → <b>Transaction</b>.</li>
      <li>Choisis tes cartes, puis <b>Exécuter immédiatement</b> → <b>Suivant</b> → <b>Nouveau raccourci vide</b>.</li>
      <li>Ajoute l'action <b>Obtenir le contenu de l'URL</b> et colle l'adresse.</li>
      <li>Touche <b>Afficher plus</b> : méthode <b>POST</b>, ajoute un en-tête <b>Authorization</b> avec la valeur copiée.</li>
      <li>Corps de la requête <b>JSON</b>, trois champs texte : <b>amount</b> = Montant, <b>merchant</b> = Commerçant, <b>card</b> = Carte (variables de l'entrée du raccourci).</li>
      <li>Paie avec Apple Pay : le paiement arrive ici dans « À classer ».</li>
    </ol>
  </${Sheet}>`;
}

/** Données perso du mois affiché, rechargées au retour sur l'app (un paiement a pu arriver entre-temps). */
function usePerso(ym) {
  const [data, setData] = useState(null);
  const load = () => get(`/perso/${ym}`).then(setData, (err) => toast(err.message, 'error'));
  useEffect(() => {
    load();
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [ym]);
  return [data?.ym === ym ? data : null, load];
}

const Header = ({ ctx }) => html`<${MonthHeader} ctx=${ctx} title="Mon compte perso" />`;

export function PersoHomeView({ ctx }) {
  const [data, load] = usePerso(ctx.ym);
  const [sheet, setSheet] = useState(null); // { classify } | { income }
  if (!data) return html`<${Header} ctx=${ctx} /><${Skeleton} />`;

  const income = data.incomes.reduce((a, t) => a + t.amount_cents, 0);
  const spent = [...data.transactions, ...data.pending.filter((t) => t.ym === ctx.ym)].reduce((a, t) => a + t.amount_cents, 0);
  const balance = income - spent;

  return html`
    <${Header} ctx=${ctx} />
    <div class="month-body ${ctx.monthDir}" key=${ctx.ym}>
      <section class="card budget-card">
        <span class="muted">Solde du mois</span>
        <div class="budget-amount num" style=${{ color: balance < 0 ? 'var(--danger)' : undefined }}>${balance < 0 ? '−' : ''}<${Money} cents=${Math.abs(balance)} /></div>
        <div class="totals num" style=${{ marginTop: '10px' }}>
          <div class="row"><span class="muted">Revenus</span><strong style=${{ color: 'var(--ok)' }}>+${eur(income)}</strong></div>
          <div class="row"><span class="muted">Dépenses</span><strong>−${eur(spent)}</strong></div>
        </div>
      </section>

      ${data.pending.length > 0 &&
      html`<div class="section-title">À classer (${data.pending.length})</div>
        <section class="card">
          <ul class="list">${data.pending.map((t) => html`<${TxRow} key=${t.id} tx=${t} onClick=${() => setSheet({ classify: t })} />`)}</ul>
        </section>`}

      <div class="section-title">
        Revenus du mois
        <button class="link-btn" onClick=${() => setSheet({ income: { date: defaultDateFor(ctx.ym) } })}>+ Revenu</button>
      </div>
      <section class="card">
        ${data.incomes.length === 0
          ? html`<div class="empty">Ajoute ton salaire et les virements reçus pour suivre ton solde.</div>`
          : html`<ul class="list">
              ${data.incomes.map(
                (t) => html`<li key=${t.id} class="clickable" onClick=${() => setSheet({ income: { ...t, label: t.merchant } })}>
                  <div class="emoji" style=${catTile('aides')}>💶</div>
                  <div class="grow">
                    <div class="title ellipsis">${t.merchant}</div>
                    <div class="sub">${shortDate(t.date)}</div>
                  </div>
                  <div class="amount num" style=${{ color: 'var(--ok)' }}>+${eur(t.amount_cents)}</div>
                </li>`
              )}
            </ul>`}
      </section>
    </div>

    ${sheet?.classify && html`<${ClassifySheet} tx=${sheet.classify} onDone=${load} onClose=${() => setSheet(null)} />`}
    ${sheet?.income &&
    html`<${ItemSheet}
      title=${sheet.income.id ? 'Revenu' : 'Nouveau revenu'}
      income
      withDate
      initial=${sheet.income}
      submitLabel=${sheet.income.id ? 'Enregistrer' : 'Ajouter'}
      onSubmit=${async ({ label, amount_cents, date }) => {
        const v = { label, amount_cents, date };
        await (sheet.income.id ? patch(`/perso/tx/${sheet.income.id}`, v) : post('/perso/incomes', v));
        load();
      }}
      onDelete=${sheet.income.id ? async () => { await del(`/perso/tx/${sheet.income.id}`); load(); } : null}
      onClose=${() => setSheet(null)}
    />`}
  `;
}

export function PersoBudgetView({ ctx }) {
  const [data, load] = usePerso(ctx.ym);
  const [sheet, setSheet] = useState(null); // { classify } | { budget }
  if (!data) return html`<${Header} ctx=${ctx} /><${Skeleton} />`;

  const spentBy = {};
  for (const t of data.transactions) spentBy[t.category] = (spentBy[t.category] || 0) + t.amount_cents;
  const spent = data.transactions.reduce((a, t) => a + t.amount_cents, 0);
  const budget = Object.values(data.budgets).reduce((a, b) => a + b, 0);
  const cats = CATEGORIES.map(([k]) => k).filter((k) => data.budgets[k] || spentBy[k]);

  return html`
    <${Header} ctx=${ctx} />
    <div class="month-body ${ctx.monthDir}" key=${ctx.ym}>
      <section class="card budget-card">
        <div class="row between">
          <span class="muted">Dépensé ce mois</span>
          ${budget > 0 &&
          (spent > budget
            ? html`<span class="badge warn num">${eur(spent - budget)} de dépassement</span>`
            : html`<span class="badge ok num">${eur(budget - spent)} restants</span>`)}
        </div>
        <div class="budget-amount num"><${Money} cents=${spent} /></div>
        ${budget > 0 && html`<${Bar} value=${spent} max=${budget} color=${spent > budget ? 'var(--danger)' : 'var(--grad)'} />
          <div class="small muted num" style=${{ marginTop: '6px' }}>sur ${eur(budget)} de budget</div>`}
        ${data.pending.length > 0 && html`<div class="small muted" style=${{ marginTop: '6px' }}><a href="#/perso">${data.pending.length} paiement${data.pending.length > 1 ? 's' : ''} à classer</a></div>`}
      </section>

      <div class="section-title">
        Budget par catégorie
        <button class="link-btn" onClick=${() => setSheet({ budget: { category: 'courses', amount_cents: 0 } })}>+ Budget</button>
      </div>
      <section class="card">
        ${cats.length === 0
          ? html`<div class="empty">Fixe un budget par catégorie (courses, sorties…) pour suivre ce qu'il te reste.</div>`
          : html`<ul class="list">
              ${cats.map((k) => {
                const b = data.budgets[k] || 0;
                const s = spentBy[k] || 0;
                return html`<li key=${k} class="clickable" onClick=${() => setSheet({ budget: { category: k, amount_cents: b } })}>
                  <div class="emoji" style=${catTile(k)}>${catEmoji(k)}</div>
                  <div class="grow">
                    <div class="title ellipsis">${catLabel(k)}</div>
                    ${b > 0 && html`<${Bar} value=${s} max=${b} color=${s > b ? 'var(--danger)' : 'var(--grad)'} />`}
                  </div>
                  <div class="member-amount num">
                    <div class="amount">${eur(s)}</div>
                    <div class="small muted">${b > 0 ? `sur ${eur(b)}` : 'sans budget'}</div>
                  </div>
                </li>`;
              })}
            </ul>`}
      </section>

      <div class="section-title">Dépenses du mois</div>
      <section class="card">
        ${data.transactions.length === 0
          ? html`<div class="empty">Les paiements Apple Pay classés apparaîtront ici.</div>`
          : html`<ul class="list">${data.transactions.map((t) => html`<${TxRow} key=${t.id} tx=${t} onClick=${() => setSheet({ classify: t })} />`)}</ul>`}
      </section>
    </div>

    ${sheet?.classify && html`<${ClassifySheet} tx=${sheet.classify} onDone=${load} onClose=${() => setSheet(null)} />`}
    ${sheet?.budget && html`<${BudgetSheet} initial=${sheet.budget} onDone=${load} onClose=${() => setSheet(null)} />`}
  `;
}

export function PersoSettingsView({ ctx }) {
  const [data, load] = usePerso(ctx.ym);
  const [token, setToken] = useState(null);

  const newToken = async () => {
    if (data.wallet_ready && !confirm("Créer un nouveau code ? L'ancien raccourci arrêtera de fonctionner.")) return;
    try {
      setToken((await post('/perso/wallet-token')).token);
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return html`
    <header class="topbar">
      <div>
        <div class="eyebrow">Mon compte perso</div>
        <h1>Réglages</h1>
      </div>
    </header>
    <div class="section-title">Paiements Apple Pay</div>
    <section class="card">
      ${!data
        ? html`<${Skeleton} lines=${1} />`
        : html`<div class="row between">
            <div class="small muted">${data.wallet_ready ? 'Raccourci iPhone configuré ✓' : 'Reçois automatiquement chaque paiement Apple Pay, à classer ensuite.'}</div>
            <button class="btn secondary small" onClick=${newToken}>${data.wallet_ready ? 'Nouveau code' : 'Connecter'}</button>
          </div>`}
    </section>
    <p class="small muted center">Seul toi vois ton espace perso.</p>
    ${token && html`<${WalletSheet} token=${token} onClose=${() => setToken(null)} />`}
  `;
}
