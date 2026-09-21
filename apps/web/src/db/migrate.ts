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

import { eq } from "drizzle-orm";

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

    // The dev user is the workspace owner and is active, so a fresh checkout
    // has somebody who can invite people. A real deployment gets its owner
    // from whoever signs in first.
    await db
      .insert(users)
      .values({
        id: DEV_USER_ID,
        email: DEV_USER_EMAIL,
        name: "Dev User",
        role: "owner",
        status: "active",
      })
      .onConflictDoNothing();

    // An existing row from before roles existed would default to an invited
    // plain user, which would lock the workspace. Promote it if nobody owns
    // the workspace yet.
    const [owner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "owner"))
      .limit(1);

    if (!owner) {
      await db
        .update(users)
        .set({ role: "owner", status: "active" })
        .where(eq(users.id, DEV_USER_ID));
    }

    console.log(`dev user ready (${DEV_USER_EMAIL}, owner)`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
