import { closePool } from "./db";

/**
 * Closes the shared Postgres pool once, after everything has run.
 *
 * Each spec file closing it in `afterAll` meant the first file to finish shut
 * it for all the others, which surfaced as "Cannot use a pool after calling
 * end on the pool" in whichever file happened to run next.
 */
export default async function teardown(): Promise<void> {
  await closePool();
}
