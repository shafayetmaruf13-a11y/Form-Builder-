import { z } from "zod";

/** `#rgb`, `#rrggbb` or `#rrggbbaa`. */
export const colorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);

export type Color = z.infer<typeof colorSchema>;

/**
 * Font families are a closed set, not a free string.
 *
 * At Slice 5 the PDF is rendered by headless Chromium. A family that isn't
 * installed there falls back to something else, and the PDF stops matching the
 * design — which is the one promise this architecture exists to keep. Keeping
 * the set closed means "every family here is self-hosted and present in the PDF
 * renderer" stays a checkable claim.
 *
 * Adding a family means shipping its woff2 and loading it in both the app and
 * the PDF worker. It is not a one-line change.
 */
export const FONT_FAMILIES = [
  "inter",
  "lora",
  "jetbrains-mono",
  "playfair-display",
] as const;

export const fontFamilySchema = z.enum(FONT_FAMILIES);
export type FontFamily = z.infer<typeof fontFamilySchema>;

/**
 * The CSS stack each family resolves to.
 *
 * This lives in the schema package rather than in the renderer because the
 * builder, the fill page and the PDF worker must all resolve a family to
 * byte-identical CSS. Two copies of this map would drift, and the drift would
 * only show up as a subtly wrong PDF.
 */
export const FONT_STACKS: Record<FontFamily, string> = {
  inter: "var(--font-inter), ui-sans-serif, system-ui, sans-serif",
  lora: "var(--font-lora), ui-serif, Georgia, serif",
  "jetbrains-mono": "var(--font-jetbrains-mono), ui-monospace, monospace",
  "playfair-display": "var(--font-playfair-display), ui-serif, Georgia, serif",
};

/**
 * The CSS custom property each family binds to.
 *
 * Any surface that renders a document — the app, and the PDF worker at Slice 5
 * — must define all four, pointing at the same self-hosted files. A surface
 * that defines none still renders, via the fallbacks above, but no longer
 * matches the design.
 */
export const FONT_CSS_VARIABLES: Record<FontFamily, string> = {
  inter: "--font-inter",
  lora: "--font-lora",
  "jetbrains-mono": "--font-jetbrains-mono",
  "playfair-display": "--font-playfair-display",
};

export const FONT_WEIGHTS = [300, 400, 500, 600, 700] as const;
export const fontWeightSchema = z.union([
  z.literal(300),
  z.literal(400),
  z.literal(500),
  z.literal(600),
  z.literal(700),
]);
export type FontWeight = z.infer<typeof fontWeightSchema>;

export const textAlignSchema = z.enum(["left", "center", "right", "justify"]);
export type TextAlign = z.infer<typeof textAlignSchema>;

export const verticalAlignSchema = z.enum(["top", "middle", "bottom"]);
export type VerticalAlign = z.infer<typeof verticalAlignSchema>;

/**
 * The style block every element carries.
 *
 * Every field has a default, so a caller can supply `{}` and get a complete,
 * renderable style back. The renderer therefore never has to ask "what if this
 * is undefined?" — which is what keeps the three renderers identical.
 */
export const styleSchema = z.object({
  /** Background. Null means transparent, which is not the same as white. */
  fill: colorSchema.nullable().default(null),
  stroke: colorSchema.nullable().default(null),
  strokeWidth: z.number().finite().nonnegative().default(0),
  radius: z.number().finite().nonnegative().default(0),
  opacity: z.number().min(0).max(1).default(1),
  fontFamily: fontFamilySchema.default("inter"),
  fontSize: z.number().finite().positive().default(14),
  fontWeight: fontWeightSchema.default(400),
  /** Text colour. `fill` is the background; these are not interchangeable. */
  color: colorSchema.default("#111111"),
  align: textAlignSchema.default("left"),
  verticalAlign: verticalAlignSchema.default("top"),
  padding: z.number().finite().nonnegative().default(0),
  lineHeight: z.number().finite().positive().default(1.4),
});

export type Style = z.infer<typeof styleSchema>;

/**
 * `.prefault({})` rather than `.default({})`.
 *
 * In zod 4 `.default(v)` short-circuits parsing and hands back `v` verbatim, so
 * `.default({})` would yield a literally empty style with none of the field
 * defaults above applied. `.prefault({})` feeds `{}` *through* the parse, which
 * is what actually fills them in.
 */
export const styleWithDefaults = styleSchema.prefault({});

/** A complete style with every default applied. Useful for tests and fixtures. */
export function defaultStyle(): Style {
  return styleSchema.parse({});
}
