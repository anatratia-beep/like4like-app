const express = require('express');
const bcrypt = require('bcryptjs');
const { db, getAllSettings, getTextSetting } = require('../db');
const config = require('../config');
const { authRequired, adminRequired } = require('../middleware/auth');
const push = require('../services/push');

const router = express.Router();
router.use(authRequired, adminRequired);

// ---- Gestion des etudiants ----
router.get('/etudiants', (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, nom, classe, telephone, photo_url, role, jetons, points, solde_ariary, actif, created_at
       FROM users ORDER BY classe, nom`
    )
    .all();
  res.json(rows);
});

router.post('/etudiants', (req, res) => {
  const { nom, telephone, classe, mot_de_passe } = req.body;
  if (!nom || !telephone || !classe) {
    return res.status(400).json({ erreur: 'nom, telephone et classe requis' });
  }
  if (!config.classesValides.includes(classe)) {
    return res.status(400).json({ erreur: 'Classe invalide' });
  }
  const motDePasseInitial = mot_de_passe || telephone; // par defaut : le numero de telephone
  const hash = bcrypt.hashSync(motDePasseInitial, 10);
  try {
    const insertion = db
      .prepare(
        `INSERT INTO users (nom, telephone, classe, password_hash, role, doit_changer_mdp)
         VALUES (?, ?, ?, ?, 'etudiant', 1)`
      )
      .run(nom, telephone, classe, hash);
    res.status(201).json({ ok: true, id: insertion.lastInsertRowid, mot_de_passe_initial: motDePasseInitial });
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      return res.status(409).json({ erreur: 'Numero de telephone deja utilise' });
    }
    throw e;
  }
});

// Import en masse (tableau d'etudiants) - pratique pour charger les 142 d'un coup
router.post('/etudiants/import', (req, res) => {
  const { etudiants } = req.body; // [{nom, telephone, classe, mot_de_passe?}, ...]
  if (!Array.isArray(etudiants) || etudiants.length === 0) {
    return res.status(400).json({ erreur: 'etudiants doit etre un tableau non vide' });
  }
  const resultats = [];
  const inserer = db.prepare(
    `INSERT INTO users (nom, telephone, classe, password_hash, role, doit_changer_mdp)
     VALUES (?, ?, ?, ?, 'etudiant', 1)`
  );
  const transactionImport = db.transaction((liste) => {
    for (const e of liste) {
      try {
        if (!config.classesValides.includes(e.classe)) {
          resultats.push({ telephone: e.telephone, ok: false, erreur: 'classe invalide' });
          continue;
        }
        const hash = bcrypt.hashSync(e.mot_de_passe || e.telephone, 10);
        const r = inserer.run(e.nom, e.telephone, e.classe, hash);
        resultats.push({ telephone: e.telephone, ok: true, id: r.lastInsertRowid });
      } catch (err) {
        resultats.push({ telephone: e.telephone, ok: false, erreur: 'deja existant ?' });
      }
    }
  });
  transactionImport(etudiants);
  res.json({ resultats });
});

router.put('/etudiants/:id/desactiver', (req, res) => {
  db.prepare('UPDATE users SET actif = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.put('/etudiants/:id/reactiver', (req, res) => {
  db.prepare('UPDATE users SET actif = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Credit/debit manuel (ex: paiement en especes, correction d'erreur)
router.post('/etudiants/:id/credit-manuel', (req, res) => {
  const { jetons = 0, points = 0, ariary = 0, description } = req.body;
  const maj = db.transaction(() => {
    db.prepare('UPDATE users SET jetons = jetons + ?, points = points + ?, solde_ariary = solde_ariary + ? WHERE id = ?').run(
      jetons, points, ariary, req.params.id
    );
    db.prepare(
      `INSERT INTO transactions (user_id, type, montant_ariary, montant_jetons, montant_points, description)
       VALUES (?, 'CREDIT_ADMIN', ?, ?, ?, ?)`
    ).run(req.params.id, ariary, jetons, points, description || 'Ajustement manuel par admin');
  });
  maj();
  push.notifier(req.params.id, {
    titre: '📢 Ajustement de compte',
    corps: description || `Mise à jour : ${jetons ? jetons + ' jetons, ' : ''}${points ? points + ' points, ' : ''}${ariary ? ariary + ' Ar' : ''}`.trim(),
    url: '/app.html',
  });
  res.json({ ok: true });
});

// ---- Reglages economiques ----
router.get('/reglages', (req, res) => {
  res.json({
    ...getAllSettings(),
    code_inscription: getTextSetting('code_inscription'),
    numero_reception_paiement: getTextSetting('numero_reception_paiement'),
  });
});

router.put('/reglages', (req, res) => {
  const { code_inscription, numero_reception_paiement, ...reglagesNumeriques } = req.body;
  const maj = db.transaction((entrees) => {
    for (const [key, value] of entrees) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?').run(
        key, String(value), String(value)
      );
    }
    if (code_inscription && code_inscription.trim()) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?').run(
        'code_inscription', code_inscription.trim(), code_inscription.trim()
      );
    }
    if (numero_reception_paiement && numero_reception_paiement.trim()) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?').run(
        'numero_reception_paiement', numero_reception_paiement.trim(), numero_reception_paiement.trim()
      );
    }
  });
  maj(Object.entries(reglagesNumeriques));
  res.json({
    ok: true,
    reglages: {
      ...getAllSettings(),
      code_inscription: getTextSetting('code_inscription'),
      numero_reception_paiement: getTextSetting('numero_reception_paiement'),
    },
  });
});

// ---- Retraits en attente ----
router.get('/retraits', (req, res) => {
  const { statut } = req.query;
  const rows = statut
    ? db.prepare(`SELECT r.*, u.nom, u.classe FROM retraits r JOIN users u ON u.id = r.user_id WHERE r.statut = ? ORDER BY r.created_at`).all(statut)
    : db.prepare(`SELECT r.*, u.nom, u.classe FROM retraits r JOIN users u ON u.id = r.user_id ORDER BY r.created_at DESC`).all();
  res.json(rows);
});

router.post('/retraits/:id/marquer-paye', (req, res) => {
  const retrait = db.prepare('SELECT * FROM retraits WHERE id = ?').get(req.params.id);
  db.prepare("UPDATE retraits SET statut = 'PAYE', traite_at = datetime('now') WHERE id = ?").run(req.params.id);
  if (retrait) {
    push.notifier(retrait.user_id, {
      titre: '✅ Retrait payé',
      corps: `Votre retrait de ${retrait.montant_ariary} Ar a été envoyé.`,
      url: '/app.html',
    });
  }
  res.json({ ok: true });
});

router.post('/retraits/:id/rejeter', (req, res) => {
  const retrait = db.prepare('SELECT * FROM retraits WHERE id = ?').get(req.params.id);
  if (!retrait) return res.status(404).json({ erreur: 'Retrait introuvable' });
  const maj = db.transaction(() => {
    db.prepare("UPDATE retraits SET statut = 'REJETE', traite_at = datetime('now') WHERE id = ?").run(retrait.id);
    db.prepare('UPDATE users SET solde_ariary = solde_ariary + ? WHERE id = ?').run(retrait.montant_ariary, retrait.user_id);
  });
  maj();
  res.json({ ok: true });
});

// ---- Vue d'ensemble des publications, classees par session/classe ----
router.get('/publications', (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, u.nom AS auteur_nom, u.classe AS auteur_classe, u.telephone AS auteur_telephone,
              (SELECT COUNT(*) FROM interactions i WHERE i.publication_id = p.id) AS nb_interactions,
              (SELECT COUNT(*) FROM interactions i WHERE i.publication_id = p.id AND i.statut = 'VALIDEE') AS nb_validees
       FROM publications p
       JOIN users u ON u.id = p.user_id
       ORDER BY u.classe, u.nom, p.created_at DESC`
    )
    .all();
  res.json(rows);
});

// ---- Vue d'ensemble des transactions ----
router.get('/transactions', (req, res) => {
  const rows = db
    .prepare(
      `SELECT t.*, u.nom, u.classe FROM transactions t JOIN users u ON u.id = t.user_id
       ORDER BY t.created_at DESC LIMIT 1000`
    )
    .all();
  res.json(rows);
});

module.exports = router;
