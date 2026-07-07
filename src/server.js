const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
require('./db'); // initialise la base au demarrage (schema + admin par defaut)
const config = require('./config');
const { lancerPlanificateur } = require('./services/scheduler');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const walletRoutes = require('./routes/wallet');
const publicationRoutes = require('./routes/publications');
const interactionRoutes = require('./routes/interactions');
const messageRoutes = require('./routes/messages');
const adminRoutes = require('./routes/admin');
const pushRoutes = require('./routes/push');
const { router: smsRoutes } = require('./routes/sms');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/publications', publicationRoutes);
app.use('/api', interactionRoutes); // expose /api/publications/:id/interactions et /api/interactions/...
app.use('/api/messages', messageRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/sms', smsRoutes);

app.get('/api/sante', (req, res) => res.json({ ok: true, heure: new Date().toISOString() }));

// Gestionnaire d'erreurs global
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: 'Fichier trop volumineux. Reduis la taille de la photo/image et reessaie.',
    };
    return res.status(400).json({ erreur: messages[err.code] || `Erreur upload (${err.code})` });
  }
  console.error(err);
  res.status(500).json({ erreur: 'Erreur serveur', detail: err.message });
});

// Filet de securite : empeche un crash complet si une erreur imprevue s'echappe
// (par ex. un flux de fichier interrompu). Le serveur continue de tourner.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] Le serveur continue de tourner, mais voici l\'erreur :', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection] Le serveur continue de tourner, mais voici l\'erreur :', err);
});

lancerPlanificateur();

app.listen(config.port, () => {
  console.log(`Serveur demarre sur http://localhost:${config.port}`);
});
