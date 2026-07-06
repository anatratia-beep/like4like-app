const cron = require('node-cron');
const { db, getSetting } = require('../db');
const push = require('./push');

const COLONNE_JETONS = { LIKE: 'jetons_par_jaime', COMMENTAIRE: 'jetons_par_commentaire', PARTAGE: 'jetons_par_partage' };

function validerInteraction(interaction) {
  const pub = db.prepare('SELECT * FROM publications WHERE id = ?').get(interaction.publication_id);
  if (!pub) return;

  const jetonsGagnes = pub[COLONNE_JETONS[interaction.type]];
  const jetonsParPoint = getSetting('jetons_par_point') || 100;
  // Garantie : si l'interaction rapporte des jetons, elle doit toujours donner au moins 1 point,
  // meme si le ratio jetons/point choisi dans les reglages arrondirait sinon a 0.
  const pointsGagnes = jetonsGagnes > 0 ? Math.max(1, Math.round(jetonsGagnes / jetonsParPoint)) : 0;

  const maj = db.transaction(() => {
    db.prepare(
      `UPDATE interactions SET statut = 'VALIDEE', jetons_attribues = ?, points_attribues = ?, validated_at = datetime('now') WHERE id = ?`
    ).run(jetonsGagnes, pointsGagnes, interaction.id);

    if (pointsGagnes > 0) {
      db.prepare('UPDATE users SET points = points + ? WHERE id = ?').run(pointsGagnes, interaction.user_id);
      db.prepare(
        `INSERT INTO transactions (user_id, type, montant_points, description)
         VALUES (?, 'GAIN_POINTS', ?, ?)`
      ).run(
        interaction.user_id,
        pointsGagnes,
        `${pointsGagnes} points pour ${interaction.type.toLowerCase()} valide sur publication #${pub.id}`
      );
    }
  });
  maj();

  if (pointsGagnes > 0) {
    push.notifier(interaction.user_id, {
      titre: '🎉 Points gagnés',
      corps: `+${pointsGagnes} points pour votre ${interaction.type.toLowerCase()} validé !`,
      url: '/app.html',
    });
  }
}

function lancerPlanificateur() {
  // Toutes les 15 minutes : valide automatiquement les interactions en attente
  // dont le delai (par defaut 48h) est depasse.
  cron.schedule('*/15 * * * *', () => {
    const enAttente = db
      .prepare(
        `SELECT * FROM interactions
         WHERE statut = 'EN_ATTENTE' AND date_limite_validation <= datetime('now')`
      )
      .all();

    for (const interaction of enAttente) {
      try {
        validerInteraction(interaction);
        console.log(`[scheduler] Interaction #${interaction.id} auto-validee (48h ecoulees)`);
      } catch (e) {
        console.error(`[scheduler] Erreur validation interaction #${interaction.id}`, e);
      }
    }
  });

  console.log('[scheduler] Validation automatique des points (48h) demarree.');
}

module.exports = { lancerPlanificateur, validerInteraction };
