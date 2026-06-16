importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyBGtZ5lkmcNN7YjVkPnSo4W0mCRpcabwu8",
    authDomain: "trading-5c2a1.firebaseapp.com",
    projectId: "trading-5c2a1",
    storageBucket: "trading-5c2a1.firebasestorage.app",
    messagingSenderId: "747427365340",
    appId: "1:747427365340:web:2f8141a8188ab0bb438f19",
});

const messaging = firebase.messaging();

// Notificaciones en segundo plano (app no activa)
messaging.onBackgroundMessage(payload => {
    const n = payload.notification || {};
    self.registration.showNotification(n.title || 'Señal Trading', {
        body: n.body || '',
        icon: n.icon || '/favicon.ico',
        badge: '/favicon.ico',
    });
});
