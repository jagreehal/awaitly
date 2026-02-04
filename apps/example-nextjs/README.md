# awaitly + Next.js playground

A minimal app that **verifies** the framework-integration docs: Server Actions with workflows, API routes with workflows, and React Query with typed Result errors.

## What it proves

- **Server Action + workflow** — Signup runs `createWorkflow` (validateEmail → checkDuplicate → createUser → sendWelcome); client calls the action and shows success or a typed error message.
- **API Route + workflow** — Same signup workflow via `POST /api/signup`; errors map to HTTP status (400, 409, 500) and `{ error: message }`.
- **React Query + Result** — `GET /api/users/[id]` returns `{ ok, value }` or `{ ok: false, error }`; client uses `useQuery`, throws `ResultError` on failure, and renders typed error states (e.g. NOT_FOUND vs UNAUTHORIZED).

## Stack

- **Next.js** (App Router)
- **awaitly** (workspace) — `ok`/`err`/`AsyncResult` from `awaitly`, `createWorkflow` from `awaitly/workflow`
- **Drizzle ORM** + **libsql** — SQLite (file-based, no native bindings)
- **TanStack Query** — client data fetching with Result unwrap + `ResultError`

## Prerequisites

- Node 22+
- pnpm (monorepo uses pnpm)

## Setup

From the **monorepo root**:

```bash
pnpm install
pnpm run build -F example-nextjs
```

From this app:

```bash
pnpm db:push
```

This creates `.data/sqlite.db` and the `users` table. The `.data/` directory is gitignored.

## Run

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). You’ll see three sections:

1. **Signup (Server Action + workflow)** — Email + password → Server Action runs the signup workflow; success or error message below.
2. **Signup (API Route + workflow)** — Same flow via `POST /api/signup`; success or error message below.
3. **Get user (React Query + Result)** — Enter a user ID (e.g. `1` after signing up), click Fetch; user data or typed error (e.g. “User not found”) appears.

## Scripts

| Script      | Description                    |
|------------|--------------------------------|
| `pnpm dev` | Start dev server (Next.js)     |
| `pnpm build` | Production build              |
| `pnpm start` | Run production server         |
| `pnpm lint`  | Run ESLint                    |
| `pnpm db:push` | Push Drizzle schema to SQLite |

## Layout

- `src/lib/db/` — Drizzle schema and libsql client
- `src/lib/workflows/signup.ts` — Signup operations + `createWorkflow` (used by action and API route)
- `src/app/actions/signup.ts` — Server Action
- `src/app/api/signup/route.ts` — POST signup API
- `src/app/api/users/[id]/route.ts` — GET user (Result-shaped JSON for React Query)
- `src/hooks/useUser.ts` — `useQuery` + `ResultError` (react-query.mdx pattern)
- `src/app/home-client.tsx` — Client UI for the three flows

## Related docs

In this repo, `apps/docs-site` and the main awaitly docs cover:

- **Framework Integrations** — Server Actions, API routes, error mapping (`guides/framework-integrations`)
- **React Query Integration** — Result + useQuery, ResultError, typed errors (`guides/react-query`)
