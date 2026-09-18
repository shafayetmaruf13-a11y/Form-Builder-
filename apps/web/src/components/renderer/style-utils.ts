import { FONT_STACKS, type Style } from "@formcraft/schema";
import type { CSSProperties } from "react";

/**
 * Translating a document style block into CSS, in one place.
 *
 * Every renderer — this one, the builder canvas, the Slice 5 PDF worker — uses
 * these functions rather than reading `style` directly. A second translation
 * would drift, and the drift would surface as a PDF that doesn't match the
 * design, which is the one failure this architecture exists to prevent.
 */

/** Background, border, corner radius and padding. */
export function boxStyle(style: Style): CSSProperties {
  const hasStroke = style.stroke !== null && style.strokeWidth > 0;

  return {
    // Non-negotiable: without it a border would grow the element beyond the
    // w/h the document specifies, and coordinates would stop being exact.
    boxSizing: "border-box",
    backgroundColor: style.fill ?? undefined,
    border: hasStroke
      ? `${style.strokeWidth}px solid ${style.stroke}`
      : undefined,
    borderRadius: style.radius || undefined,
    padding: style.padding || undefined,
  };
}

/** Family, size, weight, colour, alignment, leading. */
export function textStyle(style: Style): CSSProperties {
  return {
    fontFamily: FONT_STACKS[style.fontFamily],
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    color: style.color,
    textAlign: style.align,
    lineHeight: style.lineHeight,
  };
}

const VERTICAL_ALIGN_TO_FLEX: Record<Style["verticalAlign"], string> = {
  top: "flex-start",
  middle: "center",
  bottom: "flex-end",
};

/** Vertical placement of content within the element's box. */
export function verticalAlignStyle(style: Style): CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    justifyContent: VERTICAL_ALIGN_TO_FLEX[style.verticalAlign],
  };
}

/**
 * Chrome for an input control.
 *
 * An input's style block is authored for the *control*: `fill` paints the field
 * background and `stroke` its border. Unset means "use the sensible default"
 * rather than "transparent and borderless", because an invisible input box is
 * never what the designer meant.
 */
export function controlChrome(style: Style): CSSProperties {
  return {
    boxSizing: "border-box",
    backgroundColor: style.fill ?? "#ffffff",
    border: `${style.strokeWidth || 1}px solid ${style.stroke ?? "#cbd5e1"}`,
    borderRadius: style.radius || 6,
  };
}
