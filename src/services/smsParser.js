/**
 * Analyse les SMS de confirmation MVola pour en extraire les donnees verifiees
 * (montant, telephone, reference). Base sur des exemples reels de SMS MVola :
 *
 * Argent RECU (utilise pour valider automatiquement un achat de jetons) :
 *   "51 300 Ar recu de HARIJAONA MAMINIAINA 0386081661 le 04/07/26 a 13:41.
 *    Raison: 1. Solde: 172 914 Ar. Ref 3210176366"
 *
 * Argent TRANSFERE / envoye (utilise pour confirmer automatiquement un retrait) :
 *   "Vous avez transfere 10 275 Ar a SYLVIECHRISTINE(0337502403) le 06/07/2026
 *    a 17:28:55. Frais:1 000 Ar. Raison: Naty. Votre solde est de 59 239 Ar.
 *    Ref: 3319713596"
 *
 * Si MVola modifie legerement la formulation de ses SMS, ces expressions
 * regulieres devront etre ajustees en consequence.
 */

function analyserSms(texteBrut) {
  const texte = (texteBrut || '').replace(/\u00A0/g, ' ').trim();

  // Argent RECU (entrant)
  let m = texte.match(/([\d][\d\s]*)\s*Ar\s+recu\s+de\s+.*?(\d{9,10})\s+le[\s\S]*?Ref\.?:?\s*(\d+)/i);
  if (m) {
    return {
      type: 'RECU',
      montant: parseInt(m[1].replace(/\s/g, ''), 10),
      telephone: m[2],
      reference: m[3],
    };
  }

  // Argent TRANSFERE (sortant, envoye par l'admin) - format A : "Vous avez transfere X Ar a NOM(telephone)..."
  m = texte.match(/Vous avez transfere\s+([\d][\d\s]*)\s*Ar\s+a\s+.*?\((\d{9,10})\)[\s\S]*?Ref\.?:?\s*(\d+)/i);
  if (m) {
    return {
      type: 'TRANSFERE',
      montant: parseInt(m[1].replace(/\s/g, ''), 10),
      telephone: m[2],
      reference: m[3],
    };
  }

  // Argent TRANSFERE (sortant) - format B : "X Ar envoye a NOM telephone le ..."
  m = texte.match(/([\d][\d\s]*)\s*Ar\s+envoye\s+a\s+.*?(\d{9,10})\s+le[\s\S]*?Ref\.?:?\s*(\d+)/i);
  if (m) {
    return {
      type: 'TRANSFERE',
      montant: parseInt(m[1].replace(/\s/g, ''), 10),
      telephone: m[2],
      reference: m[3],
    };
  }

  return null;
}

module.exports = { analyserSms };
