/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const urlParams = new URL(location.href).searchParams;
const firebaseConfig = {
  apiKey: urlParams.get('apiKey') || '',
  authDomain: urlParams.get('authDomain') || '',
  projectId: urlParams.get('projectId') || '',
  messagingSenderId: urlParams.get('messagingSenderId') || '',
  appId: urlParams.get('appId') || '',
};

if (firebase.apps.length === 0 && firebaseConfig.projectId) {
  try {
    firebase.initializeApp(firebaseConfig);
  } catch (err) {
    console.warn('Failed to initialize Firebase in service worker:', err);
  }
}

try {
  if (firebase.apps.length > 0) {
    const messaging = firebase.messaging();
    messaging.onBackgroundMessage((payload) => {
      const notificationTitle = payload.notification?.title || payload.data?.title || 'MuscleOS Notification';
      const notificationOptions = {
        body: payload.notification?.body || payload.data?.body || '',
        icon: payload.notification?.icon || payload.data?.icon || '/favicon.svg',
        data: payload.data || {},
      };

      self.registration.showNotification(notificationTitle, notificationOptions);
    });
  }
} catch (e) {
  // Graceful fallback if background messaging is unavailable
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
