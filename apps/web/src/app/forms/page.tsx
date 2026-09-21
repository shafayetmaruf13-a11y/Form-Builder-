import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DocumentThumbnail } from "@/library/document-thumbnail";
import { FormCard } from "@/library/form-card";
import { SearchBox } from "@/library/search-box";
import { getCurrentUser } from "@/server/auth/session";
import { createForm } from "@/server/forms/actions";
import { listForms } from "@/server/forms/queries";

export const metadata: Metadata = { title: "My forms — Formcraft" };

// Reads the database, so never prerendered.
export const dynamic = "force-dynamic";

/**
 * The library.
 *
 * A server component: the list and every thumbnail are rendered here, so the
 * browser receives markup rather than a pile of documents to draw itself.
 */
export default async function FormsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;

  // Checked before anything else. Letting `listForms` throw and catching it
  // below would report "the database is down" to somebody who is merely
  // signed out — which is both wrong and an invitation to stop reading errors.
  const actor = await getCurrentUser().catch(() => null);
  if (!actor) redirect("/sign-in");

  let forms;
  try {
    forms = await listForms(q);
  } catch {
    return <DatabaseDown />;
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6 sm:p-10">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">My forms</h1>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/members" className="text-sm underline">
            Members
          </Link>
          <SearchBox initialQuery={q} />
          <form action={createForm}>
            <button
              type="submit"
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            >
              New form
            </button>
          </form>
        </div>
      </header>

      {forms.length === 0 ? (
        <Empty query={q} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {forms.map((form) => (
            <FormCard
              key={form.id}
              id={form.id}
              title={form.title}
              updatedAt={formatWhen(form.updatedAt)}
              thumbnail={<DocumentThumbnail document={form.document} />}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function Empty({ query }: { query: string }) {
  return (
    <div className="rounded-lg border border-dashed border-black/15 p-10 text-center text-sm opacity-70 dark:border-white/20">
      {query ? (
        <p>
          Nothing matches <strong>{query}</strong>.
        </p>
      ) : (
        <p>No forms yet. Make one to get started.</p>
      )}
    </div>
  );
}

function DatabaseDown() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 p-10 text-sm">
      <h1 className="text-2xl font-semibold tracking-tight">My forms</h1>
      <p>The database is not reachable, so your forms cannot be listed.</p>
      <p className="opacity-70">
        Start it with <code className="font-mono">pnpm db:up</code>, then{" "}
        <code className="font-mono">pnpm db:migrate</code>.
      </p>
      <p>
        <Link className="underline" href="/health">
          Environment check
        </Link>
      </p>
    </main>
  );
}

/** "3 minutes ago" beats a timestamp for "when did I last touch this". */
function formatWhen(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)} d ago`;

  return date.toLocaleDateString();
}
