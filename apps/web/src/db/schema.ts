import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  primaryKey,
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
 * Who may do what.
 *
 * A single hierarchy over one workspace, not multi-tenant organisations: the
 * deployment *is* the owner's team. Actual teams stay out of scope.
 *
 * Order matters — `ROLES` is ranked from least to most privileged, and the
 * authorization rules lean on that ordering rather than restating it.
 */
export const ROLES = ["user", "moderator", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];

/**
 * `invited` means a row exists for an email that has never signed in. It
 * becomes `active` when someone completes sign-in with that address, which is
 * how an invitation is redeemed without an outbound email service (that is
 * Slice 8's job).
 */
export const USER_STATUSES = ["invited", "active", "suspended"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name"),
    /** Auth.js writes this when an email sign-in link is used. */
    emailVerified: timestamp("email_verified", { withTimezone: true }),
    image: text("image"),
    role: text("role").$type<Role>().notNull().default("user"),
    status: text("status").$type<UserStatus>().notNull().default("invited"),
    invitedByUserId: text("invited_by_user_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("users_email_key").on(table.email),
    index("users_role_idx").on(table.role),
    /**
     * Exactly one owner, enforced by the database rather than by remembering.
     * Transferring ownership has to demote the old owner in the same
     * transaction, which is precisely the discipline this is here to force.
     */
    uniqueIndex("users_single_owner_key")
      .on(table.role)
      .where(sql`${table.role} = 'owner'`),
  ],
);

// ---------------------------------------------------------------------------
// Auth.js
// ---------------------------------------------------------------------------

/**
 * Tables the Auth.js Drizzle adapter owns.
 *
 * Column names are the adapter's, snake_case where it expects snake_case —
 * these are not ours to tidy. They point at our own `users` table rather than
 * one of their own, so a person is one row with one id, and `forms.owner_id`
 * keeps meaning what it always meant.
 *
 * Everything the *application* cares about — role, status — lives on `users`,
 * not here. Sign-in is identity; what somebody may do is our business.
 */
export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
    index("accounts_user_id_idx").on(table.userId),
  ],
);

/**
 * Database sessions rather than JWTs, deliberately.
 *
 * A role change has to take effect immediately — demoting an admin who is
 * mid-session must actually demote them. With a JWT they would keep their old
 * claims until it expired, which for an access-control feature is the whole
 * point missed.
 */
export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

/** Single-use email sign-in tokens. */
export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
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
// rate_limits
// ---------------------------------------------------------------------------

/**
 * A fixed-window counter, keyed by whatever is being limited.
 *
 * Architecture rule 6 requires rate limiting on public fill pages, and this app
 * is a handful of Next.js instances behind one Postgres — an in-memory counter
 * would reset on every deploy and be wrong the moment there are two processes.
 * The database is already the thing all of them agree about.
 *
 * Rows are disposable. The key encodes both the bucket and the window
 * (`submit:<linkId>:<epochMinute>`), so a window that has passed is simply a row
 * nobody reads again; a periodic delete keeps the table small.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    /** `<bucket>:<subject>:<window start, epoch seconds>`. */
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(0),
    /** When this row stops meaning anything and may be deleted. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("rate_limits_expires_at_idx").on(table.expiresAt)],
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
