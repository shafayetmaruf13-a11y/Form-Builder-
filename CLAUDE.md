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
| Authentication  | Auth.js (NextAuth v5) + Drizzle adapter, email sign-in      |
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

- `users` — email, name, **role** (`user` | `moderator` | `admin` | `owner`),
  **status** (`invited` | `active` | `suspended`), who invited them. Exactly one
  owner, enforced by a partial unique index.
- `accounts`, `sessions`, `verification_tokens` — owned by the Auth.js adapter,
  pointing at our `users` table so a person is one row with one id
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
- **Slice 4 — accounts and access.** Auth.js email sign-in, roles over one
  workspace, and a members dashboard: invite, change role, suspend, remove,
  transfer ownership. Authorization is ours, in `server/auth/permissions.ts`,
  not the identity provider's.
- **Slice 5 — publish and fill.** Publish creates an immutable version plus a
  share link. Public `/f/[slug]` renders a live form with validation and
  conditional logic, saves drafts to localStorage for resume, accepts a
  submission idempotently. Owner sees a submissions table.
- **Slice 6 — PDF.** Worker route renders a submission's version plus answers
  through headless Chromium at the same page coordinates, uploads to storage.
  Filled values appear exactly where the designer put the fields.
- **Slice 7 — Excel.** One workbook per submission, and one sheet of all
  submissions for a form with input elements as columns. Multi-select and file
  fields handled sensibly.
- **Slice 8 — email.** PDF to the owner on submission; owner can email any
  submission to a typed address. Resend, bounce webhooks, `email_log`.
  SPF/DKIM/DMARC records are **documented for the owner to add** — never
  configure DNS from here.

## Quality bar

This should feel like a design tool, not a CRUD app. Dragging is smooth at
60fps with many elements. Undo always works. Nothing is ever lost. Keyboard
shortcuts match Figma conventions where they apply. Public fill pages are
WCAG 2.2 AA accessible and work on a phone.

## Out of scope for v1

Payments, a form templates marketplace, integrations, webhooks, i18n,
analytics. Do not build these. Do not add them "while you're in there."

**Multi-tenant teams** remain out of scope. Roles are in (see Slice 4), but
over a _single_ workspace: the deployment is the owner's team. Several
independent organisations in one database is a different product.

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
- **2026-09-21 — Slugs are 22 characters of a 29-symbol alphabet (~107 bits).**
  Rule 6 makes the URL the access control, so it has to be beyond enumeration.
  The alphabet drops `0/O`, `1/l/I`, vowels and `u/v`, so a slug read off a
  printed page cannot land on a _different_ valid form; lower case only,
  because URLs are not reliably case-preserved by everything that touches them.
- **2026-09-21 — Every reason a link won't open is the same message and the
  same 404.** Distinguishing "expired" from "never existed" tells a stranger
  which slugs are real, which is an enumeration oracle. The distinctions exist
  in `LinkRefusal` for the owner's UI and for tests.
- **2026-09-21 — A hidden field's answer is dropped and never validated.**
  Otherwise a required question nobody can see blocks the form forever, and a
  value typed before a condition turned against it gets submitted invisibly.
  The evaluator resolves to a fixed point, because hiding A hides B that
  depends on A.
- **2026-09-21 — Circular conditional rules are detected explicitly, not left
  to the iteration cap.** Two fields conditioned on each other _settle_
  perfectly well at "both hidden", so no loop ever happens — the questions just
  quietly vanish. `findCycles` walks the (out-degree one) dependency graph and
  reports them as `broken`, which renders them visible. A silently missing
  question is not something anybody debugs.
- **2026-09-21 — `validateAnswers` builds its result up from the document, not
  down from the request.** A key that is not a question in this form — from a
  tampered request or a tab open since before an edit — therefore cannot reach
  storage at all. The request says what was answered; the document says what
  was asked.
- **2026-09-21 — A signature is a PNG data URL, and the server caps it.**
  Uploading to object storage would make it the only answer that can fail to
  save _after_ the form is otherwise complete; storing stroke coordinates would
  need a second renderer in the PDF worker, which is what rule 2 exists to
  prevent. One string that both an `<img>` and headless Chromium draw
  identically. Its prefix and length are checked server-side, and again where
  it is rendered.
- **2026-09-21 — The fill page removes hidden elements from the DOM rather
  than hiding them with CSS.** A `display: none` field is still submitted by
  some browsers and still reachable by some screen readers. Removing it is the
  only version where what is asked, what is announced and what is stored agree.
- **2026-09-21 — Rate limiting is a fixed window in Postgres, incremented in
  one statement.** Read-then-write races two concurrent submits straight past
  the limit, which is the case that matters. In-memory would reset on deploy
  and be wrong with two processes. A fixed window admits up to 2x across a
  boundary — a rounding error against storing every attempt.
- **2026-09-21 — Turnstile is written in full and off unless both keys are
  set, and fails closed.** `challenges.cloudflare.com` is refused by this
  container's network policy, so a wired-up widget would make every fill page
  unusable here and a stub that pretended to verify would be worse. An
  anti-abuse check that disables itself under strain is not a check.
- **2026-09-21 — Idempotency keys are namespaced by link.** The unique index is
  global, so without the prefix one person's key could collide with another's
  on a different form, and a key from one link could resolve a submission on
  another.
- **2026-09-21 — A link use is claimed after validation and before the insert.**
  A rejected submission must not burn a use, and a one-use link must not take
  two — so the counter is incremented conditionally on its own cap in a single
  statement.
- **2026-09-21 — The fill draft is localStorage, read through
  `useSyncExternalStore`.** Server-side drafts would mean an unauthenticated
  write endpoint holding partial answers for anyone who opens a link. The hook
  is the one that gets the hydration boundary right; its snapshot is cached
  because React compares by identity and a freshly parsed object each call is
  an infinite render loop.
- **2026-09-21 — Publishing is refused for an unlabelled field, an empty
  choice list, a dangling condition or duplicate ids.** A version is immutable,
  so these cannot be fixed after the link is circulating — and an unlabelled
  control is the commonest way to fail the WCAG 2.2 AA bar the brief sets.
- **2026-09-21 — `submission:readOwn` sits at `user`.** `submission:readAny`
  starts at moderator, so without it somebody could publish a form and never
  see a single reply to it. Reading _other people's_ responses is moderation;
  reading your own is what publishing is for.
- **2026-09-21 — Ownership goes through `currentOwnerId()`.** It returns the
  hardcoded dev user today, so the owner filter on every query is currently a
  formality — which is exactly why it is written now. Adding auth becomes a
  change to one function rather than an audit for the query that forgot.
- **2026-09-21 — Library thumbnails render live from the stored document;
  `forms.thumbnail_key` stays unused.** "Rendered from the document, not
  screenshots" is satisfied by rendering, and a stored image would need the
  headless-Chromium pipeline that Slice 5 brings. The cost is that the list
  query returns every draft document. Revisit if the library gets slow.
- **2026-09-21 — Autosave is a route handler; library CRUD are server actions.**
  Autosave runs from the builder's save loop, which is not React and needs a
  conflict reported back rather than a re-render. The rest are invoked from
  forms and buttons, where `revalidatePath` does the work.
- **2026-09-21 — Autosave carries the `updatedAt` it last saw, and a mismatch
  is a 409.** Two tabs on one form would otherwise silently overwrite each
  other. On conflict the client stops saving and says so rather than retrying,
  because retrying _is_ the silent overwrite.
- **2026-09-21 — No localStorage mirror of the draft.** The store is the truth
  while the tab is open, the server between sessions. A third copy that can
  disagree with both on load is worse than the problem it solves. On a failed
  save the builder shows a persistent error and `beforeunload` warns. Offline
  buffering is a real feature and deserves its own design, not a smuggled-in
  one.
- **2026-09-21 — Undo history is session-scoped.** It is not persisted across a
  reload, and "undo always works" in the quality bar means within a session.
  Persisting a command stack is a much larger feature than it looks.
- **2026-09-21 — Duplicating a form keeps its element ids.** Ids only have to be
  unique within a document, and answers resolve against the version they were
  filled against, so two documents sharing ids confuses nothing.
- **2026-09-21 — Deleting a form cascades to its versions and every submission
  against them.** The confirmation states the counts rather than asking "are you
  sure". If that turns out to be too sharp an edge, soft delete is a schema
  change, not a UI one.
- **2026-09-21 — `/builder` redirects to `/forms`.** A builder that saves
  nowhere has no reason to exist once saving works.
- **2026-09-21 — Teams and permissions moved into scope, at the owner's
  request.** Roles over one workspace, not multi-tenant organisations. The
  out-of-scope list was edited rather than quietly stepped over.
- **2026-09-21 — Auth.js, not Clerk.** The owner's organisation does not want
  Clerk. Auth.js is also reachable from the dev container, where every Clerk
  domain is refused by the network policy — so sign-in can actually be
  exercised here rather than taken on trust.
- **2026-09-21 — The identity provider answers "who"; we answer "what they may
  do".** Roles live on our own `users` row and every check goes through
  `server/auth/permissions.ts`, which is pure and exhaustively tested. No
  network call to authorize, and the model is not owned by a vendor.
- **2026-09-21 — Database sessions, not JWTs.** Demoting an admin has to bite
  immediately; a JWT would carry the old role until it expired, which for an
  access-control feature is the entire point missed. `getCurrentUser()` re-reads
  the row rather than trusting the session's copy, for the same reason.
- **2026-09-21 — Every server action re-checks permission.** A server action is
  a public endpoint; the dashboard disabling a button is a courtesy, not a
  control. The UI asks the same pure rules so a disabled control's tooltip is
  the exact reason the server would refuse.
- **2026-09-21 — A workspace is not a signup form.** Only an invited address may
  sign in; the sole exception is the first account, which claims an ownerless
  workspace. A row is not an invitation just because it exists — a real one
  records who sent it, which is what distinguishes it from one the Auth.js
  adapter created for a stranger. The first cut of this got it wrong and let an
  uninvited address in; the browser harness caught it.
- **2026-09-21 — An uninvited address is refused at sign-in, not at
  redemption.** That allows enumerating who is a member. The alternative —
  emailing a link to any address on request — makes the app a spam relay, which
  is worse. Deliberate trade-off.
- **2026-09-21 — `trustHost` is opt-in in production** (`AUTH_TRUST_HOST`), and
  on by default only in development. The `Host` header decides where a sign-in
  link points, so trusting a forged one mails somebody's magic link to an
  attacker.
- **2026-09-21 — `AUTH_DEV_BYPASS` signs you in as the seeded dev user,** and is
  refused in production regardless of its value. An environment variable that
  turns off authentication is exactly the sort of thing that escapes a laptop.
- **2026-09-21 — Not-found and not-permitted are the same answer.** Telling
  somebody a form exists but is not theirs is itself a disclosure.
- **2026-09-30 — The PDF worker navigates to a real page, it does not
  `setContent()`.** The app's fonts come from `next/font`, self-hosted under
  `/_next/static/media` with build-generated filenames. Loading
  `/internal/render/<id>` on our own origin means Chromium is served the same
  stylesheet, the same `@font-face` rules and the same CSS variables as every
  other page, by construction. Rebuilding that font CSS by hand from hashes
  nothing can predict would be a second rendering path — rule 2's failure mode
  one level down.
- **2026-09-30 — `/internal/render` is authorised by a per-submission HMAC,
  not a shared secret.** It has no session, because the browser fetching it is
  nobody, which makes it an IDOR over every response ever collected if it is
  ever reachable. The first version held a random token in a module variable;
  Next compiles a route handler and an RSC page into separate module graphs, so
  that token existed twice in one process with two different values and nothing
  ever authenticated. A token derived from `AUTH_SECRET`, the submission id and
  an expiry has no state to disagree about — and a leaked URL grants one
  response for two minutes rather than all of them forever.
- **2026-09-30 — PDFs render on demand and are cached by (submission,
  version).** Rendering on submit would put a Chromium launch behind the one
  endpoint strangers can reach. Caching is safe precisely because a version is
  immutable: rule 4 paying for itself, since otherwise every download would
  have to re-render to be trustworthy.
- **2026-09-30 — Page size is passed to `page.pdf` in inches, never px or
  `format: "A4"`.** 1in is exactly 72pt and a PDF page box is in points, so
  inches are the one accepted unit that converts without rounding. `794px`
  yields a box a fraction _shorter_ than the page; `A4` is wrong by definition,
  since 210x297mm is not 794x1123px at 96dpi. Chromium still quantises the
  sheet by about half a pixel, which is a hairline of white at the right and
  bottom — with `scale: 1` the content itself is never stretched, and element
  placement is asserted separately.
- **2026-09-30 — Page breaks use `+` on adjacent pages, not `:last-child`.**
  The framework appends its own script tags to the body, so the final page div
  is not `:last-child`, kept its break, and printed a trailing blank page. An
  adjacent-sibling selector only ever matches page divs.
- **2026-09-30 — A hidden field is absent from the PDF, not blank.** It was
  never asked, so printing an empty box for it would claim it went unanswered.
  The same rule the fill page follows, and now the fourth thing that agrees:
  what is asked, announced, stored and printed.
- **2026-09-30 — The all-submissions sheet's columns are the union of every
  version, keyed by element id.** Owner's call. Submissions span versions
  (rule 4) and a version may add, remove or rename fields. Keying by id
  (rule 3) means a rename is one column with a new heading rather than two
  columns with half the data each, and a field removed in a later version
  still reports the answers it collected — dropping those would be data loss in
  the one place that is a record. Retired columns are tinted and annotated, and
  the Version column is what makes a blank legible.
- **2026-09-30 — Excel cells carry real types.** Dates are Dates, numbers are
  numbers, a checkbox is a boolean. A column of text dates sorts
  alphabetically and `=SUM()` over text numbers is zero — the difference
  between a spreadsheet and a CSV that has been renamed. Dates are parsed at
  UTC midnight, because a local-midnight `Date` renders as the previous day for
  anybody west of Greenwich.
- **2026-09-30 — A choice exports its option _label_, not its stored value.**
  A sheet is read by people: the answer somebody gave was "United Kingdom";
  "gb" is a detail of how it is stored. Values that are no longer options fall
  back to the raw value rather than vanishing.
- **2026-09-30 — A signature exports as `(signed)` and a file as its
  filename.** 15KB of base64 in a cell is unusable and an embedded image makes
  rows unsortable; file bytes cannot go in a cell and an object key would mean
  nothing to whoever opens the sheet.
- **2026-09-30 — Column order is reading order, not `z` or document order.**
  Top to bottom then left to right, with rows within a line of each other
  treated as one row so two side-by-side fields do not swap over a stray pixel.
  A free canvas has no inherent column order; this is where one is imposed.
- **2026-09-30 — A hidden field is omitted from a single submission's
  workbook, exactly as from its PDF** — the question was never asked, so a
  blank beside it would claim it went unanswered. The all-submissions sheet
  cannot do this, since a column must exist if any row answered it.
- **2026-10-01 — One transport for every email, and every send is logged.**
  Slice 4 posted sign-in links to Resend inline and logged nothing, which made
  the one email this app already sent the one email nobody could account for.
  Everything now goes through `server/email/transport.ts` and lands in
  `email_log`, so "did they get it?" has an answer that does not depend on
  asking Resend.
- **2026-10-01 — `api.resend.com` is refused by this container's network
  policy,** like Cloudflare's and Clerk's domains. Unset `RESEND_API_KEY`
  prints the message and records it as `logged` — a status deliberately
  distinct from `sent`, so a log full of them is never mistaken for delivered
  mail. This is how the flow is exercised here; it is not a stub that pretends
  to succeed.
- **2026-10-01 — The submission email is sent from `after()`, never before the
  response.** Notifying means rendering a PDF, which means launching Chromium,
  and Slice 6's rule is that the one endpoint strangers can reach never waits
  on a browser. Measured: 37–47ms to respond, against about a second to
  render.
- **2026-10-01 — Notifications are a per-form toggle, default on.** Owner's
  call. The brief says "PDF to the owner on submission"; unconditional, a form
  taking two hundred responses a day would be unusable with no remedy but
  unpublishing it.
- **2026-10-01 — A failed email never fails the thing that caused it.**
  `sendEmail` does not throw: a submission is accepted whether or not the
  owner's mail server is reachable, and the `email_log` row is what says which
  happened. The one exception is the sign-in link, where Auth.js would
  otherwise show "check your email" for a message nothing sent.
- **2026-10-01 — Webhook signatures are verified in-repo rather than with the
  `svix` package,** which is not in the stack table. The scheme is one HMAC
  over `id.timestamp.body` and is worth having under test either way. With no
  `RESEND_WEBHOOK_SECRET` the endpoint rejects everything: it is public, so one
  that accepted everything would let anyone mark an owner's address as bounced
  and silently stop their notifications.
- **2026-10-01 — Webhook events only ever move a status forward.** They arrive
  out of order — `delivered` can land before `sent` — so a later event wins
  only if it says more than what is recorded. Otherwise a stray `sent` would
  overwrite a `bounced` and the log would claim an address works when it does
  not.
- **2026-10-01 — Forwarding a response is treated as a spam relay, because
  that is its shape.** Permission-checked, one recipient per call, rate limited
  at 20/hour keyed on the _actor_ (keying on the recipient would let somebody
  spray a thousand addresses once each), and every send logged. `reply_to` is
  the sender's address, since nobody reads the sending domain's mailbox.
- **2026-10-01 — Email bodies show option labels, not stored values** — the
  same rule as the Excel export, for the same reason. Reading the first real
  notification is what caught it: "Country: gb" reads like a bug.
- **2026-10-01 — DNS records are documented in `docs/email-dns.md` and never
  configured from here.** The brief's instruction, and the right one:
  publishing SPF, DKIM or DMARC changes the public identity of a domain, with
  consequences for mail that has nothing to do with this app.
- **2026-10-01 — The CDP harness is now a committed Playwright suite.** Four
  slices' worth of verification lived in throwaway scripts in `/tmp`, which
  meant re-checking by hand every time. `apps/web/e2e` holds 41 assertions on
  the invariants unit tests cannot reach — rule 2's coordinates, rule 4's
  immutability, rule 5's refusals, rule 6's slugs and limits — and runs as its
  own CI job.
- **2026-10-01 — The e2e suite runs a production build and signs in with a
  real session row.** `next dev` reloads whenever its HMR socket reconnects,
  which silently undid every navigation; and dev's compile-on-demand makes a
  latency assertion measure the compiler. Production means `AUTH_DEV_BYPASS` is
  refused — correctly — so the setup inserts a `sessions` row and its cookie,
  which exercises the real path rather than a bypass.
- **2026-10-01 — The suite owns its server (`reuseExistingServer: false`).**
  It depends on a render origin and a webhook secret passed as env; a server
  somebody left on that port has neither, and the failure is invisible — PDFs
  500 against the wrong port and every signed webhook returns 401. Diagnosing
  that cost more than never reusing ever will.
- **2026-10-01 — Tests wait for hydration before clicking.** `load` is not
  enough: the markup is there and the control looks normal, but React has not
  attached its handlers, so the click vanishes without a trace. Two separate
  failures came from this, one of which looked convincingly like a broken
  redirect in the app.
- **2026-10-01 — Deployment is a container on an OCI compute instance, with
  the database managed.** Owner's constraint is the cloud, not the engine, so
  nothing in the data layer moves: Postgres via Drizzle exactly as the stack
  fixes it, and only `DATABASE_URL` changes. Running Postgres in a container
  beside the app would make its durability the owner's problem for no benefit.
- **2026-10-01 — `output: "standalone"` with `outputFileTracingRoot` at the
  workspace root.** Without the root, tracing misses `@formcraft/schema` and
  the image starts without the one package every other part derives from.
- **2026-10-01 — `browsers.json` is force-included in the trace.** Playwright
  reads it at runtime rather than importing it, so tracing cannot see it. The
  standalone build started, served pages and exported Excel, then failed every
  PDF with "Cannot find module browsers.json" — a failure that looks like a
  healthy deploy until somebody downloads a response. Found by running the
  traced output, which is the only way to find it without Docker.
- **2026-10-01 — Caddy rather than nginx plus certbot.** It obtains and renews
  TLS from the domain name alone. Renewal is the part that silently stops
  working, and this is maintained solo.
- **2026-10-01 — Uploads are a Docker volume and this is a known weakness.**
  `lib/storage` still has only the local-disk implementation, so a container's
  filesystem is the store. `docker compose down -v` destroys them. Documented
  with a backup command rather than left to be discovered.
- **2026-09-30 — A file answer prints as its filename.** The bytes cannot be
  drawn into an A4 box, and silently omitting an attached document would
  misrepresent the submission. Naming it says what was sent without pretending
  to include it. A signature, already a PNG data URL, prints as the image.
