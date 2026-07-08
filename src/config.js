require('dotenv').config();

const path = require('path');

module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-a-changer',
  baseUrl: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`,

  // Dossier ou sont stockes la base de donnees et les fichiers uploades.
  // En local, ca reste le dossier du projet (comportement inchange).
  // En production sur Render avec un disque persistant, definir DATA_DIR
  // (ex: /data) pour que rien ne soit efface entre deux deploiements.
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..'),

  admin: {
    telephone: process.env.ADMIN_TELEPHONE || '0340000000',
    password: process.env.ADMIN_PASSWORD || 'admin123',
  },

  // Regles economiques par defaut (surchargeables via table `settings` / panneau admin)
  // Nouveau modele : une publication a un quota fixe (identique pour tout le monde,
  // regle par l'admin) de partages / commentaires / j'aime disponibles. Chaque type
  // a son propre cout en jetons (partage > commentaire > j'aime). Le cout total de la
  // publication = somme(quota_type * jetons_par_type), debite a la creation.
  // Quand une interaction est validee, l'interacteur recoit les jetons_par_type
  // correspondants, immediatement convertis en points (1 point = jetons_par_point).
  reglesParDefaut: {
    quota_jaime: Number(process.env.QUOTA_JAIME || 10),
    quota_commentaire: Number(process.env.QUOTA_COMMENTAIRE || 5),
    quota_partage: Number(process.env.QUOTA_PARTAGE || 3),

    jetons_par_jaime: Number(process.env.JETONS_PAR_JAIME || 100),
    jetons_par_commentaire: Number(process.env.JETONS_PAR_COMMENTAIRE || 200),
    jetons_par_partage: Number(process.env.JETONS_PAR_PARTAGE || 300),

    jetons_par_point: Number(process.env.JETONS_PAR_POINT || 10),  // 100 jetons = 10 points
    ariary_par_jeton: Number(process.env.ARIARY_PAR_JETON || 10),  // achat : 1000 Ar = 100 jetons
    ariary_par_point: Number(process.env.ARIARY_PAR_POINT || 20),  // 10 points = 200 Ar

    delai_validation_heures: Number(process.env.DELAI_VALIDATION_HEURES || 48),
  },

  // Code que les etudiants doivent saisir pour creer eux-memes leur compte
  codeInscriptionParDefaut: process.env.CODE_INSCRIPTION || 'IBDAV1',

  // Les 4 sessions/classes possibles pour un etudiant
  classesValides: ['S1_MATIN', 'S2_MATIN', 'S1_APREM', 'S2_APREM'],

  // Numero (Mobile Money) vers lequel les etudiants envoient l'argent pour acheter des jetons
  numeroReceptionParDefaut: process.env.NUMERO_RECEPTION_PAIEMENT || '0340000000',

  mvola: {
    env: process.env.MVOLA_ENV || 'sandbox',
    consumerKey: process.env.MVOLA_CONSUMER_KEY || '',
    consumerSecret: process.env.MVOLA_CONSUMER_SECRET || '',
    partnerName: process.env.MVOLA_PARTNER_NAME || 'MonEtablissement',
    partnerMsisdn: process.env.MVOLA_PARTNER_MSISDN || '0343500004',
    sandboxBaseUrl: process.env.MVOLA_SANDBOX_BASE_URL || 'https://devapi.mvola.mg',
    prodBaseUrl: process.env.MVOLA_PROD_BASE_URL || 'https://api.mvola.mg',
  },

  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:contact@example.com',
  },
};
