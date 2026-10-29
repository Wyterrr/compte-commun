// [clé, emoji, libellé, couleur pastel de la tuile]
export const CATEGORIES = [
  ['logement', '🏠', 'Logement', '#ffd6a5'],
  ['energie', '⚡', 'Énergie', '#fff0a0'],
  ['telecom', '📶', 'Internet & mobile', '#a9c8ff'],
  ['assurance', '🛡️', 'Assurances', '#c9bfff'],
  ['courses', '🛒', 'Courses', '#c4f2bd'],
  ['transport', '🚗', 'Transport', '#a6eef5'],
  ['abonnements', '📺', 'Abonnements', '#ffc8f0'],
  ['epargne', '🐷', 'Épargne', '#ffc0c0'],
  ['loisirs', '🎉', 'Loisirs', '#ffd3e0'],
  ['sante', '💊', 'Santé', '#bfead9'],
  ['animaux', '🐾', 'Animaux', '#e8d3c6'],
  ['enfants', '🧸', 'Enfants', '#ffe2a8'],
  ['aides', '💶', 'Aides & CAF', '#c8f0dc'],
  ['autre', '📦', 'Autre', '#e3e0ec'],
];
const CAT_MAP = new Map(CATEGORIES.map(([k, e, l, c]) => [k, { emoji: e, label: l, color: c }]));
const cat = (k) => CAT_MAP.get(k) || CAT_MAP.get('autre');
export const catEmoji = (k) => cat(k).emoji;
export const catLabel = (k) => cat(k).label;
/** Style à poser sur une tuile .emoji pour la teinter selon la catégorie. */
export const catTile = (k) => ({ '--tile': cat(k).color });

export const USER_COLORS = ['#b4bcff', '#ffb3d1', '#ffcf9f', '#9fe3c1', '#d4bfff', '#9fdcf5', '#ffb0b0', '#f5e09a'];

// Anciennes couleurs vives -> équivalent pastel (profils créés avant le nouveau design)
const LEGACY_COLORS = {
  '#5b6cf0': '#b4bcff', '#e8618c': '#ffb3d1', '#f59e0b': '#ffcf9f', '#10b981': '#9fe3c1',
  '#8b5cf6': '#d4bfff', '#0ea5e9': '#9fdcf5', '#ef4444': '#ffb0b0', '#64748b': '#f5e09a',
};
export const userColor = (c) => LEGACY_COLORS[c] || c || '#e3e0ec';

const fmtInt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fmtDec = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });

/** 125000 -> "1 250 €", 12550 -> "125,50 €" */
export function eur(cents) {
  const v = cents / 100;
  return cents % 100 === 0 ? fmtInt.format(v) : fmtDec.format(v);
}

/** "1 250,5" -> 125050 ; null si invalide */
export function parseMoney(str) {
  if (str == null) return null;
  const s = String(str).replace(/[\s  €]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}

/** 125050 -> "1250,50" pour pré-remplir un champ */
export function centsToInput(cents) {
  if (!cents) return '';
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace('.', ',');
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export function monthLabel(ym, withYear = true) {
  const [y, m] = ym.split('-').map(Number);
  return withYear ? `${MONTHS[m - 1]} ${y}` : MONTHS[m - 1];
}
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Date par défaut d'une saisie : aujourd'hui si on est dans le mois, sinon le 1er du mois affiché. */
export function defaultDateFor(ym) {
  const t = today();
  return t.startsWith(ym) ? t : `${ym}-01`;
}

const SHORT_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export function shortDate(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${SHORT_MONTHS[m - 1]}`;
}

export const pct = (bp) => `${Math.round(bp / 100)} %`;
export const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/** Options « Payée par » : le compte commun ou une des personnes (null si on est seul). */
export function payerOptions(users, me) {
  if (users.length < 2) return null;
  return [['joint', 'Commun'], ...users.map((x) => [x.id, x.id === me.id ? 'Moi' : x.name])];
}
