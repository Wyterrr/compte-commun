import { html, useState } from '/vendor/preact-htm.js';
import { post, patch, del } from '../api.js';
import { Segmented, Avatar, Bar, Money, toast } from '../ui.js';
import { eur, catEmoji, catLabel, catTile, defaultDateFor, shortDate, payerOptions } from '../util.js';
import { MonthHeader, Skeleton } from './home.js';
import { ItemSheet } from './item-sheet.js';

function ChargesTab({ ctx, month }) {
  const [edit, setEdit] = useState(null); // charge du mois | 'new'

  const charges = month.charges.filter((c) => c.kind !== 'income');
  const aids = month.charges.filter((c) => c.kind === 'income');
  const joint = charges.filter((c) => !c.paid_by);
  const personal = charges.filter((c) => c.paid_by);
  const nameOf = (id) => (id === ctx.me.id ? 'toi' : ctx.users.find((u) => u.id === id)?.name || '—');
  const userById = new Map(ctx.users.map((u) => [u.id, u]));
  const payers = payerOptions(ctx.users, ctx.me);

  // Synchronisé avec les virements : l'argent reçu sur le compte (versements + aides)
  // couvre les charges dans l'ordre où elles tombent dans le mois.
  const funds = month.received + (month.aid_joint || 0);
  const missing = Math.max(0, month.total - funds);
  const ordered = [...joint].sort((a, b) => (a.day ?? 99) - (b.day ?? 99));
  const coverage = new Map();
  let left = funds;
  for (const c of ordered) {
    coverage.set(c.id, Math.min(c.amount_cents, Math.max(0, left)));
    left -= c.amount_cents;
  }

  return html`
    <section class="card budget-card">
      <div class="row between">
        <span class="muted">Budget du compte commun</span>
        ${month.total > 0 && missing === 0
          ? html`<span class="badge ok pop">✓ Couvert</span>`
          : html`<span class="badge warn num">${eur(missing)} à financer</span>`}
      </div>
      <div class="budget-amount num"><${Money} cents=${month.total} /></div>
      <${Bar} value=${funds} max=${month.total} color="var(--grad)" />
      <div class="row between small muted num" style=${{ marginTop: '6px' }}>
        <span>${eur(funds)} reçus${month.aid_joint > 0 ? ` (dont ${eur(month.aid_joint)} d'aides)` : ''}</span>
        <span>${Math.min(100, month.total ? Math.round((funds / month.total) * 100) : 0)} %</span>
      </div>
      <div class="budget-people">
        ${month.members.map((m) => {
          const u = userById.get(m.user_id);
          return u && html`<div class="budget-person num" key=${m.user_id}>
            <${Avatar} user=${u} small />
            <div class="grow">
              <div class="small" style=${{ fontWeight: 700 }}>${m.user_id === ctx.me.id ? 'Toi' : u.name}</div>
              <div class="small muted">${eur(m.paid)} / ${eur(Math.max(0, m.target))}</div>
            </div>
            ${m.remaining <= 0 && html`<span class="tick-sm">✓</span>`}
          </div>`;
        })}
      </div>
      ${month.personal_total > 0 &&
      html`<div class="small muted num" style=${{ marginTop: '10px' }}>+ ${eur(month.personal_total)} de charges payées perso, partagées entre vous</div>`}
    </section>

    <div class="section-title">
      Charges du mois
      <button class="link-btn" onClick=${() => setEdit('new')}>+ Exceptionnelle</button>
    </div>
    <section class="card">
      ${ordered.length === 0
        ? html`<div class="empty">Aucune charge ce mois-ci.<br /><a href="#/reglages">Ajouter des charges récurrentes</a></div>`
        : html`<ul class="list">
            ${ordered.map((c) => {
              const cov = coverage.get(c.id);
              const full = cov >= c.amount_cents;
              return html`<li key=${c.id} class="clickable" onClick=${() => setEdit(c)}>
                <div class="emoji" style=${catTile(c.category)}>${catEmoji(c.category)}</div>
                <div class="grow">
                  <div class="title ellipsis">${c.label}</div>
                  <div class="sub">${c.one_off ? 'Exceptionnelle' : catLabel(c.category)}${c.day ? ` · le ${c.day}` : ''}</div>
                  <div class="mini-bar"><div class=${full ? 'full' : ''} style=${{ width: `${c.amount_cents ? (cov / c.amount_cents) * 100 : 100}%` }}></div></div>
                </div>
                <div class="member-amount num">
                  <div class="amount">${eur(c.amount_cents)}</div>
                  <div class="small ${full ? 'cov-ok' : 'muted'}">${full ? 'Couvert' : cov > 0 ? `${eur(cov)} couverts` : 'À financer'}</div>
                </div>
              </li>`;
            })}
          </ul>`}
    </section>
    <p class="small muted center">Les virements reçus couvrent les charges dans l'ordre du mois. Toucher une charge permet d'ajuster son montant pour ce mois-ci.</p>

    ${personal.length > 0 &&
    html`<div class="section-title">Payées perso, partagées</div>
      <section class="card">
        <ul class="list">
          ${personal.map(
            (c) => html`<li key=${c.id} class="clickable" onClick=${() => setEdit(c)}>
              <div class="emoji" style=${catTile(c.category)}>${catEmoji(c.category)}</div>
              <div class="grow">
                <div class="title ellipsis">${c.label}</div>
                <div class="sub">Payée par ${nameOf(c.paid_by)}${c.one_off ? ' · exceptionnelle' : ''}</div>
              </div>
              <div class="amount num">${eur(c.amount_cents)}</div>
            </li>`
          )}
        </ul>
      </section>
      <p class="small muted center">Payées depuis un compte perso : on les partage quand même, en baissant la part sur le compte commun de celui ou celle qui paie.</p>`}

    ${aids.length > 0 &&
    html`<div class="section-title">Aides du mois</div>
      <section class="card">
        <ul class="list">
          ${aids.map(
            (c) => html`<li key=${c.id} class="clickable" onClick=${() => setEdit(c)}>
              <div class="emoji" style=${catTile('aides')}>${catEmoji('aides')}</div>
              <div class="grow">
                <div class="title ellipsis">${c.label}</div>
                <div class="sub">${c.paid_by ? `Reçue sur le compte de ${nameOf(c.paid_by)}` : 'Reçue sur le compte commun'}${c.day ? ` · le ${c.day}` : ''}</div>
              </div>
              <div class="amount num" style=${{ color: 'var(--ok)' }}>+${eur(c.amount_cents)}</div>
            </li>`
          )}
        </ul>
      </section>
      <p class="small muted center">Elle compte pour les deux : la part de chacun baisse d'autant.</p>`}

    ${edit === 'new' &&
    html`<${ItemSheet}
      title="Charge exceptionnelle"
      payers=${payers}
      hint="Elle s'ajoute au total de ce mois et augmente la part de chacun."
      submitLabel="Ajouter"
      onSubmit=${async (v) => ctx.setMonthData(await post(`/months/${ctx.ym}/charges`, v))}
      onClose=${() => setEdit(null)}
    />`}
    ${edit && edit !== 'new' &&
    html`<${ItemSheet}
      title=${edit.kind === 'income' ? 'Aide de ce mois' : edit.one_off ? 'Charge exceptionnelle' : 'Charge de ce mois'}
      initial=${edit}
      income=${edit.kind === 'income'}
      payers=${payers}
      allowZero
      hint=${edit.one_off ? null : edit.kind === 'income' ? 'Pour changer le montant tous les mois, passe par Réglages → Aides.' : 'Pour changer le montant tous les mois, passe par Réglages → Charges récurrentes.'}
      onSubmit=${async (v) => ctx.setMonthData(await patch(`/month-charges/${edit.id}`, v))}
      onDelete=${async () => ctx.setMonthData(await del(`/month-charges/${edit.id}`))}
      onClose=${() => setEdit(null)}
    />`}
  `;
}

function ExpensesTab({ ctx, month }) {
  const [adding, setAdding] = useState(false);
  const userById = new Map(ctx.users.map((u) => [u.id, u]));

  const remove = async (x) => {
    if (!confirm(`Supprimer « ${x.label} » ?`)) return;
    try {
      ctx.setMonthData(await del(`/expenses/${x.id}`));
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return html`
    <section class="card totals num">
      <div class="row"><span class="muted">Dépenses ponctuelles</span><strong>${eur(month.expenses_total)}</strong></div>
      <div class="row">
        <span class="muted">Reste sur le compte</span>
        <span style=${{ color: month.available < 0 ? 'var(--danger)' : 'var(--accent)', fontWeight: 600 }}>
          ${month.available < 0 ? '−' : ''}${eur(Math.abs(month.available))}
        </span>
      </div>
    </section>
    <div class="btn-row"><button class="btn secondary" onClick=${() => setAdding(true)}>+ Ajouter une dépense</button></div>

    <div class="section-title">Dépenses du mois</div>
    <section class="card">
      ${month.expenses.length === 0
        ? html`<div class="empty">Les achats faits avec la carte du compte commun (resto, cadeau, bricolage…) peuvent être notés ici.</div>`
        : html`<ul class="list">
            ${month.expenses.map(
              (x) => html`<li key=${x.id}>
                <div class="emoji" style=${catTile(x.category)}>${catEmoji(x.category)}</div>
                <div class="grow">
                  <div class="title ellipsis">${x.label}</div>
                  <div class="sub">${shortDate(x.date)}${userById.get(x.user_id) ? ` · ${userById.get(x.user_id).name}` : ''}</div>
                </div>
                <div class="amount num neg">${eur(x.amount_cents)}</div>
                <button class="del" aria-label="Supprimer" onClick=${() => remove(x)}>×</button>
              </li>`
            )}
          </ul>`}
    </section>

    ${adding &&
    html`<${ItemSheet}
      title="Nouvelle dépense"
      withDate
      initial=${{ date: defaultDateFor(ctx.ym) }}
      submitLabel="Ajouter"
      onSubmit=${async (v) => {
        ctx.setMonthData(await post(`/months/${ctx.ym}/expenses`, v));
        toast('Dépense ajoutée');
      }}
      onClose=${() => setAdding(false)}
    />`}
  `;
}

export function BudgetView({ ctx }) {
  const [tab, setTab] = useState('charges');
  const { month, ym } = ctx;
  return html`
    <${MonthHeader} ctx=${ctx} />
    <${Segmented} options=${[['charges', 'Charges'], ['expenses', 'Dépenses']]} value=${tab} onChange=${setTab} />
    <div class="month-body ${ctx.monthDir}" key=${`${ym}-${tab}`} style=${{ marginTop: '14px' }}>
      ${!month || month.ym !== ym
        ? html`<${Skeleton} />`
        : tab === 'charges'
          ? html`<${ChargesTab} ctx=${ctx} month=${month} />`
          : html`<${ExpensesTab} ctx=${ctx} month=${month} />`}
    </div>
  `;
}
