import { answerToString, inputElements } from "@formcraft/schema";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { canReadSubmissions } from "@/server/auth/permissions";
import { getCurrentUser } from "@/server/auth/session";
import { getForm } from "@/server/forms/queries";
import {
  documentsForVersions,
  listSubmissions,
  listVersions,
} from "@/server/publish/queries";

import { EmailSubmissionButton, NotifyToggle } from "./email-controls";
import { LinkControls } from "./link-controls";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const form = await getForm(id).catch(() => null);

  return { title: form ? `${form.title} — responses` : "Responses" };
}

/**
 * What came back.
 *
 * Every submission is rendered against *its own* version's document
 * (architecture rule 4), not against the current draft — so a column renamed
 * last week does not retitle answers given the week before, and a field deleted
 * since still shows the answers it collected.
 */
export default async function ResponsesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const actor = await getCurrentUser().catch(() => null);
  if (!actor) redirect("/sign-in");

  const form = await getForm(id);
  if (!form) notFound();

  // `getForm` already applies `canReadForm`. Reading the *responses* is its own
  // permission: a moderator may see replies to forms they cannot edit.
  if (!canReadSubmissions(actor, form.ownerId)) notFound();

  const [versions, submissions] = await Promise.all([
    listVersions(id),
    listSubmissions(id),
  ]);

  const documents = await documentsForVersions(
    submissions.map((submission) => submission.formVersionId),
  );

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <Link href="/forms" className="text-sm underline opacity-70">
            My forms
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{form.title}</h1>
        </div>
        <Link
          href={`/forms/${id}`}
          className="rounded border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
        >
          Back to the builder
        </Link>
      </div>

      <section className="mb-10">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-60">
          Published versions
        </h2>

        {versions.length === 0 ? (
          <p className="rounded border border-dashed border-black/15 p-6 text-sm opacity-70 dark:border-white/20">
            This form has not been published yet. Publish it from the builder to
            get a share link.
          </p>
        ) : (
          <ul className="space-y-3">
            {versions.map((version) => (
              <li
                key={version.id}
                className="rounded border border-black/10 p-4 dark:border-white/15"
              >
                <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-semibold">
                    Version {version.version}
                  </span>
                  <span className="text-xs opacity-60">
                    published{" "}
                    {version.publishedAt.toLocaleDateString(undefined, {
                      dateStyle: "medium",
                    })}
                  </span>
                  <span className="text-xs opacity-60">
                    · {version.submissions}{" "}
                    {version.submissions === 1 ? "response" : "responses"}
                  </span>
                </div>

                <LinkControls versionId={version.id} links={version.links} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">
            Responses
          </h2>

          <div className="flex items-center gap-4">
            <NotifyToggle formId={id} initial={form.notifyOnSubmission} />
            {submissions.length > 0 && (
              <a
                href={`/api/forms/${id}/xlsx`}
                className="rounded border border-black/10 px-3 py-1 text-xs hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
              >
                Download all as Excel
              </a>
            )}
          </div>
        </div>

        {submissions.length === 0 ? (
          <p className="rounded border border-dashed border-black/15 p-6 text-sm opacity-70 dark:border-white/20">
            No responses yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-black/10 dark:border-white/15">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 bg-black/5 text-left dark:border-white/15 dark:bg-white/5">
                  <th className="whitespace-nowrap p-2 font-semibold">
                    Submitted
                  </th>
                  <th className="whitespace-nowrap p-2 font-semibold">
                    Version
                  </th>
                  <th className="p-2 font-semibold">Answers</th>
                  <th className="whitespace-nowrap p-2 font-semibold">
                    Download
                  </th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((submission) => {
                  const document = documents.get(submission.formVersionId);
                  // Labels come from the version this was filled against, so
                  // they read as they did on the day (rule 4).
                  const fields = document ? inputElements(document) : [];

                  return (
                    <tr
                      key={submission.id}
                      className="border-b border-black/5 align-top last:border-0 dark:border-white/10"
                    >
                      <td className="whitespace-nowrap p-2 tabular-nums opacity-80">
                        {submission.submittedAt.toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </td>
                      <td className="p-2 opacity-60">v{submission.version}</td>
                      <td className="p-2">
                        <dl className="grid grid-cols-[minmax(6rem,12rem)_1fr] gap-x-4 gap-y-1">
                          {fields.map((element) => {
                            const answer = submission.answers[element.id];
                            if (answer === undefined) return null;

                            return (
                              <div
                                key={element.id}
                                className="contents"
                                // `display: contents` so each pair lands in the
                                // parent grid rather than making its own row.
                              >
                                <dt className="truncate opacity-60">
                                  {element.label}
                                </dt>
                                <dd className="m-0 break-words">
                                  {renderAnswer(element.type, answer)}
                                </dd>
                              </div>
                            );
                          })}
                        </dl>
                      </td>
                      <td className="whitespace-nowrap p-2">
                        {/* Plain links, not fetches: the browser's own
                            download handling beats anything worth rebuilding,
                            and the first PDF request renders. */}
                        <a
                          href={`/api/submissions/${submission.id}/pdf`}
                          className="underline opacity-70 hover:opacity-100"
                        >
                          PDF
                        </a>
                        <span aria-hidden="true" className="px-1 opacity-30">
                          ·
                        </span>
                        <a
                          href={`/api/submissions/${submission.id}/xlsx`}
                          className="underline opacity-70 hover:opacity-100"
                        >
                          Excel
                        </a>
                        <span aria-hidden="true" className="px-1 opacity-30">
                          ·
                        </span>
                        <EmailSubmissionButton submissionId={submission.id} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-6 text-xs opacity-50">
        PDF and Excel export arrive in the next slices.
      </p>
    </main>
  );
}

/** One answer, as a table cell. */
function renderAnswer(type: string, answer: unknown) {
  if (type === "signature" && typeof answer === "string") {
    if (answer === "") return <span className="opacity-40">—</span>;

    // Checked again here, not only at submit time. This row may predate that
    // check or have been written by something else, and `src` on a value from
    // a public endpoint is exactly the place not to assume.
    if (!answer.startsWith("data:image/png;base64,")) {
      return <span className="opacity-40">(unreadable signature)</span>;
    }

    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={answer}
        alt="Signature"
        className="h-10 rounded border border-black/10 bg-white dark:border-white/15"
      />
    );
  }

  if (typeof answer === "boolean") return answer ? "Yes" : "No";

  const text = answerToString(answer as Parameters<typeof answerToString>[0]);

  return text === "" ? <span className="opacity-40">—</span> : text;
}
