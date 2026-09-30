import {
  type Answer,
  type AnswerFile,
  type InputElement,
  answerToString,
} from "@formcraft/schema";
import type { CSSProperties } from "react";

import { FieldShell } from "@/components/renderer/elements/field-shell";
import { controlChrome } from "@/components/renderer/style-utils";

/**
 * An input element with its answer drawn in.
 *
 * The third view of an input, and the last one: the builder's read-only
 * preview draws an *empty* control, the fill page renders a real one, and this
 * draws a *completed* one. All three sit at the same document coordinates
 * inside the same `ElementFrame`, which is what makes the PDF land every value
 * exactly where the designer put the field (architecture rule 2).
 *
 * Deliberately not the fill page's components: those are `"use client"` and
 * carry state, focus rings and error styling that have no meaning in a
 * finished document. This is a server component with no interactivity at all,
 * which is also what lets the render page be a plain RSC.
 */

const CONTROL_PADDING = "8px 10px";

export function FilledField({
  element,
  answer,
}: {
  element: InputElement;
  answer: Answer | undefined;
}) {
  return (
    <FieldShell element={element}>
      <Control element={element} answer={answer} />
    </FieldShell>
  );
}

/** The box an answer sits in — same chrome the empty preview draws. */
function ValueBox({
  element,
  children,
  align = "center",
}: {
  element: InputElement;
  children: React.ReactNode;
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

function valueText(element: InputElement): CSSProperties {
  return {
    fontSize: element.style.fontSize,
    color: element.style.color,
    fontWeight: element.style.fontWeight,
    lineHeight: element.style.lineHeight,
    // An answer can be longer than the designer allowed for. Wrapping and
    // clipping is the honest failure: silently shrinking the text would make
    // the PDF stop matching the design, which is the one thing it promises.
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  };
}

/** Shown where a question was left blank, so the gap is deliberate. */
function Blank({ element }: { element: InputElement }) {
  return <span style={{ ...valueText(element), color: "#94a3b8" }}>—</span>;
}

function Control({
  element,
  answer,
}: {
  element: InputElement;
  answer: Answer | undefined;
}) {
  switch (element.type) {
    case "textInput":
    case "date":
    case "number": {
      const text = answerToString(answer);
      return (
        <ValueBox element={element}>
          {text === "" ? (
            <Blank element={element} />
          ) : (
            <span style={valueText(element)}>{text}</span>
          )}
        </ValueBox>
      );
    }

    case "textarea": {
      const text = answerToString(answer);
      return (
        <ValueBox element={element} align="flex-start">
          {text === "" ? (
            <Blank element={element} />
          ) : (
            <span style={valueText(element)}>{text}</span>
          )}
        </ValueBox>
      );
    }

    case "select": {
      // The option's *label*, not its value. The value is a storage detail;
      // the label is what the person filling in actually chose.
      const chosen = element.options.find(
        (option) => option.value === answerToString(answer),
      );
      return (
        <ValueBox element={element}>
          {chosen ? (
            <span style={valueText(element)}>{chosen.label}</span>
          ) : (
            <Blank element={element} />
          )}
        </ValueBox>
      );
    }

    case "checkbox":
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Tick
            checked={answer === true}
            round={false}
            size={Math.max(12, element.style.fontSize)}
            stroke={element.style.stroke ?? "#94a3b8"}
          />
          <span style={valueText(element)}>{element.boxLabel}</span>
        </div>
      );

    case "radioGroup":
    case "checkboxGroup": {
      const selected = new Set(
        element.type === "checkboxGroup"
          ? asStrings(answer)
          : [answerToString(answer)],
      );

      // Every option is drawn, not just the chosen ones: a completed paper
      // form shows which boxes were ticked *and* which were not, and a PDF
      // that listed only the answers would not be the same document.
      return (
        <div
          style={{
            display: "flex",
            flexDirection: element.layout === "horizontal" ? "row" : "column",
            flexWrap: element.layout === "horizontal" ? "wrap" : "nowrap",
            gap: element.layout === "horizontal" ? 16 : 6,
            width: "100%",
            overflow: "hidden",
          }}
        >
          {element.options.map((option) => (
            <span
              key={option.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                ...valueText(element),
              }}
            >
              <Tick
                checked={selected.has(option.value)}
                round={element.type === "radioGroup"}
                size={Math.max(12, element.style.fontSize)}
                stroke={element.style.stroke ?? "#94a3b8"}
              />
              {option.label}
            </span>
          ))}
        </div>
      );
    }

    case "signature": {
      const data = answerToString(answer);
      // Checked here as well as at submit time: this string reaches an `img`
      // `src`, and a row may predate that check or have been written by
      // something else.
      const usable = data.startsWith("data:image/png;base64,");

      return (
        <div
          style={{
            ...controlChrome(element.style),
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {usable ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data}
              // The field's own label, not "Signature for <label>": that field
              // is usually called "Signature", and a PDF reader announcing
              // "Signature for Signature" is worse than saying nothing twice.
              alt={element.label || "Signature"}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
              }}
            />
          ) : (
            <Blank element={element} />
          )}
        </div>
      );
    }

    case "fileUpload": {
      const files = asFiles(answer);

      // Filenames, because the bytes cannot be drawn into an A4 box. A PDF
      // that silently omitted an attached CV would misrepresent the
      // submission; naming it says what was sent without pretending to
      // include it.
      return (
        <ValueBox element={element} align="flex-start">
          {files.length === 0 ? (
            <Blank element={element} />
          ) : (
            <span style={valueText(element)}>
              {files.map((file) => file.filename).join(", ")}
            </span>
          )}
        </ValueBox>
      );
    }

    default: {
      const exhaustive: never = element;
      return exhaustive;
    }
  }
}

/** A checkbox or radio, ticked or not. */
function Tick({
  checked,
  round,
  size,
  stroke,
}: {
  checked: boolean;
  round: boolean;
  size: number;
  stroke: string;
}) {
  return (
    <span
      style={{
        boxSizing: "border-box",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        width: size,
        height: size,
        border: `1px solid ${stroke}`,
        borderRadius: round ? "50%" : 3,
        backgroundColor: "#ffffff",
        color: "#0f172a",
        // Drawn as a glyph rather than a background colour, so the tick
        // survives a black-and-white print.
        fontSize: size * 0.8,
        lineHeight: 1,
      }}
    >
      {checked ? (round ? "●" : "✓") : ""}
    </span>
  );
}

function asStrings(answer: Answer | undefined): string[] {
  if (!Array.isArray(answer)) return [];
  return answer.filter((item): item is string => typeof item === "string");
}

function asFiles(answer: Answer | undefined): AnswerFile[] {
  if (!Array.isArray(answer)) return [];
  return answer.filter((item): item is AnswerFile => typeof item !== "string");
}
