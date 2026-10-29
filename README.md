# Compte commun 💜

Petite app mobile (PWA) pour gérer le compte commun du couple : on liste ce que le compte paie chaque mois, l'app calcule la part de chacun, et on enregistre ses virements. Quand chacun a mis sa part, le mois est **bouclé** ✅.

👉 **Installation sur le VPS : voir [INSTALL.md](INSTALL.md).**

## Ce que fait l'app

- **Charges récurrentes** : loyer, électricité, courses, assurances… Une charge peut aussi être **payée par l'un de vous depuis son compte perso** (la box par exemple). Elle reste partagée : la part de cette personne sur le compte commun baisse d'autant.
- **Aides (CAF…)** : elles comptent pour les deux et font baisser la part de chacun, qu'elles arrivent sur le compte commun ou sur le compte de l'un de vous.
- **Répartition** : 50/50, au prorata des revenus, ou pourcentages perso.
- **Ce mois** : progression, reste à verser pour chacun, « J'ai fait mon virement » ou **virement à deux**. Confettis quand le mois est bouclé 🎉.
- **Report des écarts** (optionnel) : une avance ou un manque est reporté sur le mois suivant.
- **Budget** : le budget du mois, couvert au fur et à mesure par les virements reçus, charge par charge. On y ajoute aussi les charges exceptionnelles et les dépenses ponctuelles.
- **Historique** : résumé, bilan de chacun depuis le début, détail de chaque mois.
- **Notifications push** : virement de l'autre, mois bouclé, rappels automatiques, bouton « Relancer » 👋.
- Chaque mois garde une **photo** de ses charges et de sa répartition : un changement s'applique au mois en cours et aux suivants, jamais au passé.
- Fonctionne **hors ligne** en lecture. Thème pastel clair et sombre.

## Lancer en local

Node 22.13+ requis (SQLite intégré à Node, aucune dépendance native).

```bash
npm install
```

```bash
npm run dev
```

Puis ouvre http://localhost:3000.

## Technique

- `server/` : Express + SQLite (`node:sqlite`), sessions par cookie httpOnly (1 an), mots de passe en scrypt, notifications Web Push (clés VAPID générées au premier lancement et stockées en base), rappels vérifiés toutes les 30 min.
- `public/` : PWA sans étape de build (Preact + htm en modules ES), police Plus Jakarta Sans servie localement, service worker « réseau d'abord, cache en secours ».
- `docker-compose.yml` : l'app + Caddy (HTTPS automatique). Les données sont dans le volume Docker `cc-data`.
- `scripts/backup.sh` : sauvegarde de la base dans `backups/`. `scripts/make-icons.js` : régénère les icônes (`npm run icons`).
- Variables d'environnement : `DOMAIN`, `VAPID_SUBJECT` (dans `.env`), et côté app `PORT` (3000), `DATA_DIR`, `TZ`, `TRUST_PROXY`.
- Après une modification du front, incrémente `VERSION` dans `public/sw.js` pour que les téléphones récupèrent la nouvelle version.
