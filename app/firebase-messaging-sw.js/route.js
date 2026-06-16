export const runtime = 'nodejs';

export function GET() {
    const config = {
        apiKey:            process.env.NEXT_PUBLIC_FB_API_KEY,
        authDomain:        process.env.NEXT_PUBLIC_FB_AUTH_DOMAIN,
        projectId:         process.env.NEXT_PUBLIC_FB_PROJECT_ID,
        storageBucket:     process.env.NEXT_PUBLIC_FB_STORAGE_BUCKET,
        messagingSenderId: process.env.NEXT_PUBLIC_FB_MESSAGING_SENDER_ID,
        appId:             process.env.NEXT_PUBLIC_FB_APP_ID,
    };

    const body = `
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp(${JSON.stringify(config)});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
    const n = payload.notification || {};
    self.registration.showNotification(n.title || 'Señal Trading', {
        body:  n.body  || '',
        icon:  n.icon  || '/favicon.ico',
        badge: '/favicon.ico',
    });
});
`.trimStart();

    return new Response(body, {
        headers: {
            'Content-Type':  'application/javascript',
            'Cache-Control': 'no-store',
        },
    });
}
