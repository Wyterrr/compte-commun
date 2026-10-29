import { html, useState } from '/vendor/preact-htm.js';
import { post, del } from '../api.js';
import { Icon, Avatar, Ring, Bar, Sheet, Segmented, MoneyInput, Money, Count, Skeleton, toast, useSubmit, useSheet, moneyOk } from '../ui.js';
import { eur, pct, monthLabel, addMonths, parseMoney, centsToInput, defaultDateFor, shortDate } from '../util.js';

export function MonthHeader({ ctx, title }) {
  const { ym, setYm, boot, settings } = ctx;
  return html`<header class="topbar">
    <button class="icon-btn" disabled=${ym <= settings.start_ym} onClick=${() => setYm(addMonths(ym, -1))} aria-label="Mois précédent">
      <${Icon.left} />
    </button>
    <div class="grow center">
      <div class="eyebrow ellipsis">${title || settings.household_name}</div>
      <h1 class="month-title" key=${ym}>${monthLabel(ym)}</h1>
      ${ym !== boot.current_ym &&
      html`<button class="link-btn" onClick=${() => setYm(boot.current_ym)}>Revenir à ${monthLabel(boot.current_ym, false)}</button>`}
    </div>
    <button class="icon-btn" disabled=${ym >= boot.max_ym} onClick=${() => setYm(addMonths(ym, 1))} aria-label="Mois suivant">
      <${Icon.right} />
    </button>
  </header>`;
}

export { Skeleton };

function Hero({ month }) {
  const missing = month.members.reduce((a, m) => a + Math.max(0, m.remaining), 0);
  let title;
  let text;
  if (month.status === 'empty') {
    title = 'Aucune charge prévue';
    text = html`Ajoute vos charges récurrentes dans <a href="#/reglages">Réglages</a> pour calculer la part de chacun.`;
  } else if (month.status === 'complete') {
    title = 'Mois bouclé 🎉';
    text = 'Chacun a mis sa part sur le compte. Tranquilles jusqu’au mois prochain !';
  } else {
    title = html`Il manque <span class="num"><${Money} cents=${missing} /></span>`;
    text = html`<span class="num"><${Money} cents=${month.received} /></span> versés sur <span class="num">${eur(month.target_total)}</span> attendus.`;
  }
  const max = month.target_total || month.total;
  const ratio = max > 0 ? Math.min(100, Math.round((month.received / max) * 100)) : month.status === 'complete' ? 100 : 0;
  return html`<section class="card hero ${month.status === 'complete' ? 'done' : ''}">
    <${Ring} value=${month.status === 'complete' ? 1 : month.received} max=${month.status === 'complete' ? 1 : max}>
      ${month.status === 'complete'
        ? html`<strong class="tick">✓</strong>`
        : html`<strong class="num"><${Count} value=${ratio} suffix=" %" /></strong>`}
    </${Ring}>
    <div class="hero-text grow">
      <h2>${title}</h2>
      <p>${text}</p>
    </div>
  </section>`;
}

function MemberRow({ m, user, isMe, month }) {
  const personalLabels = month.charges.filter((c) => c.paid_by === m.user_id && c.kind !== 'income').map((c) => c.label);
  const aidLabels = month.charges.filter((c) => c.paid_by === m.user_id && c.kind === 'income' && c.arrived).map((c) => c.label);
  return html`<div class="member">
    <div class="row">
      <${Avatar} user=${user} />
      <div class="grow">
        <div class="member-name">${user.name}${isMe && html` <span class="muted small">(toi)</span>`}</div>
        <div class="small muted num">Part ${pct(m.pct_bp)} · ${eur(m.share ?? m.due)}</div>
      </div>
      <div class="member-amount num">
        ${m.remaining > 0
          ? html`<strong><${Money} cents=${m.remaining} /></strong><span class="small muted">à verser</span>`
          : html`<span class="badge ok pop">✓ À jour</span>
              ${m.remaining < 0 && html`<div class="small muted" style=${{ marginTop: '4px' }}>+${eur(-m.remaining)} d’avance</div>`}`}
      </div>
    </div>
    <${Bar} value=${m.paid} max=${m.target} color=${user.color} />
    <div class="row between small muted num" style=${{ marginTop: '6px' }}>
      <span>Versé <${Money} cents=${m.paid} /></span>
      <span>Attendu ${eur(Math.max(0, m.target))}</span>
    </div>
    ${m.paid_personally > 0 && html`<div class="carry num">💳 Déjà payé de son côté : −${eur(m.paid_personally)} (${personalLabels.join(', ')})</div>`}
    ${m.received_personally > 0 && html`<div class="carry num">💶 Aide reçue sur son compte, à reverser : +${eur(m.received_personally)} (${aidLabels.join(', ')})</div>`}
    ${m.carry_in > 0 && html`<div class="carry num">↩︎ Avance des mois précédents déduite : −${eur(m.carry_in)}</div>`}
    ${m.carry_in < 0 && html`<div class="carry num">↩︎ Reste dû des mois précédents ajouté : +${eur(-m.carry_in)}</div>`}
  </div>`;
}

/**
 * Découpe un total au prorata de ce que chacun doit mettre ce mois-ci
 * (tient compte des charges payées perso et des reports), le dernier absorbe l'arrondi.
 */
function splitByShares(total, members) {
  let weights = members.map((m) => Math.max(0, m.target));
  if (!weights.some((w) => w > 0)) weights = members.map((m) => m.pct_bp);
  const sum = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return members.map((m, i) => {
    const v = i === members.length - 1 ? total - acc : Math.round(total * (sum ? weights[i] / sum : 1 / members.length));
    acc += v;
    return [m.user_id, v];
  });
}

function ContributionSheet({ ctx, initialUser, onClose }) {
  const { month, users, me, ym } = ctx;
  const { closing, close } = useSheet(onClose);
  const remainingOf = (id) => Math.max(0, month.members.find((m) => m.user_id === id)?.remaining || 0);
  const members = month.members.filter((m) => users.some((u) => u.id === m.user_id));

  // who : l'id d'une personne, ou 'both' pour un virement fait à deux
  const [who, setWho] = useState(initialUser);
  const [amount, setAmount] = useState(centsToInput(remainingOf(initialUser)));
  const [parts, setParts] = useState(() => Object.fromEntries(users.map((u) => [u.id, centsToInput(remainingOf(u.id))])));
  const [total, setTotal] = useState(() => centsToInput(users.reduce((a, u) => a + remainingOf(u.id), 0)));
  const [date, setDate] = useState(defaultDateFor(ym));
  const [note, setNote] = useState('');

  const pick = (k) => {
    setWho(k);
    if (k !== 'both') setAmount(centsToInput(remainingOf(k)));
  };
  // Saisir le total le répartit selon les parts du mois ; modifier une part met le total à jour.
  const onTotal = (v) => {
    setTotal(v);
    const c = parseMoney(v);
    if (c != null) setParts(Object.fromEntries(splitByShares(c, members).map(([id, x]) => [id, centsToInput(x)])));
  };
  const onPart = (id, v) => {
    const next = { ...parts, [id]: v };
    setParts(next);
    setTotal(centsToInput(users.reduce((a, u) => a + (parseMoney(next[u.id]) || 0), 0)));
  };

  const partsCents = users.map((u) => ({ user_id: u.id, amount_cents: parts[u.id] === '' ? 0 : parseMoney(parts[u.id]) }));
  const bothOk = partsCents.every((p) => p.amount_cents != null) && partsCents.some((p) => p.amount_cents > 0);

  const { busy, error, run } = useSubmit(async () => {
    let body;
    if (who === 'both') {
      if (!bothOk) throw new Error('Montants invalides');
      body = { parts: partsCents, date, note };
    } else {
      const cents = parseMoney(amount);
      if (!cents) throw new Error('Montant invalide');
      body = { user_id: who, amount_cents: cents, date, note };
    }
    ctx.setMonthData(await post(`/months/${ym}/contributions`, body));
    toast(who === 'both' ? 'Virement à deux enregistré ✓' : 'Versement enregistré ✓');
    close();
  });

  const options = [...users.map((u) => [u.id, u.id === me.id ? 'Moi' : u.name]), ['both', 'Les deux']];

  return html`<${Sheet} title="Nouveau versement" onClose=${close} closing=${closing}>
    <form onSubmit=${run}>
      ${users.length > 1 && html`<div style=${{ marginBottom: '16px' }}><${Segmented} options=${options} value=${who} onChange=${pick} /></div>`}
      ${who === 'both'
        ? html`<div class="both-box" key="both">
            <${MoneyInput} big value=${total} onInput=${onTotal} />
            <p class="small muted center">Total viré à deux, réparti selon la part de chacun. Tu peux ajuster chaque montant.</p>
            <div class="card both-parts">
              ${users.map(
                (u) => html`<div class="row" key=${u.id}>
                  <${Avatar} user=${u} small />
                  <span class="grow">${u.id === me.id ? 'Moi' : u.name}</span>
                  <div style=${{ width: '140px' }}><${MoneyInput} value=${parts[u.id]} onInput=${(v) => onPart(u.id, v)} /></div>
                </div>`
              )}
            </div>
          </div>`
        : html`<div key="one">
            <${MoneyInput} big value=${amount} onInput=${setAmount} autofocus />
            <p class="small muted center">Montant viré sur le compte commun pour ${monthLabel(ym)}</p>
          </div>`}
      <label class="field">
        <span>Date du virement</span>
        <input class="input" type="date" value=${date} onInput=${(e) => setDate(e.target.value)} required />
      </label>
      <label class="field">
        <span>Note (facultatif)</span>
        <input class="input" value=${note} maxlength="140" placeholder="ex : virement auto" onInput=${(e) => setNote(e.target.value)} />
      </label>
      ${error && html`<div class="error-msg">${error}</div>`}
      <div class="btn-row">
        <button class="btn" disabled=${busy || (who === 'both' ? !bothOk : !moneyOk(amount))}>
          ${who === 'both' ? 'Enregistrer le virement à deux' : 'Enregistrer le versement'}
        </button>
      </div>
    </form>
  </${Sheet}>`;
}

function AccountCard({ month }) {
  return html`<section class="card totals num">
    <div class="row"><span class="muted">Versements reçus</span><span>${eur(month.received)}</span></div>
    ${month.aid_joint > 0 &&
    html`<div class="row"><span class="muted">Aides (CAF…)</span><span style=${{ color: 'var(--ok)' }}>+${eur(month.aid_joint)}</span></div>`}
    <div class="row"><span class="muted">Charges prévues</span><span>${month.total > 0 ? '−' : ''}${eur(month.total)}</span></div>
    ${month.expenses_total > 0 &&
    html`<div class="row"><span class="muted">Dépenses ponctuelles</span><span>−${eur(month.expenses_total)}</span></div>`}
    <div class="row sum">
      <span>Reste sur le compte</span>
      <span style=${{ color: month.available < 0 ? 'var(--danger)' : 'var(--accent)' }}>
        ${month.available < 0 ? '−' : ''}${eur(Math.abs(month.available))}
      </span>
    </div>
  </section>`;
}

export function HomeView({ ctx }) {
  const { month, me, users, ym, boot } = ctx;
  const [sheetUser, setSheetUser] = useState(null);
  const [nudging, setNudging] = useState(false);

  if (!month || month.ym !== ym)
    return html`<${MonthHeader} ctx=${ctx} /><div class="month-body ${ctx.monthDir}" key=${'sk' + ym}><${Skeleton} /><${Skeleton} lines=${2} /></div>`;

  const userById = new Map(users.map((u) => [u.id, u]));
  const ordered = [...month.members].sort((a, b) => (a.user_id === me.id ? -1 : b.user_id === me.id ? 1 : 0));
  const mine = month.members.find((m) => m.user_id === me.id);
  const late = month.members.filter((m) => m.user_id !== me.id && m.remaining > 0);

  const nudge = async () => {
    setNudging(true);
    try {
      const r = await post('/nudge');
      toast(r.sent ? 'Rappel envoyé 👋' : `${late.map((m) => userById.get(m.user_id)?.name).join(', ')} n’a pas activé les notifications`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setNudging(false);
    }
  };

  // Un virement à deux = plusieurs lignes avec le même group_id, affichées comme une seule entrée.
  const entries = [];
  const groups = new Map();
  for (const c of month.contributions) {
    if (!c.group_id) {
      entries.push({ ...c, parts: [c] });
    } else if (groups.has(c.group_id)) {
      const g = groups.get(c.group_id);
      g.parts.push(c);
      g.amount_cents += c.amount_cents;
    } else {
      const g = { ...c, parts: [c] };
      groups.set(c.group_id, g);
      entries.push(g);
    }
  }
  const bothLate = users.length > 1 && month.members.every((m) => m.remaining > 0);
  const bothTotal = month.members.reduce((a, m) => a + Math.max(0, m.remaining), 0);

  const removeContribution = async (c) => {
    const what = c.parts.length > 1 ? 'ce virement à deux' : 'ce versement';
    if (!confirm(`Supprimer ${what} de ${eur(c.amount_cents)} ?`)) return;
    try {
      ctx.setMonthData(await del(`/contributions/${c.id}`));
      toast('Versement supprimé');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return html`
    <${MonthHeader} ctx=${ctx} />
    <div class="month-body ${ctx.monthDir}" key=${ym}>
    <${Hero} month=${month} />

    <section class="card">
      ${ordered.map((m) => userById.get(m.user_id) && html`<${MemberRow} key=${m.user_id} m=${m} month=${month} user=${userById.get(m.user_id)} isMe=${m.user_id === me.id} />`)}
    </section>

    <div class="btn-row">
      ${mine && mine.remaining > 0
        ? html`<button class="btn" onClick=${() => setSheetUser(me.id)}>J’ai fait mon virement · <span class="num">${eur(mine.remaining)}</span></button>`
        : html`<button class="btn secondary" onClick=${() => setSheetUser(me.id)}>+ Ajouter un versement</button>`}
    </div>
    ${bothLate &&
    html`<div class="btn-row">
      <button class="btn secondary" onClick=${() => setSheetUser('both')}>Virement à deux · <span class="num">${eur(bothTotal)}</span></button>
    </div>`}
    ${users.length < 2 &&
    html`<div class="btn-row"><a class="btn ghost" href="#/reglages">💌 Inviter ta moitié</a></div>`}
    ${ym === boot.current_ym && late.length > 0 && users.length > 1 &&
    html`<div class="btn-row">
      <button class="btn ghost" disabled=${nudging} onClick=${nudge}>
        Relancer ${late.map((m) => userById.get(m.user_id)?.name).join(' et ')} 👋
      </button>
    </div>`}

    <div class="section-title">Le compte ce mois-ci</div>
    <${AccountCard} month=${month} />

    <div class="section-title">Versements</div>
    <section class="card">
      ${month.contributions.length === 0
        ? html`<div class="empty">Aucun versement pour l’instant.</div>`
        : html`<ul class="list">
            ${entries.map((c) => {
              const order = users.map((u) => u.id);
              const parts = [...c.parts].sort((a, b) => order.indexOf(a.user_id) - order.indexOf(b.user_id));
              const people = parts.map((p) => userById.get(p.user_id)).filter(Boolean);
              const joint = c.parts.length > 1;
              return html`<li key=${c.id}>
                ${joint
                  ? html`<div class="avatars">${people.map((u) => html`<${Avatar} user=${u} small />`)}</div>`
                  : html`<${Avatar} user=${people[0]} small />`}
                <div class="grow">
                  <div class="title">${joint ? 'À deux' : people[0]?.name || '—'}</div>
                  <div class="sub ellipsis">${shortDate(c.date)}${c.note ? ` · ${c.note}` : ''}</div>
                  ${joint && html`<div class="sub num">${parts.map((p) => `${userById.get(p.user_id)?.name} ${eur(p.amount_cents)}`).join(' · ')}</div>`}
                </div>
                <div class="amount num">+${eur(c.amount_cents)}</div>
                <button class="del" aria-label="Supprimer" onClick=${() => removeContribution(c)}>×</button>
              </li>`;
            })}
          </ul>`}
    </section>

    </div>

    ${sheetUser != null && html`<${ContributionSheet} ctx=${ctx} initialUser=${sheetUser} onClose=${() => setSheetUser(null)} />`}
  `;
}
