import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'compte-commun.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  name_key      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  color         TEXT NOT NULL,
  income_cents  INTEGER NOT NULL DEFAULT 0,
  custom_pct_bp INTEGER NOT NULL DEFAULT 5000,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  code       TEXT PRIMARY KEY,
  created_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Modèle des charges récurrentes payées par le compte commun
CREATE TABLE IF NOT EXISTS charges (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  label        TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  category     TEXT NOT NULL DEFAULT 'autre',
  day          INTEGER,
  sort         INTEGER NOT NULL DEFAULT 0
);

-- Un mois "ouvert" : photo des charges et de la répartition au moment de sa création
CREATE TABLE IF NOT EXISTS months (
  ym         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS month_charges (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ym           TEXT NOT NULL REFERENCES months(ym) ON DELETE CASCADE,
  charge_id    INTEGER REFERENCES charges(id) ON DELETE SET NULL,
  label        TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  category     TEXT NOT NULL DEFAULT 'autre',
  day          INTEGER,
  paid         INTEGER NOT NULL DEFAULT 0,
  one_off      INTEGER NOT NULL DEFAULT 0,
  sort         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_month_charges_ym ON month_charges(ym);

CREATE TABLE IF NOT EXISTS month_shares (
  ym      TEXT NOT NULL REFERENCES months(ym) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pct_bp  INTEGER NOT NULL,
  PRIMARY KEY (ym, user_id)
);

CREATE TABLE IF NOT EXISTS contributions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ym           TEXT NOT NULL,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  date         TEXT NOT NULL,
  note         TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contributions_ym ON contributions(ym);

CREATE TABLE IF NOT EXISTS expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ym           TEXT NOT NULL,
  label        TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  category     TEXT NOT NULL DEFAULT 'autre',
  date         TEXT NOT NULL,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_expenses_ym ON expenses(ym);

CREATE TABLE IF NOT EXISTS push_subs (
  endpoint   TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Migrations des bases déjà créées
const contributionCols = db.prepare('PRAGMA table_info(contributions)').all().map((c) => c.name);
if (!contributionCols.includes('group_id')) {
  // Un virement « à deux » = une ligne par personne partageant le même group_id
  db.exec('ALTER TABLE contributions ADD COLUMN group_id TEXT');
}
// paid_by NULL = payée par le compte commun ; sinon payée par cette personne depuis son compte perso
for (const table of ['charges', 'month_charges']) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes('paid_by')) db.exec(`ALTER TABLE ${table} ADD COLUMN paid_by INTEGER REFERENCES users(id) ON DELETE SET NULL`);
  // kind = 'charge' (dépense) ou 'income' (aide reçue, ex : CAF). Pour une aide, paid_by = qui la reçoit.
  if (!cols.includes('kind')) db.exec(`ALTER TABLE ${table} ADD COLUMN kind TEXT NOT NULL DEFAULT 'charge'`);
}

// Passage au thème pastel : on adoucit les couleurs vives des profils existants
const LEGACY_COLORS = {
  '#5b6cf0': '#b4bcff', '#e8618c': '#ffb3d1', '#f59e0b': '#ffcf9f', '#10b981': '#9fe3c1',
  '#8b5cf6': '#d4bfff', '#0ea5e9': '#9fdcf5', '#ef4444': '#ffb0b0', '#64748b': '#f5e09a',
};
for (const [from, to] of Object.entries(LEGACY_COLORS)) db.prepare('UPDATE users SET color = ? WHERE color = ?').run(to, from);

const DEFAULT_SETTINGS = {
  household_name: 'Notre compte commun',
  split_mode: 'equal', // equal | income | custom
  carry_over: '1', // reporter les écarts d'un mois sur l'autre
  reminder_day: '5', // jour du mois à partir duquel on relance
  start_ym: '',
};

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : DEFAULT_SETTINGS[key];
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

export function getSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return {
    household_name: out.household_name,
    split_mode: out.split_mode,
    carry_over: out.carry_over === '1',
    reminder_day: Number(out.reminder_day) || 0,
    start_ym: out.start_ym,
  };
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
