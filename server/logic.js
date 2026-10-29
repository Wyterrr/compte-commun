import { db, getSettings, getSetting } from './db.js';

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isValidYm = (ym) => typeof ym === 'string' && YM_RE.test(ym);

export function currentYm(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return currentYm(d);
}

const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export function formatEuros(cents) {
  return (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}

/** Montant envoyé par Raccourcis ("12,50 €", "€1,234.56", 12.5…) -> centimes ; null si illisible. */
export function parseAmount(v) {
  let s = String(v ?? '').replace(/[^\d.,]/g, '');
  const sep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  // Le dernier séparateur suivi d'1 ou 2 chiffres est la virgule décimale ; les autres sont des milliers.
  if (sep >= 0 && s.length - sep - 1 <= 2) s = s.slice(0, sep).replace(/[.,]/g, '') + '.' + s.slice(sep + 1);
  else s = s.replace(/[.,]/g, '');
  const n = Math.round(parseFloat(s) * 100);
  return Number.isFinite(n) && n > 0 && n <= 100_000_000 ? n : null;
}

export function listUsers() {
  return db
    .prepare('SELECT id, name, color, income_cents, custom_pct_bp FROM users ORDER BY id')
    .all();
}

/** Répartition en points de base (10000 = 100 %) selon le mode choisi. */
export function computeSplit(users, mode) {
  const n = users.length;
  if (!n) return new Map();
  let weights;
  if (mode === 'income') {
    weights = users.map((u) => Math.max(0, u.income_cents));
  } else if (mode === 'custom') {
    weights = users.map((u) => Math.max(0, u.custom_pct_bp));
  } else {
    weights = users.map(() => 1);
  }
  let sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) {
    weights = users.map(() => 1);
    sum = n;
  }
  const out = new Map();
  let acc = 0;
  users.forEach((u, i) => {
    const bp = i === n - 1 ? 10000 - acc : Math.round((weights[i] * 10000) / sum);
    acc += bp;
    out.set(u.id, bp);
  });
  return out;
}

/** Découpe un total selon les parts, le dernier absorbe l'arrondi pour que la somme tombe juste. */
export function splitAmount(total, shares) {
  const out = new Map();
  let acc = 0;
  shares.forEach((s, i) => {
    const v = i === shares.length - 1 ? total - acc : Math.round((total * s.pct_bp) / 10000);
    acc += v;
    out.set(s.user_id, v);
  });
  return out;
}

function writeShares(ym, split) {
  db.prepare('DELETE FROM month_shares WHERE ym = ?').run(ym);
  const ins = db.prepare('INSERT INTO month_shares (ym, user_id, pct_bp) VALUES (?, ?, ?)');
  for (const [userId, bp] of split) ins.run(ym, userId, bp);
}

function snapshotMonth(ym) {
  db.prepare('INSERT INTO months (ym) VALUES (?)').run(ym);
  const charges = db.prepare('SELECT * FROM charges ORDER BY sort, id').all();
  const ins = db.prepare(
    'INSERT INTO month_charges (ym, charge_id, label, amount_cents, category, day, sort, paid_by, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const c of charges) ins.run(ym, c.id, c.label, c.amount_cents, c.category, c.day, c.sort, c.paid_by, c.kind);
  writeShares(ym, computeSplit(listUsers(), getSetting('split_mode')));
}

/**
 * Garantit que le mois existe (et tous ceux entre le mois de départ et lui),
 * pour que les dus de chaque mois soient comptés même si personne n'a ouvert l'app.
 */
export function ensureMonth(ym) {
  const start = getSetting('start_ym');
  if (!start || ym < start || ym > addMonths(currentYm(), 12)) return false;
  const exists = db.prepare('SELECT 1 FROM months WHERE ym = ?');
  for (let m = start; m <= ym; m = addMonths(m, 1)) {
    if (!exists.get(m)) snapshotMonth(m);
  }
  return true;
}

/** Les changements de modèle / répartition s'appliquent au mois en cours et aux suivants, jamais au passé. */
export function openMonths() {
  return db
    .prepare('SELECT ym FROM months WHERE ym >= ? ORDER BY ym')
    .all(currentYm())
    .map((r) => r.ym);
}

export function applySplitToOpenMonths() {
  const split = computeSplit(listUsers(), getSetting('split_mode'));
  for (const ym of openMonths()) writeShares(ym, split);
}

export function syncChargeCreated(charge) {
  const ins = db.prepare(
    'INSERT INTO month_charges (ym, charge_id, label, amount_cents, category, day, sort, paid_by, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const ym of openMonths()) ins.run(ym, charge.id, charge.label, charge.amount_cents, charge.category, charge.day, charge.sort, charge.paid_by, charge.kind);
}

export function syncChargeUpdated(charge) {
  db.prepare(
    'UPDATE month_charges SET label = ?, amount_cents = ?, category = ?, day = ?, sort = ?, paid_by = ? WHERE charge_id = ? AND ym >= ?'
  ).run(charge.label, charge.amount_cents, charge.category, charge.day, charge.sort, charge.paid_by, charge.id, currentYm());
}

export function syncChargeDeleted(chargeId) {
  // Une charge déjà cochée comme prélevée ce mois-ci reste dans le mois.
  db.prepare('DELETE FROM month_charges WHERE charge_id = ? AND ym >= ? AND paid = 0').run(chargeId, currentYm());
}

/**
 * Calcule, mois par mois, ce que chacun doit, a versé, et le report éventuel.
 * Le report d'un mois = cumul (versé - dû) des mois précédents.
 *
 * Une charge peut être payée directement par une personne depuis son compte perso (ex : la box).
 * Elle reste une dépense commune : on répartit (charges du compte + charges payées perso) selon les parts,
 * puis on retire à chacun ce qu'il a déjà payé de son côté. La somme des dus = charges du compte commun.
 *
 * Les aides (ex : CAF) comptent pour les deux : elles viennent en déduction des dépenses partagées.
 * Reçue sur le compte commun, elle réduit simplement ce qu'il faut y verser ; reçue sur le compte
 * de quelqu'un, cette personne la reverse via sa part (sa part augmente du montant reçu).
 */
export function computeLedger(uptoYm) {
  const settings = getSettings();
  const users = listUsers();
  const months = db.prepare('SELECT ym FROM months WHERE ym <= ? ORDER BY ym').all(uptoYm);

  const totals = new Map(
    db
      .prepare("SELECT ym, SUM(amount_cents) AS total, COUNT(*) AS n, SUM(paid) AS n_paid FROM month_charges WHERE paid_by IS NULL AND kind = 'charge' GROUP BY ym")
      .all()
      .map((r) => [r.ym, r])
  );
  const personal = new Map();
  for (const r of db.prepare("SELECT ym, paid_by, SUM(amount_cents) AS s FROM month_charges WHERE paid_by IS NOT NULL AND kind = 'charge' GROUP BY ym, paid_by").all()) {
    if (!personal.has(r.ym)) personal.set(r.ym, new Map());
    personal.get(r.ym).set(r.paid_by, r.s);
  }
  const incomeJoint = new Map(
    db
      .prepare("SELECT ym, SUM(amount_cents) AS s FROM month_charges WHERE paid_by IS NULL AND kind = 'income' GROUP BY ym")
      .all()
      .map((r) => [r.ym, r.s])
  );
  const incomePersonal = new Map();
  for (const r of db.prepare("SELECT ym, paid_by, SUM(amount_cents) AS s FROM month_charges WHERE paid_by IS NOT NULL AND kind = 'income' GROUP BY ym, paid_by").all()) {
    if (!incomePersonal.has(r.ym)) incomePersonal.set(r.ym, new Map());
    incomePersonal.get(r.ym).set(r.paid_by, r.s);
  }
  const shares = new Map();
  for (const r of db.prepare('SELECT ym, user_id, pct_bp FROM month_shares ORDER BY ym, user_id').all()) {
    if (!shares.has(r.ym)) shares.set(r.ym, []);
    shares.get(r.ym).push(r);
  }
  const paid = new Map();
  for (const r of db.prepare('SELECT ym, user_id, SUM(amount_cents) AS s FROM contributions GROUP BY ym, user_id').all()) {
    if (!paid.has(r.ym)) paid.set(r.ym, new Map());
    paid.get(r.ym).set(r.user_id, r.s);
  }
  const expenses = new Map(
    db.prepare('SELECT ym, SUM(amount_cents) AS s FROM expenses GROUP BY ym').all().map((r) => [r.ym, r.s])
  );

  const carry = new Map();
  const out = [];
  for (const { ym } of months) {
    const t = totals.get(ym) || { total: 0, n: 0, n_paid: 0 };
    const sh = shares.get(ym) || [];
    const personalMap = personal.get(ym) || new Map();
    const personalTotal = [...personalMap.values()].reduce((a, b) => a + b, 0);
    const aidJoint = incomeJoint.get(ym) || 0;
    const aidPersonalMap = incomePersonal.get(ym) || new Map();
    const aidPersonal = [...aidPersonalMap.values()].reduce((a, b) => a + b, 0);
    const sharedTotal = t.total + personalTotal - aidJoint - aidPersonal;
    const fairShares = splitAmount(sharedTotal, sh);
    const pctOf = new Map(sh.map((s) => [s.user_id, s.pct_bp]));
    const paidMap = paid.get(ym) || new Map();

    const members = users.map((u) => {
      const share = fairShares.get(u.id) || 0;
      const paid_personally = personalMap.get(u.id) || 0;
      const received_personally = aidPersonalMap.get(u.id) || 0;
      const due = share - paid_personally + received_personally;
      const carry_in = settings.carry_over ? carry.get(u.id) || 0 : 0;
      const p = paidMap.get(u.id) || 0;
      const target = due - carry_in;
      return {
        user_id: u.id,
        name: u.name,
        color: u.color,
        pct_bp: pctOf.get(u.id) || 0,
        share,
        paid_personally,
        received_personally,
        due,
        carry_in,
        target,
        paid: p,
        remaining: target - p,
      };
    });
    for (const m of members) carry.set(m.user_id, (carry.get(m.user_id) || 0) + m.paid - m.due);

    const received = members.reduce((a, m) => a + m.paid, 0);
    const expenses_total = expenses.get(ym) || 0;
    const target_total = members.reduce((a, m) => a + Math.max(0, m.target), 0);
    let status;
    if (t.total + personalTotal === 0 && aidJoint + aidPersonal === 0 && received === 0) status = 'empty';
    else if (members.every((m) => m.remaining <= 0)) status = 'complete';
    else status = 'pending';

    out.push({
      ym,
      label: monthLabel(ym),
      status,
      total: t.total,
      personal_total: personalTotal,
      shared_total: sharedTotal,
      aid_total: aidJoint + aidPersonal,
      aid_joint: aidJoint,
      charges_count: t.n,
      charges_paid: t.n_paid || 0,
      target_total,
      received,
      expenses_total,
      available: received + aidJoint - t.total - expenses_total,
      members,
    });
  }
  return out;
}

export function getMonthSummary(ym) {
  const ledger = computeLedger(ym);
  const summary = ledger.find((m) => m.ym === ym);
  if (!summary) return null;
  summary.charges = db
    .prepare('SELECT id, charge_id, label, amount_cents, category, day, paid, one_off, paid_by, kind FROM month_charges WHERE ym = ? ORDER BY one_off, sort, day IS NULL, day, id')
    .all(ym)
    .map((c) => ({ ...c, paid: !!c.paid, one_off: !!c.one_off }));
  summary.contributions = db
    .prepare('SELECT id, user_id, amount_cents, date, note, created_by, created_at, group_id FROM contributions WHERE ym = ? ORDER BY date DESC, id DESC')
    .all(ym);
  summary.expenses = db
    .prepare('SELECT id, label, amount_cents, category, date, user_id, created_at FROM expenses WHERE ym = ? ORDER BY date DESC, id DESC')
    .all(ym);
  return summary;
}
