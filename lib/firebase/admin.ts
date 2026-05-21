import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let cachedApp: App | undefined;

function getAdminApp(): App {
  if (cachedApp) return cachedApp;

  const existing = getApps()[0];
  if (existing) {
    cachedApp = existing;
    return existing;
  }

  const jsonCreds = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (jsonCreds) {
    cachedApp = initializeApp({
      credential: cert(JSON.parse(jsonCreds)),
    });
    return cachedApp;
  }

  // Application Default Credentials: works automatically in Cloud Run /
  // Functions; locally, set GOOGLE_APPLICATION_CREDENTIALS to a
  // service-account JSON path (or run `gcloud auth application-default login`).
  cachedApp = initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
  return cachedApp;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}
