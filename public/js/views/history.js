import { html, useState, useEffect } from '/vendor/preact-htm.js';
import { get } from '../api.js';
import { Avatar, Bar, Ring, Money, Count, Skeleton, toast } from '../ui.js';
import { eur, monthLabel, userColor } from '../util.js';

function statusBadge(m, currentYm, carryOver) {
  if (m.status === 'complete') return html`<span class="badge ok">✓ Bouclé</span>`;
  if (m.status === 'empty') return html`<span class="badge">Vide</span>`;
  if (m.ym > currentYm) return html`<span class="badge">À venir</span>`;
  if (m.ym === currentYm) return html`<span class="badge warn">En cours</span>`;
  return carryOver ? html`<span class="badge warn">Reporté</span>` : html`<span class="badge danger">Incomplet</span>`;
}

const signed = (cents) => `${cents < 0 ? '−' : '+'}${eur(Math.abs(cents))}`;

function Summary({ data }) {
  const s = data.summary;
  return html`<section class="card hero">
      <${Ring} value=${s.complete} max=${s.months || 1} size=${96} stroke=${10}>
        <strong class="num"><${Count} value=${s.complete} />/${s.months}</strong>
      </${Ring}>
      <div class="hero-text grow">
        <h2>${s.complete} mois bouclé${s.complete > 1 ? 's' : ''}</h2>
        <p>sur ${s.months} mois suivi${s.months > 1 ? 's' : ''} dans l'app</p>
      </div>
    </section>
    <section class="card stats num">
      <div class="stat"><span>Versé sur le compte</span><strong><${Money} cents=${s.received} /></strong></div>
      <div class="stat"><span>Charges du compte</span><strong><${Money} cents=${s.charges} /></strong></div>
      <div class="stat"><span>Payées perso</span><strong><${Money} cents=${s.personal} /></strong></div>
      <div class="stat"><span>Dépenses</span><strong><${Money} cents=${s.expenses} /></strong></div>
      <div class="stat aid"><span>Aides reçues (CAF…)</span><strong><${Money} cents=${s.aids} /></strong></div>
    </section>`;
}

function PersonTotals({ data, carryOver }) {
  return html`<section class="card">
    ${data.totals.map(
      (t) => html`<div class="member" key=${t.user_id}>
        <div class="row">
          <${Avatar} user=${t} />
          <div class="grow">
            <div class="member-name">${t.name}</div>
            <div class="small muted num">Part totale ${eur(t.share)}</div>
          </div>
          ${t.balance === 0
            ? html`<span class="badge ok">À jour</span>`
            : t.balance > 0
              ? html`<span class="badge ok num">+${eur(t.balance)} d’avance</span>`
              : html`<span class="badge warn num">${eur(-t.balance)} de retard</span>`}
        </div>
        <${Bar} value=${t.paid} max=${t.due} color=${t.color} />
        <div class="row between small muted num" style=${{ marginTop: '6px' }}>
          <span>Versé ${eur(t.paid)}</span>
          <span>Attendu ${eur(t.due)}</span>
        </div>
        ${t.received_personally > 0 && html`<div class="carry num">💶 Aides reçues sur son compte : ${eur(t.received_personally)} (reversées via sa part)</div>`}
        ${t.paid_personally > 0 && html`<div class="carry num">💳 Payé de son côté : ${eur(t.paid_personally)} (déduit de ce qui était à verser)</div>`}
      </div>`
    )}
    <p class="small muted" style=${{ margin: '14px 0 0' }}>
      ${carryOver
        ? 'Les avances et retards sont reportés automatiquement sur le mois suivant.'
        : 'Le report des écarts est désactivé : chaque mois est indépendant.'}
    </p>
  </section>`;
}

function MonthDetails({ m, users, onOpen }) {
  const nameOf = (id) => users.find((u) => u.id === id)?.name || '—';
  const personal = m.members.filter((mm) => mm.paid_personally > 0);
  return html`<div class="month-details" onClick=${(e) => e.stopPropagation()}>
    <div class="totals num">
      <div class="row"><span class="muted">Charges du compte</span><span>${eur(m.total)}</span></div>
      ${personal.length > 0 &&
      html`<div class="row"><span class="muted">Payées perso</span><span>${personal.map((p) => `${nameOf(p.user_id)} ${eur(p.paid_personally)}`).join(' · ')}</span></div>`}
      ${m.aid_total > 0 && html`<div class="row"><span class="muted">Aides (CAF…)</span><span style=${{ color: 'var(--ok)' }}>+${eur(m.aid_total)}</span></div>`}
      ${m.expenses_total > 0 && html`<div class="row"><span class="muted">Dépenses ponctuelles</span><span>${eur(m.expenses_total)}</span></div>`}
      <div class="row">
        <span class="muted">Virements</span>
        <span>${m.transfers}${m.joint_transfers ? ` (dont ${m.joint_transfers} à deux)` : ''}</span>
      </div>
      <div class="row sum">
        <span>Reste sur le compte</span>
        <span style=${{ color: m.available < 0 ? 'var(--danger)' : 'var(--ok)' }}>${signed(m.available)}</span>
      </div>
    </div>

    <div class="detail-people">
      ${m.members.map(
        (mm) => html`<div class="detail-person num" key=${mm.user_id}>
          <div class="row" style=${{ marginBottom: '6px' }}>
            <i class="dot" style=${{ background: userColor(mm.color) }}></i><strong>${mm.name}</strong>
          </div>
          <div class="row between"><span class="muted">Part</span><span>${eur(mm.share)}</span></div>
          ${mm.received_personally > 0 && html`<div class="row between"><span class="muted">Aide reçue</span><span>+${eur(mm.received_personally)}</span></div>`}
          ${mm.paid_personally > 0 && html`<div class="row between"><span class="muted">Payé perso</span><span>−${eur(mm.paid_personally)}</span></div>`}
          ${mm.carry_in !== 0 && html`<div class="row between"><span class="muted">Report</span><span>${signed(-mm.carry_in)}</span></div>`}
          <div class="row between"><span class="muted">Attendu</span><span>${eur(Math.max(0, mm.target))}</span></div>
          <div class="row between"><span class="muted">Versé</span><span>${eur(mm.paid)}</span></div>
          <div class="row between" style=${{ fontWeight: 700 }}>
            <span>${mm.remaining > 0 ? 'Reste' : mm.remaining < 0 ? 'Avance' : 'À jour'}</span>
            <span>${mm.remaining !== 0 ? eur(Math.abs(mm.remaining)) : '✓'}</span>
          </div>
        </div>`
      )}
    </div>

    <div class="btn-row">
      <button class="btn secondary small" onClick=${() => onOpen(m.ym, '')}>Voir le mois</button>
      <button class="btn ghost small" onClick=${() => onOpen(m.ym, 'budget')}>Charges & dépenses</button>
    </div>
  </div>`;
}

export function HistoryView({ ctx }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);

  // Se met à jour dès que quelque chose change ailleurs (versement, charge, répartition, réglages…)
  useEffect(() => {
    get('/history').then(setData).catch((err) => toast(err.message, 'error'));
  }, [ctx.month, ctx.boot]);

  const goTo = (ym, tab) => {
    ctx.setYm(ym);
    location.hash = tab ? `#/${tab}` : `#/mois/${ym}`;
  };

  return html`
    <header class="topbar">
      <div>
        <div class="eyebrow">${ctx.settings.household_name}</div>
        <h1>Historique</h1>
      </div>
    </header>
    ${!data
      ? html`<${Skeleton} /><${Skeleton} lines=${2} />`
      : html`
          <${Summary} data=${data} />

          <div class="section-title">Chacun depuis le début</div>
          <${PersonTotals} data=${data} carryOver=${ctx.settings.carry_over} />

          <div class="section-title">Mois par mois</div>
          ${data.months.map(
            (m) => html`<section class="card month-row ${open === m.ym ? 'open' : ''}" key=${m.ym} onClick=${() => setOpen(open === m.ym ? null : m.ym)}>
              <div class="row between">
                <span class="label">${monthLabel(m.ym)}</span>
                <span class="row" style=${{ gap: '8px' }}>
                  ${statusBadge(m, data.current_ym, ctx.settings.carry_over)}
                  <span class="chevron" aria-hidden="true">›</span>
                </span>
              </div>
              <${Bar} value=${m.received} max=${m.target_total || m.total} color="var(--grad)" />
              <div class="row between small muted num" style=${{ marginTop: '6px' }}>
                <span>${eur(m.received)} versés</span>
                <span>${eur(m.target_total)} attendus</span>
              </div>
              <div class="mini-members num">
                ${m.members.map(
                  (mm) => html`<span key=${mm.user_id}>
                    <i class="dot" style=${{ background: userColor(mm.color) }}></i>${mm.name} ${eur(mm.paid)} / ${eur(Math.max(0, mm.target))}
                  </span>`
                )}
                ${m.joint_transfers > 0 && html`<span>🤝 ${m.joint_transfers} à deux</span>`}
                ${m.expenses_total > 0 && html`<span>🧾 ${eur(m.expenses_total)} de dépenses</span>`}
              </div>
              ${open === m.ym && html`<${MonthDetails} m=${m} users=${ctx.users} onOpen=${goTo} />`}
            </section>`
          )}
        `}
  `;
}
