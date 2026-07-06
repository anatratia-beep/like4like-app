const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db, getSetting } = require('../db');
const config = require('../config');
const { authRequired } = require('../middleware/auth');
const mvola = require('../services/mvola');
const push = require('../services/push');

const router = express.Router();

router.get('/solde', authRequired, (req, res) => {
  const u = db.prepare('SELECT jetons, points, solde_ariary FROM users WHERE id = ?').get(req.user.id);
  res.json(u);
});

/**
 * 1) L'etudiant demande a acheter des jetons pour un montant en Ariary.
 *    -> on cree une transaction EN_ATTENTE et on initie le paiement MVola.
 *    -> MVola enverra un callback sur /api/wallet/callback-mvola une fois le
 *       paiement confirme par l'etudiant sur son telephone (push USSD).
 */
router.post('/achat-jetons', authRequired, async (req, res) => {
  const { montant_ariary } = req.body;
  const montant = Number(montant_ariary);
  if (!montant || montant < 100) {
    return res.status(400).json({ erreur: 'montant_ariary invalide (minimum 100 Ar)' });
  }

  const reference = `JET-${req.user.id}-${uuidv4().slice(0, 8)}`;

  const insertion = db.prepare(
    `INSERT INTO transactions (user_id, type, montant_ariary, description, reference_externe, statut)
     VALUES (?, 'ACHAT_JETONS', ?, ?, ?, 'EN_ATTENTE')`
  ).run(req.user.id, montant, `Achat de jetons (${montant} Ar)`, reference);

  try {
    const resultat = await mvola.initierPaiement({
      montantAriary: montant,
      debitMsisdn: req.user.telephone,
      description: `Achat jetons ${montant}Ar`,
      callbackUrl: `${config.baseUrl}/api/wallet/callback-mvola`,
      reference,
    });

    db.prepare('UPDATE transactions SET reference_externe = ? WHERE id = ?').run(
      resultat.serverCorrelationId || reference,
      insertion.lastInsertRowid
    );

    res.json({
      ok: true,
      message: 'Demande de paiement envoyee. Validez la transaction sur votre telephone (notification MVola).',
      reference,
      serverCorrelationId: resultat.serverCorrelationId,
    });
  } catch (e) {
    db.prepare("UPDATE transactions SET statut = 'ECHEC' WHERE id = ?").run(insertion.lastInsertRowid);
    console.error('Erreur MVola:', e.message);
    res.status(502).json({ erreur: "Echec de l'initiation du paiement MVola", detail: e.message });
  }
});

/**
 * 2) Callback MVola : appele par MVola quand le paiement est confirme/echoue.
 *    A SECURISER en production (verifier IP source / signature selon les
 *    consignes du devportal MVola avant le GO LIVE).
 */
router.post('/callback-mvola', express.json(), (req, res) => {
  console.log('[MVola callback]', JSON.stringify(req.body));

  const reference =
    req.body.requestingOrganisationTransactionReference ||
    req.body.reference ||
    req.body.serverCorrelationId;
  const statutMvola = (req.body.status || req.body.transactionStatus || '').toLowerCase();

  const transaction = db
    .prepare("SELECT * FROM transactions WHERE reference_externe = ? AND statut = 'EN_ATTENTE'")
    .get(reference);

  if (!transaction) {
    return res.status(404).json({ erreur: 'Transaction introuvable ou deja traitee' });
  }

  const succes = ['completed', 'success', 'successful'].includes(statutMvola);

  if (succes) {
    const ariaryParJeton = getSetting('ariary_par_jeton');
    const jetonsAcredit = Math.floor(transaction.montant_ariary / ariaryParJeton);

    const maj = db.transaction(() => {
      db.prepare("UPDATE transactions SET statut = 'VALIDE', montant_jetons = ? WHERE id = ?").run(
        jetonsAcredit,
        transaction.id
      );
      db.prepare('UPDATE users SET jetons = jetons + ? WHERE id = ?').run(jetonsAcredit, transaction.user_id);
    });
    maj();
    push.notifier(transaction.user_id, {
      titre: '💰 Jetons crédités',
      corps: `+${jetonsAcredit} jetons suite à votre achat de ${transaction.montant_ariary} Ar.`,
      url: '/app.html',
    });
  } else {
    db.prepare("UPDATE transactions SET statut = 'ECHEC' WHERE id = ?").run(transaction.id);
  }

  res.json({ ok: true });
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
