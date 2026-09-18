import { z } from "zod";

import { rectSchema } from "./geometry";
import { colorSchema, styleWithDefaults } from "./style";

/**
 * A JSON-safe leaf value.
 *
 * Answers and conditional comparands round-trip through jsonb, so anything that
 * isn't valid JSON cannot be stored. Dates are ISO strings, not Date objects,
 * for exactly this reason.
 */
export const jsonValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
export type JsonValue = z.infer<typeof jsonValueSchema>;

/**
 * Element ids are opaque nanoids (architecture rule 3).
 *
 * Never derived from position, order or label: answers are keyed by these, so a
 * reordered or renamed field must keep the same id or historical submissions
 * lose their meaning.
 */
export const elementIdSchema = z.string().min(1);

/** A choice in a select, radio group or checkbox group. */
export const optionSchema = z.object({
  /** Stable, like an element id — answers reference the value, not the label. */
  id: z.string().min(1),
  label: z.string(),
  value: z.string(),
});
export type Option = z.infer<typeof optionSchema>;

// ---------------------------------------------------------------------------
// Conditional visibility
// ---------------------------------------------------------------------------

export const CONDITION_OPERATORS = [
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "isEmpty",
  "isNotEmpty",
  "greaterThan",
  "lessThan",
] as const;

export const conditionOperatorSchema = z.enum(CONDITION_OPERATORS);
export type ConditionOperator = z.infer<typeof conditionOperatorSchema>;

/**
 * "Show this element if <targetId> <op> <value>."
 *
 * Slice 1 only fixes the shape. The evaluator — and its tests — land in Slice 4
 * where fill-time logic lives; a read-only design preview deliberately renders
 * every element regardless of its condition, because the designer needs to see
 * what they built.
 */
export const conditionalSchema = z.object({
  targetId: elementIdSchema,
  operator: conditionOperatorSchema,
  /** Unused by `isEmpty` / `isNotEmpty`. */
  value: jsonValueSchema.default(null),
});
export type Conditional = z.infer<typeof conditionalSchema>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * One optional bag rather than a per-type validation schema.
 *
 * A `minLength` on a number field is meaningless but harmless, and the
 * alternative — fourteen bespoke validation schemas — costs far more than it
 * catches. Slice 4 applies only the fields that make sense for each type.
 */
export const validationSchema = z.object({
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().nonnegative().optional(),
  /** JavaScript regular expression source, applied to the answer as a string. */
  pattern: z.string().optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  /** ISO 8601 date, e.g. "2026-01-31". */
  minDate: z.string().optional(),
  maxDate: z.string().optional(),
  minSelected: z.number().int().nonnegative().optional(),
  maxSelected: z.number().int().nonnegative().optional(),
  maxSizeBytes: z.number().int().positive().optional(),
  /** MIME types or extensions, e.g. ["image/png", ".pdf"]. */
  acceptedTypes: z.array(z.string()).optional(),
});
export type Validation = z.infer<typeof validationSchema>;

// ---------------------------------------------------------------------------
// Shared element shape
// ---------------------------------------------------------------------------

const baseElementFields = {
  id: elementIdSchema,
  ...rectSchema.shape,
  style: styleWithDefaults,
};

const inputElementFields = {
  ...baseElementFields,
  label: z.string(),
  required: z.boolean().default(false),
  placeholder: z.string().optional(),
  help: z.string().optional(),
  validation: validationSchema.optional(),
  /** Null means "always visible". */
  conditional: conditionalSchema.nullable().default(null),
};

// ---------------------------------------------------------------------------
// Static elements — decoration, collect nothing
// ---------------------------------------------------------------------------

export const textElementSchema = z.object({
  ...baseElementFields,
  type: z.literal("text"),
  content: z.string(),
});

export const imageElementSchema = z.object({
  ...baseElementFields,
  type: z.literal("image"),
  /**
   * Object storage key, or null before anything is uploaded.
   *
   * Nullable from the start so that Slice 2's logo upload doesn't change the
   * schema: the builder creates the element first and fills the key in after.
   */
  objectKey: z.string().nullable().default(null),
  /** Required for WCAG 2.2 AA on public fill pages. Empty means decorative. */
  alt: z.string().default(""),
  fit: z.enum(["contain", "cover", "fill"]).default("contain"),
});

export const SHAPE_KINDS = ["rect", "ellipse", "line", "arrow"] as const;
export const shapeKindSchema = z.enum(SHAPE_KINDS);
export type ShapeKind = z.infer<typeof shapeKindSchema>;

export const shapeElementSchema = z.object({
  ...baseElementFields,
  type: z.literal("shape"),
  shape: shapeKindSchema,
});

export const dividerElementSchema = z.object({
  ...baseElementFields,
  type: z.literal("divider"),
  color: colorSchema.default("#d4d4d4"),
  thickness: z.number().finite().positive().default(1),
});

// ---------------------------------------------------------------------------
// Input elements — collect an answer
// ---------------------------------------------------------------------------

export const textInputElementSchema = z.object({
  ...inputElementFields,
  type: z.literal("textInput"),
  /** Drives the mobile keyboard and browser autofill, not validation. */
  inputType: z.enum(["text", "email", "tel", "url"]).default("text"),
});

export const textareaElementSchema = z.object({
  ...inputElementFields,
  type: z.literal("textarea"),
});

export const checkboxElementSchema = z.object({
  ...inputElementFields,
  type: z.literal("checkbox"),
  /** Shown beside the box; the `label` sits above it, as on every other input. */
  boxLabel: z.string().default(""),
});

export const checkboxGroupElementSchema = z.object({
  ...inputElementFields,
  type: z.literal("checkboxGroup"),
  options: z.array(optionSchema),
  layout: z.enum(["vertical", "horizontal"]).default("vertical"),
});

export const radioGroupElementSchema = z.object({
  ...inputElementFields,
  type: z.literal("radioGroup"),
  options: z.array(optionSchema),
  layout: z.enum(["vertical", "horizontal"]).default("vertical"),
});

export const selectElementSchema = z.object({
  ...inputElementFields,
  type: z.literal("select"),
  options: z.array(optionSchema),
});

export const dateElementSchema = z.object({
  ...inputElementFields,
  type: z.literal("date"),
});

export const numberElementSchema = z.object({
  ...inputElementFields,
  type: z.literal("number"),
  step: z.number().finite().positive().default(1),
});

export const signatureElementSchema = z.object({
  ...inputElementFields,
  type: z.literal("signature"),
});

export const fileUploadElementSchema = z.object({
  ...inputElementFields,
  type: z.literal("fileUpload"),
  multiple: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// The union
// ---------------------------------------------------------------------------

export const STATIC_ELEMENT_TYPES = [
  "text",
  "image",
  "shape",
  "divider",
] as const;

export const INPUT_ELEMENT_TYPES = [
  "textInput",
  "textarea",
  "checkbox",
  "checkboxGroup",
  "radioGroup",
  "select",
  "date",
  "number",
  "signature",
  "fileUpload",
] as const;

export const ELEMENT_TYPES = [
  ...STATIC_ELEMENT_TYPES,
  ...INPUT_ELEMENT_TYPES,
] as const;

export type ElementType = (typeof ELEMENT_TYPES)[number];
export type InputElementType = (typeof INPUT_ELEMENT_TYPES)[number];

export const elementSchema = z.discriminatedUnion("type", [
  textElementSchema,
  imageElementSchema,
  shapeElementSchema,
  dividerElementSchema,
  textInputElementSchema,
  textareaElementSchema,
  checkboxElementSchema,
  checkboxGroupElementSchema,
  radioGroupElementSchema,
  selectElementSchema,
  dateElementSchema,
  numberElementSchema,
  signatureElementSchema,
  fileUploadElementSchema,
]);

export type FormElement = z.infer<typeof elementSchema>;

export type TextElement = z.infer<typeof textElementSchema>;
export type ImageElement = z.infer<typeof imageElementSchema>;
export type ShapeElement = z.infer<typeof shapeElementSchema>;
export type DividerElement = z.infer<typeof dividerElementSchema>;
export type TextInputElement = z.infer<typeof textInputElementSchema>;
export type TextareaElement = z.infer<typeof textareaElementSchema>;
export type CheckboxElement = z.infer<typeof checkboxElementSchema>;
export type CheckboxGroupElement = z.infer<typeof checkboxGroupElementSchema>;
export type RadioGroupElement = z.infer<typeof radioGroupElementSchema>;
export type SelectElement = z.infer<typeof selectElementSchema>;
export type DateElement = z.infer<typeof dateElementSchema>;
export type NumberElement = z.infer<typeof numberElementSchema>;
export type SignatureElement = z.infer<typeof signatureElementSchema>;
export type FileUploadElement = z.infer<typeof fileUploadElementSchema>;

/** An element that collects an answer, as opposed to decoration. */
export type InputElement = Extract<FormElement, { type: InputElementType }>;

const INPUT_TYPE_SET: ReadonlySet<string> = new Set(INPUT_ELEMENT_TYPES);

/**
 * Narrows to the elements that produce an answer.
 *
 * Used wherever the system walks a document looking for data rather than
 * decoration — Excel columns, submission validation, the answers map.
 */
export function isInputElement(element: FormElement): element is InputElement {
  return INPUT_TYPE_SET.has(element.type);
}
