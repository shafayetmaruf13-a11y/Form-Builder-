import type { Metadata } from "next";

export const metadata: Metadata = { title: "Check your email — Formcraft" };

export default function CheckEmailPage() {
  return (
    <main className="mx-auto flex max-w-sm flex-col gap-3 p-10">
      <h1 className="text-xl font-semibold tracking-tight">Check your email</h1>
      <p className="text-sm opacity-70">
        If that address has been invited, a sign-in link is on its way. It
        expires in 24 hours.
      </p>
      <p className="text-[11px] opacity-50">
        Running locally without an email service? The link is printed in the dev
        server&rsquo;s console.
      </p>
    </main>
  );
}
