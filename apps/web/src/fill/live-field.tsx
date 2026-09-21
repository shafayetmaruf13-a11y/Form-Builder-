"use client";

import {
  type Answer,
  type AnswerFile,
  FONT_STACKS,
  type InputElement,
} from "@formcraft/schema";
import type { CSSProperties, ReactNode } from "react";

import { controlChrome, textStyle } from "@/components/renderer/style-utils";

import { SignaturePad } from "./signature-pad";

/**
 * The live, fillable version of an input element.
 *
 * The read-only views in `components/renderer/elements/input-elements.tsx`
 * deliberately draw *pictures* of controls with no state and no `<input>` — a
 * design preview that announced itself to a screen reader as fillable would be
 * lying. This is the other half of that decision: the real controls, rendered
 * at the same document coordinates through the same `ElementFrame`, so the
 * filled page matches the design and later the PDF.
 *
 * Accessibility is not decoration here. The quality bar says public fill pages
 * are WCAG 2.2 AA, so every control has a real associated label, groups are
 * `fieldset`/`legend`, errors are `aria-describedby` and announced, and nothing
 * relies on colour alone.
 */

export interface LiveFieldProps {
  element: InputElement;
  value: Answer | undefined;
  onChange: (value: Answer) => void;
  error?: string;
  /** Set once the form has been submitted, so errors appear then and not before. */
  showError: boolean;
  disabled?: boolean;
}

export function LiveField(props: LiveFieldProps) {
  const { element } = props;

  switch (element.type) {
    case "checkbox":
    case "checkboxGroup":
    case "radioGroup":
      // These label themselves — a single checkbox by its own box label, a
      // group by its legend — so they bring their own shell.
      return <ChoiceField {...props} />;
    default:
      return (
        <LabelledField {...props}>
          {(ids) => <Control {...props} ids={ids} />}
        </LabelledField>
      );
  }
}

// ---------------------------------------------------------------------------
// Shells
// ---------------------------------------------------------------------------

interface FieldIds {
  controlId: string;
  describedBy: string | undefined;
  invalid: boolean;
}

function fieldIds(
  element: InputElement,
  error: string | undefined,
  showError: boolean,
): FieldIds {
  const invalid = Boolean(showError && error);
  const described = [
    element.help ? `${element.id}-help` : null,
    invalid ? `${element.id}-error` : null,
  ].filter(Boolean);

  return {
    controlId: `${element.id}-control`,
    describedBy: described.length > 0 ? described.join(" ") : undefined,
    invalid,
  };
}

/** A control with a `<label for>` above it. */
function LabelledField({
  element,
  error,
  showError,
  children,
}: LiveFieldProps & { children: (ids: FieldIds) => ReactNode }) {
  const ids = fieldIds(element, error, showError);

  return (
    <Shell element={element} ids={ids} error={error}>
      <label
        htmlFor={ids.controlId}
        style={labelStyle(element)}
        // The asterisk is a convention, not an accessible name. `required` on
        // the control is what a screen reader actually announces.
      >
        {element.label}
        {element.required && <RequiredMark />}
      </label>
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {children(ids)}
      </div>
    </Shell>
  );
}

/** A group of controls under a `<legend>`. */
function ChoiceField(props: LiveFieldProps) {
  const { element, error, showError } = props;
  const ids = fieldIds(element, error, showError);

  return (
    <Shell element={element} ids={ids} error={error}>
      <fieldset
        style={{ border: 0, margin: 0, padding: 0, minWidth: 0, flex: 1 }}
        aria-describedby={ids.describedBy}
        aria-invalid={ids.invalid || undefined}
      >
        <legend style={{ ...labelStyle(element), padding: 0 }}>
          {element.label}
          {element.required && <RequiredMark />}
        </legend>
        <ChoiceControls {...props} ids={ids} />
      </fieldset>
    </Shell>
  );
}

function Shell({
  element,
  ids,
  error,
  children,
}: {
  element: InputElement;
  ids: FieldIds;
  error: string | undefined;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        boxSizing: "border-box",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontFamily: FONT_STACKS[element.style.fontFamily],
        // Unlike the read-only preview, a live field may outgrow its box: a
        // wrapped error message must never be clipped away where nobody can
        // read it. The design's height is the *minimum* here.
        overflow: "visible",
      }}
    >
      {children}

      {element.help && (
        <span
          id={`${element.id}-help`}
          style={{
            fontSize: Math.max(9, element.style.fontSize * 0.8),
            color: "#475569",
            lineHeight: 1.3,
          }}
        >
          {element.help}
        </span>
      )}

      {ids.invalid && (
        <span
          id={`${element.id}-error`}
          // Errors appear after a submit attempt, so they need announcing.
          // `alert` rather than a live region on the container: this element
          // did not exist a moment ago.
          role="alert"
          style={{
            fontSize: Math.max(9, element.style.fontSize * 0.8),
            color: "#b91c1c",
            fontWeight: 600,
            lineHeight: 1.3,
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}

function RequiredMark() {
  return (
    <span aria-hidden="true" style={{ color: "#dc2626", marginLeft: 3 }}>
      *
    </span>
  );
}

function labelStyle(element: InputElement): CSSProperties {
  return {
    fontSize: element.style.fontSize,
    fontWeight: 600,
    color: element.style.color,
    lineHeight: 1.2,
    display: "block",
  };
}

/**
 * Chrome for a control, plus an unmistakable invalid state.
 *
 * Red alone would fail WCAG 1.4.1, so an invalid control also thickens its
 * border — and the message beside it says what is wrong in words.
 */
function chrome(element: InputElement, invalid: boolean): CSSProperties {
  const base = controlChrome(element.style);

  return {
    ...base,
    ...(invalid
      ? { border: "2px solid #b91c1c", backgroundColor: "#fef2f2" }
      : {}),
    width: "100%",
    padding: element.style.padding || 6,
    ...textStyle(element.style),
    fontWeight: element.style.fontWeight,
  };
}

// ---------------------------------------------------------------------------
// The controls themselves
// ---------------------------------------------------------------------------

function Control({
  element,
  value,
  onChange,
  disabled,
  ids,
}: LiveFieldProps & { ids: FieldIds }) {
  const common = {
    id: ids.controlId,
    name: element.id,
    required: element.required,
    disabled,
    "aria-describedby": ids.describedBy,
    "aria-invalid": ids.invalid || undefined,
    style: chrome(element, ids.invalid),
  };

  switch (element.type) {
    case "textInput":
      return (
        <input
          {...common}
          type={element.inputType}
          placeholder={element.placeholder}
          value={asText(value)}
          maxLength={element.validation?.maxLength}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case "textarea":
      return (
        <textarea
          {...common}
          placeholder={element.placeholder}
          value={asText(value)}
          maxLength={element.validation?.maxLength}
          style={{ ...common.style, height: "100%", resize: "none" }}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case "number":
      return (
        <input
          {...common}
          type="number"
          inputMode="decimal"
          placeholder={element.placeholder}
          step={element.step}
          min={element.validation?.min}
          max={element.validation?.max}
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(event) => {
            const raw = event.target.value;
            // Kept as text while it is being typed — "-" and "1." are states a
            // person passes through, and coercing them to a number mid-keystroke
            // would fight the cursor. The server parses it either way.
            onChange(raw === "" ? null : raw);
          }}
        />
      );

    case "date":
      return (
        <input
          {...common}
          type="date"
          value={asText(value)}
          min={element.validation?.minDate}
          max={element.validation?.maxDate}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case "select":
      return (
        <select
          {...common}
          value={asText(value)}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{element.placeholder || "Choose one…"}</option>
          {element.options.map((option) => (
            <option key={option.id} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );

    case "signature":
      return (
        <SignaturePad
          id={ids.controlId}
          label={element.label}
          value={asText(value)}
          invalid={ids.invalid}
          describedBy={ids.describedBy}
          disabled={disabled}
          onChange={onChange}
        />
      );

    case "fileUpload":
      return (
        <FileField
          element={element}
          value={value}
          onChange={onChange}
          ids={ids}
          disabled={disabled}
        />
      );

    default:
      return null;
  }
}

function ChoiceControls({
  element,
  value,
  onChange,
  disabled,
  ids,
}: LiveFieldProps & { ids: FieldIds }) {
  if (element.type === "checkbox") {
    return (
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          ...textStyle(element.style),
          cursor: disabled ? "default" : "pointer",
          // 24px keeps the hit target above the 24x24 minimum of WCAG 2.2's
          // Target Size (Minimum).
          minHeight: 24,
        }}
      >
        <input
          type="checkbox"
          name={element.id}
          checked={value === true}
          required={element.required}
          disabled={disabled}
          aria-describedby={ids.describedBy}
          aria-invalid={ids.invalid || undefined}
          style={{ width: 18, height: 18, flex: "none" }}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{element.boxLabel || element.label}</span>
      </label>
    );
  }

  if (element.type === "radioGroup" || element.type === "checkboxGroup") {
    const multiple = element.type === "checkboxGroup";
    const selected = new Set(asStringArray(value));

    return (
      <div
        style={{
          display: "flex",
          flexDirection: element.layout === "horizontal" ? "row" : "column",
          flexWrap: "wrap",
          gap: element.layout === "horizontal" ? 16 : 6,
          marginTop: 4,
        }}
      >
        {element.options.map((option) => (
          <label
            key={option.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              ...textStyle(element.style),
              cursor: disabled ? "default" : "pointer",
              minHeight: 24,
            }}
          >
            <input
              type={multiple ? "checkbox" : "radio"}
              name={element.id}
              value={option.value}
              checked={
                multiple
                  ? selected.has(option.value)
                  : asText(value) === option.value
              }
              disabled={disabled}
              style={{ width: 18, height: 18, flex: "none" }}
              onChange={(event) => {
                if (!multiple) {
                  onChange(option.value);
                  return;
                }

                const next = new Set(selected);
                if (event.target.checked) next.add(option.value);
                else next.delete(option.value);

                // Emitted in the document's option order, not click order, so
                // the same set of ticks always stores the same array — which
                // keeps an Excel cell stable across submissions.
                onChange(
                  element.options
                    .map((o) => o.value)
                    .filter((v) => next.has(v)),
                );
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    );
  }

  return null;
}

/**
 * File answers.
 *
 * Uploads happen immediately, to the same endpoint the builder's logo upload
 * uses, and the answer stores the returned object key. Holding the bytes until
 * submit would mean a multipart submit path and losing a large file to a
 * refresh.
 */
function FileField({
  element,
  value,
  onChange,
  ids,
  disabled,
}: {
  element: Extract<InputElement, { type: "fileUpload" }>;
  value: Answer | undefined;
  onChange: (value: Answer) => void;
  ids: FieldIds;
  disabled?: boolean;
}) {
  const files = asFiles(value);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
      <input
        id={ids.controlId}
        type="file"
        name={element.id}
        multiple={element.multiple}
        disabled={disabled}
        accept={element.validation?.acceptedTypes?.join(",")}
        aria-describedby={ids.describedBy}
        aria-invalid={ids.invalid || undefined}
        style={{
          ...textStyle(element.style),
          fontSize: Math.max(10, element.style.fontSize * 0.9),
        }}
        onChange={async (event) => {
          const chosen = [...(event.target.files ?? [])];
          if (chosen.length === 0) return;

          const uploaded: AnswerFile[] = [];
          for (const file of chosen) {
            const body = new FormData();
            body.append("file", file);

            const response = await fetch("/api/uploads", {
              method: "POST",
              body,
            });
            if (!response.ok) continue;

            const result = (await response.json()) as {
              objectKey: string;
              filename: string;
              contentType: string;
              byteSize: number;
            };
            uploaded.push(result);
          }

          onChange(element.multiple ? [...files, ...uploaded] : uploaded);
        }}
      />

      {files.length > 0 && (
        <ul
          style={{
            margin: 0,
            paddingLeft: 18,
            fontSize: Math.max(9, element.style.fontSize * 0.8),
            color: "#475569",
          }}
        >
          {files.map((file) => (
            <li key={file.objectKey}>{file.filename}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coercions
// ---------------------------------------------------------------------------

/**
 * A value as text for a controlled input.
 *
 * Never `undefined`: React switches an input from controlled to uncontrolled
 * when its value becomes undefined, and warns loudly about it.
 */
function asText(value: Answer | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "";
  return "";
}

function asStringArray(value: Answer | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asFiles(value: Answer | undefined): AnswerFile[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is AnswerFile => typeof item !== "string");
}
