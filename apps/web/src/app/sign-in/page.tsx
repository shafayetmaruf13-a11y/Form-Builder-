import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthError } from "next-auth";

import { signIn } from "@/auth";
import { getCurrentUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Sign in — Formcraft" };
export const dynamic = "force-dynamic";

/**
 * Sign in with an emailed link.
 *
 * No passwords: nothing to store, reset or leak. The same mechanism redeems an
 * invitation, so there is one path in rather than two.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  if (await getCurrentUser()) redirect("/forms");

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-5 p-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Formcraft</h1>
        <p className="mt-1 text-sm opacity-70">
          Sign in with your email address.
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded bg-red-100 px-3 py-2 text-xs text-red-900 dark:bg-red-900/40 dark:text-red-100"
        >
          {error === "AccessDenied"
            ? "That address has not been invited to this workspace."
            : "Sign-in failed. Try again."}
        </p>
      )}

      <form
        action={async (formData) => {
          "use server";
          try {
            await signIn("resend", {
              email: String(formData.get("email") ?? ""),
              redirectTo: "/forms",
            });
          } catch (error) {
            // A refusal is an AuthError. Anything else — notably the
            // NEXT_REDIRECT that a *successful* sign-in throws — has to keep
            // propagating, or success would look like failure.
            if (error instanceof AuthError) {
              redirect(`/sign-in?error=${error.type}`);
            }
            throw error;
          }
        }}
        className="flex flex-col gap-2"
      >
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          aria-label="Email address"
          className="rounded border border-black/15 bg-transparent px-3 py-2 text-sm outline-none focus:border-blue-500 dark:border-white/20"
        />
        <button
          type="submit"
          className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
        >
          Email me a sign-in link
        </button>
      </form>

      <p className="text-[11px] opacity-50">
        Only people who have been invited can sign in. The first account to be
        created becomes the owner.
      </p>
    </main>
  );
}
