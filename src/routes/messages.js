const express = require('express');
const { db } = require('../db');
const { authRequired } = require('../middleware/auth');
const push = require('../services/push');

const router = express.Router();

// Liste des conversations (derniers messages par contact)
router.get('/conversations', authRequired, (req, res) => {
  const rows = db
    .prepare(
      `SELECT
         u.id AS contact_id, u.nom AS contact_nom, u.photo_url AS contact_photo,
         m.contenu AS dernier_message, m.created_at AS dernier_message_date,
         (SELECT COUNT(*) FROM messages WHERE sender_id = u.id AND receiver_id = ? AND lu = 0) AS non_lus
       FROM users u
       JOIN messages m ON (m.sender_id = u.id AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = u.id)
       WHERE u.id != ?
       GROUP BY u.id
       HAVING m.id = MAX(m.id)
       ORDER BY m.created_at DESC`
    )
    .all(req.user.id, req.user.id, req.user.id, req.user.id);
  res.json(rows);
});

// Historique d'une conversation avec un utilisateur donne
router.get('/:userId', authRequired, (req, res) => {
  const autreId = Number(req.params.userId);
  const rows = db
    .prepare(
      `SELECT * FROM messages
       WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
       ORDER BY created_at ASC`
    )
    .all(req.user.id, autreId, autreId, req.user.id);

  db.prepare("UPDATE messages SET lu = 1 WHERE sender_id = ? AND receiver_id = ? AND lu = 0").run(
    autreId,
    req.user.id
  );

  res.json(rows);
});

router.post('/', authRequired, (req, res) => {
  const { receiver_id, contenu } = req.body;
  if (!receiver_id || !contenu || !contenu.trim()) {
    return res.status(400).json({ erreur: 'receiver_id et contenu requis' });
  }
  const destinataire = db.prepare('SELECT id FROM users WHERE id = ? AND actif = 1').get(receiver_id);
  if (!destinataire) return res.status(404).json({ erreur: 'Destinataire introuvable' });

  const insertion = db
    .prepare('INSERT INTO messages (sender_id, receiver_id, contenu) VALUES (?, ?, ?)')
    .run(req.user.id, receiver_id, contenu.trim());

  push.notifier(receiver_id, {
    titre: `💬 ${req.user.nom}`,
    corps: contenu.trim().slice(0, 100),
    url: req.user.role === 'admin' ? '/app.html' : '/admin.html',
  });

  res.status(201).json({ ok: true, message_id: insertion.lastInsertRowid });
});

module.exports = router;
