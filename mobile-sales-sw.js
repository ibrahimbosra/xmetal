const CACHE_NAME = 'xmetal-mobile-sales-v4';
const APP_SHELL = [
    './mobile-sales.html',
    './manifest.json',
    './css/mobile-sales.css',
    './js/mobile-sales.js',
    './js/firebase-config.js',
    './fonts/Cairo-Regular.woff2',
    './icons/icon-192.svg',
    './icons/icon-512.svg',
    './mobile-sales-sw.js'
];

const FIREBASE_HOSTS = [
    'firestore.googleapis.com',
    'identitytoolkit.googleapis.com'
];

function isFirebaseRequest(url) {
    return FIREBASE_HOSTS.includes(url.hostname) ||
        (url.hostname.endsWith('.googleapis.com') && url.hostname.includes('firebase'));
}

function isStaticRequest(request, url) {
    if (url.origin !== self.location.origin || isFirebaseRequest(url)) return false;
    if (request.method !== 'GET') return false;
    return ['document', 'script', 'style', 'image', 'font', 'manifest'].includes(request.destination) ||
        /\.(html?|css|js|mjs|json|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf)$/i.test(url.pathname);
}

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(async cache => {
        for (const path of APP_SHELL) {
            try {
                const response = await fetch(new Request(path, { cache: 'no-cache' }));
                if (response.ok && response.type === 'basic') await cache.put(path, response);
            } catch (error) {
                // A missing static asset must not prevent the Service Worker from installing.
            }
        }
    }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    // Firebase Auth and Firestore must manage their own network and offline storage.
    if (!isStaticRequest(request, url)) return;
    event.respondWith((async () => {
        const cached = await caches.match(request);
        try {
            const response = await fetch(request);
            if (response && response.ok && response.type === 'basic') {
                const copy = response.clone();
                const cache = await caches.open(CACHE_NAME);
                await cache.put(request, copy);
            }
            return response;
        } catch (error) {
            return cached || new Response('', { status: 503, statusText: 'Offline' });
        }
    })());
});
