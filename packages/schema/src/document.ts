import { z } from "zod";

import {
  type FormElement,
  type InputElement,
  elementSchema,
  isInputElement,
} from "./elements";
import { colorSchema } from "./style";

/**
 * Bumped only when a change cannot be read by the previous renderer.
 *
 * Architecture rule 4 means a version published today must still render years
 * from now. Carrying the discriminator from the first document ever written is
 * what makes a future migration a switch statement rather than guesswork.
 */
export const SCHEMA_VERSION = 1;

export const pageSchema = z.object({
  id: z.string().min(1),
  background: colorSchema.default("#ffffff"),
  elements: z.array(elementSchema),
});

export type Page = z.infer<typeof pageSchema>;

export const formDocumentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  title: z.string(),
  /** At least one page: a form with nothing to render is never intentional. */
  pages: z.array(pageSchema).min(1),
});

export type FormDocument = z.infer<typeof formDocumentSchema>;

/** An empty single-page document, for "new form". */
export function emptyDocument(id: string, pageId: string): FormDocument {
  return formDocumentSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id,
    title: "Untitled form",
    pages: [{ id: pageId, elements: [] }],
  });
}

/** Every element across every page, in page order. */
export function allElements(document: FormDocument): FormElement[] {
  return document.pages.flatMap((page) => page.elements);
}

/**
 * Every element that collects an answer, in page order.
 *
 * This ordering is what Slice 6 turns into Excel columns, so it must follow the
 * document rather than anything incidental like insertion time.
 */
export function inputElements(document: FormDocument): InputElement[] {
  return allElements(document).filter(isInputElement);
}

/**
 * Element ids that appear more than once.
 *
 * Duplicate ids silently corrupt answers, since answers are keyed by id
 * (architecture rule 3) — two elements sharing an id means one overwrites the
 * other. Cheap to check, so Slice 2 can call it on every mutation.
 */
export function duplicateElementIds(document: FormDocument): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const element of allElements(document)) {
    if (seen.has(element.id)) {
      duplicates.add(element.id);
    }
    seen.add(element.id);
  }

  return [...duplicates];
}

/**
 * Conditional rules pointing at an element id that no longer exists.
 *
 * Deleting a field that another field's visibility depends on leaves a dangling
 * reference. Slice 4 has to decide what a broken condition means at fill time;
 * surfacing it in the builder first is much kinder.
 */
export function danglingConditionalTargets(
  document: FormDocument,
): { elementId: string; targetId: string }[] {
  const ids = new Set(allElements(document).map((element) => element.id));

  return inputElements(document).flatMap((element) =>
    element.conditional && !ids.has(element.conditional.targetId)
      ? [{ elementId: element.id, targetId: element.conditional.targetId }]
      : [],
  );
}
