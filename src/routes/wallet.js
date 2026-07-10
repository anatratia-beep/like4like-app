const express = require('express');
const { db, getSetting, getTextSetting } = require('../db');
const { authRequired } = require('../middleware/auth');
const push = require('../services/push');

const router = express.Router();

router.get('/solde', authRequired, (req, res) => {
  const u = db.prepare('SELECT jetons, points, solde_ariary FROM users WHERE id = ?').get(req.user.id);
  res.json(u);
});

// Numero vers lequel les etudiants doivent envoyer l'argent avant d'acheter des jetons,
// et forfaits rapides proposes (montants en Ariary).
router.get('/infos-paiement', authRequired, (req, res) => {
  const forfaitsTexte = getTextSetting('forfaits_ariary') || '';
  const forfaits = forfaitsTexte.split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
  res.json({
    numero_reception_paiement: getTextSetting('numero_reception_paiement'),
    ariary_par_jeton: getSetting('ariary_par_jeton'),
    forfaits,
  });
});

/**
 * Achat de jetons - flux DECLARATIF AVEC VALIDATION ADMIN OBLIGATOIRE.
 *
 * IMPORTANT - lecon retenue : sans compte marchand MVola, une reference saisie par
 * l'etudiant ne peut PAS etre consideree comme une preuve de paiement (elle peut
 * etre inventee). Le credit automatique sans verification a ete retire : chaque
 * demande passe desormais par une validation en un clic par l'administrateur
 * (Admin -> Achats en attente), qui doit d'abord verifier que l'argent est bien
 * arrive sur son compte Mobile Money avant de valider.
 *
 * Le jour ou un compte marchand MVola est obtenu, voir src/services/mvola.js pour
 * une verification automatique et fiable des paiements.
 */
/**
 * Achat de jetons - flux DECLARATIF avec verification automatique par passerelle SMS.
 *
 * Si le vrai SMS de confirmation MVola correspondant a cette reference est deja
 * arrive (recu par la passerelle SMS avant que l'etudiant ne soumette ce formulaire),
 * les jetons sont credites IMMEDIATEMENT et automatiquement, sur la base du montant
 * REELLEMENT verifie dans le SMS (pas celui declare par l'etudiant).
 *
 * Sinon, la demande reste EN_ATTENTE : elle sera validee automatiquement des que
 * le SMS correspondant arrivera (voir routes/sms.js), ou manuellement par l'admin
 * en secours (Admin -> Achats) si la passerelle SMS n'est pas configuree/disponible.
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

  // Le vrai SMS MVola est-il deja arrive pour cette reference ?
  const smsVerifie = db.prepare("SELECT * FROM sms_recus WHERE type = 'RECU' AND reference = ? AND consomme = 0").get(ref);

  if (smsVerifie) {
    const jetonsAcredit = Math.floor(smsVerifie.montant / ariaryParJeton);
    const maj = db.transaction(() => {
      db.prepare('UPDATE users SET jetons = jetons + ? WHERE id = ?').run(jetonsAcredit, req.user.id);
      db.prepare(
        `INSERT INTO transactions (user_id, type, montant_ariary, montant_jetons, description, reference_externe, statut)
         VALUES (?, 'ACHAT_JETONS', ?, ?, ?, ?, 'VALIDE')`
      ).run(req.user.id, smsVerifie.montant, jetonsAcredit, `Achat de jetons verifie automatiquement par SMS (ref. ${ref})`, ref);
      db.prepare('UPDATE sms_recus SET consomme = 1 WHERE id = ?').run(smsVerifie.id);
    });
    maj();

    return res.json({
      ok: true,
      jetons_credites: jetonsAcredit,
      message: `${jetonsAcredit} jetons crédités immédiatement — paiement vérifié automatiquement.`,
    });
  }

  const jetonsPrevus = Math.floor(montant / ariaryParJeton);

  db.prepare(
    `INSERT INTO transactions (user_id, type, montant_ariary, montant_jetons, description, reference_externe, statut)
     VALUES (?, 'ACHAT_JETONS', ?, ?, ?, ?, 'EN_ATTENTE')`
  ).run(req.user.id, montant, jetonsPrevus, `Achat declare de jetons (${montant} Ar, ref. ${ref}) - en attente de verification`, ref);

  res.json({
    ok: true,
    message: `Demande enregistree (${jetonsPrevus} jetons prevus). Elle sera validee automatiquement des reception du SMS de confirmation, ou par l'administrateur en secours.`,
  });
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
/**
 * Demande de retrait - AUCUN DEBIT IMMEDIAT.
 * Le solde n'est debite qu'au moment ou l'admin confirme avoir reellement envoye
 * l'argent (avec une reference de preuve) via /admin/retraits/:id/marquer-paye.
 * Ici, on verifie seulement que le solde disponible (solde actuel moins les
 * demandes deja en attente) couvre bien cette nouvelle demande.
 */
router.post('/retrait', authRequired, (req, res) => {
  const { montant_ariary, telephone_reception } = req.body;
  const montant = Number(montant_ariary);
  if (!montant || montant <= 0) return res.status(400).json({ erreur: 'montant_ariary invalide' });
  if (!telephone_reception) return res.status(400).json({ erreur: 'telephone_reception requis' });

  const enAttente = db
    .prepare("SELECT COALESCE(SUM(montant_ariary), 0) AS total FROM retraits WHERE user_id = ? AND statut = 'EN_ATTENTE'")
    .get(req.user.id).total;

  if (montant + enAttente > req.user.solde_ariary) {
    return res.status(400).json({
      erreur: `Solde insuffisant. Solde : ${req.user.solde_ariary} Ar, deja ${enAttente} Ar en attente de traitement.`,
    });
  }

  const insertion = db.prepare(
    `INSERT INTO retraits (user_id, montant_ariary, telephone_reception) VALUES (?, ?, ?)`
  ).run(req.user.id, montant, telephone_reception);

  db.prepare(
    `INSERT INTO transactions (user_id, type, montant_ariary, description, reference_externe, statut)
     VALUES (?, 'RETRAIT', ?, ?, ?, 'EN_ATTENTE')`
  ).run(req.user.id, -montant, `Demande de retrait vers ${telephone_reception}`, `RETRAIT-${insertion.lastInsertRowid}`);

  res.json({ ok: true, message: 'Demande de retrait enregistree. Le solde sera debite une fois le versement confirme par l\'administrateur.' });
});

router.get('/mes-retraits', authRequired, (req, res) => {
  const rows = db.prepare('SELECT * FROM retraits WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(rows);
});

module.exports = router;
