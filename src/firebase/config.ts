import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getAnalytics, isSupported } from 'firebase/analytics';

// Safe environment variable helper that never throws TypeError if import.meta.env is undefined
function getEnv(key: string, fallback: string = ''): string {
  try {
    if (typeof import.meta !== 'undefined' && import.meta && (import.meta as any).env) {
      return (import.meta as any).env[key] || fallback;
    }
    const g = typeof globalThis !== 'undefined' ? (globalThis as any) : typeof window !== 'undefined' ? (window as any) : {};
    if (g.process && g.process.env && g.process.env[key]) {
      return g.process.env[key] || fallback;
    }
  } catch {}
  return fallback;
}

// Load Firebase configuration with resilient defaults
export const firebaseConfig = {
  apiKey: getEnv('VITE_FIREBASE_API_KEY', 'AIzaSyAQE2cor8T1eTs4KQls-bxdfC6cMhU8zzU'),
  authDomain: getEnv('VITE_FIREBASE_AUTH_DOMAIN', 'hackathon-6937b.firebaseapp.com'),
  projectId: getEnv('VITE_FIREBASE_PROJECT_ID', 'hackathon-6937b'),
  storageBucket: getEnv('VITE_FIREBASE_STORAGE_BUCKET', 'hackathon-6937b.firebasestorage.app'),
  messagingSenderId: getEnv('VITE_FIREBASE_MESSAGING_SENDER_ID', '913641937361'),
  appId: getEnv('VITE_FIREBASE_APP_ID', '1:913641937361:web:5b8df76be393085045e8f0'),
  measurementId: getEnv('VITE_FIREBASE_MEASUREMENT_ID', 'G-QLC93JXYJ6'),
};

export const isFirebaseConfigured = true;

// Initialize Firebase instance safely exactly once
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, 'us-central1');

// Initialize Firebase Analytics if supported in browser environment
export let analytics: ReturnType<typeof getAnalytics> | null = null;
if (typeof window !== 'undefined') {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch(() => {
    // Ignore analytics unsupported environment
  });
}

// Connect to Emulators if configured
const useEmulator = getEnv('VITE_USE_FIREBASE_EMULATOR') === 'true';

if (useEmulator && typeof window !== 'undefined') {
  const host = window.location.hostname || 'localhost';
  try {
    connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, 8080);
    connectStorageEmulator(storage, host, 9199);
    connectFunctionsEmulator(functions, host, 5001);
    console.log('[Firebase] Connected to local Firebase Emulators');
  } catch (err) {
    console.warn('[Firebase] Emulator connection warning:', err);
  }
}

export default app;
