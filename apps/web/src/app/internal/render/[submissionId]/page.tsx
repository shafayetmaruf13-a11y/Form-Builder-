import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  type Answers,
  answersSchema,
  formDocumentSchema,
  isInputElement,
  resolveVisibility,
} from "@formcraft/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { ElementFrame } from "@/components/renderer/element-frame";
import { ElementView } from "@/components/renderer/element-view";
import { PageSurface } from "@/components/renderer/page-surface";
import { db } from "@/db";
import { formVersions, submissions } from "@/db/schema";
import { objectUrl } from "@/lib/storage/url";
import { FilledField } from "@/pdf/filled-field";
import { renderTokenValid } from "@/server/pdf/render-token";

/**
 * The page the PDF worker photographs.
 *
 * Not a second renderer. It draws through `PageSurface` at scale 1, which is
 * the same code the builder draws at 0.8 and a thumbnail at 0.25, so a filled
 * value cannot land anywhere except where the designer put the field
 * (architecture rule 2).
 *
 * It is a real page on our own origin rather than HTML handed to
 * `setContent()`, and that is the load-bearing decision of this slice: the
 * app's fonts come from `next/font`, self-hosted under `/_next/static/media`
 * with build-generated filenames. Navigating here means Chromium is served the
 * same stylesheet, the same `@font-face` rules and the same CSS variables as
 * every other page — by construction. Rebuilding that font CSS by hand, from
 * hashes nothing can predict, is how a PDF quietly stops matching its design.
 *
 * Unauthenticated by necessity: the browser fetching it is nobody. Guarded by
 * a token, and only ever fetched over loopback.
 */

export const dynamic = "force-dynamic";

export default async function RenderPage({
  params,
  searchParams,
}: {
  params: Promise<{ submissionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { submissionId } = await params;
  const query = await searchParams;
  const token = typeof query.token === "string" ? query.token : null;

  // Before the database is touched. A wrong token gets the same 404 a missing
  // submission does, so this route cannot be used to ask whether an id exists.
  if (!renderTokenValid(submissionId, token)) notFound();

  const [row] = await db
    .select({
      answers: submissions.answers,
      document: formVersions.document,
    })
    .from(submissions)
    .innerJoin(formVersions, eq(submissions.formVersionId, formVersions.id))
    .where(eq(submissions.id, submissionId))
    .limit(1);

  if (!row) notFound();

  // Rule 4 in one line: the document comes from the version the submission
  // points at, never from the form's current draft.
  const document = formDocumentSchema.safeParse(row.document);
  const answers = answersSchema.safeParse(row.answers ?? {});
  if (!document.success || !answers.success) notFound();

  return <RenderedDocument document={document.data} answers={answers.data} />;
}

function RenderedDocument({
  document,
  answers,
}: {
  document: ReturnType<typeof formDocumentSchema.parse>;
  answers: Answers;
}) {
  // A field a condition hid was never asked, so it does not appear here
  // either. Printing an empty box for a question nobody saw would make the
  // PDF claim it went unanswered.
  const { visible } = resolveVisibility(document, answers);

  return (
    <>
      {/* Chromium's own margins and the app's body padding both have to go:
          the paper is exactly one page of the document and nothing else. */}
      <style>{`
        /* In points, because a PDF page box is in points and this is the one
           unit that reaches it without a conversion. Declared in pixels, a
           794px page became a 794.56px paper box and a one-page form printed
           as two. */
        @page { size: ${(PAGE_WIDTH / 96) * 72}pt ${(PAGE_HEIGHT / 96) * 72}pt; margin: 0; }
        html, body { margin: 0; padding: 0; background: #ffffff; }
        /* A break BEFORE every page after the first, rather than a break
           after all but the last child. The framework appends its own script
           tags to the body, so the final page div is not :last-child and kept
           its page break — which printed a trailing blank page. An
           adjacent-sibling selector only ever matches page divs. */
        .formcraft-page + .formcraft-page { break-before: page; }
        /* Print colour exactly as designed rather than as Chromium's
           print stylesheet would prefer. */
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      `}</style>

      {/* The worker waits for this before printing, so a page that failed
          half-way cannot be photographed as if it were finished. */}
      <div id="render-ready" data-pages={document.pages.length} />

      {document.pages.map((page) => (
        <div key={page.id} className="formcraft-page">
          <PageSurface
            page={page}
            scale={1}
            imageSrc={objectUrl}
            renderElement={(element) => {
              if (!visible.has(element.id)) return null;

              if (!isInputElement(element)) {
                return (
                  <ElementView
                    key={element.id}
                    element={element}
                    imageSrc={objectUrl}
                  />
                );
              }

              return (
                <ElementFrame key={element.id} element={element}>
                  <FilledField element={element} answer={answers[element.id]} />
                </ElementFrame>
              );
            }}
          />
        </div>
      ))}
    </>
  );
}
