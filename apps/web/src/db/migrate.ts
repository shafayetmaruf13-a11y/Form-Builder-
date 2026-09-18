/**
 * Applies pending migrations, then seeds the hardcoded dev user.
 *
 * Run with `pnpm db:migrate`. Safe to run repeatedly: migrations are tracked by
 * Drizzle's own journal, and the seed is an idempotent upsert.
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import { users } from "./schema";

config({ path: ".env", quiet: true });

const DEV_USER_ID = process.env.DEV_USER_ID ?? "dev_user_000000000001";
const DEV_USER_EMAIL = process.env.DEV_USER_EMAIL ?? "dev@formcraft.local";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "Missing DATABASE_URL. Copy .env.example to .env and fill it in.",
    );
  }

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  try {
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
    console.log("migrations applied");

    await db
      .insert(users)
      .values({
        id: DEV_USER_ID,
        email: DEV_USER_EMAIL,
        name: "Dev User",
      })
      .onConflictDoNothing();
    console.log(`dev user ready (${DEV_USER_EMAIL})`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
