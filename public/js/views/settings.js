import { html, useState, useEffect } from '/vendor/preact-htm.js';
import { post, put, patch, del, pushSupported, currentPushSub, enablePush, disablePush } from '../api.js';
import { Avatar, Sheet, Segmented, Switch, MoneyInput, toast, useSubmit, useSheet } from '../ui.js';
import { eur, pct, catEmoji, catLabel, catTile, userColor, parseMoney, centsToInput, USER_COLORS, isStandalone, isIOS, payerOptions } from '../util.js';
import { ItemSheet } from './item-sheet.js';

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});

/** Même calcul que côté serveur, pour l'aperçu en direct. */
function previewSplit(users, mode, incomes, custom) {
  let w = users.map((u) => (mode === 'income' ? parseMoney(incomes[u.id]) || 0 : mode === 'custom' ? Number(custom[u.id]) || 0 : 1));
  let sum = w.reduce((a, b) => a + b, 0);
  if (!sum) {
    w = users.map(() => 1);
    sum = users.length;
  }
  let acc = 0;
  return users.map((u, i) => {
    const bp = i === users.length - 1 ? 10000 - acc : Math.round((w[i] * 10000) / sum);
    acc += bp;
    return bp;
  });
}

function ChargesSection({ ctx }) {
  const { boot } = ctx;
  const [edit, setEdit] = useState(null);
  const charges = boot.charges.filter((c) => c.kind !== 'income');
  const jointTotal = charges.filter((c) => !c.paid_by).reduce((a, c) => a + c.amount_cents, 0);
  const personalTotal = charges.filter((c) => c.paid_by).reduce((a, c) => a + c.amount_cents, 0);
  const payers = payerOptions(ctx.users, ctx.me);
  const nameOf = (id) => (id === ctx.me.id ? 'toi' : ctx.users.find((u) => u.id === id)?.name || '—');

  const after = async (charges) => {
    ctx.setBoot({ ...boot, charges });
    ctx.loadMonth(ctx.ym);
  };

  return html`
    <div class="section-title">
      Charges récurrentes
      <button class="link-btn" onClick=${() => setEdit('new')}>+ Ajouter</button>
    </div>
    <section class="card">
      ${charges.length === 0
        ? html`<div class="empty">
            Liste ici tout ce que le compte commun paie chaque mois : loyer, électricité, internet, courses, assurances…
            <div class="btn-row"><button class="btn secondary" onClick=${() => setEdit('new')}>Ajouter une première charge</button></div>
          </div>`
        : html`<ul class="list">
              ${charges.map(
                (c) => html`<li key=${c.id} class="clickable" onClick=${() => setEdit(c)}>
                  <div class="emoji" style=${catTile(c.category)}>${catEmoji(c.category)}</div>
                  <div class="grow">
                    <div class="title ellipsis">${c.label}</div>
                    <div class="sub">${c.paid_by ? `Payée par ${nameOf(c.paid_by)}` : catLabel(c.category)}${c.day ? ` · le ${c.day}` : ''}</div>
                  </div>
                  <div class="amount num">${eur(c.amount_cents)}</div>
                </li>`
              )}
            </ul>
            <div class="row between" style=${{ borderTop: '1px solid var(--line)', paddingTop: '12px', fontWeight: 700 }}>
              <span>Sur le compte commun / mois</span><span class="num">${eur(jointTotal)}</span>
            </div>
            ${personalTotal > 0 &&
            html`<div class="row between small muted" style=${{ paddingTop: '6px' }}>
              <span>+ payées perso, partagées</span><span class="num">${eur(personalTotal)}</span>
            </div>`}`}
    </section>
    <p class="small muted center">Les modifications s'appliquent au mois en cours et aux suivants, jamais aux mois passés.</p>

    ${edit === 'new' &&
    html`<${ItemSheet}
      title="Nouvelle charge récurrente"
      withDay
      payers=${payers}
      submitLabel="Ajouter"
      onSubmit=${async (v) => after(await post('/charges', v))}
      onClose=${() => setEdit(null)}
    />`}
    ${edit && edit !== 'new' &&
    html`<${ItemSheet}
      title="Charge récurrente"
      withDay
      payers=${payers}
      initial=${edit}
      onSubmit=${async (v) => after(await patch(`/charges/${edit.id}`, v))}
      onDelete=${async () => after(await del(`/charges/${edit.id}`))}
      onClose=${() => setEdit(null)}
    />`}
  `;
}

function AidsSection({ ctx }) {
  const { boot } = ctx;
  const [edit, setEdit] = useState(null);
  const aids = boot.charges.filter((c) => c.kind === 'income');
  const total = aids.reduce((a, c) => a + c.amount_cents, 0);
  const payers = payerOptions(ctx.users, ctx.me);
  const nameOf = (id) => (id === ctx.me.id ? 'toi' : ctx.users.find((u) => u.id === id)?.name || '—');

  const after = async (charges) => {
    ctx.setBoot({ ...boot, charges });
    ctx.loadMonth(ctx.ym);
  };

  return html`
    <div class="section-title">
      Aides (CAF…)
      <button class="link-btn" onClick=${() => setEdit('new')}>+ Ajouter</button>
    </div>
    <section class="card">
      ${aids.length === 0
        ? html`<div class="empty">
            La CAF (APL, prime d'activité…) ou toute autre aide reçue chaque mois. Elle compte pour les deux : la part de chacun baisse d'autant.
            <div class="btn-row"><button class="btn secondary" onClick=${() => setEdit('new')}>Ajouter une aide</button></div>
          </div>`
        : html`<ul class="list">
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
            <div class="row between" style=${{ borderTop: '1px solid var(--line)', paddingTop: '12px', fontWeight: 700 }}>
              <span>Aides / mois</span><span class="num" style=${{ color: 'var(--ok)' }}>+${eur(total)}</span>
            </div>`}
    </section>
    <p class="small muted center">Les aides sont déduites des dépenses communes avant de calculer la part de chacun.</p>

    ${edit === 'new' &&
    html`<${ItemSheet}
      title="Nouvelle aide"
      income
      withDay
      payers=${payers}
      submitLabel="Ajouter"
      onSubmit=${async (v) => after(await post('/charges', { ...v, kind: 'income' }))}
      onClose=${() => setEdit(null)}
    />`}
    ${edit && edit !== 'new' &&
    html`<${ItemSheet}
      title="Aide"
      income
      withDay
      payers=${payers}
      initial=${edit}
      onSubmit=${async (v) => after(await patch(`/charges/${edit.id}`, v))}
      onDelete=${async () => after(await del(`/charges/${edit.id}`))}
      onClose=${() => setEdit(null)}
    />`}
  `;
}

function SplitSection({ ctx }) {
  const { boot, users, settings } = ctx;
  const [mode, setMode] = useState(settings.split_mode);
  const [incomes, setIncomes] = useState(() => Object.fromEntries(users.map((u) => [u.id, centsToInput(u.income_cents)])));
  const [custom, setCustom] = useState(() => Object.fromEntries(users.map((u) => [u.id, Math.round(u.custom_pct_bp / 100)])));

  // Dépenses partagées nettes = charges (compte + perso) − aides (CAF…)
  const total = boot.charges.reduce((a, c) => a + (c.kind === 'income' ? -c.amount_cents : c.amount_cents), 0);
  const preview = previewSplit(users, mode, incomes, custom);
  const amounts = preview.map((bp) => Math.round((total * bp) / 10000));
  if (amounts.length) amounts[amounts.length - 1] = total - amounts.slice(0, -1).reduce((a, b) => a + b, 0);
  // Ce que chacun paie déjà de son côté est retiré de ce qu'il met sur le compte commun.
  const personalOf = (id) => boot.charges.filter((c) => c.paid_by === id && c.kind !== 'income').reduce((a, c) => a + c.amount_cents, 0);
  const aidOf = (id) => boot.charges.filter((c) => c.paid_by === id && c.kind === 'income').reduce((a, c) => a + c.amount_cents, 0);
  const toJoint = users.map((u, i) => amounts[i] - personalOf(u.id) + aidOf(u.id));

  const { busy, error, run } = useSubmit(async () => {
    const body = { split_mode: mode };
    if (mode === 'income') body.incomes = Object.fromEntries(users.map((u) => [u.id, parseMoney(incomes[u.id]) || 0]));
    if (mode === 'custom') body.custom_pct = Object.fromEntries(users.map((u, i) => [u.id, preview[i]]));
    const r = await put('/settings', body);
    ctx.setBoot({ ...boot, settings: r.settings, users: r.users });
    ctx.loadMonth(ctx.ym);
    toast('Répartition enregistrée ✓');
  });

  const two = users.length === 2;

  return html`
    <div class="section-title">Répartition</div>
    <section class="card">
      <${Segmented}
        options=${[['equal', '50 / 50'], ['income', 'Selon revenus'], ['custom', 'Perso']]}
        value=${mode}
        onChange=${setMode}
      />
      <p class="small muted">
        ${mode === 'equal' && 'Chacun met la même somme.'}
        ${mode === 'income' && 'Chacun participe au prorata de son revenu net mensuel (plus juste si vos salaires sont différents).'}
        ${mode === 'custom' && 'Vous choisissez librement le pourcentage de chacun.'}
      </p>

      ${mode === 'income' &&
      users.map(
        (u) => html`<label class="field" key=${u.id}>
          <span>Revenu net mensuel de ${u.name}</span>
          <${MoneyInput} value=${incomes[u.id]} onInput=${(v) => setIncomes({ ...incomes, [u.id]: v })} />
        </label>`
      )}

      ${mode === 'custom' &&
      (two
        ? html`<div class="field">
            <div class="row between small" style=${{ fontWeight: 600 }}>
              <span class="row" style=${{ gap: '6px' }}><i class="dot" style=${{ background: userColor(users[0].color) }}></i>${users[0].name} ${custom[users[0].id]} %</span>
              <span class="row" style=${{ gap: '6px' }}>${100 - custom[users[0].id]} % ${users[1].name}<i class="dot" style=${{ background: userColor(users[1].color) }}></i></span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value=${custom[users[0].id]}
              style=${{ width: '100%', accentColor: 'var(--accent)', marginTop: '10px' }}
              onInput=${(e) => {
                const v = Number(e.target.value);
                setCustom({ [users[0].id]: v, [users[1].id]: 100 - v });
              }}
            />
          </div>`
        : users.map(
            (u) => html`<label class="field" key=${u.id}>
              <span>% de ${u.name}</span>
              <input class="input num" inputmode="numeric" value=${custom[u.id]} onInput=${(e) => setCustom({ ...custom, [u.id]: e.target.value.replace(/\D/g, '') })} />
            </label>`
          ))}

      <div style=${{ marginTop: '16px' }}>
        ${users.map(
          (u, i) => html`<div key=${u.id} style=${{ padding: '6px 0' }}>
            <div class="row between">
              <span class="row"><${Avatar} user=${u} small /> ${u.name}</span>
              <span class="num"><strong>${eur(toJoint[i])}</strong> <span class="muted small">/ mois · ${pct(preview[i])}</span></span>
            </div>
            ${aidOf(u.id) > 0 &&
            html`<div class="small muted num" style=${{ textAlign: 'right' }}>+ ${eur(aidOf(u.id))} d'aide reçue sur son compte, à reverser</div>`}
            ${personalOf(u.id) > 0 &&
            html`<div class="small muted num" style=${{ textAlign: 'right' }}>
              part ${eur(amounts[i])} − ${eur(personalOf(u.id))} déjà payés de son côté
            </div>`}
          </div>`
        )}
        ${boot.charges.some((c) => c.paid_by || c.kind === 'income') &&
        html`<p class="small muted" style=${{ margin: '8px 0 0' }}>Montants à mettre sur le compte commun chaque mois.</p>`}
      </div>
      ${error && html`<div class="error-msg">${error}</div>`}
      <div class="btn-row"><button class="btn" disabled=${busy} onClick=${run}>Enregistrer la répartition</button></div>
      <p class="small muted center" style=${{ marginBottom: 0 }}>S'applique à partir du mois en cours.</p>
    </section>
  `;
}

function NotificationsSection({ ctx }) {
  const { boot, settings } = ctx;
  const [sub, setSub] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const supported = pushSupported();

  useEffect(() => {
    currentPushSub().then(setSub).catch(() => setSub(null));
  }, []);

  const wrap = (fn) => async () => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const enable = wrap(async () => {
    setSub(await enablePush(boot.vapid_public_key));
    toast('Notifications activées 🔔');
  });
  const disable = wrap(async () => {
    await disablePush();
    setSub(null);
  });
  const test = wrap(async () => {
    const r = await post('/push/test');
    if (!r.sent) toast('Aucun appareil abonné', 'error');
  });
  const setReminder = async (day) => {
    try {
      const r = await put('/settings', { reminder_day: Number(day) });
      ctx.setBoot({ ...boot, settings: r.settings, users: r.users });
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return html`
    <div class="section-title">Notifications</div>
    <section class="card">
      ${!supported
        ? html`<p class="small muted" style=${{ margin: 0 }}>
            ${isIOS() && !isStandalone()
              ? 'Sur iPhone, installe d’abord l’app sur l’écran d’accueil (voir plus bas), puis ouvre-la depuis l’icône pour activer les notifications.'
              : 'Ce navigateur ne gère pas les notifications.'}
          </p>`
        : html`
            <div class="switch-row">
              <div>
                <div style=${{ fontWeight: 600 }}>Sur cet appareil</div>
                <div class="small muted">Virement de l’autre, mois bouclé, rappels</div>
              </div>
              <${Switch} on=${!!sub} label="Notifications" onChange=${(v) => !busy && (v ? enable() : disable())} />
            </div>
            ${sub && html`<div class="btn-row"><button class="btn ghost small" disabled=${busy} onClick=${test}>Envoyer une notification de test</button></div>`}
          `}
      <label class="field" style=${{ marginTop: '16px' }}>
        <span>Rappel automatique si la part n’est pas versée</span>
        <select class="input" value=${String(settings.reminder_day)} onChange=${(e) => setReminder(e.target.value)}>
          <option value="0">Jamais</option>
          ${Array.from({ length: 28 }, (_, i) => i + 1).map((d) => html`<option value=${d}>À partir du ${d} du mois</option>`)}
        </select>
      </label>
      ${settings.reminder_day > 0 && html`<p class="small muted" style=${{ marginBottom: 0 }}>Puis tous les 3 jours, vers 9 h, tant que la part n'est pas versée.</p>`}
    </section>
  `;
}

function OptionsSection({ ctx }) {
  const { boot, settings } = ctx;
  const [name, setName] = useState(settings.household_name);
  const save = async (body) => {
    try {
      const r = await put('/settings', body);
      ctx.setBoot({ ...boot, settings: r.settings, users: r.users });
      ctx.loadMonth(ctx.ym);
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  return html`
    <div class="section-title">Fonctionnement</div>
    <section class="card">
      <div class="switch-row">
        <div>
          <div style=${{ fontWeight: 600 }}>Reporter les écarts</div>
          <div class="small muted">Si quelqu’un met trop ou pas assez, la différence est reportée sur le mois suivant.</div>
        </div>
        <${Switch} on=${settings.carry_over} label="Reporter les écarts" onChange=${(v) => save({ carry_over: v })} />
      </div>
      <label class="field" style=${{ marginTop: '16px' }}>
        <span>Nom du compte</span>
        <input class="input" value=${name} maxlength="60" onInput=${(e) => setName(e.target.value)} onBlur=${() => name.trim() && name !== settings.household_name && save({ household_name: name })} />
      </label>
    </section>
  `;
}

function InviteSection({ ctx }) {
  const [link, setLink] = useState('');
  const { busy, error, run } = useSubmit(async () => {
    const { code } = await post('/invites');
    setLink(`${location.origin}/#/join/${code}`);
  });
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Compte commun', text: 'Rejoins notre compte commun 💌', url: link });
        return;
      } catch {
        /* annulé : on retombe sur la copie */
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      toast('Lien copié');
    } catch {
      toast('Copie impossible, sélectionne le lien à la main', 'error');
    }
  };
  if (ctx.users.length >= 2) return null;
  return html`
    <div class="section-title">Inviter ta moitié</div>
    <section class="card">
      <p class="small muted" style=${{ marginTop: 0 }}>Génère un lien (valable 7 jours) et envoie-le. Elle ou il choisira son prénom et son mot de passe.</p>
      ${link
        ? html`<input class="input small" readonly value=${link} onFocus=${(e) => e.target.select()} />
            <div class="btn-row"><button class="btn" onClick=${share}>Partager le lien</button></div>`
        : html`<button class="btn" disabled=${busy} onClick=${run}>Créer un lien d’invitation</button>`}
      ${error && html`<div class="error-msg">${error}</div>`}
    </section>
  `;
}

function PasswordSheet({ onClose }) {
  const { closing, close } = useSheet(onClose);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const { busy, error, run } = useSubmit(async () => {
    await patch('/me', { current_password: current, new_password: next });
    toast('Mot de passe modifié ✓');
    close();
  });
  return html`<${Sheet} title="Changer de mot de passe" onClose=${close} closing=${closing}>
    <form onSubmit=${run}>
      <label class="field"><span>Mot de passe actuel</span><input class="input" type="password" autocomplete="current-password" value=${current} onInput=${(e) => setCurrent(e.target.value)} required /></label>
      <label class="field"><span>Nouveau mot de passe</span><input class="input" type="password" autocomplete="new-password" minlength="6" value=${next} onInput=${(e) => setNext(e.target.value)} required /></label>
      ${error && html`<div class="error-msg">${error}</div>`}
      <div class="btn-row"><button class="btn" disabled=${busy}>Enregistrer</button></div>
    </form>
  </${Sheet}>`;
}

function ProfileSection({ ctx }) {
  const { boot, me } = ctx;
  const meUser = ctx.users.find((u) => u.id === me.id) || me;
  const [name, setName] = useState(meUser.name);
  const [pwd, setPwd] = useState(false);

  const save = async (body) => {
    try {
      const r = await patch('/me', body);
      const updated = r.users.find((u) => u.id === me.id);
      ctx.setBoot({ ...boot, users: r.users, me: { ...boot.me, ...updated } });
      ctx.loadMonth(ctx.ym);
    } catch (err) {
      toast(err.message, 'error');
      setName(meUser.name);
    }
  };

  return html`
    <div class="section-title">Mon profil</div>
    <section class="card">
      <div class="row">
        <${Avatar} user=${meUser} />
        <input class="input grow" value=${name} maxlength="30" aria-label="Prénom" onInput=${(e) => setName(e.target.value)} onBlur=${() => name.trim() && name !== meUser.name && save({ name })} />
      </div>
      <div class="field" style=${{ marginTop: '16px' }}>
        <span>Ma couleur</span>
        <div class="colors">
          ${USER_COLORS.map(
            (c) => html`<button type="button" class="color-dot ${meUser.color === c ? 'on' : ''}" style=${{ background: c }} aria-label=${c} onClick=${() => save({ color: c })}></button>`
          )}
        </div>
      </div>
      <div class="btn-row">
        <button class="btn ghost small" onClick=${() => setPwd(true)}>Changer le mot de passe</button>
        <button class="btn danger small" onClick=${ctx.logout}>Se déconnecter</button>
      </div>
    </section>
    ${pwd && html`<${PasswordSheet} onClose=${() => setPwd(false)} />`}
  `;
}

function InstallSection() {
  const [, force] = useState(0);
  if (isStandalone()) return null;
  const install = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    force((n) => n + 1);
  };
  return html`
    <div class="section-title">Installer l’app</div>
    <section class="card">
      ${installPrompt
        ? html`<button class="btn" onClick=${install}>Installer sur ce téléphone</button>`
        : isIOS()
          ? html`<p class="small" style=${{ margin: 0 }}>Dans Safari, touche <strong>Partager</strong> <span aria-hidden="true">⬆︎</span> puis <strong>Sur l’écran d’accueil</strong>. L’app s’ouvrira ensuite en plein écran, comme une vraie app.</p>`
          : html`<p class="small" style=${{ margin: 0 }}>Dans le menu du navigateur, choisis <strong>Installer l’application</strong> ou <strong>Ajouter à l’écran d’accueil</strong>.</p>`}
    </section>
  `;
}

export function SettingsView({ ctx }) {
  return html`
    <header class="topbar">
      <div>
        <div class="eyebrow">${ctx.settings.household_name}</div>
        <h1>Réglages</h1>
      </div>
    </header>
    <${InviteSection} ctx=${ctx} />
    <${ChargesSection} ctx=${ctx} />
    <${AidsSection} ctx=${ctx} />
    <${SplitSection} ctx=${ctx} key=${ctx.users.map((u) => u.id).join(',')} />
    <${NotificationsSection} ctx=${ctx} />
    <${OptionsSection} ctx=${ctx} />
    <${ProfileSection} ctx=${ctx} />
    <${InstallSection} />
    <p class="small muted center" style=${{ marginTop: '24px' }}>Compte commun · v1.0</p>
  `;
}
