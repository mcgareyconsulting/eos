import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

function getClientApp(): FirebaseApp {
  if (getApps().length) return getApp();

  return initializeApp({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  });
}

export function getClientAuth(): Auth {
  return getAuth(getClientApp());
}

export function getClientDb(): Firestore {
  return getFirestore(getClientApp());
}

// Google provider preconfigured with hosted-domain hint (if set).
// The hint scopes the account picker; the *real* perimeter is enforced at
// the Firebase Auth provider config in the console.
export function googleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  const hd = process.env.NEXT_PUBLIC_FIREBASE_HOSTED_DOMAIN;
  if (hd) provider.setCustomParameters({ hd });
  return provider;
}
