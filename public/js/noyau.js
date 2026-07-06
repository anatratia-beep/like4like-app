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

// ---------- EMOJIS COURANTS (pour la messagerie) ----------
const EMOJIS_MESSAGERIE = [
  '😀','😂','😍','🥰','😊','😉','😎','🤔','😢','😭','😡','😱','👍','👎','🙏','👏',
  '💪','🔥','🎉','❤️','💛','💯','✅','❌','👋','😴','🤝','🙌','😅','🥳','😇','🤗',
];
const ICONES = {
  fil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1"></rect><rect x="3" y="11" width="18" height="4" rx="1"></rect><rect x="3" y="18" width="10" height="3" rx="1"></rect></svg>',
  publier: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"></path></svg>',
  valider: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>',
  portefeuille: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"></rect><path d="M16 12h3M3 9h18"></path></svg>',
  messages: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 01-8.5 8.5 8.38 8.38 0 01-3.8-.9L3 20l1-5.5A8.38 8.38 0 0121 11.5z"></path></svg>',
  profil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 20c0-4 3.5-6 8-6s8 2 8 6"></path></svg>',
  etudiants: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"></circle><path d="M2.5 19c0-3.2 2.9-5 6.5-5s6.5 1.8 6.5 5"></path><circle cx="17.5" cy="8.5" r="2.6"></circle><path d="M15.7 14.2c2.7.4 4.8 1.9 4.8 4.6"></path></svg>',
  transactions: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h13l-3-3M20 17H7l3 3"></path></svg>',
  retraits: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5"></path><path d="M4 19h16"></path></svg>',
  reglages: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 13a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.9 2.9l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.6V19a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.6 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.9-2.9l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.6-1H4a2 2 0 110-4h.1a1.7 1.7 0 001.6-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.9-2.9l.1.1a1.7 1.7 0 001.9.3H10a1.7 1.7 0 001-1.6V4a2 2 0 114 0v.1a1.7 1.7 0 001 1.6 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.9 2.9l-.1.1a1.7 1.7 0 00-.3 1.9V10a1.7 1.7 0 001.6 1H20a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"></path></svg>',
  coeur: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z"></path></svg>',
  commentaire: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 01-8.5 8.5 8.38 8.38 0 01-3.8-.9L3 20l1-5.5A8.38 8.38 0 0121 11.5z"></path></svg>',
  partage: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.5"></circle><circle cx="6" cy="12" r="2.5"></circle><circle cx="18" cy="19" r="2.5"></circle><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"></path></svg>',
  cloche: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.7 21a2 2 0 01-3.4 0"></path></svg>',
  fleche_retour: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"></path></svg>',
  envoyer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"></path></svg>',
  croix: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"></path></svg>',
  piece: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v10M9 9.5c0-1.4 1.3-2.5 3-2.5s3 .9 3 2c0 3-6 1.5-6 4.5 0 1.1 1.3 2 3 2s3-1.1 3-2.5"></path></svg>',
  smiley: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M8.5 14.5s1.5 2 3.5 2 3.5-2 3.5-2"></path><path d="M9 9.5h.01M15 9.5h.01"></path></svg>',
};

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
