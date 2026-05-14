# EOS

A self-hosted alternative to ninety.io for running EOS — Level 10 meetings, Scorecard, Rocks, To-Dos, Issues, Headlines, and a personal "My 90" dashboard.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind v4 · Supabase (Postgres + Auth + Realtime) · Vercel.

> Status: **Day 1 scaffold.** Auth + nav shell + DB schema are in. Feature pages land Thu–Fri. L10 orchestrator Sat. Pilot Tue 2026-05-19.

## Setup

### 1. Install deps

```bash
pnpm install
```

### 2. Set up Supabase

You have two options. **Hosted is recommended** for this project since the pilot runs on Vercel + hosted Supabase anyway.

#### Option A — Hosted Supabase (recommended)

1. Create a project at <https://supabase.com/dashboard> (free tier is fine).
2. In **SQL Editor**, paste the contents of `supabase/migrations/20260513210000_init.sql` and run it.
3. Then paste `supabase/seed.sql` and run it.
4. In **Project Settings → API**, copy the `URL` and the `anon public` key.
5. Create `.env.local` (see `.env.example`):

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

6. In **Authentication → URL Configuration**, set Site URL to `http://localhost:3000` (and your Vercel URL once deployed) and add both as redirect URLs.

#### Option B — Local Supabase (Docker required)

```bash
# Start Docker Desktop first, then:
pnpm db:start          # boots local Supabase stack (~1 min first time)
pnpm db:reset          # applies migrations + seed
```

The CLI prints local URLs and keys. Put them in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from supabase start output>
```

### 3. Run

```bash
pnpm dev
```

Open <http://localhost:3000>. You'll be redirected to `/login`. Enter your email, click the magic link in your inbox.

### 4. Join the pilot team

Magic-link signup creates an `auth.users` row → a trigger creates a `profiles` row in the pilot org. **Users are not auto-added to a team.** After a user signs up, manually add them via SQL:

```sql
insert into team_members (team_id, user_id)
select '00000000-0000-0000-0000-000000000010', id
from auth.users where email = 'pilot.user@example.com';
```

(This will be replaced with an admin UI before the pilot.)

## Project structure

```
app/
  (auth)/login/       — public sign-in (magic link)
  auth/callback/      — OAuth code exchange
  (app)/              — auth-gated route group
    my90/             — personal dashboard
    layout.tsx        — sidebar shell
components/
  app-shell.tsx       — sidebar nav
lib/
  supabase/           — server / client / proxy helpers
  auth.ts             — requireUser, getUserTeams
proxy.ts              — Next.js 16 "proxy" (was middleware) — refreshes session, gates routes
supabase/
  migrations/         — schema + RLS
  seed.sql            — pilot org + team + sample scorecard/rocks
```

## Roadmap to pilot (2026-05-19)

| Day | Status | Goal |
|-----|--------|------|
| Wed eve | done | Scaffold, schema, auth, nav shell |
| Thu     | todo | Scorecard / Rocks / To-Dos CRUD + My 90 wiring |
| Fri     | todo | Issues / Headlines CRUD, IDS → spawn to-do |
| Sat     | todo | L10 orchestrator (segment state, AgendaTimer, drop-to-issues) |
| Sun     | todo | Realtime sync, deploy to Vercel, dry-run |
| Mon     | todo | Buffer, invite pilot users |
| Tue     | todo | Pilot team runs real L10 |
