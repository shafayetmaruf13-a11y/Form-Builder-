import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { Builder } from "@/builder/builder";
import { getCurrentUser } from "@/server/auth/session";
import { getForm } from "@/server/forms/queries";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const form = await getForm(id).catch(() => null);

  return { title: form ? `${form.title} — Formcraft` : "Formcraft" };
}

/**
 * The builder, bound to a stored form.
 *
 * The document is loaded on the server and handed to the builder as its initial
 * state, so the canvas is right on first paint rather than flashing empty while
 * a fetch resolves.
 */
export default async function FormBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Same reasoning as the library: signed out is a redirect, not a 404.
  const actor = await getCurrentUser().catch(() => null);
  if (!actor) redirect("/sign-in");

  const form = await getForm(id);
  // Not-found and not-permitted are deliberately the same answer.
  if (!form) notFound();

  return (
    <Builder
      formId={form.id}
      initialDocument={form.document}
      initialUpdatedAt={form.updatedAt.toISOString()}
    />
  );
}
