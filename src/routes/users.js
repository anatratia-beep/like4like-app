const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db } = require('../db');
const config = require('../config');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

const uploadsDir = path.join(config.dataDir, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `photo_${req.user.id}_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 Mo max
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Fichier image requis'));
    cb(null, true);
  },
});

router.get('/me', authRequired, (req, res) => {
  const { password_hash, ...user } = req.user;
  res.json(user);
});

router.put('/me/photo', authRequired, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ erreur: 'Aucun fichier recu (champ "photo")' });
  const photoUrl = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE users SET photo_url = ? WHERE id = ?').run(photoUrl, req.user.id);
  res.json({ ok: true, photo_url: photoUrl });
});

// Historique complet : transactions (ariary/jetons/points) confondues, plus recent en premier
router.get('/me/historique', authRequired, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 500')
    .all(req.user.id);
  res.json(rows);
});

router.get('/me/publications', authRequired, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM publications WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  res.json(rows);
});

// Liste des autres etudiants (pour demarrer une conversation ou voir les profils)
router.get('/', authRequired, (req, res) => {
  const rows = db
    .prepare("SELECT id, nom, classe, photo_url FROM users WHERE actif = 1 AND id != ? ORDER BY nom")
    .all(req.user.id);
  res.json(rows);
});

module.exports = router;
