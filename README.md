# Like4Like Étudiants — Système de jetons / points / Ariary

Application complète (backend + base de données + frontend) pour gérer, pour tes 142 étudiants :
- l'achat de jetons contre de l'Ariary (Mobile Money),
- la création de publications (débit de jetons),
- les interactions (like/commentaire) entre étudiants, validées par le propriétaire de la publication ou automatiquement après 48h,
- la conversion des points en Ariary,
- les retraits,
- l'historique complet des transactions,
- la messagerie privée,
- la photo de profil,
- un panneau d'administration.

## Règles économiques par défaut (modifiables dans Admin → Réglages)
- 1000 Ar = 100 jetons
- 100 jetons = 1 publication
- 1 publication = un "pool" de 10 points, distribué aux étudiants dont l'interaction (like/commentaire) est validée
- 10 points = 500 Ar

**Hypothèse faite pour construire le système** (à valider avec toi) : les points ne sont pas gagnés en publiant, mais en **interagissant avec la publication d'un autre étudiant**, une fois cette interaction validée par le propriétaire (ou automatiquement après 48h). Chaque publication ne peut distribuer que 10 points au total (configurable), pour éviter qu'un seul post ne génère des points à l'infini. Si ta règle est différente (par ex. le propriétaire gagne aussi des points), dis-le-moi et j'ajuste `src/routes/publications.js` / `src/services/scheduler.js`.

## Installation

```bash
cd like4like-app
npm install
cp .env.example .env
# Modifier .env : JWT_SECRET, ADMIN_PASSWORD, et les identifiants MVola
npm start
```

Le serveur démarre sur `http://localhost:3000`. Au premier démarrage, un compte admin est créé automatiquement avec les identifiants définis dans `.env` (`ADMIN_MATRICULE` / `ADMIN_PASSWORD`).

La base de données est un simple fichier `data.sqlite` (créé automatiquement) — largement suffisant pour 142 utilisateurs, aucun serveur de base de données séparé à gérer.

## Déploiement en production

Pour que MVola puisse envoyer ses callbacks de paiement, ton serveur doit être accessible publiquement en HTTPS (obligatoire pour la production Mobile Money). Options simples :
- Un petit VPS (ex. hébergeurs locaux, DigitalOcean, etc.) + nom de domaine + certificat SSL (Let's Encrypt),
- Ou une plateforme de type Render/Railway/Fly.io.

Mets à jour `BASE_URL` dans `.env` avec l'URL publique — c'est cette URL qui est envoyée à MVola comme `callback_url`.

## Notifications push

Les étudiants et l'admin peuvent activer les notifications (bouton 🔔 en haut de l'app) pour recevoir une alerte sur leur téléphone/ordinateur même quand l'app est fermée, à chaque :
- crédit/débit de jetons, points ou Ariary,
- nouveau message reçu.

Ça utilise le standard **Web Push** (aucune app à installer, ça marche directement dans le navigateur). Il faut que les 3 variables `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` soient présentes dans `.env` (déjà pré-remplies dans `.env.example` avec des clés toutes prêtes) **et aussi ajoutées dans les variables d'environnement de l'hébergeur en ligne** (Render, etc.) puisque `.env` n'est jamais envoyé sur GitHub.

## Paiements Mobile Money — ce qu'il reste à faire de ton côté

J'ai vérifié la documentation publique de l'API **MVola Merchant Pay** (https://developer.mvola.mg/devportal/) et implémenté l'intégration dans `src/services/mvola.js`. Mais il y a des étapes que je ne peux pas faire à ta place, car elles nécessitent un vrai compte marchand :

1. **Créer un compte marchand MVola** sur le portail développeur, obtenir les clés `consumer_key`/`consumer_secret` (sandbox, puis production).
2. **Tester en sandbox** avec les numéros de test officiels (`0343500003` / `0343500004`) avant le lancement réel.
3. **Revérifier les noms exacts des champs JSON** sur le devportal au moment de l'intégration — MVola documente et fait évoluer son API, les champs utilisés dans `mvola.js` suivent la doc publique "Merchant Pay v1" mais doivent être reconfirmés avant le go-live.
4. **Retraits (verser de l'Ariary aux étudiants)** : l'API "Merchant Pay" gère le sens étudiant → marchand (achat de jetons). Le sens inverse (marchand → étudiant, pour les retraits) est un produit différent chez MVola ("disbursement"/B2C) qu'il faut négocier séparément avec l'équipe MVola. **En attendant, les retraits sont gérés manuellement** : l'étudiant fait une demande dans l'app, tu la vois dans Admin → Retraits, tu envoies l'argent toi-même (agent MVola, transfert manuel...) puis tu cliques "Marquer payé".
5. **Orange Money et Airtel Money** ne sont pas intégrés automatiquement : ce sont des API totalement différentes de MVola, chacune avec son propre compte marchand à créer. Si tu veux les ajouter, il faudra répéter la même démarche (créer un compte développeur chez chacun, obtenir des clés, puis je pourrai écrire les modules d'intégration correspondants sur le même modèle que `mvola.js`).

En résumé : le code est prêt à fonctionner avec MVola dès que tu as tes clés API. Pour Orange/Airtel ou pour les retraits automatiques, on pourra les ajouter dans une prochaine itération une fois que tu as les accès nécessaires.

## Structure du projet

```
like4like-app/
  src/
    server.js          -> point d'entrée
    db.js               -> schéma SQLite + valeurs par défaut
    config.js           -> variables d'environnement
    middleware/auth.js   -> authentification JWT
    services/mvola.js    -> intégration MVola
    services/scheduler.js -> validation automatique des points après 48h
    routes/               -> auth, users, wallet, publications, interactions, messages, admin
  public/                 -> frontend (login, app étudiant, panneau admin)
  uploads/                -> photos de profil
```

## Créer les 142 comptes étudiants

Deux options dans Admin → Étudiants :
- Ajout un par un,
- Import en masse au format JSON :
```json
[
  {"matricule": "E001", "nom": "Rakoto Jean", "telephone": "0341234567"},
  {"matricule": "E002", "nom": "Rasoa Marie", "telephone": "0347654321"}
]
```
Le mot de passe initial de chaque étudiant est son numéro de téléphone (il peut le changer ensuite dans Profil).

## Sécurité — points à ne pas négliger avant le lancement réel
- Change `JWT_SECRET` et `ADMIN_PASSWORD` dans `.env` avant la mise en production.
- Le callback MVola (`/api/wallet/callback-mvola`) doit être sécurisé (vérification d'origine/signature) avant le go-live — voir les recommandations du devportal MVola.
- Fais des sauvegardes régulières du fichier `data.sqlite` (il contient tout l'historique financier).
