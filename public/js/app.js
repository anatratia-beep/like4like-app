exigerConnexion();
const moi = utilisateurCourant();
let ongletActuel = 'fil';
let contactActuel = null;

function nomClasse(code) {
  const noms = { S1_MATIN: 'S1 Matin', S2_MATIN: 'S2 Matin', S1_APREM: 'S1 Après-midi', S2_APREM: 'S2 Après-midi' };
  return noms[code] || code || '';
}

async function majSoldes() {
  try {
    const s = await api('/wallet/solde');
    document.getElementById('soldeJetons').textContent = s.jetons;
    document.getElementById('soldePoints').textContent = s.points;
    document.getElementById('soldeAriary').textContent = s.solde_ariary;
  } catch (e) { console.error(e); }
}

function afficherOnglet(nom) {
  ongletActuel = nom;
  document.querySelectorAll('.nav-bas button').forEach((b) =>
    b.classList.toggle('actif', b.dataset.onglet === nom)
  );
  const titres = { fil: 'Fil des publications', publier: 'Nouvelle publication', valider: 'Interactions a valider', portefeuille: 'Mon portefeuille', messages: 'Messages', profil: 'Mon profil' };
  document.getElementById('titrePage').textContent = titres[nom];
  const fonctions = { fil: chargerFil, publier: chargerPublier, valider: chargerAValider, portefeuille: chargerPortefeuille, messages: chargerConversations, profil: chargerProfil };
  fonctions[nom]();
  majSoldes();
}

// ---------- FIL ----------
async function chargerFil() {
  const zone = document.getElementById('contenuPage');
  zone.innerHTML = 'Chargement...';
  const publications = await api('/publications');
  if (publications.length === 0) { zone.innerHTML = '<p>Aucune publication pour le moment.</p>'; return; }
  zone.innerHTML = publications.map((p) => `
    <div class="publication">
      <div class="auteur">
        <img src="${p.auteur_photo || ''}" onerror="this.style.visibility='hidden'">
        <div>
          <div class="nom">${echapper(p.auteur_nom)}</div>
          <div class="date">${formaterDate(p.created_at)}</div>
        </div>
      </div>
      <div>${echapper(p.contenu)}</div>
      ${p.lien_url ? `<div><a href="${p.lien_url}" target="_blank">${echapper(p.lien_url)}</a></div>` : ''}
      <div class="date">J'aime ${p.jaime_restants}/${p.quota_jaime} · Commentaires ${p.commentaire_restants}/${p.quota_commentaire} · Partages ${p.partage_restants}/${p.quota_partage}</div>
      ${p.user_id !== moi.id ? `
      <div class="actions-pub">
        <button onclick="ouvrirPreuve(${p.id}, 'LIKE')" ${p.jaime_restants <= 0 ? 'disabled' : ''}>${ICONES.coeur} J'aime</button>
        <button class="secondaire" onclick="ouvrirPreuve(${p.id}, 'COMMENTAIRE')" ${p.commentaire_restants <= 0 ? 'disabled' : ''}>${ICONES.commentaire} Commenter</button>
        <button class="secondaire" onclick="ouvrirPreuve(${p.id}, 'PARTAGE')" ${p.partage_restants <= 0 ? 'disabled' : ''}>${ICONES.partage} Partager</button>
      </div>` : '<div class="badge">Votre publication</div>'}
    </div>
  `).join('');
}

let interactionEnCours = null;

function ouvrirPreuve(publicationId, type) {
  interactionEnCours = { publicationId, type };
  const noms = { LIKE: "un j'aime", COMMENTAIRE: 'un commentaire', PARTAGE: 'un partage' };
  const zone = document.getElementById('contenuPage');
  zone.dataset.retourFil = 'oui';
  zone.innerHTML = `
    <button class="secondaire" onclick="chargerFil()">${ICONES.fleche_retour} Annuler</button>
    <h3>Preuve pour ${noms[type]}</h3>
    <p class="date">Fournis soit un lien, soit une capture d'ecran prouvant ton interaction.</p>
    <input type="url" id="preuveLien" placeholder="Lien (ex: capture hebergee, post...)">
    <p style="text-align:center;color:var(--muted);">-- ou --</p>
    <input type="file" id="preuveImage" accept="image/*">
    <button onclick="envoyerInteraction()">Envoyer la preuve</button>
    <div id="messagePreuve"></div>
  `;
}

async function envoyerInteraction() {
  const lien = document.getElementById('preuveLien').value.trim();
  const fichier = document.getElementById('preuveImage').files[0];
  const msg = document.getElementById('messagePreuve');
  if (!lien && !fichier) { msg.innerHTML = '<div class="erreur">Fournis un lien ou une image</div>'; return; }

  const formData = new FormData();
  formData.append('type', interactionEnCours.type);
  if (lien) formData.append('preuve_lien', lien);
  if (fichier) formData.append('preuve_image', fichier);

  try {
    await api(`/publications/${interactionEnCours.publicationId}/interactions`, 'POST', formData, true);
    alert("Interaction enregistree ! Elle sera validee par l'auteur (ou automatiquement apres le delai).");
    chargerFil();
  } catch (e) {
    msg.innerHTML = `<div class="erreur">${e.message}</div>`;
  }
}

// ---------- PUBLIER ----------
async function chargerPublier() {
  const zone = document.getElementById('contenuPage');
  const t = await api('/publications/tarif-actuel');
  const s = await api('/wallet/solde');
  zone.innerHTML = `
    <div class="carte" style="box-shadow:none;border:1px solid #e5eae6;padding:12px;">
      <b>Cout de cette publication : ${t.cout_total} jetons</b>
      <table style="margin-top:8px;">
        <tr><th>Type</th><th>Quota</th><th>Cout/action</th></tr>
        <tr><td>J'aime</td><td>${t.quota_jaime}</td><td>${t.jetons_par_jaime} jetons</td></tr>
        <tr><td>Commentaire</td><td>${t.quota_commentaire}</td><td>${t.jetons_par_commentaire} jetons</td></tr>
        <tr><td>Partage</td><td>${t.quota_partage}</td><td>${t.jetons_par_partage} jetons</td></tr>
      </table>
      <p class="date">Vous avez actuellement <b>${s.jetons} jetons</b>.</p>
    </div>
    <textarea id="contenuPub" placeholder="Texte de votre publication" rows="3"></textarea>
    <input type="url" id="lienPub" placeholder="Lien vers la publication (Facebook, Instagram, TikTok...)" required>
    <button onclick="publier()">Publier (-${t.cout_total} jetons)</button>
    <div id="messagePub"></div>
  `;
}

async function publier() {
  const contenu = document.getElementById('contenuPub').value.trim();
  const lien_url = document.getElementById('lienPub').value.trim();
  const msg = document.getElementById('messagePub');
  if (!lien_url) { msg.innerHTML = '<div class="erreur">Le lien de la publication est requis</div>'; return; }
  try {
    const r = await api('/publications', 'POST', { contenu, lien_url });
    msg.innerHTML = `<div class="succes">Publication creee ! (-${r.cout_total} jetons)</div>`;
    document.getElementById('contenuPub').value = '';
    document.getElementById('lienPub').value = '';
    majSoldes();
    chargerPublier();
  } catch (e) {
    msg.innerHTML = `<div class="erreur">${e.message}</div>`;
  }
}

// ---------- A VALIDER ----------
async function chargerAValider() {
  const zone = document.getElementById('contenuPage');
  zone.innerHTML = 'Chargement...';
  const interactions = await api('/interactions/a-valider');
  if (interactions.length === 0) { zone.innerHTML = '<p>Aucune interaction en attente sur vos publications.</p>'; return; }
  zone.innerHTML = interactions.map((i) => `
    <div class="interaction-item" style="flex-direction:column;align-items:flex-start;">
      <div><b>${echapper(i.interacteur_nom)}</b> a fait : <span class="badge">${i.type}</span></div>
      <div class="date">Sur : "${echapper((i.publication_contenu || '').slice(0, 60))}" • ${formaterDate(i.created_at)}</div>
      <div class="date">Delai de validation automatique : ${formaterDate(i.date_limite_validation)}</div>
      <div>${i.preuve_type === 'IMAGE'
        ? `<img src="${i.preuve_url}" style="max-width:100%;border-radius:8px;margin-top:6px;">`
        : `<a href="${i.preuve_url}" target="_blank">Voir la preuve (lien)</a>`}</div>
      <div class="actions-pub" style="width:100%;">
        <button onclick="validerInteraction(${i.id})">${ICONES.valider} Valider</button>
        <button class="danger" onclick="rejeterInteraction(${i.id})">${ICONES.croix} Rejeter</button>
      </div>
    </div>
  `).join('');
}

async function validerInteraction(id) {
  try { await api(`/interactions/${id}/valider`, 'POST'); chargerAValider(); majSoldes(); }
  catch (e) { alert(e.message); }
}
async function rejeterInteraction(id) {
  try { await api(`/interactions/${id}/rejeter`, 'POST'); chargerAValider(); }
  catch (e) { alert(e.message); }
}

// ---------- PORTEFEUILLE ----------
async function chargerPortefeuille() {
  const zone = document.getElementById('contenuPage');
  const [historique, retraits] = await Promise.all([api('/users/me/historique'), api('/wallet/mes-retraits')]);
  zone.innerHTML = `
    <h3>Acheter des jetons (Mobile Money)</h3>
    <input type="number" id="montantAchat" placeholder="Montant en Ariary (ex: 1000)" min="100">
    <button onclick="acheterJetons()">Payer via MVola</button>
    <div id="messageAchat"></div>

    <h3>Convertir des points en Ariary</h3>
    <input type="number" id="pointsAConvertir" placeholder="Nombre de points">
    <button onclick="convertirPoints()">Convertir</button>
    <div id="messageConversion"></div>

    <h3>Demander un retrait</h3>
    <input type="number" id="montantRetrait" placeholder="Montant Ariary a retirer">
    <input type="text" id="telephoneRetrait" placeholder="Numero mobile money de reception">
    <button onclick="demanderRetrait()">Demander le retrait</button>
    <div id="messageRetrait"></div>

    <h3>Mes retraits</h3>
    ${retraits.length === 0 ? '<p>Aucun retrait.</p>' : retraits.map((r) => `
      <div class="retrait-item">
        <span>${r.montant_ariary} Ar &rarr; ${echapper(r.telephone_reception)}</span>
        <span class="badge ${r.statut}">${r.statut}</span>
      </div>`).join('')}

    <h3>Historique des transactions</h3>
    ${historique.length === 0 ? '<p>Aucune transaction.</p>' : historique.map((t) => `
      <div class="transaction-item">
        <span>${echapper(t.description || t.type)}<br><span class="date">${formaterDate(t.created_at)}</span></span>
        <span class="badge ${t.statut}">${t.statut}</span>
      </div>`).join('')}
  `;
}

async function acheterJetons() {
  const montant = Number(document.getElementById('montantAchat').value);
  const msg = document.getElementById('messageAchat');
  try {
    const r = await api('/wallet/achat-jetons', 'POST', { montant_ariary: montant });
    msg.innerHTML = `<div class="succes">${r.message}</div>`;
  } catch (e) { msg.innerHTML = `<div class="erreur">${e.message}</div>`; }
}

async function convertirPoints() {
  const points = Number(document.getElementById('pointsAConvertir').value);
  const msg = document.getElementById('messageConversion');
  try {
    const r = await api('/wallet/convertir-points', 'POST', { points });
    msg.innerHTML = `<div class="succes">${r.montant_ariary_credite} Ar credites !</div>`;
    majSoldes();
    chargerPortefeuille();
  } catch (e) { msg.innerHTML = `<div class="erreur">${e.message}</div>`; }
}

async function demanderRetrait() {
  const montant_ariary = Number(document.getElementById('montantRetrait').value);
  const telephone_reception = document.getElementById('telephoneRetrait').value.trim();
  const msg = document.getElementById('messageRetrait');
  try {
    const r = await api('/wallet/retrait', 'POST', { montant_ariary, telephone_reception });
    msg.innerHTML = `<div class="succes">${r.message}</div>`;
    majSoldes();
    chargerPortefeuille();
  } catch (e) { msg.innerHTML = `<div class="erreur">${e.message}</div>`; }
}

// ---------- MESSAGES ----------
async function chargerConversations() {
  const zone = document.getElementById('contenuPage');
  const [conversations, tousUtilisateurs] = await Promise.all([api('/messages/conversations'), api('/users')]);
  const idsAvecConv = new Set(conversations.map((c) => c.contact_id));
  const autres = tousUtilisateurs.filter((u) => !idsAvecConv.has(u.id));

  zone.innerHTML = `
    <div id="listeConversations">
      ${conversations.map((c) => `
        <div class="conversation-item" style="cursor:pointer;" onclick="ouvrirConversation(${c.contact_id}, '${echapper(c.contact_nom)}')">
          <span><img src="${c.contact_photo || ''}" style="width:28px;height:28px;border-radius:50%;vertical-align:middle;margin-right:8px;" onerror="this.style.visibility='hidden'">${echapper(c.contact_nom)}</span>
          ${c.non_lus > 0 ? `<span class="badge EN_ATTENTE">${c.non_lus}</span>` : ''}
        </div>`).join('')}
    </div>
    <h3>Demarrer une nouvelle conversation</h3>
    <select id="selectContact">
      <option value="">-- choisir un etudiant --</option>
      ${autres.map((u) => `<option value="${u.id}" data-nom="${echapper(u.nom)}">${echapper(u.nom)}</option>`).join('')}
    </select>
    <button onclick="demarrerConversation()">Ouvrir</button>
  `;
}

function demarrerConversation() {
  const select = document.getElementById('selectContact');
  if (!select.value) return;
  ouvrirConversation(Number(select.value), select.options[select.selectedIndex].dataset.nom);
}

async function ouvrirConversation(contactId, nom) {
  contactActuel = contactId;
  document.getElementById('titrePage').textContent = nom;
  const zone = document.getElementById('contenuPage');
  zone.innerHTML = `
    <button class="secondaire" onclick="chargerConversations()">${ICONES.fleche_retour} Retour aux conversations</button>
    <div class="msg-liste" id="listeMessages"></div>
    <div class="barre-envoi">
      <input type="text" id="texteMessage" placeholder="Votre message...">
      <button onclick="envoyerMessage()">${ICONES.envoyer}</button>
    </div>
  `;
  const messages = await api(`/messages/${contactId}`);
  const liste = document.getElementById('listeMessages');
  liste.innerHTML = messages.map((m) => `
    <div class="bulle ${m.sender_id === moi.id ? 'moi' : 'autre'}">${echapper(m.contenu)}</div>
  `).join('');
  liste.scrollTop = liste.scrollHeight;
}

async function envoyerMessage() {
  const input = document.getElementById('texteMessage');
  const contenu = input.value.trim();
  if (!contenu || !contactActuel) return;
  await api('/messages', 'POST', { receiver_id: contactActuel, contenu });
  input.value = '';
  ouvrirConversation(contactActuel, document.getElementById('titrePage').textContent);
}

// ---------- PROFIL ----------
async function chargerProfil() {
  const u = await api('/users/me');
  const zone = document.getElementById('contenuPage');
  zone.innerHTML = `
    <img class="photo-profil" src="${u.photo_url || ''}" id="apercuPhoto" onerror="this.style.visibility='hidden'">
    <h3 style="text-align:center;">${echapper(u.nom)}</h3>
    <p style="text-align:center;color:var(--text-muted);">${nomClasse(u.classe)} · ${echapper(u.telephone)}</p>
    <label>Photo de profil</label>
    <input type="file" id="fichierPhoto" accept="image/*" onchange="fichierPhotoSelectionne(event)">
    <p class="date" style="text-align:center;">Choisis une image : tu pourras ensuite la déplacer et zoomer avant d'enregistrer.</p>
    <div id="editeurPhotoZone"></div>
    <div id="messagePhoto"></div>

    <h3>Mot de passe</h3>
    <input type="password" id="ancienMdp" placeholder="Ancien mot de passe">
    <input type="password" id="nouveauMdp" placeholder="Nouveau mot de passe">
    <button onclick="changerMotDePasse()">Mettre à jour</button>
    <div id="messageMdp"></div>
  `;
}

let edPhoto = null;

function fichierPhotoSelectionne(evenement) {
  const fichier = evenement.target.files[0];
  if (!fichier) return;
  const img = new Image();
  img.onload = () => ouvrirEditeurPhoto(img);
  img.src = URL.createObjectURL(fichier);
}

function ouvrirEditeurPhoto(img) {
  const taille = 260;
  const coverScale = Math.max(taille / img.width, taille / img.height);
  edPhoto = { img, scale: coverScale, coverScale, offsetX: 0, offsetY: 0, taille };

  const zone = document.getElementById('editeurPhotoZone');
  zone.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:12px;margin:14px 0;">
      <div style="width:${taille}px;height:${taille}px;border-radius:50%;overflow:hidden;border:2px solid var(--border-strong);">
        <canvas id="canvasPhoto" width="${taille}" height="${taille}" style="cursor:grab;display:block;touch-action:none;"></canvas>
      </div>
      <input type="range" id="zoomPhoto" min="100" max="300" value="100" style="width:${taille}px;">
      <div style="display:flex;gap:8px;width:100%;max-width:${taille}px;">
        <button class="secondaire" onclick="annulerEditeurPhoto()">Annuler</button>
        <button onclick="validerEditeurPhoto()">Enregistrer</button>
      </div>
    </div>
  `;
  dessinerPhoto();

  const canvas = document.getElementById('canvasPhoto');
  let glisse = false, dernierX = 0, dernierY = 0;
  const debut = (x, y) => { glisse = true; dernierX = x; dernierY = y; canvas.style.cursor = 'grabbing'; };
  const bouge = (x, y) => {
    if (!glisse) return;
    edPhoto.offsetX += x - dernierX;
    edPhoto.offsetY += y - dernierY;
    dernierX = x; dernierY = y;
    clamperOffsetPhoto();
    dessinerPhoto();
  };
  const fin = () => { glisse = false; canvas.style.cursor = 'grab'; };

  canvas.addEventListener('mousedown', (e) => debut(e.offsetX, e.offsetY));
  canvas.addEventListener('mousemove', (e) => bouge(e.offsetX, e.offsetY));
  window.addEventListener('mouseup', fin);
  canvas.addEventListener('touchstart', (e) => {
    const t = e.touches[0], r = canvas.getBoundingClientRect();
    debut(t.clientX - r.left, t.clientY - r.top);
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    const t = e.touches[0], r = canvas.getBoundingClientRect();
    bouge(t.clientX - r.left, t.clientY - r.top);
  }, { passive: true });
  canvas.addEventListener('touchend', fin);

  document.getElementById('zoomPhoto').addEventListener('input', (e) => {
    edPhoto.scale = edPhoto.coverScale * (Number(e.target.value) / 100);
    clamperOffsetPhoto();
    dessinerPhoto();
  });
}

function clamperOffsetPhoto() {
  const { img, scale, taille } = edPhoto;
  const w = img.width * scale, h = img.height * scale;
  const maxX = Math.max(0, (w - taille) / 2);
  const maxY = Math.max(0, (h - taille) / 2);
  edPhoto.offsetX = Math.min(maxX, Math.max(-maxX, edPhoto.offsetX));
  edPhoto.offsetY = Math.min(maxY, Math.max(-maxY, edPhoto.offsetY));
}

function dessinerPhoto() {
  const canvas = document.getElementById('canvasPhoto');
  const ctx = canvas.getContext('2d');
  const { img, scale, offsetX, offsetY, taille } = edPhoto;
  const w = img.width * scale, h = img.height * scale;
  ctx.clearRect(0, 0, taille, taille);
  ctx.drawImage(img, taille / 2 - w / 2 + offsetX, taille / 2 - h / 2 + offsetY, w, h);
}

function annulerEditeurPhoto() {
  edPhoto = null;
  document.getElementById('editeurPhotoZone').innerHTML = '';
  document.getElementById('fichierPhoto').value = '';
}

function validerEditeurPhoto() {
  const resolution = 500;
  const sortie = document.createElement('canvas');
  sortie.width = resolution; sortie.height = resolution;
  const ctxSortie = sortie.getContext('2d');
  const { img, scale, offsetX, offsetY, taille } = edPhoto;
  const facteur = resolution / taille;
  const w = img.width * scale * facteur, h = img.height * scale * facteur;
  ctxSortie.drawImage(img, resolution / 2 - w / 2 + offsetX * facteur, resolution / 2 - h / 2 + offsetY * facteur, w, h);

  sortie.toBlob(async (blob) => {
    const formData = new FormData();
    formData.append('photo', blob, 'profil.jpg');
    const msg = document.getElementById('messagePhoto');
    try {
      await api('/users/me/photo', 'PUT', formData, true);
      msg.innerHTML = '<div class="succes">Photo mise à jour.</div>';
      annulerEditeurPhoto();
      chargerProfil();
    } catch (e) { msg.innerHTML = `<div class="erreur">${e.message}</div>`; }
  }, 'image/jpeg', 0.92);
}

async function changerMotDePasse() {
  const ancien_mot_de_passe = document.getElementById('ancienMdp').value;
  const nouveau_mot_de_passe = document.getElementById('nouveauMdp').value;
  const msg = document.getElementById('messageMdp');
  try {
    await api('/auth/changer-mot-de-passe', 'POST', { ancien_mot_de_passe, nouveau_mot_de_passe });
    msg.innerHTML = '<div class="succes">Mot de passe mis à jour.</div>';
  } catch (e) { msg.innerHTML = `<div class="erreur">${e.message}</div>`; }
}

afficherOnglet('fil');
initNotificationsSiDejaActivees();
