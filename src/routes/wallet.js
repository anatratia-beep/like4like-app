const express = require('express');
const { db, getSetting, getTextSetting } = require('../db');
const { authRequired } = require('../middleware/auth');
const push = require('../services/push');

const router = express.Router();

router.get('/solde', authRequired, (req, res) => {
  const u = db.prepare('SELECT jetons, points, solde_ariary FROM users WHERE id = ?').get(req.user.id);
  res.json(u);
});

// Numero vers lequel les etudiants doivent envoyer l'argent avant d'acheter des jetons
router.get('/infos-paiement', authRequired, (req, res) => {
  res.json({ numero_reception_paiement: getTextSetting('numero_reception_paiement') });
});

/**
 * Achat de jetons - flux DECLARATIF (tant qu'il n'y a pas de compte marchand MVola/
 * Orange Money/Airtel Money avec acces API) :
 *   1) L'etudiant envoie lui-meme l'argent via Mobile Money vers le numero affiche
 *      dans l'app (reglable par l'admin dans Reglages).
 *   2) Il colle ici la reference recue par SMS suite a son transfert.
 *   3) Les jetons sont credites IMMEDIATEMENT, sans intervention de l'admin.
 *
 * IMPORTANT - limite technique honnete : sans compte marchand, il n'existe aucun
 * moyen de verifier par API qu'un paiement a reellement eu lieu. Ce flux fait donc
 * confiance a la reference saisie par l'etudiant. Pour limiter les abus :
 *   - toute reference ne peut etre utilisee qu'une seule fois (anti-reutilisation),
 *   - chaque credit reste visible avec sa reference dans Admin -> Transactions,
 *   - l'admin peut debiter en un clic (credit-manuel avec un montant negatif) si
 *     une reference se revele fausse ou reutilisee frauduleusement.
 * Le jour ou un compte marchand MVola est obtenu, voir src/services/mvola.js pour
 * repasser a une verification automatique et fiable des paiements.
 */
router.post('/achat-jetons', authRequired, (req, res) => {
  const { montant_ariary, reference } = req.body;
  const montant = Number(montant_ariary);
  const ref = (reference || '').trim();

  if (!montant || montant < 100) {
    return res.status(400).json({ erreur: 'montant_ariary invalide (minimum 100 Ar)' });
  }
  if (!ref) {
    return res.status(400).json({ erreur: 'La reference du transfert Mobile Money est requise' });
  }

  const dejaUtilisee = db.prepare("SELECT id FROM transactions WHERE reference_externe = ?").get(ref);
  if (dejaUtilisee) {
    return res.status(409).json({ erreur: 'Cette reference a deja ete utilisee. Contacte ton enseignant si tu penses que c\'est une erreur.' });
  }

  const ariaryParJeton = getSetting('ariary_par_jeton');
  const jetonsAcredit = Math.floor(montant / ariaryParJeton);

  const maj = db.transaction(() => {
    db.prepare('UPDATE users SET jetons = jetons + ? WHERE id = ?').run(jetonsAcredit, req.user.id);
    db.prepare(
      `INSERT INTO transactions (user_id, type, montant_ariary, montant_jetons, description, reference_externe, statut)
       VALUES (?, 'ACHAT_JETONS', ?, ?, ?, ?, 'VALIDE')`
    ).run(req.user.id, montant, jetonsAcredit, `Achat declaratif de jetons (${montant} Ar, ref. ${ref})`, ref);
  });
  maj();

  push.notifier(req.user.id, {
    titre: 'Jetons crédités',
    corps: `+${jetonsAcredit} jetons crédités suite à votre paiement de ${montant} Ar.`,
    url: '/app.html',
  });

  res.json({ ok: true, jetons_credites: jetonsAcredit, message: `${jetonsAcredit} jetons ont ete credites immediatement.` });
});

/**
 * Convertir des points en Ariary (credite le solde_ariary, en attente de retrait).
 * Doit se faire par multiples de 10 points (=500 Ar par defaut).
 */
router.post('/convertir-points', authRequired, (req, res) => {
  const { points } = req.body;
  const nbPoints = Number(points);
  if (!nbPoints || nbPoints <= 0) return res.status(400).json({ erreur: 'points invalide' });
  if (nbPoints > req.user.points) return res.status(400).json({ erreur: 'Points insuffisants' });

  const ariaryParPoint = getSetting('ariary_par_point');
  const montantAriary = nbPoints * ariaryParPoint;

  const maj = db.transaction(() => {
    db.prepare('UPDATE users SET points = points - ?, solde_ariary = solde_ariary + ? WHERE id = ?').run(
      nbPoints,
      montantAriary,
      req.user.id
    );
    db.prepare(
      `INSERT INTO transactions (user_id, type, montant_ariary, montant_points, description)
       VALUES (?, 'CONVERSION_POINTS_ARIARY', ?, ?, ?)`
    ).run(req.user.id, montantAriary, -nbPoints, `Conversion de ${nbPoints} points en Ariary`);
  });
  maj();

  push.notifier(req.user.id, {
    titre: '🔄 Conversion effectuée',
    corps: `${nbPoints} points convertis en ${montantAriary} Ar.`,
    url: '/app.html',
  });

  res.json({ ok: true, montant_ariary_credite: montantAriary });
});

/**
 * Demande de retrait du solde Ariary vers un numero mobile money.
 * NOTE : le versement effectif (marchand -> client) necessite un produit
 * MVola "disbursement" distinct (a demander a MVola). En attendant, la
 * demande est validee manuellement par l'admin (voir routes/admin.js).
 */
router.post('/retrait', authRequired, (req, res) => {
  const { montant_ariary, telephone_reception } = req.body;
  const montant = Number(montant_ariary);
  if (!montant || montant <= 0) return res.status(400).json({ erreur: 'montant_ariary invalide' });
  if (!telephone_reception) return res.status(400).json({ erreur: 'telephone_reception requis' });
  if (montant > req.user.solde_ariary) return res.status(400).json({ erreur: 'Solde insuffisant' });

  const maj = db.transaction(() => {
    db.prepare('UPDATE users SET solde_ariary = solde_ariary - ? WHERE id = ?').run(montant, req.user.id);
    db.prepare(
      `INSERT INTO retraits (user_id, montant_ariary, telephone_reception) VALUES (?, ?, ?)`
    ).run(req.user.id, montant, telephone_reception);
    db.prepare(
      `INSERT INTO transactions (user_id, type, montant_ariary, description, statut)
       VALUES (?, 'RETRAIT', ?, ?, 'EN_ATTENTE')`
    ).run(req.user.id, -montant, `Demande de retrait vers ${telephone_reception}`);
  });
  maj();

  res.json({ ok: true, message: 'Demande de retrait enregistree, en attente de traitement par l\'administrateur.' });
});

router.get('/mes-retraits', authRequired, (req, res) => {
  const rows = db.prepare('SELECT * FROM retraits WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(rows);
});

module.exports = router;
