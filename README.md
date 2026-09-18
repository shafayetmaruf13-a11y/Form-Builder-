# Formcraft

Design a form on a free canvas — drag text, logos, shapes, colours and input
fields anywhere on an A4 page, like a design tool — then publish it as a
shareable link. People fill it in, and you get the result back as a
pixel-accurate PDF, as Excel, or by email.

See [CLAUDE.md](./CLAUDE.md) for the architecture rules, the data model and the
build plan. Read it before changing anything structural.

## Status

**Slice 2b — the builder's gestures.** `/builder` gives you a palette, a canvas
and the editing surface: drag to create, move, resize, rotate, multi-select,
marquee, restack, nudge, duplicate, copy/paste, snapping with alignment guides,
zoom and pan — all undoable. The properties panel, multi-page and logo upload
come in 2c.

Behind it: `packages/schema` defines what a form document is (Slice 1), and
`<FormRenderer />` draws one — the builder reuses that renderer rather than
having its own, so the canvas shows exactly what the PDF will.

- [`/`](http://localhost:3000/) — the read-only renderer, at two scales
- [`/builder`](http://localhost:3000/builder) — the builder
- [`/health`](http://localhost:3000/health) — environment check

Nothing is saved to the server yet (Slice 3). A localStorage draft stands in, so
a refresh does not lose work.

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

`/` renders the sample document and needs no database. `/health` should report
**Connected. 7 tables** and a dev user of `dev@formcraft.local`; if it reports
"Not reachable", Postgres isn't up — run `pnpm db:up` and reload.

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
apps/web/
  src/app/                     routes — /, /builder, /health
  src/components/renderer/     <FormRenderer />, page surface, element views
  src/builder/
    store/                     state, command stack, undo/redo
    geometry/                  screen ↔ page conversion
    canvas/                    page + interaction overlay
    palette/  keyboard/  persistence/
  src/db/                      Drizzle schema, client, migrations, migrate script
packages/schema/               the form document schema and pure document
                               operations — shared by builder, renderer, PDF
                               worker and API
```

### Builder shortcuts

Figma conventions where they overlap. `⌘` is `Ctrl` on Windows and Linux.

|                                |                                                                   |
| ------------------------------ | ----------------------------------------------------------------- |
| Move / extend selection        | drag · shift-click · marquee on empty canvas                      |
| Select all / deselect          | `⌘A` · `Esc`                                                      |
| Nudge                          | arrows (1 unit) · `⇧`+arrows (10)                                 |
| Undo / redo                    | `⌘Z` · `⌘⇧Z`                                                      |
| Copy / cut / paste / duplicate | `⌘C` · `⌘X` · `⌘V` · `⌘D`                                         |
| Delete                         | `⌫`                                                               |
| Restack                        | `⌘]` `⌘[` one step · `⌘⇧]` `⌘⇧[` front/back                       |
| Zoom                           | `⌘+` `⌘−` · `⌘0` for 100% · `⌘`+scroll                            |
| Pan                            | hold space and drag                                               |
| Constrain                      | `⇧` while resizing keeps proportions, while rotating snaps to 15° |

### The other rule worth knowing before you touch the builder

A drag writes **ephemeral** state only, applied as a CSS transform. The document
is written once, when the gesture ends. That is what keeps dragging at 60fps and
keeps undo at one entry per gesture instead of one per frame. Never write the
document from a pointer-move handler.

### The one rule worth knowing before you touch the renderer

A page is 794 × 1123 units (A4 at 96dpi) and every element stores its geometry
in those units. Scale is applied **once**, as a transform on the page surface;
no element ever knows what scale it is being drawn at. That is what makes the
builder, the fill page and the PDF agree. Do not add a second way to lay
elements out.

## Authentication

There isn't any yet. Everything is owned by one hardcoded dev user seeded by
`pnpm db:migrate` (`DEV_USER_ID` / `DEV_USER_EMAIL`). **Do not deploy this
publicly as-is.** Choosing an auth provider is a decision still to be made; see
the decisions log in CLAUDE.md.
