/**
 * Applies pending migrations, then makes sure the workspace has an owner.
 *
 * Run with `pnpm db:migrate`. Safe to run repeatedly: migrations are tracked by
 * Drizzle's own journal, and every write below is conditional on what it finds.
 *
 * Who ends up owning the workspace depends on how this is run:
 *
 *   - `FORMCRAFT_OWNER_EMAIL` set   — that address, active, owner. The
 *     deployment path: the owner is named up front rather than being whoever
 *     reaches the URL first.
 *   - development, no owner email   — the hardcoded dev user, so a fresh
 *     checkout has somebody who can invite people.
 *   - production, no owner email    — nobody. The workspace is left ownerless
 *     on purpose, and the first address to sign in claims it (see the
 *     bootstrap branch of the `signIn` callback in `auth.ts`).
 *
 * The production case is why this is not simply an unconditional seed. Seeding
 * `dev@formcraft.local` as owner on a real deployment hands the workspace to an
 * address at a domain that does not exist: the gate then refuses every real
 * sign-in as uninvited, and nobody can ever issue an invitation. The app comes
 * up perfectly and is permanently locked.
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { nanoid } from "nanoid";
import { Pool } from "pg";

import { eq } from "drizzle-orm";

import { ID_LENGTH, users } from "./schema";

config({ path: ".env", quiet: true });

type Db = ReturnType<typeof drizzle>;

const DEV_USER_ID = process.env.DEV_USER_ID ?? "dev_user_000000000001";
const DEV_USER_EMAIL = process.env.DEV_USER_EMAIL ?? "dev@formcraft.local";

/** Addresses are compared lowercased, exactly as the gate in `auth.ts` does. */
const OWNER_EMAIL = process.env.FORMCRAFT_OWNER_EMAIL?.trim().toLowerCase();
const IS_PRODUCTION = process.env.NODE_ENV === "production";

/** Development seeds a dev user; naming an owner explicitly takes precedence. */
const seedDevUser = !OWNER_EMAIL && !IS_PRODUCTION;

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

    // The dev user is what `currentOwnerId()` resolves to and what the e2e
    // suite signs in as, so in development its row has to exist whether or not
    // it is the one that ends up owning the workspace.
    if (seedDevUser) {
      await ensureUser(db, {
        email: DEV_USER_EMAIL,
        id: DEV_USER_ID,
        name: "Dev User",
      });
    }

    const [owner] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.role, "owner"))
      .limit(1);

    // Ownership moves only by transfer, never by re-running a script. Exactly
    // one owner exists at a time, enforced by a partial unique index — so
    // claiming one here is only ever safe when there is none.
    if (owner) {
      console.log(`workspace owner is ${owner.email}`);
      return;
    }

    if (OWNER_EMAIL) {
      await promoteToOwner(db, await ensureUser(db, { email: OWNER_EMAIL }));
      console.log(`workspace owner is ${OWNER_EMAIL} (FORMCRAFT_OWNER_EMAIL)`);
      return;
    }

    if (IS_PRODUCTION) {
      console.log(
        "no workspace owner yet — the first address to sign in claims it.\n" +
          "  Set FORMCRAFT_OWNER_EMAIL to decide that up front instead.",
      );
      return;
    }

    await promoteToOwner(db, DEV_USER_ID);
    console.log(`dev user ready (${DEV_USER_EMAIL}, owner)`);
  } finally {
    await pool.end();
  }
}

/**
 * Makes sure a row exists for an address and returns its id.
 *
 * An existing row is reused rather than duplicated: the Auth.js adapter may
 * have created one already, and an address invited before anybody owned the
 * workspace should not end up with two.
 */
async function ensureUser(
  db: Db,
  user: { email: string; id?: string; name?: string },
): Promise<string> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, user.email))
    .limit(1);

  if (existing) return existing.id;

  const id = user.id ?? nanoid(ID_LENGTH);
  await db.insert(users).values({
    id,
    email: user.email,
    name: user.name ?? null,
    // Active rather than invited: an address named as the owner is not waiting
    // on anybody to let it in, and `invited` with no inviter is what the gate
    // treats as an adapter leftover and deletes.
    status: "active",
  });

  return id;
}

async function promoteToOwner(db: Db, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ role: "owner", status: "active", updatedAt: new Date() })
    .where(eq(users.id, userId));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
