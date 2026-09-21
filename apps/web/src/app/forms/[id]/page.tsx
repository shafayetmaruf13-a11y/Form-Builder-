import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Builder } from "@/builder/builder";
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
  const form = await getForm(id);

  if (!form) notFound();

  return (
    <Builder
      formId={form.id}
      initialDocument={form.document}
      initialUpdatedAt={form.updatedAt.toISOString()}
    />
  );
}
