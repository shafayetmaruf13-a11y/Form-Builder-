# Formcraft

Design a form on a free canvas — drag text, logos, shapes, colours and input
fields anywhere on an A4 page, like a design tool — then publish it as a
shareable link. People fill it in, and you get the result back as a
pixel-accurate PDF, as Excel, or by email.

See [CLAUDE.md](./CLAUDE.md) for the architecture rules, the data model and the
build plan. Read it before changing anything structural.

## Status

**Slice 8 — email.** New responses are emailed to the form's owner with the
PDF attached, controlled by a per-form switch on the responses page. Any
response can be emailed on to a typed address. Every send — including sign-in
links — is recorded in `email_log`, and Resend's bounce and delivery webhooks
update it. The SPF, DKIM and DMARC records are written up in
[docs/email-dns.md](./docs/email-dns.md) **for you to add**; nothing here
touches DNS.

**Slice 7 — Excel.** Every response downloads as a workbook, and a whole
form's responses download as one sheet — a row each, a column per question,
with the header frozen and a filter on every column. Dates, numbers and
checkboxes are stored as real Excel types, so sorting and formulas work.
Columns are the union of every published version, so a renamed field stays one
column and a removed one still reports what it collected.

**Slice 6 — PDF.** Every response downloads as a pixel-accurate PDF from the
**Download** column on the responses table. It renders the submission's own
version through the same `PageSurface` the builder draws, at A4's exact
coordinates, so filled values land where the designer put the fields. Rendered
on first request and cached from then on.

**Slice 5 — publish and fill.** Publish from the builder: it snapshots the
draft into an immutable version and mints an unguessable share link. Anyone
with the link fills the form in at `/f/<slug>`, on the same A4 coordinates it
was designed on, with live validation and conditional fields. Answers are saved
to the device as you type and survive a refresh. Submitting is idempotent, rate
limited and re-validated on the server. `/forms/[id]/responses` shows the
versions, their links (revocable) and every response, each rendered against the
version it was filled against.

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

That is the whole of the build plan. Slices 0 to 8 are done.

Behind it: `packages/schema` defines what a form document is (Slice 1), and
`<FormRenderer />` draws one — the builder reuses that renderer rather than
having its own, so the canvas shows exactly what the PDF will.

- [`/members`](http://localhost:3000/members) — who is in the workspace
- [`/forms`](http://localhost:3000/forms) — your forms
- [`/forms/[id]`](http://localhost:3000/forms) — the builder for one form
- `/forms/[id]/responses` — published versions, share links, responses
- `/f/<slug>` — the public fill page (no sign-in; the link is the access)
- [`/`](http://localhost:3000/) — the read-only renderer, at two scales
- [`/health`](http://localhost:3000/health) — environment check

The library and builder need the database; `/` does not. Edits autosave about a
second after you stop, and the toolbar says when they landed — if it says
otherwise, believe it. Uploaded images go to `.uploads/` on disk and are served
from `/api/uploads/<key>`; Slice 6 swaps that for Cloudflare R2 without touching
any stored document.

### Trying the fill flow

Open a form, press **Publish**, copy the link from the dialog, and open it in a
private window — there is no sign-in on a fill page. Try leaving a required
field blank (an error summary appears at the top and each field says what is
wrong), and set **Country** to _Other_ to watch a conditional field appear.
Submit, then look at **Responses** in the builder toolbar.

Then edit a field's label in the builder and reload the share link: it still
shows the old label. That is architecture rule 4 — a published version never
changes, so a response filled last month still renders exactly as it was asked.

### Getting a PDF

On **Responses**, the last column downloads the submission as a PDF. The first
one takes about a second (a browser has to start); after that it is served from
storage. Put it side by side with the builder — the values sit exactly where
the fields are, because it is the same renderer at the same coordinates.

Rendering needs a Chromium binary. In development set
`CHROMIUM_EXECUTABLE_PATH` if Playwright did not download one itself; the dev
container ships one at `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.

### Email

Nothing needs configuring to try it. With no `RESEND_API_KEY` the message is
printed to the dev server's console and recorded in `email_log` with status
`logged` — deliberately not `sent`, so a log full of them is never mistaken
for delivered mail.

Submit a response and watch the terminal: the owner's notification appears a
second or so later, with the PDF attached. The submission itself returns in
about 40ms, because the email happens after the response rather than in front
of it.

**Email** beside a response forwards it to an address you type, with the PDF
attached and replies addressed to you. The checkbox above the table turns
per-response notifications off for that form.

To send real mail, set `RESEND_API_KEY` and `EMAIL_FROM`, and follow
[docs/email-dns.md](./docs/email-dns.md) for the DNS records — which are yours
to add, not this app's.

### Getting a spreadsheet

**Excel** beside each response downloads that one, laid out like the form.
**Download all as Excel** gives every response as a table — one row each, the
header frozen, a filter on every column.

The interesting case is a form you have published more than once. Columns are
the union of every version, so a field you renamed stays a single column under
its newest name, and a field you deleted still shows the answers it collected,
with its header tinted to say it is no longer asked. A row is blank in any
column its own version never had; the **Version** column is what tells you
which.

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
sample document and needs no database. `/health` should report **Connected. 11
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
| `pnpm test`        | Vitest (unit)                                |
| `pnpm test:e2e`    | Playwright (end-to-end, from `apps/web`)     |
| `pnpm format`      | Prettier write (`format:check` to verify)    |
| `pnpm db:up`       | Start Postgres (`db:down` to stop)           |
| `pnpm db:generate` | Generate a migration from `src/db/schema.ts` |
| `pnpm db:migrate`  | Apply migrations and seed the dev user       |
| `pnpm db:studio`   | Drizzle Studio                               |

## Layout

```
apps/web/
  src/app/                     routes — /forms, /f/[slug], /, /health, /api/*
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
  src/fill/                    the public fill page: live controls, draft resume
  src/pdf/                     an input element drawn with its answer in it
  src/server/publish/          slugs, publish checks, link lookup, rate limiting
  src/server/pdf/              browser, renderer, object keys, render token
  src/server/excel/            workbooks, sheet names, export access
  src/server/email/            one transport, messages, webhook signatures
  e2e/                         Playwright: the architectural invariants
  src/auth.ts                  Auth.js configuration
  src/server/auth/             permissions (pure), session, guards
  src/server/forms/            queries and mutations, permission-checked
  src/server/members/          member management
  src/lib/storage/             object storage (local disk; R2 at Slice 6)
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
