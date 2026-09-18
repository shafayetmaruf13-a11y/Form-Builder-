import type {
  CheckboxElement,
  CheckboxGroupElement,
  DateElement,
  FileUploadElement,
  NumberElement,
  Option,
  RadioGroupElement,
  SelectElement,
  SignatureElement,
  TextInputElement,
  TextareaElement,
} from "@formcraft/schema";

import { controlChrome } from "../style-utils";
import { FieldShell, PlaceholderText } from "./field-shell";

/**
 * Read-only views of the input elements.
 *
 * These draw what a field *looks like*; they are not form controls. No state,
 * no react-hook-form, and deliberately no real `<input>` elements — a design
 * preview that announced itself to a screen reader as a fillable form would be
 * lying. Slice 4 renders the live, accessible versions on the public fill page.
 */

const CONTROL_PADDING = "8px 10px";

function TextBox({
  children,
  element,
  align = "center",
}: {
  children: React.ReactNode;
  element: { style: Parameters<typeof controlChrome>[0] };
  align?: "center" | "flex-start";
}) {
  return (
    <div
      style={{
        ...controlChrome(element.style),
        width: "100%",
        height: "100%",
        padding: CONTROL_PADDING,
        display: "flex",
        alignItems: align,
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

export function TextInputView({ element }: { element: TextInputElement }) {
  return (
    <FieldShell element={element}>
      <TextBox element={element}>
        <PlaceholderText fontSize={element.style.fontSize}>
          {element.placeholder ?? ""}
        </PlaceholderText>
      </TextBox>
    </FieldShell>
  );
}

export function TextareaView({ element }: { element: TextareaElement }) {
  return (
    <FieldShell element={element}>
      <TextBox element={element} align="flex-start">
        <PlaceholderText fontSize={element.style.fontSize}>
          {element.placeholder ?? ""}
        </PlaceholderText>
      </TextBox>
    </FieldShell>
  );
}

export function NumberView({ element }: { element: NumberElement }) {
  return (
    <FieldShell element={element}>
      <TextBox element={element}>
        <PlaceholderText fontSize={element.style.fontSize}>
          {element.placeholder ?? ""}
        </PlaceholderText>
        <span style={{ marginLeft: "auto", color: "#cbd5e1", fontSize: 10 }}>
          ▲▼
        </span>
      </TextBox>
    </FieldShell>
  );
}

/**
 * Drawn rather than typed as an emoji.
 *
 * A colour-emoji glyph depends on a font that headless Chromium may not have,
 * which would render as tofu in the Slice 5 PDF. Inline SVG has no such
 * dependency and scales with the page transform.
 */
function CalendarGlyph() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 14 14"
      fill="none"
      stroke="#94a3b8"
      strokeWidth={1.2}
      style={{ marginLeft: "auto", flex: "none" }}
      aria-hidden
    >
      <rect x={1} y={2.5} width={12} height={10.5} rx={1.5} />
      <path d="M1 5.5h12M4.5 1v3M9.5 1v3" />
    </svg>
  );
}

export function DateView({ element }: { element: DateElement }) {
  return (
    <FieldShell element={element}>
      <TextBox element={element}>
        <PlaceholderText fontSize={element.style.fontSize}>
          {element.placeholder ?? "dd / mm / yyyy"}
        </PlaceholderText>
        <CalendarGlyph />
      </TextBox>
    </FieldShell>
  );
}

export function SelectView({ element }: { element: SelectElement }) {
  return (
    <FieldShell element={element}>
      <TextBox element={element}>
        <PlaceholderText fontSize={element.style.fontSize}>
          {element.placeholder ?? element.options[0]?.label ?? "Choose…"}
        </PlaceholderText>
        <span
          style={{ marginLeft: "auto", color: "#64748b", fontSize: 10 }}
          aria-hidden
        >
          ▼
        </span>
      </TextBox>
    </FieldShell>
  );
}

/** A single unticked box or circle, drawn to match the control's styling. */
function Tick({
  round,
  size,
  stroke,
}: {
  round: boolean;
  size: number;
  stroke: string;
}) {
  return (
    <span
      style={{
        boxSizing: "border-box",
        display: "inline-block",
        flex: "none",
        width: size,
        height: size,
        border: `1px solid ${stroke}`,
        borderRadius: round ? "50%" : 3,
        backgroundColor: "#ffffff",
      }}
    />
  );
}

export function CheckboxView({ element }: { element: CheckboxElement }) {
  const size = Math.max(12, element.style.fontSize);

  return (
    <FieldShell element={element}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Tick
          round={false}
          size={size}
          stroke={element.style.stroke ?? "#94a3b8"}
        />
        <span
          style={{
            fontSize: element.style.fontSize,
            color: element.style.color,
          }}
        >
          {element.boxLabel}
        </span>
      </div>
    </FieldShell>
  );
}

function OptionList({
  options,
  round,
  horizontal,
  fontSize,
  color,
  stroke,
}: {
  options: Option[];
  round: boolean;
  horizontal: boolean;
  fontSize: number;
  color: string;
  stroke: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: horizontal ? "row" : "column",
        flexWrap: horizontal ? "wrap" : "nowrap",
        gap: horizontal ? 16 : 6,
        width: "100%",
        overflow: "hidden",
      }}
    >
      {options.map((option) => (
        <span
          key={option.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize,
            color,
          }}
        >
          <Tick round={round} size={Math.max(12, fontSize)} stroke={stroke} />
          {option.label}
        </span>
      ))}
    </div>
  );
}

export function CheckboxGroupView({
  element,
}: {
  element: CheckboxGroupElement;
}) {
  return (
    <FieldShell element={element}>
      <OptionList
        options={element.options}
        round={false}
        horizontal={element.layout === "horizontal"}
        fontSize={element.style.fontSize}
        color={element.style.color}
        stroke={element.style.stroke ?? "#94a3b8"}
      />
    </FieldShell>
  );
}

export function RadioGroupView({ element }: { element: RadioGroupElement }) {
  return (
    <FieldShell element={element}>
      <OptionList
        options={element.options}
        round
        horizontal={element.layout === "horizontal"}
        fontSize={element.style.fontSize}
        color={element.style.color}
        stroke={element.style.stroke ?? "#94a3b8"}
      />
    </FieldShell>
  );
}

export function SignatureView({ element }: { element: SignatureElement }) {
  return (
    <FieldShell element={element}>
      <div
        style={{
          ...controlChrome(element.style),
          borderStyle: "dashed",
          width: "100%",
          height: "100%",
          position: "relative",
          display: "flex",
          alignItems: "flex-end",
          padding: CONTROL_PADDING,
        }}
      >
        {/* The signing baseline, as on a paper form. */}
        <div
          style={{
            width: "100%",
            borderBottom: "1px solid #cbd5e1",
            paddingBottom: 2,
            color: "#94a3b8",
            fontSize: Math.max(9, element.style.fontSize * 0.8),
          }}
        >
          Sign here
        </div>
      </div>
    </FieldShell>
  );
}

export function FileUploadView({ element }: { element: FileUploadElement }) {
  return (
    <FieldShell element={element}>
      <div
        style={{
          ...controlChrome(element.style),
          borderStyle: "dashed",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: CONTROL_PADDING,
        }}
      >
        <span
          style={{
            border: "1px solid #cbd5e1",
            borderRadius: 4,
            padding: "3px 10px",
            fontSize: Math.max(9, element.style.fontSize * 0.85),
            color: "#475569",
            backgroundColor: "#f8fafc",
          }}
        >
          {element.multiple ? "Choose files" : "Choose file"}
        </span>
        <span style={{ fontSize: 9, color: "#94a3b8" }}>or drag and drop</span>
      </div>
    </FieldShell>
  );
}
