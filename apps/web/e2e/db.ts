import { randomBytes } from "node:crypto";

import { Pool } from "pg";

import type { PublishedDocument } from "./helpers";

/**
 * Reading the database from a test.
 *
 * Used for two things only: fetching a published document so answers respect
 * its own validation rules, and asserting state the UI does not show —
 * `email_log` rows, rate-limit counters. Never for seeding: a fixture written
 * straight into Postgres would be a second opinion about what a valid form
 * looks like, and the point of these tests is that the app's own opinion is
 * the one exercised.
 */

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgres://formcraft:formcraft@localhost:5432/formcraft",
  max: 2,
});

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

export async function one<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  return (await query<T>(sql, params))[0];
}

export async function closePool(): Promise<void> {
  await pool.end();
}

/** The document a link publishes. */
export async function documentForSlug(
  slug: string,
): Promise<PublishedDocument> {
  const row = await one<{ document: PublishedDocument }>(
    `select v.document
       from form_versions v
       join form_links l on l.form_version_id = v.id
      where l.slug = $1`,
    [slug],
  );

  if (!row) throw new Error(`no published version for slug ${slug}`);
  return row.document;
}

/** The version id a submission was filled against. */
export async function versionOfSubmission(
  submissionId: string,
): Promise<string> {
  const row = await one<{ form_version_id: string }>(
    `select form_version_id from submissions where id = $1`,
    [submissionId],
  );

  if (!row) throw new Error(`no submission ${submissionId}`);
  return row.form_version_id;
}

/**
 * Signs the tests in as the seeded dev user.
 *
 * A real `sessions` row and its cookie, not `AUTH_DEV_BYPASS` — that is
 * refused in production, which is the right behaviour for a variable that
 * turns off authentication, and these tests run against a production build.
 *
 * It also exercises the path the app actually uses: `getCurrentUser()` re-reads
 * the user row on every request rather than trusting anything in the session,
 * so a session that did not correspond to a real user would get nowhere.
 */
export async function signInAsDevUser(): Promise<{
  name: string;
  value: string;
}> {
  const user = await one<{ id: string }>(
    `select id from users where email = $1`,
    ["dev@formcraft.local"],
  );

  if (!user) {
    throw new Error(
      "no dev@formcraft.local user — run `pnpm db:migrate`, which seeds it",
    );
  }

  const sessionToken = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await query(
    `insert into sessions (session_token, user_id, expires) values ($1, $2, $3)`,
    [sessionToken, user.id, expires],
  );

  // Auth.js names the cookie `__Secure-authjs.session-token` only when it is
  // issued over HTTPS. These tests run over plain HTTP on loopback.
  return { name: "authjs.session-token", value: sessionToken };
}
