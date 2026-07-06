const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, getTextSetting } = require('../db');
const config = require('../config');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// Inscription par les etudiants eux-memes, protegee par un code fourni par l'etablissement
router.post('/inscription', (req, res) => {
  const { code, nom, telephone, classe, mot_de_passe } = req.body;

  if (!code || !nom || !telephone || !classe || !mot_de_passe) {
    return res.status(400).json({ erreur: 'code, nom, telephone, classe et mot_de_passe sont requis' });
  }
  if (!config.classesValides.includes(classe)) {
    return res.status(400).json({ erreur: 'Classe invalide' });
  }
  if (mot_de_passe.length < 4) {
    return res.status(400).json({ erreur: 'Le mot de passe doit contenir au moins 4 caracteres' });
  }

  const codeAttendu = getTextSetting('code_inscription');
  if (code.trim().toUpperCase() !== String(codeAttendu).toUpperCase()) {
    return res.status(403).json({ erreur: "Code d'inscription incorrect" });
  }

  const hash = bcrypt.hashSync(mot_de_passe, 10);
  try {
    const insertion = db
      .prepare(
        `INSERT INTO users (nom, telephone, classe, password_hash, role, doit_changer_mdp)
         VALUES (?, ?, ?, ?, 'etudiant', 0)`
      )
      .run(nom.trim(), telephone.trim(), classe, hash);

    const token = jwt.sign({ id: insertion.lastInsertRowid, role: 'etudiant' }, config.jwtSecret, { expiresIn: '30d' });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(insertion.lastInsertRowid);
    const { password_hash, ...userSansMdp } = user;
    res.status(201).json({ ok: true, token, utilisateur: userSansMdp });
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      return res.status(409).json({ erreur: 'Ce numero de telephone est deja utilise' });
    }
    throw e;
  }
});

// Connexion : telephone + mot de passe
router.post('/login', (req, res) => {
  const { identifiant, mot_de_passe } = req.body;
  if (!identifiant || !mot_de_passe) {
    return res.status(400).json({ erreur: 'identifiant et mot_de_passe requis' });
  }

  const user = db
    .prepare('SELECT * FROM users WHERE telephone = ? AND actif = 1')
    .get(identifiant);

  if (!user || !bcrypt.compareSync(mot_de_passe, user.password_hash)) {
    return res.status(401).json({ erreur: 'Identifiant ou mot de passe incorrect' });
  }

  const token = jwt.sign({ id: user.id, role: user.role }, config.jwtSecret, { expiresIn: '30d' });
  const { password_hash, ...userSansMdp } = user;
  res.json({ token, utilisateur: userSansMdp });
});

router.post('/changer-mot-de-passe', authRequired, (req, res) => {
  const { ancien_mot_de_passe, nouveau_mot_de_passe } = req.body;
  if (!nouveau_mot_de_passe || nouveau_mot_de_passe.length < 4) {
    return res.status(400).json({ erreur: 'Le nouveau mot de passe doit contenir au moins 4 caracteres' });
  }
  if (!bcrypt.compareSync(ancien_mot_de_passe || '', req.user.password_hash)) {
    return res.status(401).json({ erreur: 'Ancien mot de passe incorrect' });
  }
  const hash = bcrypt.hashSync(nouveau_mot_de_passe, 10);
  db.prepare('UPDATE users SET password_hash = ?, doit_changer_mdp = 0 WHERE id = ?').run(hash, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
