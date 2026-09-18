# Formcraft

A web app where a user designs a form on a free canvas — dragging text, logos,
shapes, colours and input fields anywhere on a page, like a design tool — then
publishes it as a shareable link. People fill it in, and the owner gets the
result as a pixel-accurate PDF, as Excel, or by email.

This file is the standing brief for anyone (human or Claude) working in this
repo. Keep it updated as decisions are made.

## Stack

Fixed. Do not substitute.

| Concern         | Choice                                                      |
| --------------- | ----------------------------------------------------------- |
| Framework       | Next.js (App Router) + TypeScript, strict mode              |
| Database        | Postgres via Drizzle ORM (local Postgres in Docker for dev) |
| UI              | Tailwind + shadcn/ui                                        |
| Dragging        | dnd-kit (**not** react-beautiful-dnd)                       |
| Fill-time forms | react-hook-form + zod                                       |
| PDF rendering   | Playwright (headless Chromium)                              |
| Spreadsheets    | ExcelJS                                                     |
| Email           | Resend                                                      |
| Object storage  | S3-compatible (Cloudflare R2), via the AWS SDK              |
| Tests           | Vitest + Playwright                                         |

**Ask before adding any dependency not listed here.**

## Architecture rules

These are non-negotiable. If a task seems to require breaking one, stop and ask.

1. **A form is a JSON document, not a page.** One zod schema in
   `packages/schema` is the single source of truth, shared by builder,
   renderer, PDF worker and API. Everything else derives from it.

2. **Fixed page coordinate system.** A page is A4 at 96dpi = **794 x 1123**
   units. Every element stores `{ x, y, w, h, rotation, z }` in those units.
   The builder canvas, the fill page and the PDF all render the same
   coordinates at different scales. This is what makes the PDF match the
   design exactly — do not introduce a second layout system anywhere.

3. **Stable element IDs.** nanoid at creation, never derived from position or
   order. Answers are keyed by element ID, never by label.

4. **Versioned documents.** Editing produces a draft. Publishing snapshots an
   immutable version. A submission references the version it was filled
   against and must always re-render against that exact version, even after
   the owner edits the form.

5. **Server re-validates everything.** Client validation is UX only.

6. **Public fill pages are untrusted surfaces.** Unguessable slugs, no
   sequential IDs, rate limiting, Turnstile.

## Element types

**Static (decoration):** `text`, `image` (logo upload), `shape` (rect,
ellipse, line, arrow), `divider`.

**Input (collects an answer):** `textInput`, `textarea`, `checkbox`,
`checkboxGroup`, `radioGroup`, `select`, `date`, `number`, `signature`,
`fileUpload`.

Every element has a style block: fill, stroke, strokeWidth, radius, opacity,
font family/size/weight/colour/align, padding.

Input elements additionally have: label, required, placeholder, help text,
validation rules, and a `conditional` rule
(`show this if <elementId> <op> <value>`).

## Data model

- `users`
- `forms` — owner, title, thumbnail key, draft document (jsonb), timestamps
- `form_versions` — form_id, version number, document (jsonb), published_at
- `form_links` — form_version_id, slug, optional token, expires_at, max_uses,
  uses_count
- `submissions` — form_version_id, link_id, answers (jsonb), submitted_at, ip,
  user_agent, pdf_object_key
- `uploads` — for logos and fileUpload answers
- `email_log` — to, subject, provider_id, status, submission_id

## Build slices

Built **in order**. Each slice must run and be reviewable on its own.

- **Slice 0 — foundation.** Repo, CLAUDE.md, Next.js scaffold, Docker Compose
  with Postgres, Drizzle set up with the schema above and a first migration,
  lint/format/test wired, `.env.example`, README.
- **Slice 1 — document schema + read-only renderer.** The zod schema package
  and a `<FormRenderer document={...} />` drawing a hardcoded document with one
  of every element type on an A4 page. No DB, no builder. Proves the
  coordinate system.
- **Slice 2 — the builder.** Palette / canvas / properties panel. Drag, move,
  resize, rotate, z-order, multi-select, copy/paste/duplicate, delete,
  undo/redo (command stack, **not** state snapshots), arrow-key nudge,
  snap-to-grid with alignment guides, zoom, multi-page, colour pickers, logo
  upload. Longest slice — component breakdown gets approved before it is
  written.
- **Slice 3 — saved forms.** Draft persistence with autosave. "My Forms"
  library: thumbnail grid, search, rename, duplicate, delete, last-edited.
  Thumbnails rendered from the document, not screenshots.
- **Slice 4 — publish and fill.** Publish creates an immutable version plus a
  share link. Public `/f/[slug]` renders a live form with validation and
  conditional logic, saves drafts to localStorage for resume, accepts a
  submission idempotently. Owner sees a submissions table.
- **Slice 5 — PDF.** Worker route renders a submission's version plus answers
  through headless Chromium at the same page coordinates, uploads to storage.
  Filled values appear exactly where the designer put the fields.
- **Slice 6 — Excel.** One workbook per submission, and one sheet of all
  submissions for a form with input elements as columns. Multi-select and file
  fields handled sensibly.
- **Slice 7 — email.** PDF to the owner on submission; owner can email any
  submission to a typed address. Resend, bounce webhooks, `email_log`.
  SPF/DKIM/DMARC records are **documented for the owner to add** — never
  configure DNS from here.

## Quality bar

This should feel like a design tool, not a CRUD app. Dragging is smooth at
60fps with many elements. Undo always works. Nothing is ever lost. Keyboard
shortcuts match Figma conventions where they apply. Public fill pages are
WCAG 2.2 AA accessible and work on a phone.

## Out of scope for v1

Teams and permissions, payments, a form templates marketplace, integrations,
webhooks, i18n, analytics. Do not build these. Do not add them "while you're
in there."

## Working agreement

- **One slice per session.** At the end of a slice: run it, say exactly how to
  verify it in the browser, list what you'd do differently, commit, and stop.
  Do not start the next slice until the owner says so.
- **Before any slice larger than a few files, show the plan and wait.**
- **When a requirement is ambiguous, stop and ask.** Guessing is worse than
  asking.
- Explain non-obvious decisions in one or two lines as they are made. This is
  maintained solo and needs to stay understandable.
- Write tests for the schema, the conditional-logic evaluator, and the Excel
  flattening. Don't test the UI exhaustively.
- **Never commit secrets. Never run destructive git commands without asking.**

## Decisions log

Decisions made as the project goes, newest last. Each line says what was
decided and why.

- **2026-09-18 — Repo is `shafayetmaruf13-a11y/Form-Builder-`, not a new
  `formcraft` repo.** The brief's `gh repo create ... formcraft` step assumed
  an empty machine; this repo already exists, is connected, and is the one
  this work is scoped to. Renaming or relocating it is a one-click change on
  GitHub later if wanted.
- **2026-09-18 — Development branch is `main-ry1qm3`.** Work is pushed there,
  not to `main`.
- **2026-09-18 — pnpm workspace monorepo** (`apps/web`, `packages/schema`), no
  Turborepo. Architecture rule 1 needs `@formcraft/schema` importable by four
  consumers; a workspace is the smallest thing that does that. The web app
  consumes it as TypeScript source via `transpilePackages`, so there's no build
  step between editing the schema and seeing it applied.
- **2026-09-18 — No auth provider; one hardcoded dev user.** Owner's call.
  `users` deliberately has no `passwordHash`/session columns: Auth.js and Clerk
  each bring their own account tables, and guessing now would only buy a
  migration to undo. Revisit at Slice 3, where "My Forms" first needs a real
  owner.
- **2026-09-18 — Tailwind v4 is CSS-first, so there is no `tailwind.config.ts`.**
  Theme tokens live in `apps/web/src/app/globals.css`, including the A4 page
  constants from architecture rule 2.
- **2026-09-18 — ESLint pinned to 9.x, not 10.** `eslint-config-next@16`'s
  plugins (react, import, jsx-a11y) don't yet declare ESLint 10 support.
  Config uses `eslint-config-next`'s native flat-config exports, no
  `FlatCompat` shim.
- **2026-09-18 — All primary keys are nanoid `text`, never `serial`.**
  Architecture rule 6 forbids enumerable public identifiers, and a sequential
  PK leaks row counts the moment one reaches a URL.
