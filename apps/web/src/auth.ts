import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";

import { db } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";

/**
 * Authentication.
 *
 * Auth.js answers "who is this person". What they may do is decided by
 * `server/auth/permissions.ts` against a role on our own `users` row — so the
 * access model is ours, testable without a network call, and not owned by
 * whichever provider we happen to sign in with.
 *
 * Sign-in is an emailed link. There are no passwords to store, reset or leak,
 * and the invitation flow is the same mechanism: an admin creates a row, the
 * person receives a link at that address.
 */

/** True once an email service is configured; otherwise we are in dev. */
const canSendEmail = Boolean(process.env.RESEND_API_KEY);

export const { handlers, auth, signIn, signOut } = NextAuth({
  /**
   * Whether to believe the request's `Host` header.
   *
   * It decides where a sign-in link points, so a forged header on an untrusting
   * deployment would send somebody's magic link to an attacker's domain. Auth.js
   * therefore refuses unknown hosts in production unless told otherwise, and
   * that stays opt-in: set `AUTH_TRUST_HOST=true` when running behind a proxy
   * you control, or set `AUTH_URL` to the canonical origin instead.
   */
  trustHost:
    process.env.AUTH_TRUST_HOST === "true" ||
    process.env.NODE_ENV !== "production",

  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),

  /**
   * Database sessions, not JWTs.
   *
   * Demoting an admin has to take effect now. A JWT would carry their old role
   * until it expired, which for an access-control feature is the entire point
   * missed.
   */
  session: { strategy: "database" },

  pages: {
    signIn: "/sign-in",
    verifyRequest: "/sign-in/check-email",
    error: "/sign-in",
  },

  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY ?? "dev-no-key",
      from: process.env.EMAIL_FROM ?? "Formcraft <onboarding@resend.dev>",

      /**
       * In development, print the link instead of sending it.
       *
       * Without this there is no way to sign in locally without a Resend
       * account and a verified domain, which would make the whole of this
       * slice unrunnable on a laptop.
       */
      async sendVerificationRequest(params) {
        if (!canSendEmail) {
          console.log(
            `\n  Sign-in link for ${params.identifier}:\n  ${params.url}\n`,
          );
          return;
        }

        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: params.provider.from,
            to: params.identifier,
            subject: "Your Formcraft sign-in link",
            text: `Sign in to Formcraft:\n\n${params.url}\n\nThis link expires in 24 hours. If you did not request it, ignore this email.`,
          }),
        });

        if (!response.ok) {
          throw new Error(`Resend refused the message: ${response.status}`);
        }
      },
    }),
  ],

  callbacks: {
    /**
     * The gate.
     *
     * A workspace is not a signup form: only somebody an admin has invited may
     * get in. The one exception is the very first account, which becomes the
     * owner — otherwise a fresh deployment has nobody who can invite anyone.
     */
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;

      const [owner] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "owner"))
        .limit(1);

      // Bootstrap: with nobody owning the workspace yet, the first person to
      // sign in claims it. Otherwise a fresh deployment has no way in.
      if (!owner) return true;

      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      // After the workspace has an owner, membership is by invitation only.
      if (!existing) return false;
      if (existing.status === "suspended") return false;

      /**
       * A row is not an invitation just because it exists.
       *
       * Depending on where in the flow this callback runs, the adapter may
       * already have created a row for an address nobody invited. Those are
       * distinguishable: a real invitation always records who sent it. Without
       * this check, signing in *creates* the membership it is supposed to be
       * checking — which is how a workspace becomes a public signup form.
       */
      if (existing.status === "invited" && !existing.invitedByUserId) {
        // Remove the adapter's leftover so it cannot linger in the members
        // list looking like somebody invited them.
        await db.delete(users).where(eq(users.id, existing.id));
        return false;
      }

      // Signing in is how a genuine invitation is redeemed.
      if (existing.status === "invited") {
        await db
          .update(users)
          .set({ status: "active", updatedAt: new Date() })
          .where(eq(users.id, existing.id));
      }

      return true;
    },

    /** Puts our own role and status on the session, so the UI can read them. */
    async session({ session, user }) {
      const [row] = await db
        .select({ role: users.role, status: users.status })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      session.user.id = user.id;
      session.user.role = row?.role ?? "user";
      session.user.status = row?.status ?? "invited";

      return session;
    },
  },

  events: {
    /**
     * The first account to exist claims the workspace.
     *
     * Every later account starts as an invited `user`, which the adapter's
     * defaults already give us.
     */
    async createUser({ user }) {
      if (!user.id) return;

      const owners = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, "owner"))
        .limit(1);

      await db
        .update(users)
        .set(
          owners.length === 0
            ? { role: "owner", status: "active" }
            : { status: "active" },
        )
        .where(eq(users.id, user.id));
    },
  },
});
