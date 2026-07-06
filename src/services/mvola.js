/**
 * Integration MVola (Telma) - API "Merchant Pay"
 * Documentation officielle : https://developer.mvola.mg/devportal/
 *
 * ATTENTION - A FAIRE AVANT LA MISE EN PRODUCTION :
 *  1. Creer un compte sur le portail developpeur MVola et obtenir un compte "marchand".
 *  2. Recuperer MVOLA_CONSUMER_KEY / MVOLA_CONSUMER_SECRET (sandbox puis production).
 *  3. Tester en sandbox avec les numeros de test officiels (0343500003 / 0343500004).
 *  4. Reverifier les noms exacts des champs JSON sur le devportal : MVola documente
 *     et fait evoluer son API ; les champs ci-dessous suivent la documentation
 *     publique "Merchant Pay v1" mais DOIVENT etre revalides avant le GO LIVE.
 *  5. Cote MVola, cette API gere le sens "client paie le marchand" (achat de jetons).
 *     Le sens inverse (marchand -> client, pour les retraits en Ariary) est un produit
 *     different chez MVola (disbursement / B2C) qu'il faut demander separement a
 *     l'equipe MVola. En attendant, les retraits sont geres manuellement (voir
 *     routes/admin.js - validation manuelle des retraits).
 */

const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

function baseUrl() {
  return config.mvola.env === 'production'
    ? config.mvola.prodBaseUrl
    : config.mvola.sandboxBaseUrl;
}

let cachedToken = null; // { access_token, expires_at }

async function getToken() {
  if (cachedToken && cachedToken.expires_at > Date.now() + 30_000) {
    return cachedToken.access_token;
  }

  const credentials = Buffer.from(
    `${config.mvola.consumerKey}:${config.mvola.consumerSecret}`
  ).toString('base64');

  const resp = await fetch(`${baseUrl()}/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache',
    },
    body: 'grant_type=client_credentials&scope=EXT_INT_MVOLA_SCOPE',
  });

  if (!resp.ok) {
    const texte = await resp.text();
    throw new Error(`MVola: echec generation token (${resp.status}) ${texte}`);
  }

  const data = await resp.json();
  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + (Number(data.expires_in || 3600) * 1000),
  };
  return cachedToken.access_token;
}

/**
 * Initie un paiement "l'etudiant paie le marchand" (achat de jetons).
 * @param {object} p
 * @param {number} p.montantAriary
 * @param {string} p.debitMsisdn - numero de telephone de l'etudiant (celui qui paie)
 * @param {string} p.description
 * @param {string} p.callbackUrl
 * @param {string} p.reference - identifiant interne (pour retrouver la transaction)
 */
async function initierPaiement({ montantAriary, debitMsisdn, description, callbackUrl, reference }) {
  const token = await getToken();
  const correlationId = uuidv4();

  const body = {
    amount: String(montantAriary),
    currency: 'Ar',
    descriptionText: (description || 'Achat de jetons').slice(0, 50),
    requestDate: new Date().toISOString(),
    debitParty: [{ key: 'msisdn', value: debitMsisdn }],
    creditParty: [{ key: 'msisdn', value: config.mvola.partnerMsisdn }],
    metadata: [
      { key: 'partnerName', value: config.mvola.partnerName },
      { key: 'reference', value: reference },
    ],
    requestingOrganisationTransactionReference: reference,
    originalTransactionReference: reference,
  };

  const resp = await fetch(
    `${baseUrl()}/mvola/mm/transactions/type/merchantpay/1.0.0/`,
    {
      method: 'POST',
      headers: {
        Version: '1.0',
        'X-CorrelationID': correlationId,
        UserLanguage: 'FR',
        UserAccountIdentifier: `msisdn;${config.mvola.partnerMsisdn}`,
        partnerName: config.mvola.partnerName,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        ...(callbackUrl ? { 'X-Callback-URL': callbackUrl } : {}),
      },
      body: JSON.stringify(body),
    }
  );

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`MVola: echec initiation paiement (${resp.status}) ${JSON.stringify(data)}`);
  }

  // MVola renvoie generalement un serverCorrelationId permettant de suivre le
  // statut via GET .../status/{serverCorrelationId}
  return { correlationId, serverCorrelationId: data.serverCorrelationId, brut: data };
}

async function statutTransaction(serverCorrelationId) {
  const token = await getToken();
  const resp = await fetch(
    `${baseUrl()}/mvola/mm/transactions/type/merchantpay/1.0.0/status/${serverCorrelationId}`,
    {
      headers: {
        Version: '1.0',
        'X-CorrelationID': uuidv4(),
        UserLanguage: 'FR',
        UserAccountIdentifier: `msisdn;${config.mvola.partnerMsisdn}`,
        partnerName: config.mvola.partnerName,
        Authorization: `Bearer ${token}`,
        'Cache-Control': 'no-cache',
      },
    }
  );
  return resp.json();
}

module.exports = { initierPaiement, statutTransaction, getToken };
