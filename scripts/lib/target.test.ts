import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { extractTarget, setupTarget, TargetError, type Env } from "./target";

// What a sandbox .env.local looks like (keys only matter here).
const ENV_LOCAL = {
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "hpb-eos-prod",
  NEXT_PUBLIC_FIREBASE_DATABASE_ID: "hpb-eos-sandbox-db",
  NEXT_PUBLIC_FIREBASE_API_KEY: "sandbox-key",
  FIREBASE_SERVICE_ACCOUNT_JSON: '{"sandbox":true}',
  SIGN_IN_ALLOWLIST: "@highplainsbank.com",
};

function files(map: Record<string, Record<string, string>>) {
  const reads: string[] = [];
  return {
    reads,
    readEnvFile: (path: string) => {
      reads.push(path);
      return map[path] ?? null;
    },
  };
}

const ARGV0 = ["node", "scripts/x.ts"];

describe("extractTarget", () => {
  test("no flag → null target, argv untouched", () => {
    const argv = [...ARGV0, "--team", "T", "--apply"];
    assert.deepEqual(extractTarget(argv), { target: null, argv });
  });

  test("--target <name> is parsed and stripped", () => {
    assert.deepEqual(extractTarget([...ARGV0, "--team", "T", "--target", "prod", "--apply"]), {
      target: "prod",
      argv: [...ARGV0, "--team", "T", "--apply"],
    });
  });

  test("--target=<name> form", () => {
    assert.deepEqual(extractTarget([...ARGV0, "--target=sandbox", "a@b.com"]), {
      target: "sandbox",
      argv: [...ARGV0, "a@b.com"],
    });
  });

  test("unknown target throws a clear error", () => {
    assert.throws(() => extractTarget([...ARGV0, "--target", "production"]), {
      name: "Error",
      message: 'Unknown target "production". Use --target sandbox or --target prod.',
    });
    assert.throws(() => extractTarget([...ARGV0, "--target", "toString"]), TargetError);
  });

  test("missing value throws", () => {
    assert.throws(() => extractTarget([...ARGV0, "--target"]), /needs a value/);
    assert.throws(() => extractTarget([...ARGV0, "--target", "--apply"]), /needs a value/);
    assert.throws(() => extractTarget([...ARGV0, "--target="]), /needs a value/);
  });

  test("repeated flag throws", () => {
    assert.throws(
      () => extractTarget([...ARGV0, "--target", "sandbox", "--target", "prod"]),
      /more than once/,
    );
  });
});

describe("setupTarget — no flag", () => {
  test("loads the default env file as before; env already set wins", () => {
    const env: Env = { NEXT_PUBLIC_FIREBASE_DATABASE_ID: "from-shell" };
    const f = files({ ".env.local": ENV_LOCAL });
    const argv = [...ARGV0, "--database", "x"];
    const r = setupTarget({ argv, env, defaultEnvFile: ".env.local", readEnvFile: f.readEnvFile });
    assert.deepEqual(r, { target: null, argv, envFile: ".env.local", banner: null });
    assert.equal(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, "hpb-eos-prod");
    assert.equal(env.NEXT_PUBLIC_FIREBASE_DATABASE_ID, "from-shell");
    assert.equal(env.FIREBASE_SERVICE_ACCOUNT_JSON, '{"sandbox":true}');
  });

  test("missing default env file is not an error", () => {
    const env: Env = {};
    const r = setupTarget({
      argv: ARGV0,
      env,
      defaultEnvFile: ".env.local",
      readEnvFile: files({}).readEnvFile,
    });
    assert.equal(r.target, null);
    assert.deepEqual(env, {});
  });
});

describe("setupTarget — requireExplicit", () => {
  const opts = (argv: string[], env: Env) => ({
    argv,
    env,
    defaultEnvFile: ".env.local",
    requireExplicit: true,
    readEnvFile: files({ ".env.local": ENV_LOCAL, "/dev/null": {} }).readEnvFile,
  });

  test("neither --target nor --env-file → error", () => {
    assert.throws(() => setupTarget(opts(ARGV0, {})), /--target sandbox, --target prod, or --env-file/);
  });

  test("--env-file still works", () => {
    const env: Env = {};
    const r = setupTarget(opts([...ARGV0, "--env-file", ".env.local"], env));
    assert.equal(r.envFile, ".env.local");
    assert.equal(env.NEXT_PUBLIC_FIREBASE_DATABASE_ID, "hpb-eos-sandbox-db");
  });

  test("--env-file that does not exist → error", () => {
    assert.throws(() => setupTarget(opts([...ARGV0, "--env-file", ".env.nope"], {})), /not found/);
  });

  test("--target satisfies the requirement", () => {
    const env: Env = {};
    const r = setupTarget(opts([...ARGV0, "--target", "prod"], env));
    assert.equal(r.target, "prod");
    assert.equal(env.NEXT_PUBLIC_FIREBASE_DATABASE_ID, "hpb-eos-prod-db");
  });
});

describe("setupTarget — prod", () => {
  test("sets prod ids, ignores .env.local Firebase values, forces ADC", () => {
    const env: Env = {
      // Shell exports must not redirect a prod run either.
      NEXT_PUBLIC_FIREBASE_DATABASE_ID: "hpb-eos-sandbox-db",
      FIREBASE_SERVICE_ACCOUNT_JSON: '{"shell":true}',
    };
    const f = files({ ".env.local": ENV_LOCAL });
    const r = setupTarget({
      argv: [...ARGV0, "--target", "prod", "--apply"],
      env,
      defaultEnvFile: ".env.local",
      readEnvFile: f.readEnvFile,
    });
    assert.equal(r.target, "prod");
    assert.deepEqual(r.argv, [...ARGV0, "--apply"]);
    assert.equal(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, "hpb-eos-prod");
    assert.equal(env.NEXT_PUBLIC_FIREBASE_DATABASE_ID, "hpb-eos-prod-db");
    assert.equal(env.NEXT_PUBLIC_FIREBASE_API_KEY, undefined);
    assert.equal(env.FIREBASE_SERVICE_ACCOUNT_JSON, undefined);
    // Non-Firebase settings still come through.
    assert.equal(env.SIGN_IN_ALLOWLIST, "@highplainsbank.com");
    assert.equal(
      r.banner,
      "Target: PROD (hpb-eos-prod / hpb-eos-prod-db), credentials: Application Default Credentials",
    );
  });

  test("works with no .env.local at all", () => {
    const env: Env = {};
    const r = setupTarget({
      argv: [...ARGV0, "--target", "prod"],
      env,
      defaultEnvFile: ".env.local",
      readEnvFile: files({}).readEnvFile,
    });
    assert.equal(r.envFile, null);
    assert.equal(env.NEXT_PUBLIC_FIREBASE_DATABASE_ID, "hpb-eos-prod-db");
  });

  test("emulator host in .env.local is ignored; in the shell it is refused", () => {
    const withEmu = { ...ENV_LOCAL, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" };
    const env: Env = {};
    setupTarget({
      argv: [...ARGV0, "--target", "prod"],
      env,
      defaultEnvFile: ".env.local",
      readEnvFile: files({ ".env.local": withEmu }).readEnvFile,
    });
    assert.equal(env.FIRESTORE_EMULATOR_HOST, undefined);

    assert.throws(
      () =>
        setupTarget({
          argv: [...ARGV0, "--target", "prod"],
          env: { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
          defaultEnvFile: ".env.local",
          readEnvFile: files({}).readEnvFile,
        }),
      /FIRESTORE_EMULATOR_HOST/,
    );
  });

  test("refuses --project / --database / --env-file alongside --target", () => {
    for (const flag of ["--project", "--database", "--env-file"]) {
      assert.throws(
        () =>
          setupTarget({
            argv: [...ARGV0, "--target", "prod", flag, "x"],
            env: {},
            defaultEnvFile: ".env.local",
            readEnvFile: files({}).readEnvFile,
          }),
        new RegExp(`drop ${flag}`),
      );
    }
  });
});

describe("setupTarget — sandbox", () => {
  test("loads .env.local and pins the sandbox ids over the shell", () => {
    const env: Env = { NEXT_PUBLIC_FIREBASE_DATABASE_ID: "hpb-eos-prod-db" };
    const r = setupTarget({
      argv: [...ARGV0, "--target", "sandbox"],
      env,
      defaultEnvFile: ".env.local",
      readEnvFile: files({ ".env.local": ENV_LOCAL }).readEnvFile,
    });
    assert.equal(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, "hpb-eos-prod");
    assert.equal(env.NEXT_PUBLIC_FIREBASE_DATABASE_ID, "hpb-eos-sandbox-db");
    assert.equal(env.FIREBASE_SERVICE_ACCOUNT_JSON, '{"sandbox":true}');
    assert.equal(
      r.banner,
      "Target: SANDBOX (hpb-eos-prod / hpb-eos-sandbox-db), credentials: FIREBASE_SERVICE_ACCOUNT_JSON",
    );
  });

  test("refuses an emulator-mode .env.local", () => {
    assert.throws(
      () =>
        setupTarget({
          argv: [...ARGV0, "--target", "sandbox"],
          env: {},
          defaultEnvFile: ".env.local",
          readEnvFile: files({
            ".env.local": { ...ENV_LOCAL, FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" },
          }).readEnvFile,
        }),
      /FIREBASE_AUTH_EMULATOR_HOST/,
    );
  });
});
