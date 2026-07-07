const express = require('express');
const { db, getAllSettings } = require('../db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

function calculerCout(reglages) {
  return (
    reglages.quota_jaime * reglages.jetons_par_jaime +
    reglages.quota_commentaire * reglages.jetons_par_commentaire +
    reglages.quota_partage * reglages.jetons_par_partage
  );
}

// Permet a l'etudiant de voir le cout et les quotas AVANT de publier
router.get('/tarif-actuel', authRequired, (req, res) => {
  const r = getAllSettings();
  res.json({
    quota_jaime: r.quota_jaime,
    quota_commentaire: r.quota_commentaire,
    quota_partage: r.quota_partage,
    jetons_par_jaime: r.jetons_par_jaime,
    jetons_par_commentaire: r.jetons_par_commentaire,
    jetons_par_partage: r.jetons_par_partage,
    jetons_par_point: r.jetons_par_point,
    cout_total: calculerCout(r),
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

// Creer une publication : debite le cout total, SAUF pour l'administrateur qui
// publie gratuitement (les interactions de ses publications restent recompensees
// normalement pour les etudiants qui y interagissent).
router.post('/', authRequired, (req, res) => {
  const { contenu, lien_url } = req.body;
  if (!contenu && !lien_url) {
    return res.status(400).json({ erreur: 'contenu ou lien_url requis' });
  }
  if (!lien_url) {
    return res.status(400).json({ erreur: 'Le lien vers la publication (Facebook/Instagram/TikTok...) est requis' });
  }

  const r = getAllSettings();
  const cout = calculerCout(r);
  const estAdmin = req.user.role === 'admin';

  if (!estAdmin && req.user.jetons < cout) {
    return res.status(400).json({
      erreur: `Jetons insuffisants. Cette publication coute ${cout} jetons (${r.quota_jaime} j'aime x${r.jetons_par_jaime} + ${r.quota_commentaire} commentaires x${r.jetons_par_commentaire} + ${r.quota_partage} partages x${r.jetons_par_partage}). Vous avez ${req.user.jetons} jetons.`,
    });
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
        r.quota_jaime, r.quota_commentaire, r.quota_partage,
        r.quota_jaime, r.quota_commentaire, r.quota_partage,
        r.jetons_par_jaime, r.jetons_par_commentaire, r.jetons_par_partage
      );
    publicationId = insertion.lastInsertRowid;
    if (!estAdmin) {
      db.prepare(
        `INSERT INTO transactions (user_id, type, montant_jetons, description)
         VALUES (?, 'DEBIT_PUBLICATION', ?, ?)`
      ).run(req.user.id, -cout, `Publication #${publicationId} creee (-${cout} jetons)`);
    }
  });
  maj();

  res.status(201).json({ ok: true, publication_id: publicationId, cout_total: estAdmin ? 0 : cout });
});

module.exports = router;
