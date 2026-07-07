const express = require('express');
const { db, getSetting, getTextSetting } = require('../db');
const { analyserSms } = require('../services/smsParser');
const push = require('../services/push');

const router = express.Router();

function tenterValidationAchat(sms) {
  const transaction = db
    .prepare("SELECT * FROM transactions WHERE type = 'ACHAT_JETONS' AND statut = 'EN_ATTENTE' AND reference_externe = ?")
    .get(sms.reference);
  if (!transaction) return;

  const ariaryParJeton = getSetting('ariary_par_jeton') || 10;
  const jetons = Math.floor(sms.montant / ariaryParJeton);

  const maj = db.transaction(() => {
    db.prepare("UPDATE transactions SET statut = 'VALIDE', montant_ariary = ?, montant_jetons = ? WHERE id = ?")
      .run(sms.montant, jetons, transaction.id);
    db.prepare('UPDATE users SET jetons = jetons + ? WHERE id = ?').run(jetons, transaction.user_id);
    db.prepare('UPDATE sms_recus SET consomme = 1 WHERE reference = ?').run(sms.reference);
  });
  maj();

  push.notifier(transaction.user_id, {
    titre: 'Jetons crédités',
    corps: `+${jetons} jetons crédités — paiement vérifié automatiquement.`,
    url: '/app.html',
  });
}

function tenterConfirmationRetrait(sms) {
  const retrait = db
    .prepare("SELECT * FROM retraits WHERE statut = 'EN_ATTENTE' AND telephone_reception = ? AND montant_ariary = ?")
    .get(sms.telephone, sms.montant);
  if (!retrait) return;

  const maj = db.transaction(() => {
    db.prepare("UPDATE retraits SET statut = 'PAYE', reference_paiement = ?, traite_at = datetime('now') WHERE id = ?")
      .run(sms.reference, retrait.id);
    db.prepare('UPDATE users SET solde_ariary = solde_ariary - ? WHERE id = ?').run(retrait.montant_ariary, retrait.user_id);
    db.prepare("UPDATE transactions SET statut = 'VALIDE' WHERE reference_externe = ?").run(`RETRAIT-${retrait.id}`);
    db.prepare('UPDATE sms_recus SET consomme = 1 WHERE reference = ?').run(sms.reference);
  });
  maj();

  push.notifier(retrait.user_id, {
    titre: 'Retrait payé',
    corps: `Votre retrait de ${retrait.montant_ariary} Ar a été envoyé — vérifié automatiquement.`,
    url: '/app.html',
  });
}

function traiterSmsEntrant(req, res) {
  const cle = req.query.cle || req.headers['x-gateway-secret'];
  const cleAttendue = getTextSetting('sms_gateway_secret');
  if (!cleAttendue || cle !== cleAttendue) {
    return res.status(403).json({ erreur: 'Cle de passerelle invalide' });
  }

  const texte =
    (req.body && (req.body.texte || req.body.message || req.body.text || req.body.body)) ||
    req.query.texte || req.query.message || req.query.text || '';

  if (!texte) return res.status(400).json({ erreur: 'Aucun texte de SMS fourni' });

  const analyse = analyserSms(texte);
  if (!analyse) {
    return res.json({ ok: true, ignore: true, raison: 'Format de SMS non reconnu' });
  }

  try {
    db.prepare(
      `INSERT INTO sms_recus (type, montant, telephone, reference, texte_brut) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(reference) DO NOTHING`
    ).run(analyse.type, analyse.montant, analyse.telephone, analyse.reference, texte);
  } catch (e) {
    console.error('[sms] erreur insertion', e);
  }

  if (analyse.type === 'RECU') tenterValidationAchat(analyse);
  else if (analyse.type === 'TRANSFERE') tenterConfirmationRetrait(analyse);

  res.json({ ok: true });
}

// Beaucoup d'applications de transfert de SMS n'envoient qu'en GET ou qu'en POST :
// on accepte les deux pour rester compatible avec le plus d'applications possible.
router.post('/entrant', express.json(), traiterSmsEntrant);
router.get('/entrant', traiterSmsEntrant);

module.exports = { router, tenterValidationAchat, tenterConfirmationRetrait };
