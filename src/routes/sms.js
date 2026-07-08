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

// Extrait le texte du SMS quel que soit le format envoye par l'application de
// transfert (JSON avec differents noms de champs, texte brut, ou parametres URL).
function extraireTexte(req) {
  const depuisQuery = req.query.texte || req.query.message || req.query.text || req.query.body;
  if (depuisQuery) return String(depuisQuery);

  const corps = req.body;
  if (!corps) return '';

  if (typeof corps === 'object') {
    return corps.texte || corps.message || corps.text || corps.body || corps.sms || '';
  }

  if (typeof corps === 'string') {
    const nettoye = corps.trim();
    if (nettoye.startsWith('{')) {
      try {
        const j = JSON.parse(nettoye);
        return j.texte || j.message || j.text || j.body || j.sms || '';
      } catch (e) {
        // Pas du JSON valide malgre les accolades : on utilise le texte brut tel quel.
      }
    }
    return nettoye;
  }

  return '';
}

function traiterSmsEntrant(req, res) {
  const cle = req.query.cle || req.headers['x-gateway-secret'];
  const cleAttendue = getTextSetting('sms_gateway_secret');
  const cleValide = !!cleAttendue && cle === cleAttendue;

  const texte = extraireTexte(req);
  const analyse = cleValide && texte ? analyserSms(texte) : null;

  // On journalise TOUT ce qui arrive (meme non reconnu) pour pouvoir deboguer
  // depuis Admin -> Reglages sans avoir besoin d'acceder aux logs du serveur.
  try {
    db.prepare(
      'INSERT INTO sms_log (cle_valide, texte_brut, type_detecte) VALUES (?, ?, ?)'
    ).run(cleValide ? 1 : 0, texte || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})), analyse?.type || null);
  } catch (e) {
    console.error('[sms] erreur journalisation', e);
  }

  if (!cleValide) return res.status(403).json({ erreur: 'Cle de passerelle invalide' });
  if (!texte) return res.status(400).json({ erreur: 'Aucun texte de SMS fourni' });
  if (!analyse) return res.json({ ok: true, ignore: true, raison: 'Format de SMS non reconnu' });

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

// Accepte le corps quel que soit son Content-Type (certaines apps de transfert
// n'envoient pas "application/json" meme quand le corps est du JSON).
router.post('/entrant', express.text({ type: () => true, limit: '100kb' }), traiterSmsEntrant);
router.get('/entrant', traiterSmsEntrant);

module.exports = { router, tenterValidationAchat, tenterConfirmationRetrait };
