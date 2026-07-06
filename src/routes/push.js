const express = require('express');
const { db } = require('../db');
const config = require('../config');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// Clef publique VAPID, necessaire au navigateur pour s'abonner
router.get('/cle-publique', (req, res) => {
  res.json({ cle_publique: config.vapid.publicKey });
});

router.post('/abonner', authRequired, (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ erreur: 'Abonnement push invalide' });
  }
  try {
    db.prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = ?, p256dh = ?, auth = ?`
    ).run(req.user.id, endpoint, keys.p256dh, keys.auth, req.user.id, keys.p256dh, keys.auth);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erreur: 'Erreur enregistrement abonnement' });
  }
});

router.post('/desabonner', authRequired, (req, res) => {
  const { endpoint } = req.body;
  if (endpoint) {
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, req.user.id);
  }
  res.json({ ok: true });
});

module.exports = router;
