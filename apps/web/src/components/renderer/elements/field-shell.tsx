import { FONT_STACKS, type InputElement } from "@formcraft/schema";
import type { ReactNode } from "react";

/**
 * Label, control, help text — the frame every input element shares.
 *
 * The style block is authored for the control, but the label inherits family,
 * size and colour so that restyling a field looks coherent rather than leaving
 * a mismatched caption above it. Help text sits a little smaller and quieter.
 */
export function FieldShell({
  element,
  children,
}: {
  element: InputElement;
  children: ReactNode;
}) {
  const { style } = element;

  return (
    <div
      style={{
        boxSizing: "border-box",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontFamily: FONT_STACKS[style.fontFamily],
        overflow: "hidden",
      }}
    >
      <span
        style={{
          fontSize: style.fontSize,
          fontWeight: 600,
          color: style.color,
          lineHeight: 1.2,
        }}
      >
        {element.label}
        {element.required && (
          <span
            style={{ color: "#dc2626", marginLeft: 3 }}
            aria-label="required"
          >
            *
          </span>
        )}
      </span>

      {/* The control takes whatever vertical space is left, so the element's
          declared height is honoured exactly rather than being pushed out. */}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>{children}</div>

      {element.help && (
        <span
          style={{
            fontSize: Math.max(9, style.fontSize * 0.8),
            color: "#64748b",
            lineHeight: 1.3,
          }}
        >
          {element.help}
        </span>
      )}
    </div>
  );
}

/** Greyed placeholder text inside a control. */
export function PlaceholderText({
  children,
  fontSize,
}: {
  children: ReactNode;
  fontSize: number;
}) {
  return <span style={{ color: "#94a3b8", fontSize }}>{children}</span>;
}
