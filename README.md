# Formcraft

Design a form on a free canvas — drag text, logos, shapes, colours and input
fields anywhere on an A4 page, like a design tool — then publish it as a
shareable link. People fill it in, and you get the result back as a
pixel-accurate PDF, as Excel, or by email.

See [CLAUDE.md](./CLAUDE.md) for the architecture rules, the data model and the
build plan. Read it before changing anything structural.

## Status

**Slice 4 — accounts and access.** Sign in with an emailed link. `/members` is
the dashboard: invite people as user, moderator or admin, change roles, suspend,
remove, transfer ownership. Only invited addresses can sign in; the first
account to exist claims the workspace.

**Slice 3 — saved forms.** Forms live in the database. `/forms` is the library:
thumbnail grid, search, rename, duplicate, delete, last-edited. `/forms/[id]` is
the builder, autosaving as you work.

The builder itself (Slice 2) gives you a palette, a canvas, a properties panel
and a page strip: drag to create, move, resize, rotate, multi-select, marquee,
restack, nudge, duplicate, copy/paste, snap to a grid and to neighbours, zoom
and pan, edit every property, manage pages, upload a logo — all undoable.

Next is Slice 5: publishing a form as a shareable link, and filling it in.

Behind it: `packages/schema` defines what a form document is (Slice 1), and
`<FormRenderer />` draws one — the builder reuses that renderer rather than
having its own, so the canvas shows exactly what the PDF will.

- [`/members`](http://localhost:3000/members) — who is in the workspace
- [`/forms`](http://localhost:3000/forms) — your forms
- [`/forms/[id]`](http://localhost:3000/forms) — the builder for one form
- [`/`](http://localhost:3000/) — the read-only renderer, at two scales
- [`/health`](http://localhost:3000/health) — environment check

The library and builder need the database; `/` does not. Edits autosave about a
second after you stop, and the toolbar says when they landed — if it says
otherwise, believe it. Uploaded images go to `.uploads/` on disk and are served
from `/api/uploads/<key>`; Slice 5 swaps that for Cloudflare R2 without touching
any stored document.

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

Open [`/forms`](http://localhost:3000/forms) and make one. `/` renders the
sample document and needs no database. `/health` should report **Connected. 7
tables** and a dev user of `dev@formcraft.local`; if it reports "Not reachable",
Postgres isn't up — run `pnpm db:up` and reload.

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
  src/app/                     routes — /forms, /forms/[id], /, /health, /api/*
  src/components/renderer/     <FormRenderer />, page surface, element views
  src/builder/
    store/                     state, command stack, undo/redo
    geometry/                  screen ↔ page conversion, resize/rotate, snapping
    canvas/                    page + interaction overlay
    properties/                the right-hand panel and its controls
    pages/                     the page strip
    palette/  keyboard/  persistence/   autosave lives in persistence/
  src/library/                 the "My forms" grid
  src/members/                 the members dashboard
  src/auth.ts                  Auth.js configuration
  src/server/auth/             permissions (pure), session, guards
  src/server/forms/            queries and mutations, permission-checked
  src/server/members/          member management
  src/lib/storage/             object storage (local disk; R2 at Slice 5)
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

## Roles and access

| Role          | Can                                                                    |
| ------------- | ---------------------------------------------------------------------- |
| **Owner**     | Everything. Manages admins. The only role that can transfer ownership. |
| **Admin**     | Manage members, see and edit every form.                               |
| **Moderator** | See, export and delete responses. Cannot edit forms or members.        |
| **User**      | Build, edit and publish their own forms.                               |

Exactly one owner exists, enforced by a partial unique index rather than by
remembering. Ownership moves only by transfer, never by promotion.

Who you are comes from Auth.js. **What you may do is decided by
`src/server/auth/permissions.ts`** — pure functions, no database, no request,
exhaustively tested. Every server action re-checks there: the dashboard
disabling a button is a courtesy, not a control.

### Signing in locally

Sign-in is an emailed link. Without `RESEND_API_KEY`, the link is **printed to
the dev server's console** — paste it into the browser. Alternatively set
`AUTH_DEV_BYPASS=true` to be signed in as the seeded dev user; it is refused in
production whatever its value.

The seeded dev user (`pnpm db:migrate`) is the workspace owner. On a real
deployment, the first account to sign in claims the workspace; after that,
only invited addresses can get in.
