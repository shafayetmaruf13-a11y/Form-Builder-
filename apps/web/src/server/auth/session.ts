import { eq } from "drizzle-orm";

import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { env } from "@/env";

import { type Action, type Actor, actorCan } from "./permissions";

/**
 * Who is making this request.
 *
 * The seam that used to be `currentOwnerId()`. Everything downstream asks this
 * and then asks `permissions.ts` what the answer may do — no route decides for
 * itself, and swapping identity providers touches only this file.
 *
 * `AUTH_DEV_BYPASS` keeps the app runnable without an email round trip: it
 * signs every request in as the seeded dev user. It is refused in production
 * regardless of how it is set, because an environment variable that disables
 * authentication is exactly the kind of thing that escapes a laptop.
 */
const devBypassEnabled =
  process.env.NODE_ENV !== "production" &&
  process.env.AUTH_DEV_BYPASS === "true";

export async function getCurrentUser(): Promise<Actor | null> {
  if (devBypassEnabled) return devActor();

  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;

  // Read the row rather than trusting the session's copy. A role changed a
  // moment ago must bite immediately, and a suspension must bite even if a
  // session is open.
  const [row] = await db
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  return row ?? null;
}

async function devActor(): Promise<Actor | null> {
  const [row] = await db
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users)
    .where(eq(users.id, env.DEV_USER_ID))
    .limit(1);

  return row ?? null;
}

/** The current user, or a thrown error. For code paths that require one. */
export async function requireUser(): Promise<Actor> {
  const actor = await getCurrentUser();
  if (!actor) throw new AuthError("Not signed in");
  return actor;
}

/** The current user, having checked they may do something. */
export async function requirePermission(action: Action): Promise<Actor> {
  const actor = await requireUser();
  if (!actorCan(actor, action)) {
    throw new AuthError(`Not permitted: ${action}`);
  }
  return actor;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export { devBypassEnabled };
