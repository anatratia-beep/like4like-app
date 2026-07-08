const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db } = require('../db');
const config = require('../config');
const { authRequired } = require('../middleware/auth');
const { validerInteraction } = require('../services/scheduler');

const router = express.Router();

const uploadsDir = path.join(config.dataDir, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `preuve_${req.user.id}_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 }, // 4 Mo max
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Fichier image requis'));
    cb(null, true);
  },
});

const TYPES_VALIDES = ['LIKE', 'COMMENTAIRE', 'PARTAGE'];
const COLONNE_RESTANTS = { LIKE: 'jaime_restants', COMMENTAIRE: 'commentaire_restants', PARTAGE: 'partage_restants' };
const COLONNE_JETONS = { LIKE: 'jetons_par_jaime', COMMENTAIRE: 'jetons_par_commentaire', PARTAGE: 'jetons_par_partage' };

// Un etudiant interagit (like/commentaire/partage) avec la publication d'un autre etudiant.
// Preuve obligatoire : soit un lien (preuve_lien), soit une image (champ fichier "preuve_image").
router.post('/publications/:id/interactions', authRequired, upload.single('preuve_image'), (req, res) => {
  const { type, preuve_lien } = req.body;
  if (!TYPES_VALIDES.includes(type)) {
    return res.status(400).json({ erreur: 'type doit etre LIKE, COMMENTAIRE ou PARTAGE' });
  }

  const preuveImage = req.file ? `/uploads/${req.file.filename}` : null;
  if (!preuve_lien && !preuveImage) {
    return res.status(400).json({ erreur: 'Une preuve est obligatoire : lien (preuve_lien) ou image (preuve_image)' });
  }

  const pub = db.prepare('SELECT * FROM publications WHERE id = ?').get(req.params.id);
  if (!pub) return res.status(404).json({ erreur: 'Publication introuvable' });
  if (pub.user_id === req.user.id) {
    return res.status(400).json({ erreur: 'Vous ne pouvez pas interagir avec votre propre publication' });
  }

  const colonneRestants = COLONNE_RESTANTS[type];
  if (pub[colonneRestants] <= 0) {
    return res.status(400).json({ erreur: `Quota "${type}" deja atteint sur cette publication` });
  }

  const delaiHeures = 48; // valeur par defaut si le reglage a disparu ; ecrase juste en dessous par le reglage courant
  const reglage = db.prepare("SELECT value FROM settings WHERE key = 'delai_validation_heures'").get();
  const delai = reglage ? Number(reglage.value) : delaiHeures;

  try {
    let interactionId;
    const maj = db.transaction(() => {
      // On reserve tout de suite le quota pour eviter le sur-engagement pendant les 48h
      db.prepare(`UPDATE publications SET ${colonneRestants} = ${colonneRestants} - 1 WHERE id = ?`).run(pub.id);

      const insertion = db
        .prepare(
          `INSERT INTO interactions
            (publication_id, user_id, type, preuve_type, preuve_url, date_limite_validation)
           VALUES (?, ?, ?, ?, ?, datetime('now', '+${delai} hours'))`
        )
        .run(
          req.params.id, req.user.id, type,
          preuveImage ? 'IMAGE' : 'LIEN',
          preuveImage || preuve_lien
        );
      interactionId = insertion.lastInsertRowid;
    });
    maj();

    res.status(201).json({
      ok: true,
      interaction_id: interactionId,
      message: `Interaction enregistree. Elle sera validee par l'auteur, ou automatiquement apres ${delai}h.`,
    });
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      return res.status(409).json({ erreur: "Vous avez deja fait ce type d'interaction sur cette publication" });
    }
    throw e;
  }
});

// Interactions recues sur MES publications, en attente de ma validation
router.get('/interactions/a-valider', authRequired, (req, res) => {
  const rows = db
    .prepare(
      `SELECT i.*, u.nom AS interacteur_nom, p.contenu AS publication_contenu
       FROM interactions i
       JOIN publications p ON p.id = i.publication_id
       JOIN users u ON u.id = i.user_id
       WHERE p.user_id = ? AND i.statut = 'EN_ATTENTE'
       ORDER BY i.created_at DESC`
    )
    .all(req.user.id);
  res.json(rows);
});

// Le proprietaire de la publication valide une interaction -> points immediats
router.post('/interactions/:id/valider', authRequired, (req, res) => {
  const interaction = db.prepare('SELECT * FROM interactions WHERE id = ?').get(req.params.id);
  if (!interaction) return res.status(404).json({ erreur: 'Interaction introuvable' });
  if (interaction.statut !== 'EN_ATTENTE') {
    return res.status(400).json({ erreur: 'Cette interaction a deja ete traitee' });
  }

  const pub = db.prepare('SELECT * FROM publications WHERE id = ?').get(interaction.publication_id);
  if (pub.user_id !== req.user.id) {
    return res.status(403).json({ erreur: "Seul l'auteur de la publication peut valider cette interaction" });
  }

  validerInteraction(interaction);
  res.json({ ok: true });
});

// Rejeter une interaction (ex: preuve non valable) -> aucun point attribue, quota restitue
router.post('/interactions/:id/rejeter', authRequired, (req, res) => {
  const interaction = db.prepare('SELECT * FROM interactions WHERE id = ?').get(req.params.id);
  if (!interaction) return res.status(404).json({ erreur: 'Interaction introuvable' });
  if (interaction.statut !== 'EN_ATTENTE') {
    return res.status(400).json({ erreur: 'Cette interaction a deja ete traitee' });
  }
  const pub = db.prepare('SELECT * FROM publications WHERE id = ?').get(interaction.publication_id);
  if (pub.user_id !== req.user.id) {
    return res.status(403).json({ erreur: "Seul l'auteur de la publication peut rejeter cette interaction" });
  }

  const colonneRestants = COLONNE_RESTANTS[interaction.type];
  const maj = db.transaction(() => {
    db.prepare("UPDATE interactions SET statut = 'REJETEE', validated_at = datetime('now') WHERE id = ?").run(interaction.id);
    db.prepare(`UPDATE publications SET ${colonneRestants} = ${colonneRestants} + 1 WHERE id = ?`).run(pub.id);
  });
  maj();

  res.json({ ok: true });
});

module.exports = router;
