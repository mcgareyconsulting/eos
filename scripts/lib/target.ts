// `--target sandbox|prod` for the operator scripts.
//
// One flag names the database a script works on, instead of a hand-built
// env-var prefix. Each script imports `./lib/load-target` (or
// `./lib/load-target-explicit`) as its FIRST import; that side-effect module
// calls `runTargetSetup` below before any other module is evaluated, so
// lib/firebase/admin.ts and every script's own `initializeApp` see the
// configured environment.
//
//   --target sandbox  load .env.local as before, then pin project
//                     hpb-eos-prod + database hpb-eos-sandbox-db.
//   --target prod     project hpb-eos-prod + database hpb-eos-prod-db,
//                     credentials from Application Default Credentials
//                     (`gcloud auth application-default login`). .env.local
//                     is still read for non-Firebase settings (e.g.
//                     SIGN_IN_ALLOWLIST), but none of its Firebase project /
//                     database / emulator / credential values are applied,
//                     and FIREBASE_SERVICE_ACCOUNT_JSON is dropped.
//   (no flag)         unchanged: the script loads its env file exactly as it
//                     did before. Never defaults to prod.
//
// `--target` is removed from process.argv, so the scripts' own argument
// parsing never sees it. It cannot be combined with --project, --database or
// --env-file — the target already names the project and database, and a
// second source would make the banner lie.
//
// A one-line banner ("Target: PROD (hpb-eos-prod / hpb-eos-prod-db), ...")
// goes to stderr before any work, so stdout stays clean for scripts whose
// output is parsed (restore-test-count.ts).

import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";

export const TARGETS = {
  sandbox: { label: "SANDBOX", projectId: "hpb-eos-prod", databaseId: "hpb-eos-sandbox-db" },
  prod: { label: "PROD", projectId: "hpb-eos-prod", databaseId: "hpb-eos-prod-db" },
} as const;

export type TargetName = keyof typeof TARGETS;

/** process.env shape (without Next.js's required NODE_ENV, so tests can pass {}). */
export type Env = Record<string, string | undefined>;

/** A usage mistake; the runner prints the message and exits 1. */
export class TargetError extends Error {}

const USAGE = "Use --target sandbox or --target prod.";

/** Flags a --target run refuses, because the target already names the database. */
const CONFLICTING_FLAGS = ["--project", "--database", "--env-file"] as const;

/** Env-file keys never applied under --target prod: they would point it elsewhere. */
function isFirebaseRoutingKey(key: string): boolean {
  return (
    key.startsWith("NEXT_PUBLIC_FIREBASE_") ||
    [
      "FIRESTORE_EMULATOR_HOST",
      "FIREBASE_AUTH_EMULATOR_HOST",
      "FIREBASE_SERVICE_ACCOUNT_JSON",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "GCLOUD_PROJECT",
      "GOOGLE_CLOUD_PROJECT",
    ].includes(key)
  );
}

const EMULATOR_KEYS = ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"] as const;

/**
 * Finds `--target <name>` / `--target=<name>` in argv and returns argv without
 * it. Throws TargetError for a missing, unknown or repeated value.
 */
export function extractTarget(argv: readonly string[]): {
  target: TargetName | null;
  argv: string[];
} {
  let target: TargetName | null = null;
  let seen = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    let value: string | undefined;
    if (a === "--target") {
      value = argv[i + 1];
      i++;
    } else if (a.startsWith("--target=")) {
      value = a.slice("--target=".length);
    } else {
      rest.push(a);
      continue;
    }
    if (seen) throw new TargetError(`--target given more than once. ${USAGE}`);
    seen = true;
    if (value === undefined || value === "" || value.startsWith("--")) {
      throw new TargetError(`--target needs a value. ${USAGE}`);
    }
    if (!Object.hasOwn(TARGETS, value)) {
      throw new TargetError(`Unknown target "${value}". ${USAGE}`);
    }
    target = value as TargetName;
  }
  return { target, argv: rest };
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

export interface TargetSetupOptions {
  /** Full argv (process.argv shape: node, script, ...args). */
  argv: readonly string[];
  /** Mutated in place — pass process.env. */
  env: Env;
  /** Env file loaded when there is no --env-file (".env.local"). */
  defaultEnvFile: string;
  /**
   * No default target: require --target or --env-file
   * (backfill-issue-comment-counts.ts). Otherwise a run without --target
   * loads `defaultEnvFile` exactly as the scripts always have.
   */
  requireExplicit?: boolean;
  /** Reads + parses an env file; null when it does not exist. Injectable for tests. */
  readEnvFile?: (path: string) => Record<string, string> | null;
}

export interface TargetSetupResult {
  target: TargetName | null;
  /** argv with --target removed. */
  argv: string[];
  /** The env file that was read (null under --target prod with no .env.local). */
  envFile: string | null;
  /** Stderr banner, set whenever --target was given. */
  banner: string | null;
}

function defaultReadEnvFile(path: string): Record<string, string> | null {
  return existsSync(path) ? parse(readFileSync(path)) : null;
}

/** dotenv's `config()` semantics: values already in the environment win. */
function apply(
  env: Env,
  values: Record<string, string> | null,
  keep: (key: string) => boolean = () => true,
) {
  if (!values) return;
  for (const [k, v] of Object.entries(values)) {
    if (keep(k) && env[k] === undefined) env[k] = v;
  }
}

export function setupTarget(opts: TargetSetupOptions): TargetSetupResult {
  const { env, defaultEnvFile } = opts;
  const read = opts.readEnvFile ?? defaultReadEnvFile;
  const { target, argv } = extractTarget(opts.argv);

  if (target === null) {
    if (opts.requireExplicit) {
      const envFile = flagValue(argv, "--env-file");
      if (!envFile || envFile.startsWith("--")) {
        throw new TargetError(
          "A target is required: --target sandbox, --target prod, or --env-file <path>.",
        );
      }
      const values = read(envFile);
      if (!values) throw new TargetError(`--env-file ${envFile}: file not found.`);
      apply(env, values);
      return { target, argv, envFile, banner: null };
    }
    apply(env, read(defaultEnvFile));
    return { target, argv, envFile: defaultEnvFile, banner: null };
  }

  const conflicts = CONFLICTING_FLAGS.filter((f) => argv.includes(f));
  if (conflicts.length > 0) {
    throw new TargetError(
      `--target ${target} already sets the project and database; drop ${conflicts.join(", ")}.`,
    );
  }

  const values = read(defaultEnvFile);
  if (target === "prod") {
    apply(env, values, (k) => !isFirebaseRoutingKey(k));
    delete env.FIREBASE_SERVICE_ACCOUNT_JSON;
  } else {
    apply(env, values);
  }

  const emulators = EMULATOR_KEYS.filter((k) => env[k]);
  if (emulators.length > 0) {
    throw new TargetError(
      `--target ${target} names a real database, but ${emulators.join(", ")} is set ` +
        "(the Admin SDK would talk to the emulator). Unset it, or run without --target.",
    );
  }

  const t = TARGETS[target];
  env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = t.projectId;
  env.NEXT_PUBLIC_FIREBASE_DATABASE_ID = t.databaseId;

  const credentials = env.FIREBASE_SERVICE_ACCOUNT_JSON
    ? "FIREBASE_SERVICE_ACCOUNT_JSON"
    : "Application Default Credentials";
  return {
    target,
    argv,
    envFile: values ? defaultEnvFile : null,
    banner: `Target: ${t.label} (${t.projectId} / ${t.databaseId}), credentials: ${credentials}`,
  };
}

/**
 * Process-level wrapper used by the side-effect modules: reads process.argv /
 * process.env, strips --target from process.argv, prints the banner to
 * stderr, and exits 1 on a usage error.
 */
export function runTargetSetup(
  opts: Pick<TargetSetupOptions, "defaultEnvFile" | "requireExplicit">,
): TargetSetupResult {
  try {
    const result = setupTarget({ ...opts, argv: process.argv, env: process.env });
    process.argv.splice(0, process.argv.length, ...result.argv);
    if (result.banner) console.error(result.banner);
    return result;
  } catch (err) {
    if (err instanceof TargetError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
