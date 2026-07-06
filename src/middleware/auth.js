const jwt = require('jsonwebtoken');
const config = require('../config');
const { db } = require('../db');

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ erreur: 'Token manquant' });

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND actif = 1').get(payload.id);
    if (!user) return res.status(401).json({ erreur: 'Utilisateur introuvable ou desactive' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ erreur: 'Token invalide ou expire' });
  }
}

function adminRequired(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ erreur: 'Reserve aux administrateurs' });
  }
  next();
}

module.exports = { authRequired, adminRequired };
