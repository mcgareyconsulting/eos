import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let cachedApp: App | undefined;

/**
 * Audit C-13: pasted service-account keys are no longer supported. Fail loudly
 * (rather than silently ignoring the var) so a stale env doesn't leave an
 * operator believing a key is in use.
 */
export function assertNoServiceAccountKey(
  env: Record<string, string | undefined> = process.env,
): void {
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is no longer supported (service-account keys are not used). " +
        "Unset it and use Application Default Credentials: run `gcloud auth application-default login` " +
        "locally; on Cloud Run the attached service account is used automatically.",
    );
  }
}

function getAdminApp(): App {
  if (cachedApp) return cachedApp;

  const existing = getApps()[0];
  if (existing) {
    cachedApp = existing;
    return existing;
  }

  assertNoServiceAccountKey();

  // Application Default Credentials: works automatically in Cloud Run /
  // Functions; locally, run `gcloud auth application-default login`.
  cachedApp = initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
  return cachedApp;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminDb(): Firestore {
  const app = getAdminApp();
  // Read lazily (not at module load): the seed script loads .env.local via
  // dotenv AFTER this module is imported, so a top-level const would be stale.
  // Each deployment targets a *named* database (e.g. "hpb-eos-prod-db",
  // "hpb-eos-sandbox-db"); unset talks to "(default)". Same var drives the
  // client SDK.
  const databaseId = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_ID;
  return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
}

/**
 * OAuth access token for the app's own Google identity (the runtime service
 * account on Cloud Run, ADC locally), for the few Google REST APIs called
 * with plain fetch — e.g. Cloud KMS in lib/google/token-cipher.ts. The admin
 * SDK's default credential requests the cloud-platform scope.
 */
export async function getAdminAccessToken(): Promise<string> {
  const credential = getAdminApp().options.credential;
  if (!credential) throw new Error("firebase-admin app has no credential");
  return (await credential.getAccessToken()).access_token;
}
