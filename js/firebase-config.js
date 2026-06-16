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

try {
    // `firebase` global should be provided by the compat SDK script in index.html
    if (window.firebase && window.firebase.initializeApp) {
        window.firebase.initializeApp(firebaseConfig);
        firebaseAuthInstance = window.firebase.auth();
        firebaseDbInstance = window.firebase.firestore();
        // try to enable persistence but ignore failures (e.g., multiple tabs or unsupported browsers)
        if (firebaseDbInstance && firebaseDbInstance.enablePersistence) {
            firebaseDbInstance.enablePersistence().catch(function() {
                console.warn('Firestore persistence not available');
            });
        }
    } else {
        console.warn('Firebase compat SDK not loaded; please ensure the compat scripts are included in index.html');
    }
} catch (error) {
    console.error('Firebase initialization error:', error);
}

window.firebaseAuth = firebaseAuthInstance;
window.firebaseDb = firebaseDbInstance;
