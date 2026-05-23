// Firebase Configuration
// ⚠️ IMPORTANT: الـ API Key يجب أن يكون من متغيرات البيئة أو backend
// هذا ملف placeholder فقط — لا تضع credentials حقيقية في الكود

// Firebase configuration separated in its own file.
// This file is loaded via <script src="js/firebase-config.js"></script> in index.html.

const firebaseConfig = {
    apiKey: "AIzaSyBeJ0sbdCqz60a-yqzuZSt6QstDhR3TRtM",
    authDomain: "profit-zone-e03c6.firebaseapp.com",
    databaseURL: "https://profit-zone-e03c6-default-rtdb.firebaseio.com",
    projectId: "profit-zone-e03c6",
    storageBucket: "profit-zone-e03c6.firebasestorage.app",
    messagingSenderId: "306955059136",
    appId: "1:306955059136:web:a450be9721f4a2db0d1225"
};

// Initialize Firebase using compat SDK loaded from index.html
let firebaseAuthInstance = null;
let firebaseDbInstance = null;

try {
    firebase.initializeApp(firebaseConfig);
    firebaseAuthInstance = firebase.auth();
    firebaseDbInstance = firebase.firestore();
    firebaseDbInstance.enablePersistence().catch(function() {
        console.warn('Firestore persistence not available');
    });
} catch (error) {
    console.error('Firebase initialization error:', error);
}

window.firebaseAuth = firebaseAuthInstance;
window.firebaseDb = firebaseDbInstance;
