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

// ---------- NOTIFICATIONS PUSH ----------
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function activerNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    alert("Les notifications ne sont pas supportées par ce navigateur.");
    return false;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      alert("Tu as refusé les notifications. Tu peux les réactiver dans les réglages du navigateur.");
      return false;
    }
    const registration = await navigator.serviceWorker.register('/sw.js');
    const { cle_publique } = await api('/push/cle-publique');
    if (!cle_publique) {
      console.warn('Notifications push non configurées côté serveur.');
      return false;
    }
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(cle_publique),
    });
    await api('/push/abonner', 'POST', subscription.toJSON());
    localStorage.setItem('notifications_activees', 'oui');
    return true;
  } catch (e) {
    console.error('Erreur activation notifications:', e);
    return false;
  }
}

async function initNotificationsSiDejaActivees() {
  if (localStorage.getItem('notifications_activees') === 'oui' && Notification.permission === 'granted') {
    activerNotifications();
  }
}
