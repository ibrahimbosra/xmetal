// Firebase Configuration (compat)
// IMPORTANT: keep credentials secure in production; this file mirrors the app's expected global `firebase` compat usage.

var firebaseConfig = {
    apiKey: "AIzaSyBeJ0sbdCqz60a-yqzuZSt6QstDhR3TRtM",
    authDomain: "profit-zone-e03c6.firebaseapp.com",
    databaseURL: "https://profit-zone-e03c6-default-rtdb.firebaseio.com",
    projectId: "profit-zone-e03c6",
    storageBucket: "profit-zone-e03c6.firebasestorage.app",
    messagingSenderId: "306955059136",
    appId: "1:306955059136:web:a450be9721f4a2db0d1225"
};

// Initialize Firebase using compat SDK loaded from index.html
var firebaseAuthInstance = null;
var firebaseDbInstance = null;
var firebaseAuthPersistenceReady = Promise.resolve();

try {
    // `firebase` global should be provided by the compat SDK script in index.html
    if (window.firebase && window.firebase.initializeApp) {
        if (!window.__xmetalFirebaseInitialized) {
            window.firebase.initializeApp(firebaseConfig);
            window.__xmetalFirebaseInitialized = true;
        }
        firebaseAuthInstance = window.firebase.auth();
        firebaseDbInstance = window.firebase.firestore();
        if (firebaseAuthInstance && firebaseAuthInstance.setPersistence && window.firebase.auth.Auth.Persistence.LOCAL) {
            firebaseAuthPersistenceReady = firebaseAuthInstance.setPersistence(window.firebase.auth.Auth.Persistence.LOCAL).catch(function() {
                console.warn('Auth persistence not available');
            });
        }

        if (firebaseDbInstance) {
            // Prefer the modern Firestore cache API when the loaded SDK surface exposes it.
            if (firebaseDbInstance.persistentLocalCache && typeof firebaseDbInstance.persistentLocalCache === 'function') {
                try {
                    firebaseDbInstance.persistentLocalCache({ tabManager: 'xmetal' });
                } catch (err) {
                    console.warn('Modern persistentLocalCache configuration unavailable; falling back to compatibility settings.', err);
                }
            }

            // Compatibility fallback for the current compat SDK payload used by this project.
            if (firebaseDbInstance.enablePersistence && typeof firebaseDbInstance.enablePersistence === 'function') {
                try {
                    firebaseDbInstance.enablePersistence({ synchronizeTabs: true }).catch(function() {
                        console.warn('Firestore persistence not available');
                    });
                } catch (err) {
                    console.warn('Firestore persistence initialization failed', err);
                }
            }
        }
    } else {
        console.warn('Firebase compat SDK not loaded; please ensure the compat scripts are included in index.html');
    }
} catch (error) {
    console.error('Firebase initialization error:', error);
}

window.firebaseAuth = firebaseAuthInstance;
window.firebaseDb = firebaseDbInstance;
