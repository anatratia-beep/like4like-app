exigerConnexion();
const moiAdmin = utilisateurCourant();
if (!moiAdmin || moiAdmin.role !== 'admin') window.location.href = '/app.html';

function afficherOngletAdmin(nom) {
  if (nom !== 'messages') arreterActualisationMessagesAdmin();
  document.querySelectorAll('.nav-bas button').forEach((b) => b.classList.toggle('actif', b.dataset.onglet === nom));
  const titres = { etudiants: 'Gestion des etudiants', achats: 'Achats de jetons à vérifier', publications: 'Publications par classe', messages: 'Messages avec les etudiants', transactions: 'Toutes les transactions', retraits: 'Retraits a traiter', reglages: 'Reglages economiques' };
  document.getElementById('titrePage').textContent = titres[nom];
  ({ etudiants: chargerEtudiants, achats: chargerAchatsEnAttente, publications: chargerPublicationsAdmin, messages: chargerConversationsAdmin, transactions: chargerTransactions, retraits: chargerRetraits, reglages: chargerReglages })[nom]();
}

// ---------- ACHATS DE JETONS EN ATTENTE ----------
async function chargerAchatsEnAttente() {
  const zone = document.getElementById('contenuPage');
  zone.innerHTML = 'Chargement...';
  const achats = await api('/admin/achats-en-attente');
  if (achats.length === 0) {
    zone.innerHTML = '<p>Aucun achat en attente de vérification.</p>';
    return;
  }
  zone.innerHTML = `
    <p class="date">Vérifie d'abord dans ton application Mobile Money que l'argent est bien arrivé (montant + référence), avant de valider.</p>
    ${achats.map((a) => `
      <div class="interaction-item" style="flex-direction:column;align-items:flex-start;">
        <div><b>${echapper(a.nom)}</b> (${nomClasse(a.classe)}) · ${echapper(a.telephone)}</div>
        <div class="date">Montant déclaré : <b style="font-family:var(--font-mono);">${a.montant_ariary} Ar</b> → ${a.montant_jetons} jetons</div>
        <div class="date">Référence fournie : <b style="font-family:var(--font-mono);">${echapper(a.reference_externe)}</b></div>
        <div class="date">${formaterDate(a.created_at)}</div>
        <div class="actions-pub" style="width:100%;">
          <button onclick="validerAchat(${a.id})">${ICONES.valider} Confirmer reçu</button>
          <button class="danger" onclick="rejeterAchat(${a.id})">${ICONES.croix} Rejeter</button>
        </div>
      </div>
    `).join('')}
  `;
}

async function validerAchat(id) {
  try { await api(`/admin/achats/${id}/valider`, 'POST'); chargerAchatsEnAttente(); }
  catch (e) { alert(e.message); }
}
async function rejeterAchat(id) {
  try { await api(`/admin/achats/${id}/rejeter`, 'POST'); chargerAchatsEnAttente(); }
  catch (e) { alert(e.message); }
}

const NOMS_CLASSES = { S1_MATIN: 'S1 Matin', S2_MATIN: 'S2 Matin', S1_APREM: 'S1 Après-midi', S2_APREM: 'S2 Après-midi' };
function nomClasse(code) { return NOMS_CLASSES[code] || code || '—'; }

// ---------- PUBLICATIONS PAR CLASSE ----------
async function chargerPublicationsAdmin() {
  const zone = document.getElementById('contenuPage');
  zone.innerHTML = 'Chargement...';
  const publications = await api('/admin/publications');

  const formulaire = `
    <h3>Publier (gratuit, épinglé en tête du fil)</h3>
    <div class="carte" style="box-shadow:none;border:1px solid var(--border);padding:14px;margin-bottom:8px;">
      <textarea id="contenuPubAdmin" placeholder="Texte de la publication" rows="3"></textarea>
      <input type="url" id="lienPubAdmin" placeholder="Lien vers la publication (Facebook, Instagram, TikTok...)">
      <button onclick="publierAdmin()">Publier</button>
      <div id="messagePubAdmin"></div>
    </div>
  `;

  if (publications.length === 0) {
    zone.innerHTML = formulaire + '<p>Aucune publication pour le moment.</p>';
    return;
  }

  const parClasse = {};
  for (const p of publications) {
    const cle = p.auteur_role === 'admin' ? 'ADMIN' : (p.auteur_classe || 'SANS_CLASSE');
    if (!parClasse[cle]) parClasse[cle] = [];
    parClasse[cle].push(p);
  }

  const ordre = ['ADMIN', 'S1_MATIN', 'S2_MATIN', 'S1_APREM', 'S2_APREM', 'SANS_CLASSE'];
  const nomsGroupes = { ADMIN: 'Administration (épinglé)', ...NOMS_CLASSES, SANS_CLASSE: 'Sans classe' };
  zone.innerHTML = formulaire + ordre
    .filter((cle) => parClasse[cle] && parClasse[cle].length > 0)
    .map((cle) => `
      <h3>${nomsGroupes[cle]} (${parClasse[cle].length} publication${parClasse[cle].length > 1 ? 's' : ''})</h3>
      ${parClasse[cle].map((p) => `
        <div class="publication">
          <div class="auteur">
            <div>
              <div class="nom">${echapper(p.auteur_nom)} <span class="date">(${echapper(p.auteur_telephone)})</span></div>
              <div class="date">${formaterDate(p.created_at)}</div>
            </div>
          </div>
          ${p.contenu ? `<div>${echapper(p.contenu)}</div>` : ''}
          ${p.lien_url ? `<div><a href="${p.lien_url}" target="_blank">${echapper(p.lien_url)}</a></div>` : ''}
          <div class="date">
            J'aime ${p.quota_jaime - p.jaime_restants}/${p.quota_jaime} ·
            Commentaires ${p.quota_commentaire - p.commentaire_restants}/${p.quota_commentaire} ·
            Partages ${p.quota_partage - p.partage_restants}/${p.quota_partage}
            &nbsp;•&nbsp; ${p.nb_validees}/${p.nb_interactions} interaction(s) validee(s)
            &nbsp;•&nbsp; cout : ${p.cout_total === 0 ? 'gratuit' : p.cout_total + ' jetons'}
          </div>
        </div>
      `).join('')}
    `).join('');
}

async function publierAdmin() {
  const contenu = document.getElementById('contenuPubAdmin').value.trim();
  const lien_url = document.getElementById('lienPubAdmin').value.trim();
  const msg = document.getElementById('messagePubAdmin');
  if (!lien_url) { msg.innerHTML = '<div class="erreur">Le lien de la publication est requis</div>'; return; }
  try {
    await api('/publications', 'POST', { contenu, lien_url });
    msg.innerHTML = '<div class="succes">Publication créée et épinglée.</div>';
    chargerPublicationsAdmin();
  } catch (e) { msg.innerHTML = `<div class="erreur">${e.message}</div>`; }
}

// ---------- MESSAGES ----------
let contactActuelAdmin = null;

async function chargerConversationsAdmin() {
  arreterActualisationMessagesAdmin();
  const zone = document.getElementById('contenuPage');
  const [conversations, tousUtilisateurs] = await Promise.all([api('/messages/conversations'), api('/users')]);
  const idsAvecConv = new Set(conversations.map((c) => c.contact_id));
  const autres = tousUtilisateurs.filter((u) => !idsAvecConv.has(u.id));

  zone.innerHTML = `
    <div id="listeConversationsAdmin">
      ${conversations.length === 0 ? '<p>Aucune conversation pour le moment.</p>' : conversations.map((c) => `
        <div class="conversation-item" style="cursor:pointer;" onclick="ouvrirConversationAdmin(${c.contact_id}, '${echapper(c.contact_nom)}')">
          <span><img src="${c.contact_photo || ''}" style="width:28px;height:28px;border-radius:50%;vertical-align:middle;margin-right:8px;" onerror="this.style.visibility='hidden'">${echapper(c.contact_nom)}</span>
          ${c.non_lus > 0 ? `<span class="badge EN_ATTENTE">${c.non_lus}</span>` : ''}
        </div>`).join('')}
    </div>
    <h3>Ecrire a un etudiant</h3>
    <select id="selectContactAdmin">
      <option value="">-- choisir un etudiant --</option>
      ${autres.map((u) => `<option value="${u.id}" data-nom="${echapper(u.nom)}">${echapper(u.nom)}</option>`).join('')}
    </select>
    <button onclick="demarrerConversationAdmin()">Ouvrir</button>
  `;
}

function demarrerConversationAdmin() {
  const select = document.getElementById('selectContactAdmin');
  if (!select.value) return;
  ouvrirConversationAdmin(Number(select.value), select.options[select.selectedIndex].dataset.nom);
}

let intervalleMessagesAdmin = null;
let nbMessagesAffichesAdmin = 0;

async function ouvrirConversationAdmin(contactId, nom) {
  arreterActualisationMessagesAdmin();
  contactActuelAdmin = contactId;
  document.getElementById('titrePage').textContent = nom;
  const zone = document.getElementById('contenuPage');
  zone.innerHTML = `
    <button class="secondaire" onclick="afficherOngletAdmin('messages')">${ICONES.fleche_retour} Retour aux conversations</button>
    <div style="display:flex;gap:6px;margin:4px 0 10px;">
      <button style="width:auto;padding:6px 10px;font-size:11.5px;" onclick="crediterType(${contactId}, '${echapper(nom)}', 'jetons', () => ouvrirConversationAdmin(${contactId}, '${echapper(nom)}'))">+ Jetons</button>
      <button style="width:auto;padding:6px 10px;font-size:11.5px;" onclick="crediterType(${contactId}, '${echapper(nom)}', 'points', () => ouvrirConversationAdmin(${contactId}, '${echapper(nom)}'))">+ Points</button>
      <button style="width:auto;padding:6px 10px;font-size:11.5px;" onclick="crediterType(${contactId}, '${echapper(nom)}', 'ariary', () => ouvrirConversationAdmin(${contactId}, '${echapper(nom)}'))">+ Ariary</button>
    </div>
    <div class="msg-liste" id="listeMessagesAdmin"></div>
    <div class="barre-envoi" style="max-width:900px;">
      <button type="button" class="bouton-emoji" onclick="basculerPanneauEmojisAdmin()">${ICONES.smiley}</button>
      <input type="text" id="texteMessageAdmin" placeholder="Votre message..." onkeydown="if(event.key==='Enter'){event.preventDefault();envoyerMessageAdmin();}">
      <button onclick="envoyerMessageAdmin()">${ICONES.envoyer}</button>
    </div>
  `;
  nbMessagesAffichesAdmin = 0;
  await actualiserMessagesAdmin(true);
  intervalleMessagesAdmin = setInterval(() => actualiserMessagesAdmin(false), 3000);
}

async function actualiserMessagesAdmin(forcerScroll) {
  if (!contactActuelAdmin) return;
  const liste = document.getElementById('listeMessagesAdmin');
  if (!liste) return;
  const messages = await api(`/messages/${contactActuelAdmin}`);
  if (messages.length === nbMessagesAffichesAdmin) return;
  nbMessagesAffichesAdmin = messages.length;
  const enBas = forcerScroll || (liste.scrollHeight - liste.scrollTop - liste.clientHeight < 60);
  liste.innerHTML = messages.map((m) => `
    <div class="bulle ${m.sender_id === moiAdmin.id ? 'moi' : 'autre'}">${echapper(m.contenu)}</div>
  `).join('');
  if (enBas) liste.scrollTop = liste.scrollHeight;
}

function arreterActualisationMessagesAdmin() {
  if (intervalleMessagesAdmin) { clearInterval(intervalleMessagesAdmin); intervalleMessagesAdmin = null; }
  const panneau = document.getElementById('panneauEmojis');
  if (panneau) panneau.remove();
}

function basculerPanneauEmojisAdmin() {
  const existant = document.getElementById('panneauEmojis');
  if (existant) { existant.remove(); return; }
  const panneau = document.createElement('div');
  panneau.id = 'panneauEmojis';
  panneau.className = 'panneau-emojis';
  panneau.style.maxWidth = '400px';
  panneau.innerHTML = EMOJIS_MESSAGERIE.map((e) => `<button type="button" onclick="insererEmojiAdmin('${e}')">${e}</button>`).join('');
  document.body.appendChild(panneau);
}

function insererEmojiAdmin(emoji) {
  const input = document.getElementById('texteMessageAdmin');
  if (!input) return;
  const debut = input.selectionStart ?? input.value.length;
  const fin = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, debut) + emoji + input.value.slice(fin);
  input.focus();
  input.selectionStart = input.selectionEnd = debut + emoji.length;
}

async function envoyerMessageAdmin() {
  const input = document.getElementById('texteMessageAdmin');
  const contenu = input.value.trim();
  if (!contenu || !contactActuelAdmin) return;
  const panneau = document.getElementById('panneauEmojis');
  if (panneau) panneau.remove();
  input.value = '';
  await api('/messages', 'POST', { receiver_id: contactActuelAdmin, contenu });
  await actualiserMessagesAdmin(true);
}

// ---------- ETUDIANTS ----------
async function chargerEtudiants() {
  const zone = document.getElementById('contenuPage');
  const etudiants = await api('/admin/etudiants');
  const nomsClasses = { S1_MATIN: 'S1 Matin', S2_MATIN: 'S2 Matin', S1_APREM: 'S1 Après-midi', S2_APREM: 'S2 Après-midi' };
  zone.innerHTML = `
    <h3>Ajouter un etudiant</h3>
    <input id="nomNouv" placeholder="Nom complet">
    <input id="telNouv" placeholder="Telephone">
    <select id="classeNouv">
      <option value="">-- Choisir la session --</option>
      <option value="S1_MATIN">S1 Matin</option>
      <option value="S2_MATIN">S2 Matin</option>
      <option value="S1_APREM">S1 Après-midi</option>
      <option value="S2_APREM">S2 Après-midi</option>
    </select>
    <input id="mdpNouv" type="password" placeholder="Mot de passe (vide = numéro de téléphone)">
    <button onclick="ajouterEtudiant()">Ajouter</button>
    <div id="messageAjout"></div>

    <h3>Import en masse (JSON)</h3>
    <p style="font-size:12px;color:var(--muted);">Format : [{"nom":"Rakoto Jean","telephone":"0341234567","classe":"S1_MATIN","mot_de_passe":"optionnel"}, ...]</p>
    <textarea id="jsonImport" rows="4" placeholder='[{"nom":"...","telephone":"...","classe":"S1_MATIN"}]'></textarea>
    <button onclick="importerEtudiants()">Importer</button>
    <div id="messageImport"></div>

    <h3>Liste (${etudiants.length})</h3>
    <table>
      <tr><th>Nom</th><th>Classe</th><th>Tel</th><th>Jetons</th><th>Points</th><th>Ariary</th><th>Statut</th><th></th></tr>
      ${etudiants.map((e) => `
        <tr>
          <td>${echapper(e.nom)}</td><td>${nomsClasses[e.classe] || '-'}</td><td>${echapper(e.telephone)}</td>
          <td>${e.jetons}</td><td>${e.points}</td><td>${e.solde_ariary}</td>
          <td>${e.actif ? '<span class="badge VALIDE">Actif</span>' : '<span class="badge REJETE">Inactif</span>'}</td>
          <td>
            <button style="width:auto;padding:4px 7px;font-size:11px;" title="Créditer des jetons" onclick="crediterType(${e.id}, '${echapper(e.nom)}', 'jetons')">+J</button>
            <button style="width:auto;padding:4px 7px;font-size:11px;" title="Créditer des points" onclick="crediterType(${e.id}, '${echapper(e.nom)}', 'points')">+P</button>
            <button style="width:auto;padding:4px 7px;font-size:11px;" title="Créditer de l'Ariary" onclick="crediterType(${e.id}, '${echapper(e.nom)}', 'ariary')">+A</button>
            ${e.role !== 'admin' ? `<button style="width:auto;padding:4px 8px;font-size:12px;" class="secondaire" onclick="basculerActif(${e.id}, ${e.actif})">${e.actif ? 'Desactiver' : 'Reactiver'}</button>` : ''}
          </td>
        </tr>`).join('')}
    </table>
  `;
}

async function ajouterEtudiant() {
  const nom = document.getElementById('nomNouv').value.trim();
  const telephone = document.getElementById('telNouv').value.trim();
  const classe = document.getElementById('classeNouv').value;
  const mot_de_passe = document.getElementById('mdpNouv').value.trim();
  const msg = document.getElementById('messageAjout');
  if (!classe) { msg.innerHTML = '<div class="erreur">Choisis une session</div>'; return; }
  try {
    const r = await api('/admin/etudiants', 'POST', { nom, telephone, classe, mot_de_passe: mot_de_passe || undefined });
    msg.innerHTML = `<div class="succes">Ajoute ! Mot de passe initial : ${r.mot_de_passe_initial}</div>`;
    chargerEtudiants();
  } catch (e) { msg.innerHTML = `<div class="erreur">${e.message}</div>`; }
}

async function importerEtudiants() {
  const msg = document.getElementById('messageImport');
  try {
    const etudiants = JSON.parse(document.getElementById('jsonImport').value);
    const r = await api('/admin/etudiants/import', 'POST', { etudiants });
    const succes = r.resultats.filter((x) => x.ok).length;
    msg.innerHTML = `<div class="succes">${succes}/${r.resultats.length} etudiants importes.</div>`;
    chargerEtudiants();
  } catch (e) { msg.innerHTML = `<div class="erreur">${e.message}</div>`; }
}

async function basculerActif(id, actifActuel) {
  await api(`/admin/etudiants/${id}/${actifActuel ? 'desactiver' : 'reactiver'}`, 'PUT');
  chargerEtudiants();
}

function crediterType(id, nom, type, apresSucces) {
  const libelles = { jetons: 'jetons', points: 'points', ariary: 'Ariary' };
  const montant = Number(prompt(`Montant de ${libelles[type]} pour ${nom} (peut être négatif) :`, '0'));
  if (!montant) return;
  const corps = { jetons: 0, points: 0, ariary: 0, description: `Ajustement ${libelles[type]} manuel admin pour ${nom}` };
  corps[type] = montant;
  api(`/admin/etudiants/${id}/credit-manuel`, 'POST', corps)
    .then(() => { if (apresSucces) apresSucces(); else chargerEtudiants(); })
    .catch((e) => alert(e.message));
}

// ---------- TRANSACTIONS ----------
async function chargerTransactions() {
  const zone = document.getElementById('contenuPage');
  const transactions = await api('/admin/transactions');
  zone.innerHTML = `
    <table>
      <tr><th>Date</th><th>Etudiant</th><th>Type</th><th>Ariary</th><th>Jetons</th><th>Points</th><th>Statut</th></tr>
      ${transactions.map((t) => `
        <tr>
          <td>${formaterDate(t.created_at)}</td>
          <td>${echapper(t.nom)}</td>
          <td>${t.type}</td>
          <td>${t.montant_ariary}</td>
          <td>${t.montant_jetons}</td>
          <td>${t.montant_points}</td>
          <td><span class="badge ${t.statut}">${t.statut}</span></td>
        </tr>`).join('')}
    </table>
  `;
}

// ---------- RETRAITS ----------
async function chargerRetraits() {
  const zone = document.getElementById('contenuPage');
  const retraits = await api('/admin/retraits?statut=EN_ATTENTE');
  zone.innerHTML = `
    <p class="date">Envoie d'abord l'argent toi-même via Mobile Money, puis renseigne la référence reçue pour confirmer — c'est seulement à ce moment que le solde de l'étudiant est débité.</p>
    ${retraits.length === 0 ? '<p>Aucun retrait en attente.</p>' : retraits.map((r) => `
    <div class="retrait-item">
      <span>${echapper(r.nom)} (${nomClasse(r.classe)}) : ${r.montant_ariary} Ar &rarr; ${echapper(r.telephone_reception)}</span>
      <span>
        <button style="width:auto;padding:4px 8px;font-size:12px;" onclick="marquerPaye(${r.id})">Confirmer envoyé</button>
        <button style="width:auto;padding:4px 8px;font-size:12px;" class="danger" onclick="rejeterRetrait(${r.id})">Rejeter</button>
      </span>
    </div>`).join('')}
  `;
}
async function marquerPaye(id) {
  const reference = prompt('Référence du versement effectué (reçue par SMS après ton envoi Mobile Money) :');
  if (!reference || !reference.trim()) return;
  try {
    await api(`/admin/retraits/${id}/marquer-paye`, 'POST', { reference: reference.trim() });
    chargerRetraits();
  } catch (e) { alert(e.message); }
}
async function rejeterRetrait(id) { await api(`/admin/retraits/${id}/rejeter`, 'POST'); chargerRetraits(); }

// ---------- REGLAGES ----------
async function chargerReglages() {
  const zone = document.getElementById('contenuPage');
  const reglages = await api('/admin/reglages');
  zone.innerHTML = `
    <h3>Inscription des étudiants</h3>
    <label>Code d'inscription (à communiquer aux 142 étudiants)</label>
    <input type="text" id="r_code_inscription" value="${reglages.code_inscription || ''}">

    <label>Numéro Mobile Money de réception des paiements</label>
    <input type="text" id="r_numero_reception" value="${reglages.numero_reception_paiement || ''}">
    <p class="date">Les étudiants voient ce numéro dans leur portefeuille pour envoyer l'argent avant de coller la référence.</p>
    <p class="date">Les étudiants créent eux-mêmes leur compte sur /inscription.html avec ce code.</p>

    <p style="color:var(--muted);font-size:13px;">
      Une publication debite automatiquement : (quota j'aime × cout) + (quota commentaire × cout) + (quota partage × cout).<br>
      Quand une interaction est validee, l'etudiant qui a interagi recoit le cout en jetons du type, converti en points (1 point = "jetons par point" jetons).
    </p>
    <h3>Achat de jetons</h3>
    <label>Ariary par jeton (1000 Ar = combien de jetons ?)</label>
    <input type="number" id="r_ariary_par_jeton" value="${reglages.ariary_par_jeton}">

    <h3>Quotas par publication</h3>
    <label>Quota j'aime</label><input type="number" id="r_quota_jaime" value="${reglages.quota_jaime}">
    <label>Quota commentaires</label><input type="number" id="r_quota_commentaire" value="${reglages.quota_commentaire}">
    <label>Quota partages</label><input type="number" id="r_quota_partage" value="${reglages.quota_partage}">

    <h3>Cout en jetons par type d'interaction</h3>
    <label>Jetons par j'aime</label><input type="number" id="r_jetons_par_jaime" value="${reglages.jetons_par_jaime}">
    <label>Jetons par commentaire</label><input type="number" id="r_jetons_par_commentaire" value="${reglages.jetons_par_commentaire}">
    <label>Jetons par partage</label><input type="number" id="r_jetons_par_partage" value="${reglages.jetons_par_partage}">

    <h3>Conversion des gains</h3>
    <label>Jetons par point (jetons gagnes -> points)</label>
    <input type="number" id="r_jetons_par_point" value="${reglages.jetons_par_point}">
    <label>Ariary par point (encaissement final)</label>
    <input type="number" id="r_ariary_par_point" value="${reglages.ariary_par_point}">

    <h3>Validation</h3>
    <label>Delai de validation automatique (heures)</label>
    <input type="number" id="r_delai_validation_heures" value="${reglages.delai_validation_heures}">

    <p id="apercuCout" style="font-weight:600;"></p>
    <p id="apercuPoints" style="font-weight:600;color:var(--primary-dark);"></p>
    <button onclick="enregistrerReglages()">Enregistrer</button>
    <div id="messageReglages"></div>
  `;
  majApercuCout();
  zone.querySelectorAll('input').forEach((i) => i.addEventListener('input', majApercuCout));
}

function majApercuCout() {
  const v = (id) => Number(document.getElementById(id).value) || 0;
  const cout = v('r_quota_jaime') * v('r_jetons_par_jaime')
    + v('r_quota_commentaire') * v('r_jetons_par_commentaire')
    + v('r_quota_partage') * v('r_jetons_par_partage');
  document.getElementById('apercuCout').textContent = `Cout d'une publication avec ces reglages : ${cout} jetons`;

  const jetonsParPoint = v('r_jetons_par_point') || 1;
  const pointsPour = (jetons) => jetons > 0 ? Math.max(1, Math.round(jetons / jetonsParPoint)) : 0;
  const pJaime = pointsPour(v('r_jetons_par_jaime'));
  const pComm = pointsPour(v('r_jetons_par_commentaire'));
  const pPartage = pointsPour(v('r_jetons_par_partage'));
  document.getElementById('apercuPoints').textContent =
    `Points gagnés par l'étudiant qui interagit : J'aime ${pJaime} pt · Commentaire ${pComm} pt · Partage ${pPartage} pt`
    + (v('r_jetons_par_jaime') > 0 && pJaime === 1 && v('r_jetons_par_jaime') < jetonsParPoint / 2
      ? ' — Attention : certaines valeurs sont très basses par rapport à "jetons par point", tout arrondit au minimum de 1 point.'
      : '');
}

async function enregistrerReglages() {
  const msg = document.getElementById('messageReglages');
  const corps = {
    code_inscription: document.getElementById('r_code_inscription').value.trim(),
    numero_reception_paiement: document.getElementById('r_numero_reception').value.trim(),
    ariary_par_jeton: Number(document.getElementById('r_ariary_par_jeton').value),
    quota_jaime: Number(document.getElementById('r_quota_jaime').value),
    quota_commentaire: Number(document.getElementById('r_quota_commentaire').value),
    quota_partage: Number(document.getElementById('r_quota_partage').value),
    jetons_par_jaime: Number(document.getElementById('r_jetons_par_jaime').value),
    jetons_par_commentaire: Number(document.getElementById('r_jetons_par_commentaire').value),
    jetons_par_partage: Number(document.getElementById('r_jetons_par_partage').value),
    jetons_par_point: Number(document.getElementById('r_jetons_par_point').value),
    ariary_par_point: Number(document.getElementById('r_ariary_par_point').value),
    delai_validation_heures: Number(document.getElementById('r_delai_validation_heures').value),
  };
  try {
    await api('/admin/reglages', 'PUT', corps);
    msg.innerHTML = '<div class="succes">Reglages enregistres !</div>';
  } catch (e) { msg.innerHTML = `<div class="erreur">${e.message}</div>`; }
}

afficherOngletAdmin('etudiants');
initNotificationsSiDejaActivees();
