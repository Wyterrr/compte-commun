# Installer le compte commun sur le VPS OVH

Ce guide se suit **depuis ton Mac**, qui a déjà accès au VPS. Compte environ 30 minutes.

À la fin, l'app tourne en HTTPS sur ton sous-domaine (par exemple `https://compte.mondomaine.fr`), et Laura et toi l'installez sur vos téléphones.

**Ce qu'il te faut :**

- l'**IP du VPS** et l'**utilisateur** avec lequel ton Mac s'y connecte (souvent `ubuntu`) ;
- un **nom de domaine** dont tu gères la zone DNS (chez OVH ou ailleurs) ;
- ton **adresse e-mail** (pour les notifications push) ;
- ton compte **GitHub**, puisque le code est dans ce dépôt.

Dans les commandes, remplace :

| Dans le guide | Par |
| --- | --- |
| `UTILISATEUR` | l'utilisateur du VPS, par exemple `ubuntu` |
| `IP_DU_VPS` | l'IPv4 du VPS, par exemple `51.83.42.17` |
| `compte.mondomaine.fr` | le sous-domaine choisi pour l'app |

---

## 1. Faire pointer le sous-domaine vers le VPS

À faire en premier : la propagation DNS peut prendre de quelques minutes à une heure.

Si ton domaine est chez OVH : **espace client** → **Web Cloud** → **Noms de domaine** → ton domaine → onglet **Zone DNS** → **Ajouter une entrée** → type **A** :

- **Sous-domaine** : `compte` (ou ce que tu veux) ;
- **Cible** : `IP_DU_VPS`.

Pour vérifier depuis le Mac (la réponse doit être l'IP du VPS) :

```bash
dig +short compte.mondomaine.fr
```

## 2. Se connecter au VPS

Ouvre le **Terminal** du Mac (`⌘ Espace`, puis « Terminal »), puis :

```bash
ssh UTILISATEUR@IP_DU_VPS
```

**Toutes les commandes des étapes 3 à 8 se tapent dans cette session**, donc sur le VPS.

## 3. Mettre à jour le serveur et installer Docker

```bash
sudo apt update && sudo apt upgrade -y
```

```bash
curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh
```

Autorise ton utilisateur à utiliser Docker sans `sudo` :

```bash
sudo usermod -aG docker $USER
```

**Déconnecte-toi (`exit`) puis reconnecte-toi** (`ssh UTILISATEUR@IP_DU_VPS`) pour que ce changement soit pris en compte. Vérifie ensuite :

```bash
docker run --rm hello-world
```

## 4. Vérifier que les ports web sont libres

L'app utilise les ports 80 et 443 pour le HTTPS. Si cette commande n'affiche **rien**, c'est bon :

```bash
sudo ss -tlnp | grep -E ':(80|443) '
```

Si elle affiche `nginx` ou `apache`, un site tourne déjà sur ce VPS : suis l'annexe [« Si un nginx tourne déjà »](#annexe--si-un-nginx-tourne-déjà) à l'étape 7.

## 5. Ouvrir le pare-feu

On n'ouvre que SSH, HTTP et HTTPS. **Autorise bien SSH avant d'activer le pare-feu**, sinon tu perds l'accès :

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443
```

```bash
sudo ufw enable
```

> Si le **pare-feu réseau OVH** (*Edge Network Firewall*) est activé dans l'espace client, autorise aussi les ports 80 et 443 de ce côté.

## 6. Récupérer le code depuis GitHub

Le dépôt est **privé** : le VPS a besoin de sa propre clé pour le lire. On utilise une *deploy key*, une clé qui ne donne accès qu'à ce dépôt, en lecture seule.

Crée la clé sur le VPS et affiche sa partie publique :

```bash
mkdir -p ~/.ssh && ssh-keygen -t ed25519 -N "" -C "vps-compte-commun" -f ~/.ssh/github_compte_commun && cat ~/.ssh/github_compte_commun.pub
```

Sur GitHub, ouvre le dépôt → **Settings** → **Deploy keys** → **Add deploy key** :

- **Title** : `VPS OVH` ;
- **Key** : colle la ligne affichée (elle commence par `ssh-ed25519`) ;
- laisse **Allow write access** décoché.

Puis, sur le VPS, indique à SSH d'utiliser cette clé pour GitHub et clone le dépôt :

```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/github_compte_commun\n  IdentitiesOnly yes\n' >> ~/.ssh/config && chmod 600 ~/.ssh/config
```

```bash
git clone git@github.com:TON_PSEUDO/compte-commun.git ~/compte-commun && cd ~/compte-commun
```

À la question `Are you sure you want to continue connecting`, réponds `yes`.

## 7. Configurer et lancer l'app

Crée le fichier de configuration :

```bash
cp .env.example .env && nano .env
```

Remplis les deux lignes, puis enregistre (`Ctrl O`, `Entrée`, `Ctrl X`) :

```dotenv
DOMAIN=compte.mondomaine.fr
VAPID_SUBJECT=mailto:ton.adresse@exemple.fr
```

Lance tout (la première fois, la construction prend une à deux minutes) :

```bash
docker compose up -d --build
```

Vérifie que les deux conteneurs tournent (`compte-commun` et `compte-commun-caddy`) :

```bash
docker compose ps
```

Regarde Caddy obtenir le certificat HTTPS. Tu dois voir passer `certificate obtained successfully` ; quitte avec `Ctrl C` :

```bash
docker compose logs -f caddy
```

## 8. Programmer une sauvegarde automatique

Teste d'abord une sauvegarde à la main :

```bash
sh scripts/backup.sh
```

Puis programme-la chaque nuit à 3 h :

```bash
(crontab -l 2>/dev/null; echo "0 3 * * * cd $HOME/compte-commun && sh scripts/backup.sh >> backups/backup.log 2>&1") | crontab -
```

Les sauvegardes sont dans `~/compte-commun/backups` (les 30 dernières sont gardées). Pour en récupérer une copie sur le Mac, lance depuis un **autre** onglet du Terminal, sur le Mac :

```bash
scp -r UTILISATEUR@IP_DU_VPS:compte-commun/backups ~/Desktop/sauvegardes-compte-commun
```

## 9. Installer l'app sur vos téléphones

1. Ouvre `https://compte.mondomaine.fr` sur ton téléphone et **crée le compte commun**.
2. **Installe l'app** :
   - **iPhone** : dans Safari, **Partager** ⬆︎ → **Sur l'écran d'accueil**, puis ouvre l'app depuis l'icône ;
   - **Android** : dans Chrome, menu ⋮ → **Installer l'application**.
3. Dans **Réglages** :
   - active les **notifications** ;
   - ajoute vos **charges récurrentes** (la box en « Payée par Laura ») ;
   - ajoute la **CAF** dans « Aides » ;
   - choisis la **répartition**.
4. **Réglages → Inviter ta moitié** : envoie le lien à Laura. Elle crée son profil, installe l'app et active ses notifications.

C'est en place 🎉

---

## Mettre à jour l'app

Quand une nouvelle version est poussée sur GitHub, sur le VPS :

```bash
cd ~/compte-commun && git pull && docker compose up -d --build
```

Les données ne bougent pas : elles sont dans un volume Docker séparé du code. Les téléphones récupèrent la nouvelle version à la réouverture de l'app.

## Sécuriser l'accès SSH (recommandé)

À faire **seulement une fois que ta connexion par clé fonctionne**, et **en gardant ta session actuelle ouverte** pendant le test.

On coupe la connexion par mot de passe. Le fichier commence par `00-` pour passer avant la configuration d'OVH (`50-cloud-init.conf`), qui la réactive sinon :

```bash
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' | sudo tee /etc/ssh/sshd_config.d/00-durcissement.conf
```

```bash
sudo sshd -t && sudo systemctl restart ssh
```

Puis, **depuis un nouvel onglet du Terminal du Mac**, vérifie que tu peux toujours te connecter avec `ssh UTILISATEUR@IP_DU_VPS`. Si ça bloque, ta première session est restée ouverte : supprime le fichier (`sudo rm /etc/ssh/sshd_config.d/00-durcissement.conf`) et relance `sudo systemctl restart ssh`.

## Donner accès au VPS à ton PC Windows (facultatif)

Une clé a été créée sur ton PC (`C:\Users\piret\.ssh\ovh_vps`). Pour l'autoriser, ajoute sa partie publique sur le VPS (étape 2, connecté avec le même utilisateur) :

```bash
echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPSC5zgMV+nU1EZ4xjJF6BziBKyaU840smXi2i7uq4ra pc-windows-compte-commun' >> ~/.ssh/authorized_keys
```

Depuis le PC, la connexion se fait ensuite avec :

```bash
ssh -i ~/.ssh/ovh_vps UTILISATEUR@IP_DU_VPS
```

## Annexe : si un nginx tourne déjà

Si l'étape 4 a montré qu'un nginx occupe déjà les ports 80 et 443, on garde ce nginx et on ne lance pas Caddy. À l'étape 7, démarre uniquement l'app (elle écoute sur `127.0.0.1:3000`, invisible depuis Internet) :

```bash
docker compose up -d --build app
```

Crée la configuration nginx :

```bash
sudo nano /etc/nginx/sites-available/compte-commun
```

Colle ce contenu en remplaçant le domaine :

```nginx
server {
    server_name compte.mondomaine.fr;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Active le site, recharge nginx, puis obtiens le certificat HTTPS :

```bash
sudo ln -s /etc/nginx/sites-available/compte-commun /etc/nginx/sites-enabled/ && sudo nginx -t && sudo systemctl reload nginx
```

```bash
sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d compte.mondomaine.fr
```

Pour les mises à jour, remplace `docker compose up -d --build` par `docker compose up -d --build app`.

## Dépannage

**La page ne s'ouvre pas, ou erreur de certificat.**

- Vérifie que le DNS pointe bien vers le VPS (`dig +short compte.mondomaine.fr` sur le Mac).
- Vérifie que les ports 80 et 443 sont ouverts (étape 5, et le pare-feu OVH s'il est actif).
- Lis les messages de Caddy :

  ```bash
  docker compose logs --tail 50 caddy
  ```

**`permission denied while trying to connect to the Docker daemon`.** Tu ne t'es pas reconnecté après l'étape 3 : fais `exit`, puis `ssh` à nouveau.

**`port is already allocated` ou `address already in use`.** Un autre service occupe le port 80 ou 443 : voir l'annexe nginx.

**`Permission denied (publickey)` au `git clone`.** La deploy key n'est pas (ou mal) ajoutée sur GitHub. Refais l'étape 6 et teste :

```bash
ssh -T git@github.com
```

**L'app plante ou se comporte bizarrement.** Lis ses messages :

```bash
docker compose logs --tail 100 app
```

**Les notifications n'arrivent pas sur iPhone.**

- L'app doit être ouverte **depuis l'icône** de l'écran d'accueil (iOS 16.4 minimum).
- `VAPID_SUBJECT` doit contenir une vraie adresse e-mail. Après l'avoir corrigée dans `.env`, relance :

  ```bash
  docker compose up -d
  ```
