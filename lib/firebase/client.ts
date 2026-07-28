import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  type Auth,
} from "firebase/auth";
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from "firebase/firestore";

// Local-only: when NEXT_PUBLIC_FIREBASE_USE_EMULATOR=true the client SDK talks
// to the Firebase emulators instead of a real project — no cloud credentials
// needed. See docs/LOCAL_DEV.md. Never set this in production.
const USE_EMULATOR = process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATOR === "true";

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

let authEmulatorConnected = false;
export function getClientAuth(): Auth {
  const auth = getAuth(getClientApp());
  if (USE_EMULATOR && !authEmulatorConnected) {
    authEmulatorConnected = true;
    connectAuthEmulator(auth, "http://127.0.0.1:9099", {
      disableWarnings: true,
    });
  }
  return auth;
}

let firestoreEmulatorConnected = false;
export function getClientDb(): Firestore {
  const app = getClientApp();
  // Prod uses a *named* database (e.g. "hpb-eos-prod-db"); local/emulator leaves
  // this unset and talks to "(default)". Same var drives the Admin SDK.
  const databaseId = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID;
  const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
  if (USE_EMULATOR && !firestoreEmulatorConnected) {
    firestoreEmulatorConnected = true;
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
  return db;
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
