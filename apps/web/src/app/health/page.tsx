import { PAGE_HEIGHT, PAGE_WIDTH } from "@formcraft/schema";
import { sql } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/db";

// This page reads the database, so it must never be statically prerendered.
export const dynamic = "force-dynamic";

type DbStatus =
  | { ok: true; tables: string[]; devUserEmail: string | null }
  | { ok: false; error: string };

/**
 * The foundation's wiring probe, kept around after Slice 1 took over `/`.
 *
 * It proves the things that are otherwise taken on faith: the workspace import
 * resolves, the database is reachable, the migration ran, and the dev user was
 * seeded. Useful whenever the app misbehaves for environmental reasons.
 */
async function checkDb(): Promise<DbStatus> {
  try {
    const tableRows = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'
          order by table_name`,
    );
    const userRows = await db.execute<{ email: string }>(
      sql`select email from users order by created_at limit 1`,
    );

    return {
      ok: true,
      tables: tableRows.rows.map((row) => row.table_name),
      devUserEmail: userRows.rows[0]?.email ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export default async function Home() {
  const status = await checkDb();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Health</h1>
        <p className="mt-2 text-sm opacity-70">
          Environment check for the foundation. The form renderer lives at{" "}
          <Link className="underline" href="/">
            /
          </Link>
          .
        </p>
      </header>

      <section className="rounded-lg border border-black/10 p-5 dark:border-white/15">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
          Coordinate system
        </h2>
        <p className="mt-2 text-sm">
          A page is{" "}
          <code className="font-mono">
            {PAGE_WIDTH} &times; {PAGE_HEIGHT}
          </code>{" "}
          units (A4 at 96dpi), imported from{" "}
          <code className="font-mono">@formcraft/schema</code>.
        </p>
      </section>

      <section className="rounded-lg border border-black/10 p-5 dark:border-white/15">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
          Database
        </h2>
        {status.ok ? (
          <div className="mt-2 space-y-2 text-sm">
            <p>
              Connected. {status.tables.length} tables:{" "}
              <code className="font-mono">{status.tables.join(", ")}</code>
            </p>
            <p>
              Dev user:{" "}
              <code className="font-mono">
                {status.devUserEmail ?? "not seeded — run pnpm db:migrate"}
              </code>
            </p>
          </div>
        ) : (
          <div className="mt-2 space-y-2 text-sm">
            <p className="font-medium">Not reachable.</p>
            <p className="opacity-70">
              Start it with <code className="font-mono">pnpm db:up</code>, then{" "}
              <code className="font-mono">pnpm db:migrate</code>.
            </p>
            <pre className="overflow-x-auto rounded bg-black/5 p-3 font-mono text-xs dark:bg-white/10">
              {status.error}
            </pre>
          </div>
        )}
      </section>
    </main>
  );
}
