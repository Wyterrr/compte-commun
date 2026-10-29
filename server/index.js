import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getSettings, setSetting, tx } from './db.js';
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  loadUser,
  requireUser,
  loginRateLimit,
  purgeExpired,
} from './auth.js';
import {
  isValidYm,
  currentYm,
  addMonths,
  monthLabel,
  formatEuros,
  listUsers,
  ensureMonth,
  applySplitToOpenMonths,
  syncChargeCreated,
  syncChargeUpdated,
  syncChargeDeleted,
  computeLedger,
  getMonthSummary,
} from './logic.js';
import { vapidPublicKey, saveSubscription, removeSubscription, sendToUser, sendToUsers } from './push.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;
const USER_COLORS = ['#b4bcff', '#ffb3d1', '#ffcf9f', '#9fe3c1'];
const CATEGORIES = new Set([
  'logement', 'energie', 'telecom', 'assurance', 'courses', 'transport',
  'abonnements', 'epargne', 'loisirs', 'sante', 'animaux', 'enfants', 'aides', 'autre',
]);

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');
app.disable('x-powered-by');

app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'",
  });
  next();
});

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);

function str(v, { max = 120, min = 1, field = 'Champ' } = {}) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min) throw bad(`${field} manquant`);
  if (s.length > max) throw bad(`${field} trop long`);
  return s;
}
function optStr(v, max = 200) {
  if (v == null || v === '') return null;
  return str(v, { max, min: 0 });
}
function cents(v, { allowZero = false, field = 'Montant' } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100_000_000 || (!allowZero && n === 0)) throw bad(`${field} invalide`);
  return n;
}
function category(v) {
  return CATEGORIES.has(v) ? v : 'autre';
}
function dateStr(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad('Date invalide');
  return v;
}
function optDay(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 31) throw bad('Jour invalide');
  return n;
}
/** null = payée par le compte commun ; sinon l'id de la personne qui la paie de son côté. */
function payer(v) {
  if (v == null || v === '') return null;
  const id = Number(v);
  if (!Number.isInteger(id) || !userExists(id)) throw bad('Personne inconnue');
  return id;
}
const kind = (v) => (v === 'income' ? 'income' : 'charge');
function color(v, fallback) {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback;
}
function password(v) {
  if (typeof v !== 'string' || v.length < 6) throw bad('Mot de passe : 6 caractères minimum');
  if (v.length > 200) throw bad('Mot de passe trop long');
  return v;
}
function localDate(d = new Date()) {
  return `${currentYm(d)}-${String(d.getDate()).padStart(2, '0')}`;
}
function monthParam(req) {
  const { ym } = req.params;
  if (!isValidYm(ym) || !ensureMonth(ym)) throw new HttpError(404, 'Mois indisponible');
  return ym;
}
function userExists(id) {
  return !!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id);
}
function nameTaken(name, exceptId = 0) {
  return !!db.prepare('SELECT 1 FROM users WHERE name_key = ? AND id != ?').get(name.toLowerCase(), exceptId);
}
const route = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res);
    if (out && typeof out.then === 'function') out.catch(next);
  } catch (err) {
    next(err);
  }
};
// On ne veut pas bloquer la réponse HTTP sur l'envoi des notifications.
const fireAndForget = (p) => p.catch((err) => console.warn('[push]', err.message));

// ---------- API ----------

const api = express.Router();
api.use(express.json({ limit: '50kb' }));
api.use(loadUser);

// Protection CSRF : toute écriture doit être un appel JSON (impossible depuis un simple formulaire tiers).
api.use((req, _res, next) => {
  if (req.method !== 'GET' && !(req.headers['content-type'] || '').startsWith('application/json')) {
    return next(new HttpError(415, 'JSON attendu'));
  }
  next();
});

api.get('/state', (req, res) => {
  const hasUsers = !!db.prepare('SELECT 1 FROM users LIMIT 1').get();
  res.json({ setup: hasUsers, user: req.user ? { id: req.user.id, name: req.user.name } : null });
});

api.post(
  '/setup',
  loginRateLimit,
  route((req, res) => {
    if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) throw new HttpError(409, 'Déjà configuré');
    const household = str(req.body.household || 'Notre compte commun', { max: 60, field: 'Nom' });
    const name = str(req.body.name, { max: 30, field: 'Prénom' });
    const pwd = password(req.body.password);
    const userId = tx(() => {
      setSetting('household_name', household);
      setSetting('start_ym', currentYm());
      const r = db
        .prepare('INSERT INTO users (name, name_key, password_hash, color) VALUES (?, ?, ?, ?)')
        .run(name, name.toLowerCase(), hashPassword(pwd), USER_COLORS[0]);
      ensureMonth(currentYm());
      return Number(r.lastInsertRowid);
    });
    createSession(res, req, userId);
    res.json({ ok: true });
  })
);

api.post(
  '/login',
  loginRateLimit,
  route((req, res) => {
    const name = str(req.body.name, { max: 30, field: 'Prénom' });
    const user = db.prepare('SELECT id, password_hash FROM users WHERE name_key = ?').get(name.toLowerCase());
    if (!user || !verifyPassword(String(req.body.password || ''), user.password_hash)) {
      throw new HttpError(401, 'Prénom ou mot de passe incorrect');
    }
    createSession(res, req, user.id);
    res.json({ ok: true });
  })
);

api.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

api.get('/invite/:code', (req, res) => {
  const inv = db.prepare('SELECT 1 FROM invites WHERE code = ? AND expires_at > ?').get(req.params.code, Date.now());
  res.json({ valid: !!inv, household: inv ? getSettings().household_name : null });
});

api.post(
  '/join',
  loginRateLimit,
  route((req, res) => {
    const code = String(req.body.code || '');
    const inv = db.prepare('SELECT 1 FROM invites WHERE code = ? AND expires_at > ?').get(code, Date.now());
    if (!inv) throw new HttpError(410, 'Invitation expirée ou invalide');
    const name = str(req.body.name, { max: 30, field: 'Prénom' });
    if (nameTaken(name)) throw bad('Ce prénom est déjà utilisé');
    const pwd = password(req.body.password);
    const userId = tx(() => {
      const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
      const r = db
        .prepare('INSERT INTO users (name, name_key, password_hash, color) VALUES (?, ?, ?, ?)')
        .run(name, name.toLowerCase(), hashPassword(pwd), USER_COLORS[count % USER_COLORS.length]);
      db.prepare('DELETE FROM invites WHERE code = ?').run(code);
      // La nouvelle personne prend sa part à partir du mois en cours.
      ensureMonth(currentYm());
      applySplitToOpenMonths();
      return Number(r.lastInsertRowid);
    });
    createSession(res, req, userId);
    const others = listUsers().filter((u) => u.id !== userId).map((u) => u.id);
    fireAndForget(sendToUsers(others, { title: 'Compte commun', body: `${name} a rejoint le compte commun 🎉`, url: '/' }));
    res.json({ ok: true });
  })
);

// --- tout ce qui suit nécessite d'être connecté ---
api.use(requireUser);

api.get('/bootstrap', (req, res) => {
  const cur = currentYm();
  ensureMonth(cur);
  res.json({
    me: req.user,
    users: listUsers(),
    settings: getSettings(),
    charges: db.prepare('SELECT id, label, amount_cents, category, day, sort, paid_by, kind FROM charges ORDER BY sort, id').all(),
    current_ym: cur,
    max_ym: addMonths(cur, 1),
    vapid_public_key: vapidPublicKey,
  });
});

api.get(
  '/months/:ym',
  route((req, res) => {
    res.json(getMonthSummary(monthParam(req)));
  })
);

api.get('/history', (_req, res) => {
  const cur = currentYm();
  ensureMonth(cur);
  // Les mois futurs n'apparaissent que s'il s'y passe déjà quelque chose (virement anticipé, dépense…)
  const active = new Set(
    db
      .prepare('SELECT ym FROM contributions WHERE ym > ? UNION SELECT ym FROM expenses WHERE ym > ?')
      .all(cur, cur)
      .map((r) => r.ym)
  );
  const ledger = computeLedger(addMonths(cur, 12)).filter((m) => m.ym <= cur || active.has(m.ym));

  // Nombre de virements par mois (un virement à deux compte pour un)
  const counts = new Map(
    db
      .prepare(
        `SELECT ym, COUNT(DISTINCT COALESCE(group_id, 'c' || id)) AS n, COUNT(DISTINCT group_id) AS n_joint
         FROM contributions GROUP BY ym`
      )
      .all()
      .map((r) => [r.ym, r])
  );
  for (const m of ledger) {
    const c = counts.get(m.ym);
    m.transfers = c?.n || 0;
    m.joint_transfers = c?.n_joint || 0;
  }

  const users = listUsers();
  const totals = users.map((u) => {
    const t = { user_id: u.id, name: u.name, color: u.color, share: 0, paid_personally: 0, received_personally: 0, due: 0, paid: 0, balance: 0 };
    for (const m of ledger) {
      const mm = m.members.find((x) => x.user_id === u.id);
      if (!mm) continue;
      t.share += mm.share;
      t.paid_personally += mm.paid_personally;
      t.received_personally += mm.received_personally;
      t.due += mm.due;
      t.paid += mm.paid;
      // Écart : mois passés en entier ; pour le mois en cours (et après), seulement l'avance déjà versée.
      const diff = mm.paid - mm.due;
      t.balance += m.ym < cur ? diff : Math.max(0, diff);
    }
    return t;
  });

  const summary = {
    months: ledger.filter((m) => m.status !== 'empty').length,
    complete: ledger.filter((m) => m.status === 'complete').length,
    received: ledger.reduce((a, m) => a + m.received, 0),
    charges: ledger.reduce((a, m) => a + m.total, 0),
    personal: ledger.reduce((a, m) => a + m.personal_total, 0),
    aids: ledger.reduce((a, m) => a + m.aid_total, 0),
    expenses: ledger.reduce((a, m) => a + m.expenses_total, 0),
  };
  res.json({ months: ledger.reverse(), totals, summary, current_ym: cur });
});

// Versements sur le compte commun
api.post(
  '/months/:ym/contributions',
  route((req, res) => {
    const ym = monthParam(req);
    const date = req.body.date ? dateStr(req.body.date) : localDate();
    const note = optStr(req.body.note, 140);

    // Soit un virement d'une personne (user_id + amount_cents),
    // soit un virement « à deux » (parts: [{ user_id, amount_cents }]) compté dans la part de chacun.
    let parts;
    if (Array.isArray(req.body.parts)) {
      parts = req.body.parts
        .map((p) => ({ user_id: Number(p.user_id), amount: cents(p.amount_cents, { allowZero: true }) }))
        .filter((p) => p.amount > 0);
      if (!parts.length) throw bad('Montant invalide');
      if (new Set(parts.map((p) => p.user_id)).size !== parts.length) throw bad('Personne en double');
    } else {
      parts = [{ user_id: Number(req.body.user_id || req.user.id), amount: cents(req.body.amount_cents) }];
    }
    if (!parts.every((p) => userExists(p.user_id))) throw bad('Personne inconnue');
    const groupId = parts.length > 1 ? crypto.randomBytes(8).toString('hex') : null;

    const before = getMonthSummary(ym).status;
    tx(() => {
      const ins = db.prepare(
        'INSERT INTO contributions (ym, user_id, amount_cents, date, note, created_by, group_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      for (const p of parts) ins.run(ym, p.user_id, p.amount, date, note, req.user.id, groupId);
    });
    const summary = getMonthSummary(ym);
    res.json(summary);

    const users = listUsers();
    const nameOf = (id) => users.find((u) => u.id === id)?.name;
    const total = parts.reduce((a, p) => a + p.amount, 0);
    const others = users.filter((u) => u.id !== req.user.id).map((u) => u.id);
    fireAndForget(
      sendToUsers(others, {
        title: groupId
          ? `💸 Virement à deux de ${formatEuros(total)}`
          : `💸 ${nameOf(parts[0].user_id)} a versé ${formatEuros(total)}`,
        body: groupId
          ? `${parts.map((p) => `${nameOf(p.user_id)} ${formatEuros(p.amount)}`).join(' · ')} — ${monthLabel(ym)}`
          : `Sur le compte commun pour ${monthLabel(ym)}`,
        url: `/#/mois/${ym}`,
        tag: `contrib-${ym}`,
      })
    );
    if (before !== 'complete' && summary.status === 'complete') {
      fireAndForget(
        sendToUsers(listUsers().map((u) => u.id), {
          title: `✅ ${monthLabel(ym)} est bouclé !`,
          body: 'Chacun a mis sa part sur le compte commun. Bravo à vous deux 🎉',
          url: `/#/mois/${ym}`,
          tag: `complete-${ym}`,
        })
      );
    }
  })
);

api.delete(
  '/contributions/:id',
  route((req, res) => {
    const row = db.prepare('SELECT ym, group_id FROM contributions WHERE id = ?').get(Number(req.params.id));
    if (!row) throw new HttpError(404, 'Introuvable');
    // Supprimer un virement à deux retire les deux parts.
    if (row.group_id) db.prepare('DELETE FROM contributions WHERE group_id = ?').run(row.group_id);
    else db.prepare('DELETE FROM contributions WHERE id = ?').run(Number(req.params.id));
    res.json(getMonthSummary(row.ym));
  })
);

// Charges d'un mois précis (cochage "prélevé", charge exceptionnelle, ajustement du montant)
api.post(
  '/months/:ym/charges',
  route((req, res) => {
    const ym = monthParam(req);
    db.prepare(
      'INSERT INTO month_charges (ym, label, amount_cents, category, day, one_off, sort, paid_by, kind) VALUES (?, ?, ?, ?, ?, 1, 999, ?, ?)'
    ).run(ym, str(req.body.label, { max: 60, field: 'Libellé' }), cents(req.body.amount_cents), category(req.body.category), optDay(req.body.day), payer(req.body.paid_by), kind(req.body.kind));
    res.json(getMonthSummary(ym));
  })
);

api.patch(
  '/month-charges/:id',
  route((req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM month_charges WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'Introuvable');
    const b = req.body;
    db.prepare('UPDATE month_charges SET label = ?, amount_cents = ?, category = ?, day = ?, paid = ?, paid_by = ? WHERE id = ?').run(
      b.label !== undefined ? str(b.label, { max: 60, field: 'Libellé' }) : row.label,
      b.amount_cents !== undefined ? cents(b.amount_cents, { allowZero: true }) : row.amount_cents,
      b.category !== undefined ? category(b.category) : row.category,
      b.day !== undefined ? optDay(b.day) : row.day,
      b.paid !== undefined ? (b.paid ? 1 : 0) : row.paid,
      b.paid_by !== undefined ? payer(b.paid_by) : row.paid_by,
      id
    );
    res.json(getMonthSummary(row.ym));
  })
);

api.delete(
  '/month-charges/:id',
  route((req, res) => {
    const row = db.prepare('SELECT ym FROM month_charges WHERE id = ?').get(Number(req.params.id));
    if (!row) throw new HttpError(404, 'Introuvable');
    db.prepare('DELETE FROM month_charges WHERE id = ?').run(Number(req.params.id));
    res.json(getMonthSummary(row.ym));
  })
);

// Dépenses ponctuelles payées avec le compte commun
api.post(
  '/months/:ym/expenses',
  route((req, res) => {
    const ym = monthParam(req);
    db.prepare('INSERT INTO expenses (ym, label, amount_cents, category, date, user_id) VALUES (?, ?, ?, ?, ?, ?)').run(
      ym,
      str(req.body.label, { max: 60, field: 'Libellé' }),
      cents(req.body.amount_cents),
      category(req.body.category),
      req.body.date ? dateStr(req.body.date) : localDate(),
      req.user.id
    );
    res.json(getMonthSummary(ym));
  })
);

api.delete(
  '/expenses/:id',
  route((req, res) => {
    const row = db.prepare('SELECT ym FROM expenses WHERE id = ?').get(Number(req.params.id));
    if (!row) throw new HttpError(404, 'Introuvable');
    db.prepare('DELETE FROM expenses WHERE id = ?').run(Number(req.params.id));
    res.json(getMonthSummary(row.ym));
  })
);

// Modèle des charges récurrentes
const listCharges = () => db.prepare('SELECT id, label, amount_cents, category, day, sort, paid_by, kind FROM charges ORDER BY sort, id').all();

api.post(
  '/charges',
  route((req, res) => {
    tx(() => {
      const sort = (db.prepare('SELECT MAX(sort) AS m FROM charges').get().m ?? 0) + 1;
      const label = str(req.body.label, { max: 60, field: 'Libellé' });
      const amount = cents(req.body.amount_cents);
      const cat = category(req.body.category);
      const day = optDay(req.body.day);
      const paidBy = payer(req.body.paid_by);
      const k = kind(req.body.kind);
      const r = db
        .prepare('INSERT INTO charges (label, amount_cents, category, day, sort, paid_by, kind) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(label, amount, cat, day, sort, paidBy, k);
      ensureMonth(currentYm());
      syncChargeCreated({ id: Number(r.lastInsertRowid), label, amount_cents: amount, category: cat, day, sort, paid_by: paidBy, kind: k });
    });
    res.json(listCharges());
  })
);

api.patch(
  '/charges/:id',
  route((req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM charges WHERE id = ?').get(id);
    if (!row) throw new HttpError(404, 'Introuvable');
    const b = req.body;
    const next = {
      id,
      label: b.label !== undefined ? str(b.label, { max: 60, field: 'Libellé' }) : row.label,
      amount_cents: b.amount_cents !== undefined ? cents(b.amount_cents) : row.amount_cents,
      category: b.category !== undefined ? category(b.category) : row.category,
      day: b.day !== undefined ? optDay(b.day) : row.day,
      sort: row.sort,
      paid_by: b.paid_by !== undefined ? payer(b.paid_by) : row.paid_by,
    };
    tx(() => {
      db.prepare('UPDATE charges SET label = ?, amount_cents = ?, category = ?, day = ?, paid_by = ? WHERE id = ?').run(
        next.label, next.amount_cents, next.category, next.day, next.paid_by, id
      );
      syncChargeUpdated(next);
    });
    res.json(listCharges());
  })
);

api.delete(
  '/charges/:id',
  route((req, res) => {
    const id = Number(req.params.id);
    tx(() => {
      syncChargeDeleted(id);
      db.prepare('DELETE FROM charges WHERE id = ?').run(id);
    });
    res.json(listCharges());
  })
);

// Réglages du foyer + répartition
api.put(
  '/settings',
  route((req, res) => {
    const b = req.body;
    tx(() => {
      if (b.household_name !== undefined) setSetting('household_name', str(b.household_name, { max: 60, field: 'Nom' }));
      if (b.carry_over !== undefined) setSetting('carry_over', b.carry_over ? '1' : '0');
      if (b.reminder_day !== undefined) {
        const d = Number(b.reminder_day);
        if (!Number.isInteger(d) || d < 0 || d > 28) throw bad('Jour de rappel invalide');
        setSetting('reminder_day', d);
      }
      let splitChanged = false;
      if (b.split_mode !== undefined) {
        if (!['equal', 'income', 'custom'].includes(b.split_mode)) throw bad('Mode de répartition invalide');
        setSetting('split_mode', b.split_mode);
        splitChanged = true;
      }
      if (b.incomes && typeof b.incomes === 'object') {
        for (const [id, v] of Object.entries(b.incomes)) {
          db.prepare('UPDATE users SET income_cents = ? WHERE id = ?').run(cents(v, { allowZero: true, field: 'Revenu' }), Number(id));
        }
        splitChanged = true;
      }
      if (b.custom_pct && typeof b.custom_pct === 'object') {
        for (const [id, v] of Object.entries(b.custom_pct)) {
          const bp = Number(v);
          if (!Number.isInteger(bp) || bp < 0 || bp > 10000) throw bad('Pourcentage invalide');
          db.prepare('UPDATE users SET custom_pct_bp = ? WHERE id = ?').run(bp, Number(id));
        }
        splitChanged = true;
      }
      if (splitChanged) {
        ensureMonth(currentYm());
        applySplitToOpenMonths();
      }
    });
    res.json({ settings: getSettings(), users: listUsers() });
  })
);

api.patch(
  '/me',
  route((req, res) => {
    const b = req.body;
    const updates = {};
    if (b.name !== undefined) {
      const name = str(b.name, { max: 30, field: 'Prénom' });
      if (nameTaken(name, req.user.id)) throw bad('Ce prénom est déjà utilisé');
      updates.name = name;
    }
    if (b.color !== undefined) updates.color = color(b.color, req.user.color);
    if (b.new_password !== undefined) {
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
      if (!verifyPassword(String(b.current_password || ''), row.password_hash)) throw bad('Mot de passe actuel incorrect');
      updates.password_hash = hashPassword(password(b.new_password));
    }
    if (updates.name) db.prepare('UPDATE users SET name = ?, name_key = ? WHERE id = ?').run(updates.name, updates.name.toLowerCase(), req.user.id);
    if (updates.color) db.prepare('UPDATE users SET color = ? WHERE id = ?').run(updates.color, req.user.id);
    if (updates.password_hash) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(updates.password_hash, req.user.id);
    res.json({ users: listUsers() });
  })
);

api.post('/invites', (req, res) => {
  const code = crypto.randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO invites (code, created_by, expires_at) VALUES (?, ?, ?)').run(code, req.user.id, Date.now() + 7 * 24 * 3600 * 1000);
  res.json({ code });
});

// Notifications
api.post(
  '/push/subscribe',
  route((req, res) => {
    const sub = req.body.subscription;
    if (!sub || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://') || !sub.keys?.p256dh || !sub.keys?.auth) {
      throw bad('Abonnement invalide');
    }
    saveSubscription(req.user.id, sub);
    res.json({ ok: true });
  })
);

api.post('/push/unsubscribe', (req, res) => {
  if (typeof req.body.endpoint === 'string') removeSubscription(req.body.endpoint);
  res.json({ ok: true });
});

api.post(
  '/push/test',
  route(async (req, res) => {
    const n = await sendToUser(req.user.id, { title: 'Compte commun', body: 'Les notifications fonctionnent 👌', url: '/' });
    res.json({ sent: n });
  })
);

api.post(
  '/nudge',
  route(async (req, res) => {
    const ym = currentYm();
    ensureMonth(ym);
    const summary = getMonthSummary(ym);
    const targets = summary.members.filter((m) => m.user_id !== req.user.id && m.remaining > 0);
    if (!targets.length) throw bad('Rien à rappeler : tout le monde est à jour 👍');
    let sent = 0;
    for (const m of targets) {
      sent += await sendToUser(m.user_id, {
        title: `👋 Petit rappel de ${req.user.name}`,
        body: `Il te reste ${formatEuros(m.remaining)} à verser sur le compte commun pour ${monthLabel(ym)}.`,
        url: '/',
        tag: `nudge-${ym}`,
      });
    }
    res.json({ sent });
  })
);

api.use((_req, _res, next) => next(new HttpError(404, 'Introuvable')));

app.use('/api', api);

// ---------- fichiers statiques ----------

app.get('/vendor/preact-htm.js', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.join(ROOT, 'node_modules/htm/preact/standalone.module.js'));
});
// Police Plus Jakarta Sans servie localement (pas d'appel à Google Fonts)
app.use(
  '/vendor/font',
  express.static(path.join(ROOT, 'node_modules/@fontsource-variable/plus-jakarta-sans'), { maxAge: '30d' })
);
app.use(
  express.static(path.join(ROOT, 'public'), {
    setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
  })
);

app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Erreur serveur' : err.message });
});

// ---------- rappels automatiques ----------

// À partir du jour de rappel, un rappel tous les 3 jours (vers 9h) tant que la part n'est pas versée.
async function reminderTick() {
  try {
    const now = new Date();
    const settings = getSettings();
    const rd = settings.reminder_day;
    if (!rd || now.getHours() < 9) return;
    const day = now.getDate();
    if (day < rd || (day - rd) % 3 !== 0) return;
    const today = localDate(now);
    const last = db.prepare("SELECT value FROM settings WHERE key = 'reminder_last'").get();
    if (last?.value === today) return;
    setSetting('reminder_last', today);

    const ym = currentYm(now);
    if (!ensureMonth(ym)) return;
    const summary = getMonthSummary(ym);
    if (summary.status !== 'pending') return;
    for (const m of summary.members) {
      if (m.remaining > 0) {
        await sendToUser(m.user_id, {
          title: '⏰ Virement du compte commun',
          body: `Il te reste ${formatEuros(m.remaining)} à verser pour ${monthLabel(ym)}.`,
          url: '/',
          tag: `reminder-${ym}`,
        });
      }
    }
  } catch (err) {
    console.error('[rappel]', err);
  }
}

purgeExpired();
setInterval(purgeExpired, 24 * 3600 * 1000).unref();
setInterval(reminderTick, 30 * 60 * 1000).unref();
setTimeout(reminderTick, 10_000).unref();

app.listen(PORT, () => {
  console.log(`Compte commun prêt sur http://localhost:${PORT}`);
});
