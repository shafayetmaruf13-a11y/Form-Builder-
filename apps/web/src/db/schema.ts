import {
  boolean,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * The Formcraft database schema.
 *
 * Two conventions hold everywhere in this file, both load-bearing:
 *
 *   - Primary keys are nanoid `text`, never `serial`. Public surfaces must not
 *     expose guessable or enumerable identifiers (architecture rule 6), and a
 *     sequential PK leaks row counts the moment one appears in a URL.
 *   - Form content is `jsonb`, never normalised into element tables. A form is
 *     a JSON document (architecture rule 1); the zod schema in
 *     `@formcraft/schema` is what validates its shape, not the database.
 */

/** nanoid length used for primary keys. */
export const ID_LENGTH = 21;

const id = () => text("id").primaryKey();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

/**
 * Slice 0 seeds exactly one hardcoded dev user and wires no auth provider.
 * `passwordHash` etc. are deliberately absent: whichever provider we adopt
 * later (Auth.js, Clerk, …) brings its own account/session tables, and
 * guessing at their columns now would only create a migration to undo.
 */
export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("users_email_key").on(table.email)],
);

// ---------------------------------------------------------------------------
// forms
// ---------------------------------------------------------------------------

/**
 * A form the owner is working on. `draftDocument` is the mutable working copy
 * shown in the builder; publishing snapshots it into `form_versions`.
 */
export const forms = pgTable(
  "forms",
  {
    id: id(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("Untitled form"),
    /** Object storage key for the library thumbnail; rendered from the document. */
    thumbnailKey: text("thumbnail_key"),
    /** The working copy. Validated by @formcraft/schema, not by the database. */
    draftDocument: jsonb("draft_document").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("forms_owner_id_idx").on(table.ownerId)],
);

// ---------------------------------------------------------------------------
// form_versions
// ---------------------------------------------------------------------------

/**
 * An immutable published snapshot of a form's document.
 *
 * Rows here are never updated and never deleted while a submission references
 * them — that is the whole mechanism behind architecture rule 4. A submission
 * re-rendered two years later must produce the same PDF it produced on the day
 * it was filled, which is only true if the version it points at cannot move.
 */
export const formVersions = pgTable(
  "form_versions",
  {
    id: id(),
    formId: text("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    /** Monotonic per form, starting at 1. */
    version: integer("version").notNull(),
    document: jsonb("document").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("form_versions_form_id_version_key").on(
      table.formId,
      table.version,
    ),
  ],
);

// ---------------------------------------------------------------------------
// form_links
// ---------------------------------------------------------------------------

/**
 * A shareable link to a published version: `/f/<slug>`.
 *
 * `slug` is random text, not a counter — see architecture rule 6. A link points
 * at a *version*, not a form, so re-publishing a form never silently changes
 * what an already-circulated link shows.
 */
export const formLinks = pgTable(
  "form_links",
  {
    id: id(),
    formVersionId: text("form_version_id")
      .notNull()
      .references(() => formVersions.id, { onDelete: "cascade" }),
    /** Unguessable, generated in Slice 4. Unique across the whole table. */
    slug: text("slug").notNull(),
    /** Optional shared secret required in addition to the slug. */
    token: text("token"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    maxUses: integer("max_uses"),
    usesCount: integer("uses_count").notNull().default(0),
    revoked: boolean("revoked").notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("form_links_slug_key").on(table.slug),
    index("form_links_form_version_id_idx").on(table.formVersionId),
  ],
);

// ---------------------------------------------------------------------------
// submissions
// ---------------------------------------------------------------------------

/**
 * One completed fill of one version.
 *
 * `answers` is keyed by *element id*, never by label (architecture rule 3), so
 * renaming a field's label in a later version never orphans historical answers.
 *
 * `formVersionId` is a hard FK with no cascade from `forms`: deleting a form
 * cascades through versions to submissions, which is the owner's explicit
 * choice; nothing else may remove a version out from under a submission.
 */
export const submissions = pgTable(
  "submissions",
  {
    id: id(),
    formVersionId: text("form_version_id")
      .notNull()
      .references(() => formVersions.id, { onDelete: "cascade" }),
    linkId: text("link_id").references(() => formLinks.id, {
      onDelete: "set null",
    }),
    /** Record<elementId, answer>. Shape validated by @formcraft/schema. */
    answers: jsonb("answers").notNull(),
    /**
     * Client-supplied idempotency key, so a retried submit does not create a
     * second row (Slice 4). Unique when present.
     */
    idempotencyKey: text("idempotency_key"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    /** Object storage key of the rendered PDF; filled by the Slice 5 worker. */
    pdfObjectKey: text("pdf_object_key"),
  },
  (table) => [
    index("submissions_form_version_id_idx").on(table.formVersionId),
    uniqueIndex("submissions_idempotency_key_key").on(table.idempotencyKey),
  ],
);

// ---------------------------------------------------------------------------
// uploads
// ---------------------------------------------------------------------------

/**
 * Anything a human put into object storage: builder logo images, and files
 * answered into a `fileUpload` element.
 *
 * `submissionId` is null for builder-side uploads (a logo belongs to the
 * document, not to any one fill).
 */
export const uploads = pgTable(
  "uploads",
  {
    id: id(),
    /** Who uploaded it; null for anonymous uploads on a public fill page. */
    ownerId: text("owner_id").references(() => users.id, {
      onDelete: "set null",
    }),
    submissionId: text("submission_id").references(() => submissions.id, {
      onDelete: "cascade",
    }),
    objectKey: text("object_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("uploads_object_key_key").on(table.objectKey),
    index("uploads_submission_id_idx").on(table.submissionId),
  ],
);

// ---------------------------------------------------------------------------
// email_log
// ---------------------------------------------------------------------------

/**
 * Every transactional email we asked Resend to send, plus whatever the bounce
 * webhook later told us about it (Slice 7). Append-only apart from `status`.
 */
export const emailLog = pgTable(
  "email_log",
  {
    id: id(),
    to: text("to").notNull(),
    subject: text("subject").notNull(),
    /** Resend's message id, once they've accepted it. */
    providerId: text("provider_id"),
    /** queued | sent | delivered | bounced | complained | failed */
    status: text("status").notNull().default("queued"),
    submissionId: text("submission_id").references(() => submissions.id, {
      onDelete: "set null",
    }),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("email_log_submission_id_idx").on(table.submissionId),
    index("email_log_provider_id_idx").on(table.providerId),
  ],
);
