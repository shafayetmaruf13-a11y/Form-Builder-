"use client";

import {
  FONT_FAMILIES,
  FONT_WEIGHTS,
  type FormElement,
  type InputElement,
  SHAPE_KINDS,
  isInputElement,
} from "@formcraft/schema";

import {
  ColorField,
  NumberField,
  Section,
  SelectField,
  TextField,
  ToggleField,
} from "../controls/fields";
import { useElementUpdate } from "../use-element-update";

type Update = ReturnType<typeof useElementUpdate>;

const FONT_LABELS: Record<(typeof FONT_FAMILIES)[number], string> = {
  inter: "Inter",
  lora: "Lora",
  "jetbrains-mono": "JetBrains Mono",
  "playfair-display": "Playfair Display",
};

export function GeometrySection({
  element,
  update,
}: {
  element: FormElement;
  update: Update["update"];
}) {
  return (
    <Section title="Position">
      <NumberField
        label="X"
        value={element.x}
        onCommit={(x) => update({ x }, "Move")}
      />
      <NumberField
        label="Y"
        value={element.y}
        onCommit={(y) => update({ y }, "Move")}
      />
      <NumberField
        label="Width"
        value={element.w}
        min={8}
        onCommit={(w) => update({ w }, "Resize")}
      />
      <NumberField
        label="Height"
        value={element.h}
        min={8}
        onCommit={(h) => update({ h }, "Resize")}
      />
      <NumberField
        label="Rotation"
        value={element.rotation}
        suffix="°"
        onCommit={(rotation) => update({ rotation }, "Rotate")}
      />
    </Section>
  );
}

export function AppearanceSection({
  element,
  updateStyle,
}: {
  element: FormElement;
  updateStyle: Update["updateStyle"];
}) {
  const { style } = element;

  return (
    <Section title="Appearance">
      <ColorField
        label="Fill"
        value={style.fill}
        clearable
        onCommit={(fill) => updateStyle({ fill })}
      />
      <ColorField
        label="Stroke"
        value={style.stroke}
        clearable
        onCommit={(stroke) => updateStyle({ stroke })}
      />
      <NumberField
        label="Stroke w."
        value={style.strokeWidth}
        min={0}
        onCommit={(strokeWidth) => updateStyle({ strokeWidth })}
      />
      <NumberField
        label="Radius"
        value={style.radius}
        min={0}
        onCommit={(radius) => updateStyle({ radius })}
      />
      <NumberField
        label="Opacity"
        value={style.opacity}
        min={0}
        max={1}
        step={0.05}
        onCommit={(opacity) => updateStyle({ opacity })}
      />
      <NumberField
        label="Padding"
        value={style.padding}
        min={0}
        onCommit={(padding) => updateStyle({ padding })}
      />
    </Section>
  );
}

export function TextSection({
  element,
  updateStyle,
}: {
  element: FormElement;
  updateStyle: Update["updateStyle"];
}) {
  const { style } = element;

  return (
    <Section title="Text">
      <SelectField
        label="Font"
        value={style.fontFamily}
        options={FONT_FAMILIES.map((family) => ({
          value: family,
          label: FONT_LABELS[family],
        }))}
        onCommit={(fontFamily) => updateStyle({ fontFamily })}
      />
      <NumberField
        label="Size"
        value={style.fontSize}
        min={1}
        onCommit={(fontSize) => updateStyle({ fontSize })}
      />
      <SelectField
        label="Weight"
        value={String(style.fontWeight)}
        options={FONT_WEIGHTS.map((weight) => ({
          value: String(weight),
          label: String(weight),
        }))}
        onCommit={(weight) => updateStyle({ fontWeight: Number(weight) })}
      />
      <ColorField
        label="Colour"
        value={style.color}
        onCommit={(color) => color && updateStyle({ color })}
      />
      <SelectField
        label="Align"
        value={style.align}
        options={[
          { value: "left", label: "Left" },
          { value: "center", label: "Centre" },
          { value: "right", label: "Right" },
          { value: "justify", label: "Justify" },
        ]}
        onCommit={(align) => updateStyle({ align })}
      />
      <SelectField
        label="Vertical"
        value={style.verticalAlign}
        options={[
          { value: "top", label: "Top" },
          { value: "middle", label: "Middle" },
          { value: "bottom", label: "Bottom" },
        ]}
        onCommit={(verticalAlign) => updateStyle({ verticalAlign })}
      />
      <NumberField
        label="Leading"
        value={style.lineHeight}
        min={0.5}
        step={0.1}
        onCommit={(lineHeight) => updateStyle({ lineHeight })}
      />
    </Section>
  );
}

/** Whatever is specific to this element's type. */
export function ContentSection({
  element,
  update,
  onPickLogo,
  uploading,
}: {
  element: FormElement;
  update: Update["update"];
  onPickLogo: () => void;
  uploading: boolean;
}) {
  if (element.type === "text") {
    return (
      <Section title="Content">
        <TextField
          label="Text"
          value={element.content}
          multiline
          onCommit={(content) => update({ content })}
        />
      </Section>
    );
  }

  if (element.type === "shape") {
    return (
      <Section title="Shape">
        <SelectField
          label="Kind"
          value={element.shape}
          options={SHAPE_KINDS.map((kind) => ({ value: kind, label: kind }))}
          onCommit={(shape) => update({ shape })}
        />
      </Section>
    );
  }

  if (element.type === "divider") {
    return (
      <Section title="Divider">
        <ColorField
          label="Colour"
          value={element.color}
          onCommit={(color) => color && update({ color })}
        />
        <NumberField
          label="Thickness"
          value={element.thickness}
          min={0.5}
          step={0.5}
          onCommit={(thickness) => update({ thickness })}
        />
      </Section>
    );
  }

  if (element.type === "image") {
    return (
      <Section title="Image">
        <button
          type="button"
          onClick={onPickLogo}
          disabled={uploading}
          className="rounded border border-black/15 px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
        >
          {uploading
            ? "Uploading…"
            : element.objectKey
              ? "Replace image"
              : "Upload image"}
        </button>
        {element.objectKey && (
          <button
            type="button"
            onClick={() => update({ objectKey: null }, "Remove image")}
            className="rounded border border-black/15 px-2 py-1 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Remove image
          </button>
        )}
        <TextField
          label="Alt text"
          value={element.alt}
          placeholder="Describes the image"
          onCommit={(alt) => update({ alt })}
        />
        <SelectField
          label="Fit"
          value={element.fit}
          options={[
            { value: "contain", label: "Contain" },
            { value: "cover", label: "Cover" },
            { value: "fill", label: "Stretch" },
          ]}
          onCommit={(fit) => update({ fit })}
        />
      </Section>
    );
  }

  return null;
}

/** Label, required, placeholder and help — common to every input element. */
export function FieldSection({
  element,
  update,
}: {
  element: InputElement;
  update: Update["update"];
}) {
  return (
    <Section title="Field">
      <TextField
        label="Label"
        value={element.label}
        onCommit={(label) => update({ label }, "Edit label")}
      />
      <ToggleField
        label="Required"
        value={element.required}
        onCommit={(required) => update({ required })}
      />
      <TextField
        label="Placeholder"
        value={element.placeholder ?? ""}
        onCommit={(placeholder) =>
          update({ placeholder: placeholder || undefined })
        }
      />
      <TextField
        label="Help"
        value={element.help ?? ""}
        onCommit={(help) => update({ help: help || undefined })}
      />
      {element.type === "checkbox" && (
        <TextField
          label="Box label"
          value={element.boxLabel}
          onCommit={(boxLabel) => update({ boxLabel })}
        />
      )}
    </Section>
  );
}

/** Choices for a select, radio group or checkbox group. */
export function OptionsSection({
  element,
  update,
}: {
  element: Extract<
    FormElement,
    { type: "select" | "radioGroup" | "checkboxGroup" }
  >;
  update: Update["update"];
}) {
  const { options } = element;

  function replace(index: number, label: string) {
    const next = options.map((option, i) =>
      i === index
        ? { ...option, label, value: label.toLowerCase().replace(/\s+/g, "-") }
        : option,
    );
    update({ options: next }, "Edit options");
  }

  function add() {
    // Option ids are as stable as element ids — answers reference them, so a
    // new one must not collide with a previously deleted one.
    update(
      {
        options: [
          ...options,
          {
            id: `${element.id}_opt${Date.now().toString(36)}`,
            label: "New option",
            value: "new-option",
          },
        ],
      },
      "Add option",
    );
  }

  return (
    <Section title="Options">
      {options.map((option, index) => (
        <div key={option.id} className="flex items-center gap-1">
          <input
            defaultValue={option.label}
            aria-label={`Option ${index + 1}`}
            className="w-full rounded border border-black/15 bg-transparent px-2 py-1 text-xs outline-none focus:border-blue-500 dark:border-white/20"
            onBlur={(event) => {
              if (event.target.value !== option.label) {
                replace(index, event.target.value);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          <button
            type="button"
            aria-label={`Remove option ${index + 1}`}
            onClick={() =>
              update(
                { options: options.filter((_, i) => i !== index) },
                "Remove option",
              )
            }
            className="shrink-0 rounded border border-black/15 px-1.5 py-0.5 text-[10px] hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="self-start rounded border border-black/15 px-2 py-1 text-[11px] hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
      >
        Add option
      </button>
    </Section>
  );
}

export function ValidationSection({
  element,
  update,
}: {
  element: InputElement;
  update: Update["update"];
}) {
  const validation = element.validation ?? {};

  function set(patch: Record<string, number | string | undefined>) {
    const next = { ...validation, ...patch };
    // Drop empty keys so the document does not accumulate `undefined`s.
    const cleaned = Object.fromEntries(
      Object.entries(next).filter(
        ([, value]) => value !== undefined && value !== "",
      ),
    );
    update(
      { validation: Object.keys(cleaned).length > 0 ? cleaned : undefined },
      "Validation",
    );
  }

  const isText = element.type === "textInput" || element.type === "textarea";
  const isNumber = element.type === "number";
  const isDate = element.type === "date";
  const isGroup =
    element.type === "checkboxGroup" || element.type === "radioGroup";

  if (!isText && !isNumber && !isDate && !isGroup) return null;

  return (
    <Section title="Validation" defaultOpen={false}>
      {isText && (
        <>
          <NumberField
            label="Min length"
            value={validation.minLength ?? 0}
            min={0}
            onCommit={(minLength) =>
              set({ minLength: minLength === 0 ? undefined : minLength })
            }
          />
          <NumberField
            label="Max length"
            value={validation.maxLength ?? 0}
            min={0}
            onCommit={(maxLength) =>
              set({ maxLength: maxLength === 0 ? undefined : maxLength })
            }
          />
        </>
      )}
      {isNumber && (
        <>
          <NumberField
            label="Minimum"
            value={validation.min ?? 0}
            onCommit={(min) => set({ min })}
          />
          <NumberField
            label="Maximum"
            value={validation.max ?? 0}
            onCommit={(max) => set({ max })}
          />
        </>
      )}
      {isDate && (
        <>
          <TextField
            label="Earliest"
            value={validation.minDate ?? ""}
            placeholder="2026-01-01"
            onCommit={(minDate) => set({ minDate: minDate || undefined })}
          />
          <TextField
            label="Latest"
            value={validation.maxDate ?? ""}
            placeholder="2026-12-31"
            onCommit={(maxDate) => set({ maxDate: maxDate || undefined })}
          />
        </>
      )}
      {isGroup && (
        <NumberField
          label="Max chosen"
          value={validation.maxSelected ?? 0}
          min={0}
          onCommit={(maxSelected) =>
            set({ maxSelected: maxSelected === 0 ? undefined : maxSelected })
          }
        />
      )}
    </Section>
  );
}

/**
 * "Show this if <element> <operator> <value>."
 *
 * Only elements that collect an answer can be targets, and an element cannot
 * depend on itself. The rule is stored here and evaluated at fill time in
 * Slice 4 — the builder deliberately renders every element regardless.
 */
export function ConditionalSection({
  element,
  candidates,
  update,
}: {
  element: InputElement;
  candidates: readonly FormElement[];
  update: Update["update"];
}) {
  const conditional = element.conditional;
  const targets = candidates.filter(
    (candidate) => isInputElement(candidate) && candidate.id !== element.id,
  );

  return (
    <Section title="Visibility" defaultOpen={Boolean(conditional)}>
      <SelectField
        label="Show if"
        value={conditional?.targetId ?? ""}
        options={[
          { value: "", label: "Always" },
          ...targets.map((target) => ({
            value: target.id,
            label: isInputElement(target)
              ? target.label || target.id
              : target.id,
          })),
        ]}
        onCommit={(targetId) =>
          update(
            {
              conditional: targetId
                ? {
                    targetId,
                    operator: conditional?.operator ?? "equals",
                    value: conditional?.value ?? "",
                  }
                : null,
            },
            "Visibility",
          )
        }
      />
      {conditional && (
        <>
          <SelectField
            label="Operator"
            value={conditional.operator}
            options={[
              { value: "equals", label: "equals" },
              { value: "notEquals", label: "does not equal" },
              { value: "contains", label: "contains" },
              { value: "notContains", label: "does not contain" },
              { value: "isEmpty", label: "is empty" },
              { value: "isNotEmpty", label: "is not empty" },
              { value: "greaterThan", label: "is greater than" },
              { value: "lessThan", label: "is less than" },
            ]}
            onCommit={(operator) =>
              update(
                { conditional: { ...conditional, operator } },
                "Visibility",
              )
            }
          />
          {conditional.operator !== "isEmpty" &&
            conditional.operator !== "isNotEmpty" && (
              <TextField
                label="Value"
                value={String(conditional.value ?? "")}
                onCommit={(value) =>
                  update(
                    { conditional: { ...conditional, value } },
                    "Visibility",
                  )
                }
              />
            )}
        </>
      )}
      {targets.length === 0 && (
        <p className="text-[11px] opacity-50">
          Add another field to make this conditional.
        </p>
      )}
    </Section>
  );
}
