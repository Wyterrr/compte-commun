import { html, useState } from '/vendor/preact-htm.js';
import { Sheet, Segmented, MoneyInput, CategoryPicker, useSubmit, useSheet, moneyOk } from '../ui.js';
import { parseMoney, centsToInput } from '../util.js';

/** Formulaire commun : charge récurrente, charge exceptionnelle, dépense, aide (income). */
export function ItemSheet({ title, initial = {}, withDay, withDate, payers, income, hint, submitLabel = 'Enregistrer', allowZero, onSubmit, onDelete, onClose }) {
  const { closing, close } = useSheet(onClose);
  const [label, setLabel] = useState(initial.label || '');
  const [amount, setAmount] = useState(centsToInput(initial.amount_cents));
  const [category, setCategory] = useState(initial.category || (income ? 'aides' : 'autre'));
  const [day, setDay] = useState(initial.day ? String(initial.day) : '');
  const [date, setDate] = useState(initial.date || '');
  const [paidBy, setPaidBy] = useState(initial.paid_by ?? 'joint');

  const { busy, error, run } = useSubmit(async () => {
    const cents = parseMoney(amount);
    if (cents == null || (!allowZero && cents === 0)) throw new Error('Montant invalide');
    const values = { label, amount_cents: cents, category };
    if (withDay) values.day = day ? Number(day) : null;
    if (withDate) values.date = date;
    if (payers) values.paid_by = paidBy === 'joint' ? null : paidBy;
    await onSubmit(values);
    close();
  });
  const remove = useSubmit(async () => {
    await onDelete();
    close();
  });

  const amountOk = allowZero ? parseMoney(amount) != null : moneyOk(amount);

  return html`<${Sheet} title=${title} onClose=${close} closing=${closing}>
    <form onSubmit=${run}>
      <label class="field">
        <span>Libellé</span>
        <input class="input" value=${label} maxlength="60" required placeholder=${income ? 'ex : CAF' : 'ex : Loyer'} onInput=${(e) => setLabel(e.target.value)} />
      </label>
      <div class="row" style=${{ marginTop: '14px', alignItems: 'flex-end' }}>
        <label class="field grow">
          <span>Montant</span>
          <${MoneyInput} value=${amount} onInput=${setAmount} />
        </label>
        ${withDay &&
        html`<label class="field" style=${{ width: '110px', marginTop: 0 }}>
          <span>Jour (option)</span>
          <input class="input num" inputmode="numeric" placeholder="ex : 5" value=${day} maxlength="2" onInput=${(e) => setDay(e.target.value.replace(/\D/g, ''))} />
        </label>`}
        ${withDate &&
        html`<label class="field" style=${{ width: '160px', marginTop: 0 }}>
          <span>Date</span>
          <input class="input" type="date" value=${date} required onInput=${(e) => setDate(e.target.value)} />
        </label>`}
      </div>
      ${payers &&
      html`<div class="field" style=${{ marginTop: '16px' }}>
        <span>${income ? 'Reçue sur' : 'Payée par'}</span>
        <${Segmented} options=${payers} value=${paidBy} onChange=${setPaidBy} />
        ${paidBy !== 'joint' &&
        html`<p class="small muted" style=${{ margin: '8px 0 0' }}>
          ${income
            ? "Reçue sur son compte perso : elle compte quand même pour les deux, et sa part sur le compte commun augmente d'autant pour la reverser."
            : "Payée depuis son compte perso : elle reste partagée, et sa part sur le compte commun baisse d'autant (l'autre met un peu plus)."}
        </p>`}
      </div>`}
      ${!income &&
      html`<div class="field" style=${{ marginTop: '16px' }}>
        <span>Catégorie</span>
        <${CategoryPicker} value=${category} onChange=${setCategory} />
      </div>`}
      ${hint && html`<p class="small muted">${hint}</p>`}
      ${(error || remove.error) && html`<div class="error-msg">${error || remove.error}</div>`}
      <div class="btn-row">
        <button class="btn" disabled=${busy || !label.trim() || !amountOk}>${submitLabel}</button>
      </div>
      ${onDelete &&
      html`<div class="btn-row">
        <button type="button" class="btn danger" disabled=${remove.busy} onClick=${() => confirm('Supprimer ?') && remove.run()}>Supprimer</button>
      </div>`}
    </form>
  </${Sheet}>`;
}
