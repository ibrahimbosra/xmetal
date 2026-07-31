const CACHE_NAME = 'xmetal-mobile-sales-v3';
const APP_SHELL = [
    './mobile-sales.html',
    './manifest.json',
    './css/mobile-sales.css',
    './js/mobile-sales.js',
    './js/firebase-config.js',
    './fonts/Cairo-Regular.woff2',
    './icons/icon-192.svg',
    './icons/icon-512.svg',
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js'
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    event.respondWith(caches.match(request).then(cached => {
        const network = fetch(request).then(response => {
            if (response && response.ok) {
                const copy = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
            }
            return response;
        }).catch(() => cached);
        return cached || network;
    }));
});
