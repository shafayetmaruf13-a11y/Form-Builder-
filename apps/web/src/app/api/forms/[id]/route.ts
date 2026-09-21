import { formDocumentSchema } from "@formcraft/schema";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { forms } from "@/db/schema";
import { isStale } from "@/server/forms/naming";
import { currentOwnerId } from "@/server/forms/queries";

export const runtime = "nodejs";

/**
 * Autosave.
 *
 * A route handler rather than a server action: this is called from the
 * builder's save loop, which is not React, and it needs to report a conflict
 * back rather than trigger a re-render.
 *
 * Architecture rule 5 — the document is re-validated here. The builder
 * validates too, but a draft arriving over the wire is not evidence of
 * anything.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
  }

  if (typeof payload !== "object" || payload === null) {
    return NextResponse.json({ error: "Expected an object" }, { status: 400 });
  }

  const body = payload as { document?: unknown; expectedUpdatedAt?: unknown };

  const parsed = formDocumentSchema.safeParse(body.document);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Document failed validation",
        issues: parsed.error.issues.slice(0, 5),
      },
      { status: 422 },
    );
  }

  const owned = and(eq(forms.id, id), eq(forms.ownerId, currentOwnerId()));

  const [current] = await db
    .select({ updatedAt: forms.updatedAt })
    .from(forms)
    .where(owned)
    .limit(1);

  if (!current) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const expected =
    typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : null;

  if (isStale(expected, current.updatedAt)) {
    // Someone else wrote in between. Overwriting would silently discard their
    // edit, so the client is told and decides.
    return NextResponse.json(
      {
        error: "This form was changed somewhere else",
        updatedAt: current.updatedAt.toISOString(),
      },
      { status: 409 },
    );
  }

  const updatedAt = new Date();

  await db
    .update(forms)
    .set({
      draftDocument: parsed.data,
      title: parsed.data.title.slice(0, 200),
      updatedAt,
    })
    .where(owned);

  // Echoed back so the client's next save can claim it.
  return NextResponse.json({ updatedAt: updatedAt.toISOString() });
}
