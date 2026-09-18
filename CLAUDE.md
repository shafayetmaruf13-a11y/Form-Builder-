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
- **2026-09-18 — CI runs lint, typecheck, format, test, migrate and build** on
  every push and PR. Migrations are applied twice against a Postgres service
  container, and `db:generate` is re-run with a diff check so a schema edit
  without a generated migration fails at review time.
- **2026-09-18 — `schemaVersion` is on the document from the first version.**
  Rule 4 means a version published today must parse years from now; a
  discriminator is only cheap to add before there are two shapes to reconcile.
- **2026-09-18 — Style defaults use zod's `.prefault({})`, not `.default({})`.**
  In zod 4 `.default(v)` short-circuits parsing and returns `v` verbatim, so
  `.default({})` yields an empty style with none of the field defaults applied.
  Every element therefore carries a fully populated style, and no renderer has
  to handle a missing field.
- **2026-09-18 — `fontFamily` is a closed enum of four self-hosted families,**
  not a free string. A family absent from headless Chromium renders a different
  PDF than the design, which breaks the one promise the architecture exists to
  keep. Families bind CSS variables (`FONT_CSS_VARIABLES`) that both the app and
  the Slice 5 PDF worker must define. Adding a family means shipping its woff2
  to both.
- **2026-09-18 — Page scale is applied exactly once, on the page surface.**
  Elements are laid out at raw document coordinates and never learn their
  scale, so the builder (0.8), a thumbnail (0.25) and the PDF (1.0) cannot
  drift — there is only one layout path. This is rule 2 in code.
- **2026-09-18 — One `validation` bag for all input types,** rather than
  fourteen bespoke validation schemas. A `minLength` on a number is harmless;
  Slice 4 applies only the fields that make sense per type.
- **2026-09-18 — The conditional _evaluator_ belongs to Slice 4, not Slice 1.**
  Slice 1 fixes the rule's shape only. A read-only design preview renders every
  element regardless of its condition, because the designer needs to see what
  they built.
- **2026-09-18 — Read-only input views are not real form controls.** They draw
  what a field looks like, with no state and no `<input>` elements: a preview
  that announced itself to a screen reader as fillable would be lying. Slice 4
  renders the live, accessible versions.
- **2026-09-18 — `/` is the renderer, `/health` is the Slice 0 wiring probe.**
- **2026-09-18 — Slice 2 is built in three parts.** 2a: store, command stack,
  canvas, select/move/delete, undo/redo, palette drag-to-create. 2b: resize,
  rotate, multi-select, marquee, z-order, snap and guides, nudge, clipboard,
  zoom, pan. 2c: properties panel, multi-page strip, logo upload. One 35-file
  session is reviewable in theory and not in practice.
- **2026-09-18 — The document and the gesture are separate state.** A drag
  writes only ephemeral `drag` state, applied as a CSS transform; the document
  is written once, on pointer-up. This is what buys 60fps _and_ an undo history
  with one entry per gesture instead of one per frame. Never write the document
  from a pointer-move handler.
- **2026-09-18 — Structural sharing is a contract of `operations.ts`,** not an
  optimisation. Unchanged elements, unchanged pages and unchanged documents must
  come back as the same object reference, because the store's per-element
  subscriptions compare by identity. An operation that rebuilt everything would
  re-render the whole canvas on every frame.
- **2026-09-18 — The builder store is hand-rolled on `useSyncExternalStore`,**
  not a state library. It is ~80 lines, and the interesting part — the command
  stack — is not something any store library provides. Selector subscriptions
  are the point: plain context would re-render every consumer on every change.
  Selectors must return stable references or React loops.
- **2026-09-18 — dnd-kit covers drag-to-create and element move; resize and
  rotate handles use raw pointer capture.** dnd-kit is the right tool for
  dragging between and within containers, and the wrong one for per-handle
  transform maths. The stack rule is honoured where it is about dragging.
- **2026-09-18 — `PageSurface` takes an optional `renderElement`.** The builder
  passes a wrapper that subscribes per element; it still draws through
  `ElementView`. This is an injection point, not a second renderer — the builder
  shows exactly what the PDF will show because it is the same code.
- **2026-09-18 — localStorage draft is a deliberate stopgap.** The quality bar
  says nothing is ever lost, but server persistence is Slice 3. Slice 3 replaces
  `persistence/use-draft.ts` wholesale.
- **2026-09-18 — Resizing a rotated element pins the corner opposite the
  handle.** An element rotates about its centre, so changing its width moves
  that centre and with it every corner — including the one the user is holding
  still. `resizeRect` rotates the pointer delta into the element's own frame,
  computes where the anchor was in page space, and derives the new centre that
  puts it back. A property test asserts the anchor does not move, across seven
  rotations and every corner handle. This is the classic canvas-editor bug and
  it is not obvious from reading the code, so do not "simplify" it.
- **2026-09-18 — Grid snapping a resize touches only the dragged edges.**
  Snapping all four would shift the anchored corner. A rotated element is not
  grid-snapped at all: the grid is axis-aligned and a rotated box has no
  axis-aligned edges, so snapping its bounding box would silently change its
  size.
- **2026-09-18 — Alignment guides beat the grid.** Lining up with a neighbour is
  what the designer was aiming at; the grid only takes over on an axis where
  nothing was near enough. Guides are move-only so far — snapping a dragged
  _edge_ to a neighbour's edge during a resize is a separate computation.
- **2026-09-18 — Snap candidates are collected once per gesture,** not per
  frame. With a hundred elements, recomputing every edge each frame is the
  difference between a smooth drag and a janky one.
- **2026-09-18 — Handles exist only for a single selection.** Resizing several
  elements at once means deciding how each scales within the group, which is its
  own piece of work. Multiple selections move, nudge, restack, copy and delete.
- **2026-09-18 — The clipboard is in-memory, not the system clipboard.** Cross-
  tab paste needs async permissions and a format anything else could paste into.
  Worth doing; not worth blocking the gesture work on.
- **2026-09-18 — Panning is scrolling.** The page sits in an overflow container
  and space-drag moves its scroll position. A separate pan transform would be a
  second way for the page to be positioned, and the architecture rests on there
  being one.
- **2026-09-18 — shadcn/ui's registry is unreachable from the dev container.**
  `ui.shadcn.com` is refused by the environment's network policy, so the CLI
  cannot pull components. `components.json`, `cn()` and its deps are in place
  and the panel's controls follow shadcn's shape, so `npx shadcn add` works
  unchanged once that host is allowed. The controls are native elements
  meanwhile, which for a properties panel is barely a compromise — native
  `<select>` and `<input type="color">` are accessible and open the platform's
  own pickers.
- **2026-09-18 — The properties panel is driven by the schema's discriminant.**
  What it shows is a switch on `element.type`. Adding an element type means
  adding a case, not inventing a parallel notion of what that type can do.
- **2026-09-18 — Panel edits re-validate through the schema before becoming a
  command.** An invalid patch is a no-op, not an undo entry that does nothing
  and not a corrupted document. The panel constrains its own inputs; this is a
  backstop.
- **2026-09-18 — Consecutive edits to the same element merge into one undo.**
  Typing a label is one history entry, not one per keystroke. The merge keeps
  the original before-state and takes the latest after-state.
- **2026-09-18 — Object storage is an interface with one local-disk
  implementation.** R2 is the stack's choice and Slice 5 needs a bucket anyway,
  but writing an R2 client now — against credentials nobody has and which
  nothing here can exercise — would mean shipping untested code and calling it
  done. The seam is what matters: a document stores only an `objectKey`, so
  Slice 5 changes `lib/storage` and nothing else.
- **2026-09-18 — `objectUrl` lives in its own module.** The canvas and page
  thumbnails are client components; importing it from `lib/storage/index.ts`
  drags `node:fs` into the browser bundle and fails the build.
- **2026-09-18 — Uploads are validated server-side and keys are generated
  server-side.** MIME allowlist, size cap measured from the bytes rather than
  the reported length, and a nanoid key — never the supplied filename, which is
  a path traversal and an overwrite waiting to happen. Served objects carry a
  restrictive CSP and `nosniff`, because an uploaded SVG is script-capable.
- **2026-09-18 — Page thumbnails render the document through `PageSurface`,**
  not screenshots. Slice 3's library grid reuses the same mechanism.
