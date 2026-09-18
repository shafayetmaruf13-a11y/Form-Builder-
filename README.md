# Formcraft

Design a form on a free canvas — drag text, logos, shapes, colours and input
fields anywhere on an A4 page, like a design tool — then publish it as a
shareable link. People fill it in, and you get the result back as a
pixel-accurate PDF, as Excel, or by email.

See [CLAUDE.md](./CLAUDE.md) for the architecture rules, the data model and the
build plan. Read it before changing anything structural.

## Status

**Slice 0 — foundation.** The scaffold, database and toolchain are in place.
There is no product UI yet: the home page exists only to prove the wiring
(workspace import resolves, database reachable, migration applied, dev user
seeded). Slice 1 adds the document schema and the renderer.

## Requirements

- Node 22+
- pnpm 10+
- Docker (for the local Postgres)

## Running it

```bash
pnpm install
cp .env.example apps/web/.env   # defaults already match docker-compose.yml
pnpm db:up                      # starts Postgres on :5432
pnpm db:migrate                 # applies migrations, seeds the dev user
pnpm dev                        # http://localhost:3000
```

The home page should report **Connected. 7 tables** and a dev user of
`dev@formcraft.local`. If it reports "Not reachable", Postgres isn't up — run
`pnpm db:up` and reload.

### Without Docker

Any Postgres 16 will do. Create the role and database, point `DATABASE_URL` at
it, and run `pnpm db:migrate`:

```sql
create role formcraft with login password 'formcraft';
create database formcraft owner formcraft;
```

## Commands

| Command            | Does                                         |
| ------------------ | -------------------------------------------- |
| `pnpm dev`         | Next dev server                              |
| `pnpm build`       | Production build (fails on type errors)      |
| `pnpm lint`        | ESLint across the workspace                  |
| `pnpm typecheck`   | `tsc --noEmit` across the workspace          |
| `pnpm test`        | Vitest                                       |
| `pnpm format`      | Prettier write (`format:check` to verify)    |
| `pnpm db:up`       | Start Postgres (`db:down` to stop)           |
| `pnpm db:generate` | Generate a migration from `src/db/schema.ts` |
| `pnpm db:migrate`  | Apply migrations and seed the dev user       |
| `pnpm db:studio`   | Drizzle Studio                               |

## Layout

```
apps/web/            Next.js app (App Router)
  src/app/           routes
  src/db/            Drizzle schema, client, migrations, migrate script
packages/schema/     the form document schema — shared by builder, renderer,
                     PDF worker and API. Empty shell until Slice 1.
```

## Authentication

There isn't any yet. Everything is owned by one hardcoded dev user seeded by
`pnpm db:migrate` (`DEV_USER_ID` / `DEV_USER_EMAIL`). **Do not deploy this
publicly as-is.** Choosing an auth provider is a decision still to be made; see
the decisions log in CLAUDE.md.
