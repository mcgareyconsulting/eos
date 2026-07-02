@AGENTS.md

## ⚠ Before continuing feature/infra work — read `docs/ROADMAP.md`

At the **start of a session**, read the "▶ RESUME HERE" section of
`docs/ROADMAP.md` — it tracks what's decided, what's blocked on the client
(requirements stack, BigQuery conventions), and what's buildable now.

Standing constraints (Pass 10, 2026-07-01): runs fully in the client's GCP
org (no Vercel); Firestore = live layer, BigQuery = warehouse via nightly
batch + `onWrite` audit log; Gemini/AI features removed and deferred
(Vertex-AI-only if revived); features stay tabled until the client's
requirements stack arrives.
