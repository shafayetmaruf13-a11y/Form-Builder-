/**
 * Environment access, in one place.
 *
 * Deliberately hand-rolled rather than zod-validated: `@formcraft/schema` is
 * the document schema and pulling zod into the web app just for env vars would
 * add a dependency Slice 0 doesn't need. If env validation grows past this,
 * revisit.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

export const env = {
  get DATABASE_URL(): string {
    return required("DATABASE_URL");
  },

  /**
   * The single hardcoded user everything is owned by until real auth arrives.
   * Seeded by `pnpm db:migrate`. See CLAUDE.md's decisions log.
   */
  get DEV_USER_ID(): string {
    return process.env.DEV_USER_ID ?? "dev_user_000000000001";
  },
  get DEV_USER_EMAIL(): string {
    return process.env.DEV_USER_EMAIL ?? "dev@formcraft.local";
  },
} as const;
