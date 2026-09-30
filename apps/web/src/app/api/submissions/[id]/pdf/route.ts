import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { formVersions, forms, submissions } from "@/db/schema";
import { canReadSubmissions } from "@/server/auth/permissions";
import { getCurrentUser } from "@/server/auth/session";
import { submissionPdfFilename } from "@/server/pdf/keys";
import { getOrRenderSubmissionPdf } from "@/server/pdf/render";

/**
 * Downloading a submission's PDF.
 *
 * The owner-facing counterpart to `/internal/render`: this one is
 * authenticated and permission-checked, and it is the only way in from
 * outside. Rendering happens on the first request and is cached from then on.
 *
 * A route handler rather than a server action because the response is a file
 * with its own content type and disposition.
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const actor = await getCurrentUser().catch(() => null);
  // A 404 rather than a 401: whether a submission id exists is not something
  // to confirm to somebody who is not signed in.
  if (!actor) return notFound();

  const [row] = await db
    .select({
      id: submissions.id,
      submittedAt: submissions.submittedAt,
      formTitle: forms.title,
      formOwnerId: forms.ownerId,
    })
    .from(submissions)
    .innerJoin(formVersions, eq(submissions.formVersionId, formVersions.id))
    .innerJoin(forms, eq(formVersions.formId, forms.id))
    .where(eq(submissions.id, id))
    .limit(1);

  if (!row) return notFound();

  // The permission added in Slice 5: your own form's responses are yours,
  // anyone else's are moderation. Not-found and not-permitted are the same
  // answer, as everywhere else in this app.
  if (!canReadSubmissions(actor, row.formOwnerId)) return notFound();

  let pdf;
  try {
    pdf = await getOrRenderSubmissionPdf(id);
  } catch (error) {
    // Rendering needs a browser and a reachable render origin, both of which
    // can be missing in a deployment that has not set them up. Say so rather
    // than returning a broken file.
    console.error(`PDF render failed for submission ${id}`, error);
    return NextResponse.json(
      { error: "Could not render this submission as a PDF." },
      { status: 500 },
    );
  }

  if (!pdf) return notFound();

  return new NextResponse(pdf.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-length": String(pdf.bytes.byteLength),
      "content-disposition": `attachment; filename="${submissionPdfFilename(
        row.formTitle,
        row.submittedAt,
      )}"`,
      // A submission's PDF never changes — the version it renders is
      // immutable — but it is somebody's personal data, so private only.
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
}

function notFound(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
