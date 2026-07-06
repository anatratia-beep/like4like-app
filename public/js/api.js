async function api(chemin, methode = 'GET', corps = null, estFormData = false) {
  const token = localStorage.getItem('token');
  const options = {
    method: methode,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  };
  if (corps) {
    if (estFormData) {
      options.body = corps;
    } else {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(corps);
    }
  }
  const resp = await fetch(`/api${chemin}`, options);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data.erreur || `Erreur ${resp.status}`);
  }
  return data;
}

function utilisateurCourant() {
  const brut = localStorage.getItem('utilisateur');
  return brut ? JSON.parse(brut) : null;
}

function deconnexion() {
  localStorage.removeItem('token');
  localStorage.removeItem('utilisateur');
  window.location.href = '/';
}

function exigerConnexion() {
  if (!localStorage.getItem('token')) window.location.href = '/';
}

function formaterDate(iso) {
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function echapper(texte) {
  const div = document.createElement('div');
  div.textContent = texte ?? '';
  return div.innerHTML;
}
