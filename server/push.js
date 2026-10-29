import webpush from 'web-push';
import { db, getSetting, setSetting } from './db.js';

let publicKey = getSetting('vapid_public');
let privateKey = getSetting('vapid_private');
if (!publicKey || !privateKey) {
  const keys = webpush.generateVAPIDKeys();
  publicKey = keys.publicKey;
  privateKey = keys.privateKey;
  setSetting('vapid_public', publicKey);
  setSetting('vapid_private', privateKey);
}

// Apple refuse les sujets en "localhost" : mettre une vraie adresse via VAPID_SUBJECT.
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:compte-commun@example.com', publicKey, privateKey);

export const vapidPublicKey = publicKey;

export function saveSubscription(userId, sub) {
  db.prepare(
    `INSERT INTO push_subs (endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
  ).run(sub.endpoint, userId, sub.keys.p256dh, sub.keys.auth);
}

export function removeSubscription(endpoint) {
  db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);
}

export async function sendToUser(userId, payload) {
  const subs = db.prepare('SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id = ?').all(userId);
  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          TTL: 24 * 3600,
        });
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) removeSubscription(s.endpoint);
        else console.warn('[push] échec', err.statusCode || '', err.body || err.message);
      }
    })
  );
  return subs.length;
}

export function sendToUsers(userIds, payload) {
  return Promise.all(userIds.map((id) => sendToUser(id, payload)));
}
