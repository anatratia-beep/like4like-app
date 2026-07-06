const webpush = require('web-push');
const { db } = require('../db');
const config = require('../config');

let configure = false;
function assurerConfiguration() {
  if (configure) return;
  if (!config.vapid.publicKey || !config.vapid.privateKey) {
    console.warn('[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY manquants : notifications push desactivees.');
    return;
  }
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
  configure = true;
}

/**
 * Envoie une notification push a TOUS les appareils abonnes d'un utilisateur.
 * Nettoie automatiquement les abonnements expires/invalides (code 404/410).
 */
async function notifier(userId, { titre, corps, url }) {
  assurerConfiguration();
  if (!configure) return;

  const abonnements = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  if (abonnements.length === 0) return;

  const payload = JSON.stringify({ titre, corps, url: url || '/' });

  for (const abo of abonnements) {
    const subscription = {
      endpoint: abo.endpoint,
      keys: { p256dh: abo.p256dh, auth: abo.auth },
    };
    try {
      await webpush.sendNotification(subscription, payload);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(abo.id);
      } else {
        console.error('[push] Erreur envoi notification:', err.message);
      }
    }
  }
}

module.exports = { notifier };
