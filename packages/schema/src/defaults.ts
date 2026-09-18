import { type Page, pageSchema } from "./document";
import { type ElementType, type FormElement, elementSchema } from "./elements";

/**
 * What a freshly dropped element looks like.
 *
 * The builder needs this and so will form templates later, so it lives beside
 * the schema rather than in the app. Every result is run through
 * `elementSchema.parse`, which means a default that stops being valid fails
 * here rather than producing an unrenderable document.
 *
 * `id` is a parameter rather than generated inside: architecture rule 3 wants
 * nanoids, but a function that mints its own ids is untestable and
 * non-deterministic. The caller supplies `nanoid()`.
 */

/** Default footprint per type, in page units. */
export const ELEMENT_DEFAULT_SIZE: Record<
  ElementType,
  { w: number; h: number }
> = {
  text: { w: 260, h: 40 },
  image: { w: 160, h: 90 },
  shape: { w: 120, h: 90 },
  divider: { w: 320, h: 8 },
  textInput: { w: 300, h: 66 },
  textarea: { w: 320, h: 110 },
  checkbox: { w: 300, h: 50 },
  checkboxGroup: { w: 280, h: 120 },
  radioGroup: { w: 280, h: 120 },
  select: { w: 280, h: 66 },
  date: { w: 220, h: 66 },
  number: { w: 180, h: 66 },
  signature: { w: 320, h: 130 },
  fileUpload: { w: 300, h: 120 },
};

/** Human labels for the palette. */
export const ELEMENT_LABELS: Record<ElementType, string> = {
  text: "Text",
  image: "Image",
  shape: "Rectangle",
  divider: "Divider",
  textInput: "Text field",
  textarea: "Paragraph",
  checkbox: "Checkbox",
  checkboxGroup: "Checkbox group",
  radioGroup: "Radio group",
  select: "Dropdown",
  date: "Date",
  number: "Number",
  signature: "Signature",
  fileUpload: "File upload",
};

function options(id: string, labels: string[]) {
  return labels.map((label, index) => ({
    id: `${id}_opt${index + 1}`,
    label,
    value: label.toLowerCase().replace(/\s+/g, "-"),
  }));
}

function typeSpecificFields(
  type: ElementType,
  id: string,
): Record<string, unknown> {
  switch (type) {
    case "text":
      return { content: "Text" };
    case "shape":
      return {
        shape: "rect",
        style: {
          fill: "#e2e8f0",
          stroke: "#94a3b8",
          strokeWidth: 1,
          radius: 4,
        },
      };
    case "image":
      return { alt: "" };
    case "divider":
      return {};
    case "textInput":
      return { label: "Text field", placeholder: "" };
    case "textarea":
      return { label: "Paragraph", placeholder: "" };
    case "checkbox":
      return { label: "Checkbox", boxLabel: "I agree" };
    case "checkboxGroup":
      return {
        label: "Checkbox group",
        options: options(id, ["Option one", "Option two"]),
      };
    case "radioGroup":
      return {
        label: "Radio group",
        options: options(id, ["Option one", "Option two"]),
      };
    case "select":
      return {
        label: "Dropdown",
        placeholder: "Choose…",
        options: options(id, ["Option one", "Option two"]),
      };
    case "date":
      return { label: "Date" };
    case "number":
      return { label: "Number" };
    case "signature":
      return { label: "Signature" };
    case "fileUpload":
      return { label: "File upload" };
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

/**
 * Builds a new element of the given type at the given top-left position.
 *
 * `z` defaults to 0; the builder passes the next free z so a dropped element
 * lands on top of what is already there.
 */
export function createElement(
  type: ElementType,
  id: string,
  position: { x: number; y: number; z?: number },
): FormElement {
  const size = ELEMENT_DEFAULT_SIZE[type];

  return elementSchema.parse({
    id,
    type,
    x: position.x,
    y: position.y,
    w: size.w,
    h: size.h,
    z: position.z ?? 0,
    ...typeSpecificFields(type, id),
  });
}

/** A new, empty page. Like `createElement`, the id is supplied by the caller. */
export function createPage(id: string): Page {
  return pageSchema.parse({ id, elements: [] });
}
