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
  const app = getClientApp();
  // Each deployment targets a *named* database (e.g. "hpb-eos-prod-db",
  // "hpb-eos-sandbox-db"); unset talks to "(default)". Same var drives the
  // Admin SDK.
  const databaseId = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID;
  return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
}

// Google provider for the sign-in popup.
//
// The `hd` hint only pre-filters the account chooser and can't express "domain
// plus one account", so it's optional and off by default. The actual perimeter
// is the server-side SIGN_IN_ALLOWLIST check in createSession()
// (lib/firebase/session.ts) — nothing here is enforcement.
//
// `prompt: "select_account"` is always sent. Without it Google silently reuses
// whichever account the browser is already signed into, so anyone whose
// default is a personal account gets refused by the allowlist and then hits
// the identical refusal on every retry — the picker never reappears and the
// only way out is an incognito window. Forcing the chooser makes "sign in
// with the other one" the obvious next click.
export function googleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  const hd = process.env.NEXT_PUBLIC_FIREBASE_HOSTED_DOMAIN;
  provider.setCustomParameters({ prompt: "select_account", ...(hd ? { hd } : {}) });
  return provider;
}
