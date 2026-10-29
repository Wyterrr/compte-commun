import { html, useState, useEffect } from '/vendor/preact-htm.js';
import { get, post } from '../api.js';
import { useSubmit } from '../ui.js';

export function AuthScreen({ mode, code, onMode, onDone }) {
  const [household, setHousehold] = useState('Notre compte commun');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState(null);

  useEffect(() => {
    if (mode === 'join' && code) get(`/invite/${encodeURIComponent(code)}`).then(setInvite).catch(() => setInvite({ valid: false }));
  }, [mode, code]);

  const { busy, error, run } = useSubmit(async () => {
    if (mode === 'setup') await post('/setup', { household, name, password });
    else if (mode === 'join') await post('/join', { code, name, password });
    else await post('/login', { name, password });
    onDone();
  });

  const titles = {
    setup: ['Bienvenue 👋', 'Créons votre compte commun. Tu pourras inviter ta moitié juste après.'],
    login: ['Compte commun', 'Connecte-toi pour voir où vous en êtes ce mois-ci.'],
    join: ['On t’attend 💌', invite?.household ? `Tu as été invité·e à rejoindre « ${invite.household} ».` : 'Rejoins le compte commun.'],
  };
  const [title, subtitle] = titles[mode] || titles.login;

  if (mode === 'join' && invite && !invite.valid) {
    return html`<div class="auth">
      <img class="auth-logo" src="/icons/icon.svg" alt="" />
      <h1>Lien expiré</h1>
      <p>Cette invitation n'est plus valable. Demande un nouveau lien depuis les réglages de l'app.</p>
      <button class="btn secondary" onClick=${() => { location.hash = '#/'; onMode('login'); }}>J'ai déjà un compte</button>
    </div>`;
  }

  return html`<form class="auth" onSubmit=${run}>
    <img class="auth-logo" src="/icons/icon.svg" alt="" />
    <h1>${title}</h1>
    <p>${subtitle}</p>
    <div class="card">
      ${mode === 'setup' &&
      html`<label class="field">
        <span>Nom du compte</span>
        <input class="input" value=${household} maxlength="60" onInput=${(e) => setHousehold(e.target.value)} />
      </label>`}
      <label class="field">
        <span>Ton prénom</span>
        <input class="input" value=${name} maxlength="30" autocomplete="username" autocapitalize="words" required onInput=${(e) => setName(e.target.value)} />
      </label>
      <label class="field">
        <span>Mot de passe</span>
        <input
          class="input"
          type="password"
          value=${password}
          minlength=${mode === 'login' ? undefined : 6}
          autocomplete=${mode === 'login' ? 'current-password' : 'new-password'}
          required
          onInput=${(e) => setPassword(e.target.value)}
        />
      </label>
      ${error && html`<div class="error-msg">${error}</div>`}
    </div>
    <div class="btn-row">
      <button class="btn" disabled=${busy}>
        ${mode === 'setup' ? 'Créer le compte commun' : mode === 'join' ? 'Rejoindre' : 'Se connecter'}
      </button>
    </div>
  </form>`;
}
