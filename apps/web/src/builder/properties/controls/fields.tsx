"use client";

import { useId, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * The properties panel's form controls.
 *
 * Native elements throughout. shadcn/ui is the project's component library and
 * these follow its shape — a `cn`-merged className, a stable generated id
 * pairing label and control — but its registry (ui.shadcn.com) is blocked by
 * this environment's network policy, so the Radix-backed versions could not be
 * pulled in. `components.json` and `cn()` are in place, so `npx shadcn add`
 * drops them in unchanged once that host is reachable.
 *
 * Native `<select>` and `<input type="color">` are no loss here: both are
 * accessible by default and open the platform's own pickers, which is what a
 * properties panel wants.
 */

const controlClass =
  "w-full rounded border border-black/15 bg-transparent px-2 py-1 text-xs outline-none focus:border-blue-500 dark:border-white/20";

function Row({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="grid grid-cols-[4.5rem_1fr] items-center gap-2"
    >
      <span className="truncate text-[11px] opacity-70">{label}</span>
      {children}
    </label>
  );
}

/**
 * A committed text input.
 *
 * Keeps its own draft while focused and reports on blur or Enter, so typing
 * does not re-parse the document on every keystroke. Escape abandons the edit.
 */
export function TextField({
  label,
  value,
  onCommit,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const [seen, setSeen] = useState(value);

  // Adopt external changes — an undo, or a different element selected — unless
  // the user is mid-edit, where clobbering their typing would be maddening.
  //
  // Adjusted during render rather than in an effect: React re-runs this
  // component before touching the DOM, so there is no flash of the stale value
  // and no cascading render.
  if (value !== seen) {
    setSeen(value);
    if (!editing) setDraft(value);
  }

  const common = {
    id,
    value: draft,
    placeholder,
    className: cn(controlClass, multiline && "h-16 resize-none"),
    onFocus: () => setEditing(true),
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => setDraft(event.target.value),
    onBlur: () => {
      setEditing(false);
      if (draft !== value) onCommit(draft);
    },
  };

  return (
    <Row label={label} htmlFor={id}>
      {multiline ? (
        <textarea {...common} />
      ) : (
        <input
          {...common}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setDraft(value);
              setEditing(false);
              event.currentTarget.blur();
            }
          }}
        />
      )}
    </Row>
  );
}

/** A numeric input that only commits values the schema will accept. */
export function NumberField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  const [seen, setSeen] = useState(value);

  if (value !== seen) {
    setSeen(value);
    if (!editing) setDraft(String(value));
  }

  function commit() {
    setEditing(false);
    const parsed = Number(draft);

    // A half-typed "-" or an empty box is not a value; put the old one back
    // rather than committing NaN and letting the schema silently reject it.
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }

    const clamped = Math.min(
      max ?? Infinity,
      Math.max(min ?? -Infinity, parsed),
    );
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  }

  return (
    <Row label={label} htmlFor={id}>
      <div className="relative">
        <input
          id={id}
          type="number"
          value={draft}
          min={min}
          max={max}
          step={step}
          className={cn(controlClass, suffix && "pr-6")}
          onFocus={() => setEditing(true)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] opacity-50">
            {suffix}
          </span>
        )}
      </div>
    </Row>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onCommit,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onCommit: (value: T) => void;
}) {
  const id = useId();

  return (
    <Row label={label} htmlFor={id}>
      <select
        id={id}
        value={value}
        className={controlClass}
        onChange={(event) => onCommit(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

export function ToggleField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: boolean;
  onCommit: (value: boolean) => void;
}) {
  const id = useId();

  return (
    <Row label={label} htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={value}
        className="h-3.5 w-3.5 justify-self-start accent-blue-600"
        onChange={(event) => onCommit(event.target.checked)}
      />
    </Row>
  );
}

const SWATCHES = [
  "#000000",
  "#ffffff",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#2563eb",
  "#7c3aed",
  "#64748b",
  "#e2e8f0",
];

/**
 * Colour, as a swatch plus a hex field, with an optional transparent state.
 *
 * `null` is transparent and is not the same as white — a shape with no fill
 * shows what is behind it, and the PDF must reproduce that. So the control has
 * an explicit clear rather than letting the absence of a colour be implied.
 */
export function ColorField({
  label,
  value,
  onCommit,
  clearable,
}: {
  label: string;
  value: string | null;
  onCommit: (value: string | null) => void;
  clearable?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value ?? "");
  const [seen, setSeen] = useState(value);

  if (value !== seen) {
    setSeen(value);
    setDraft(value ?? "");
  }

  function commitHex(text: string) {
    const trimmed = text.trim();
    if (trimmed === "" && clearable) {
      onCommit(null);
      return;
    }
    const hex = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
    if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(hex)) {
      onCommit(hex);
    } else {
      setDraft(value ?? "");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Row label={label} htmlFor={id}>
        <div className="flex items-center gap-1">
          <input
            id={id}
            type="color"
            value={value ?? "#ffffff"}
            className="h-6 w-7 shrink-0 cursor-pointer rounded border border-black/15 bg-transparent dark:border-white/20"
            onChange={(event) => onCommit(event.target.value)}
          />
          <input
            value={draft}
            placeholder={clearable ? "none" : "#000000"}
            className={cn(controlClass, "font-mono")}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => commitHex(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
          {clearable && (
            <button
              type="button"
              title="No colour"
              onClick={() => onCommit(null)}
              className="shrink-0 rounded border border-black/15 px-1.5 py-0.5 text-[10px] hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              ✕
            </button>
          )}
        </div>
      </Row>
      <div className="col-start-2 flex flex-wrap gap-1 pl-[5rem]">
        {SWATCHES.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={swatch}
            title={swatch}
            onClick={() => onCommit(swatch)}
            className="h-3.5 w-3.5 rounded-sm border border-black/20 dark:border-white/20"
            style={{ backgroundColor: swatch }}
          />
        ))}
      </div>
    </div>
  );
}

/** A collapsible group of related properties. */
export function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group">
      <summary className="cursor-pointer list-none py-1.5 text-[11px] font-medium uppercase tracking-wide opacity-60 marker:content-none">
        {title}
      </summary>
      <div className="flex flex-col gap-1.5 pb-3">{children}</div>
    </details>
  );
}
