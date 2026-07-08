const crypto = require('crypto');
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('./config');

const db = new Database(path.join(__dirname, '..', 'data.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  classe TEXT,                                -- S1_MATIN | S2_MATIN | S1_APREM | S2_APREM (vide pour l'admin)
  telephone TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  photo_url TEXT,
  role TEXT NOT NULL DEFAULT 'etudiant',      -- etudiant | admin
  jetons INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  solde_ariary INTEGER NOT NULL DEFAULT 0,    -- Ariary converti, en attente de retrait
  actif INTEGER NOT NULL DEFAULT 1,
  doit_changer_mdp INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,          -- ACHAT_JETONS | DEBIT_PUBLICATION | GAIN_POINTS | CONVERSION_POINTS_ARIARY | RETRAIT | CREDIT_ADMIN | DEBIT_ADMIN
  montant_ariary INTEGER NOT NULL DEFAULT 0,
  montant_jetons INTEGER NOT NULL DEFAULT 0,
  montant_points INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  reference_externe TEXT,      -- ex: transID MVola
  statut TEXT NOT NULL DEFAULT 'VALIDE', -- EN_ATTENTE | VALIDE | ECHEC
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS publications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  contenu TEXT,
  lien_url TEXT,
  cout_total INTEGER NOT NULL,
  -- Quotas et couts figes au moment de la creation (meme si les reglages admin changent ensuite)
  quota_jaime INTEGER NOT NULL,
  quota_commentaire INTEGER NOT NULL,
  quota_partage INTEGER NOT NULL,
  jaime_restants INTEGER NOT NULL,
  commentaire_restants INTEGER NOT NULL,
  partage_restants INTEGER NOT NULL,
  jetons_par_jaime INTEGER NOT NULL,
  jetons_par_commentaire INTEGER NOT NULL,
  jetons_par_partage INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publication_id INTEGER NOT NULL REFERENCES publications(id),
  user_id INTEGER NOT NULL REFERENCES users(id),   -- celui qui a fait le like/commentaire/partage
  type TEXT NOT NULL,                -- LIKE | COMMENTAIRE | PARTAGE
  preuve_type TEXT NOT NULL,         -- LIEN | IMAGE
  preuve_url TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'EN_ATTENTE', -- EN_ATTENTE | VALIDEE | REJETEE
  jetons_attribues INTEGER NOT NULL DEFAULT 0,
  points_attribues INTEGER NOT NULL DEFAULT 0,
  date_limite_validation TEXT NOT NULL,
  validated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(publication_id, user_id, type)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  receiver_id INTEGER NOT NULL REFERENCES users(id),
  contenu TEXT NOT NULL,
  lu INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS retraits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  montant_ariary INTEGER NOT NULL,
  telephone_reception TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'EN_ATTENTE', -- EN_ATTENTE | PAYE | REJETE
  reference_paiement TEXT,   -- preuve (reference MVola) du versement reel, saisie par l'admin
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  traite_at TEXT
);

CREATE TABLE IF NOT EXISTS sms_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cle_valide INTEGER NOT NULL,
  texte_brut TEXT,
  type_detecte TEXT,   -- RECU | TRANSFERE | NULL si non reconnu
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sms_recus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,          -- RECU (argent recu) | TRANSFERE (argent envoye)
  montant INTEGER NOT NULL,
  telephone TEXT,
  reference TEXT NOT NULL UNIQUE,
  texte_brut TEXT,
  consomme INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_interactions_pub ON interactions(publication_id);
CREATE INDEX IF NOT EXISTS idx_interactions_statut ON interactions(statut);
CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id, receiver_id);
`);

// ---- Réglages par défaut (uniquement s'ils n'existent pas encore) ----
const insertSetting = db.prepare(
  'INSERT INTO settings (key, value) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = ?)'
);
for (const [key, value] of Object.entries(config.reglesParDefaut)) {
  insertSetting.run(key, String(value), key);
}
insertSetting.run('code_inscription', config.codeInscriptionParDefaut, 'code_inscription');
insertSetting.run('numero_reception_paiement', config.numeroReceptionParDefaut, 'numero_reception_paiement');
insertSetting.run('sms_gateway_secret', crypto.randomBytes(16).toString('hex'), 'sms_gateway_secret');

// Migration idempotente : ajoute la colonne si la base existait deja sans elle
// (par ex. deploiement Render deja en place avant cet ajout).
try {
  db.exec('ALTER TABLE retraits ADD COLUMN reference_paiement TEXT');
} catch (e) {
  // La colonne existe deja : rien a faire.
}

// ---- Compte admin par défaut si aucun admin n'existe ----
const adminExiste = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
if (!adminExiste) {
  const hash = bcrypt.hashSync(config.admin.password, 10);
  db.prepare(
    `INSERT INTO users (nom, telephone, password_hash, role, doit_changer_mdp)
     VALUES ('Administrateur', ?, ?, 'admin', 1)`
  ).run(config.admin.telephone, hash);
  console.log(`[seed] Compte admin cree : telephone="${config.admin.telephone}" mot de passe initial="${config.admin.password}" (a changer !)`);
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? Number(row.value) : null;
}

function getTextSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function getAllSettings() {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key NOT IN ('code_inscription', 'numero_reception_paiement', 'sms_gateway_secret')").all();
  const obj = {};
  for (const r of rows) obj[r.key] = Number(r.value);
  return obj;
}

module.exports = { db, getSetting, getTextSetting, getAllSettings };
