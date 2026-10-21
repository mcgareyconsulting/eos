# spikes/

Throwaway proofs that de-risk a design before it lands in the real code.
Nothing here is imported by the app, and nothing here is in the default
`pnpm test` glob (which only covers `lib/`, `components/`, `app/`, `scripts/`).

## P14 — `hasAny()` on `users/{uid}.team_ids`

Proves that one `get()` of the caller's profile plus `hasAny()` authorizes the
live client queries (`array-contains` on `shared_team_ids`, `team_id ==`, and
get-by-id), and denies a caller who is not on the team. Result and the rule to
carry into P2/P11: `docs/spikes/P14-rules-hasany.md`.

Files:

- `p14-hasany.rules` — minimal standalone rules. **Not** the app's `firestore.rules`.
- `p14-hasany.test.ts` — `@firebase/rules-unit-testing` + the client SDK, run under `node:test`.
- `firebase.json` — emulator config just for this spike (Firestore only, port 8085, UI off).

### Run it

Needs Java (any JDK 11+; tested with Temurin 26) and the repo's
`firebase-tools` devDependency. The first run downloads the emulator jar to
`~/.cache/firebase/emulators/`.

```sh
pnpm spike:p14
```

which is:

```sh
firebase emulators:exec --config spikes/firebase.json --project demo-p14-hasany \
  --only firestore "tsx --test spikes/p14-hasany.test.ts"
```

The `demo-` project id keeps the emulator fully offline: it never talks to a
real Firebase project, and no login is needed. Run it from the repo root.

To iterate, start the emulator once and run the test against it:

```sh
npx firebase emulators:start --config spikes/firebase.json --project demo-p14-hasany --only firestore
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx --test spikes/p14-hasany.test.ts
```
