const express = require('express');
const { db, getAllSettings } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

const OBJECTIFS_VALIDES = ['LIKE', 'COMMENTAIRE', 'PARTAGE', 'TOUS'];
const COUT_UNITAIRE_PAR_OBJECTIF = {
  LIKE: 'jetons_par_jaime',
  COMMENTAIRE: 'jetons_par_commentaire',
  PARTAGE: 'jetons_par_partage',
};

// Permet a l'etudiant de voir les couts unitaires AVANT de choisir son objectif
// (style "Booster une publication" : un seul objectif par publication).
router.get('/tarif-actuel', authRequired, (req, res) => {
  const r = getAllSettings();
  res.json({
    jetons_par_jaime: r.jetons_par_jaime,
    jetons_par_commentaire: r.jetons_par_commentaire,
    jetons_par_partage: r.jetons_par_partage,
    jetons_par_point: r.jetons_par_point,
    gratuit: req.user.role === 'admin',
  });
});

// Fil de publications (toutes) avec infos auteur, classe, et epinglage admin en tete
router.get('/', authRequired, (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, u.nom AS auteur_nom, u.photo_url AS auteur_photo, u.classe AS auteur_classe, u.role AS auteur_role,
              (SELECT COUNT(*) FROM interactions i WHERE i.publication_id = p.id) AS nb_interactions
       FROM publications p
       JOIN users u ON u.id = p.user_id
       ORDER BY (CASE WHEN u.role = 'admin' THEN 0 ELSE 1 END), p.created_at DESC
       LIMIT 200`
    )
    .all();
  res.json(rows);
});

router.get('/:id', authRequired, (req, res) => {
  const pub = db
    .prepare(
      `SELECT p.*, u.nom AS auteur_nom, u.photo_url AS auteur_photo, u.classe AS auteur_classe, u.role AS auteur_role
       FROM publications p JOIN users u ON u.id = p.user_id WHERE p.id = ?`
    )
    .get(req.params.id);
  if (!pub) return res.status(404).json({ erreur: 'Publication introuvable' });

  const interactions = db
    .prepare(
      `SELECT i.*, u.nom AS auteur_nom FROM interactions i
       JOIN users u ON u.id = i.user_id WHERE i.publication_id = ? ORDER BY i.created_at DESC`
    )
    .all(req.params.id);

  res.json({ ...pub, interactions });
});

/**
 * Creer une publication - style "Booster" (comme Facebook Ads) :
 * l'etudiant choisit UN SEUL objectif (j'aime, commentaire ou partage) et une
 * quantite ; le cout est calcule uniquement sur cet objectif. L'administrateur
 * continue de publier gratuitement avec les 3 types actives (quotas des reglages).
 */
router.post('/', authRequired, (req, res) => {
  const { contenu, lien_url, objectif, quantite, quantite_jaime, quantite_commentaire, quantite_partage } = req.body;
  if (!contenu && !lien_url) {
    return res.status(400).json({ erreur: 'contenu ou lien_url requis' });
  }
  if (!lien_url) {
    return res.status(400).json({ erreur: 'Le lien vers la publication (Facebook/Instagram/TikTok...) est requis' });
  }

  const r = getAllSettings();
  const estAdmin = req.user.role === 'admin';

  let quotaJaime = 0, quotaCommentaire = 0, quotaPartage = 0, cout = 0;

  if (estAdmin) {
    quotaJaime = r.quota_jaime;
    quotaCommentaire = r.quota_commentaire;
    quotaPartage = r.quota_partage;
  } else {
    if (!OBJECTIFS_VALIDES.includes(objectif)) {
      return res.status(400).json({ erreur: "objectif doit etre LIKE, COMMENTAIRE, PARTAGE ou TOUS" });
    }

    if (objectif === 'TOUS') {
      quotaJaime = Math.max(0, Number(quantite_jaime) || 0);
      quotaCommentaire = Math.max(0, Number(quantite_commentaire) || 0);
      quotaPartage = Math.max(0, Number(quantite_partage) || 0);

      if (quotaJaime + quotaCommentaire + quotaPartage <= 0) {
        return res.status(400).json({ erreur: 'Indiquez au moins une quantite pour un des 3 objectifs' });
      }

      cout = quotaJaime * r.jetons_par_jaime + quotaCommentaire * r.jetons_par_commentaire + quotaPartage * r.jetons_par_partage;
    } else {
      const qte = Number(quantite);
      if (!qte || qte <= 0) {
        return res.status(400).json({ erreur: 'quantite invalide' });
      }

      const coutUnitaire = r[COUT_UNITAIRE_PAR_OBJECTIF[objectif]];
      cout = qte * coutUnitaire;

      if (objectif === 'LIKE') quotaJaime = qte;
      if (objectif === 'COMMENTAIRE') quotaCommentaire = qte;
      if (objectif === 'PARTAGE') quotaPartage = qte;
    }

    if (req.user.jetons < cout) {
      return res.status(400).json({
        erreur: `Jetons insuffisants. Ceci coute ${cout} jetons. Vous avez ${req.user.jetons} jetons.`,
      });
    }
  }

  let publicationId;
  const maj = db.transaction(() => {
    if (!estAdmin) {
      db.prepare('UPDATE users SET jetons = jetons - ? WHERE id = ?').run(cout, req.user.id);
    }
    const insertion = db
      .prepare(
        `INSERT INTO publications
          (user_id, contenu, lien_url, cout_total,
           quota_jaime, quota_commentaire, quota_partage,
           jaime_restants, commentaire_restants, partage_restants,
           jetons_par_jaime, jetons_par_commentaire, jetons_par_partage)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        req.user.id, contenu || '', lien_url,
        estAdmin ? 0 : cout,
        quotaJaime, quotaCommentaire, quotaPartage,
        quotaJaime, quotaCommentaire, quotaPartage,
        r.jetons_par_jaime, r.jetons_par_commentaire, r.jetons_par_partage
      );
    publicationId = insertion.lastInsertRowid;
    if (!estAdmin) {
      db.prepare(
        `INSERT INTO transactions (user_id, type, montant_jetons, description)
         VALUES (?, 'DEBIT_PUBLICATION', ?, ?)`
      ).run(req.user.id, -cout, `Publication #${publicationId} - objectif ${objectif} x${quantite} (-${cout} jetons)`);
    }
  });
  maj();

  res.status(201).json({ ok: true, publication_id: publicationId, cout_total: estAdmin ? 0 : cout });
});

module.exports = router;
