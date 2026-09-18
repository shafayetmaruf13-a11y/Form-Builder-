"use client";

import { isInputElement } from "@formcraft/schema";

import { setTitleCommand, updatePageCommand } from "../store/commands";
import {
  useActivePageId,
  useBuilderStore,
  useDocument,
  useElement,
  useSelection,
} from "../store/use-builder";
import { ColorField, Section, TextField } from "./controls/fields";
import {
  AppearanceSection,
  ConditionalSection,
  ContentSection,
  FieldSection,
  GeometrySection,
  OptionsSection,
  TextSection,
  ValidationSection,
} from "./sections/element-sections";
import { useElementUpdate } from "./use-element-update";
import { useLogoUpload } from "./use-logo-upload";

/**
 * The right-hand panel.
 *
 * What it shows is driven entirely by the selected element's `type`, which is
 * the schema's discriminant — so adding an element type means adding a case
 * here, not inventing a parallel notion of what that type can do.
 *
 * With nothing selected it falls back to the document and page, which is where
 * the form's title and the page background live.
 */
export function PropertiesPanel() {
  const selection = useSelection();

  return (
    <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-black/10 p-3 lg:flex dark:border-white/15">
      {selection.length === 0 ? (
        <DocumentProperties />
      ) : selection.length === 1 ? (
        <ElementProperties id={selection[0]!} />
      ) : (
        <p className="p-2 text-xs opacity-60">
          {selection.length} elements selected. Choose one to edit its
          properties.
        </p>
      )}
    </aside>
  );
}

function DocumentProperties() {
  const store = useBuilderStore();
  const document = useDocument();
  const activePageId = useActivePageId();
  const page = document.pages.find(
    (candidate) => candidate.id === activePageId,
  );

  return (
    <div className="flex flex-col">
      <Section title="Form">
        <TextField
          label="Title"
          value={document.title}
          onCommit={(title) =>
            store.dispatch(setTitleCommand(document.title, title))
          }
        />
      </Section>

      {page && (
        <Section title="Page">
          <ColorField
            label="Background"
            value={page.background}
            onCommit={(background) =>
              background &&
              store.dispatch(
                updatePageCommand(
                  page.id,
                  { background: page.background },
                  { background },
                ),
              )
            }
          />
        </Section>
      )}

      <p className="px-1 pt-2 text-[11px] opacity-50">
        Select an element to edit it.
      </p>
    </div>
  );
}

function ElementProperties({ id }: { id: string }) {
  const element = useElement(id);
  const document = useDocument();
  const activePageId = useActivePageId();
  const { update, updateStyle } = useElementUpdate(element);
  const logo = useLogoUpload();

  if (!element) return null;

  const page = document.pages.find(
    (candidate) => candidate.id === activePageId,
  );
  const isInput = isInputElement(element);
  // Text styling is meaningless on a shape or a divider; showing it would imply
  // it does something.
  const hasText = element.type !== "shape" && element.type !== "divider";

  async function pickLogo() {
    const objectKey = await logo.pick();
    if (objectKey) update({ objectKey }, "Upload image");
  }

  return (
    <div className="flex flex-col">
      <header className="flex items-baseline justify-between px-1 pb-2">
        <h2 className="text-xs font-medium">{element.type}</h2>
        <code className="font-mono text-[10px] opacity-40">{element.id}</code>
      </header>

      <ContentSection
        element={element}
        update={update}
        onPickLogo={pickLogo}
        uploading={logo.uploading}
      />

      {logo.error && (
        <p role="alert" className="px-1 pb-2 text-[11px] text-red-600">
          {logo.error}
        </p>
      )}

      {isInput && <FieldSection element={element} update={update} />}

      {(element.type === "select" ||
        element.type === "radioGroup" ||
        element.type === "checkboxGroup") && (
        <OptionsSection element={element} update={update} />
      )}

      <GeometrySection element={element} update={update} />
      <AppearanceSection element={element} updateStyle={updateStyle} />
      {hasText && <TextSection element={element} updateStyle={updateStyle} />}

      {isInput && <ValidationSection element={element} update={update} />}
      {isInput && (
        <ConditionalSection
          element={element}
          candidates={page?.elements ?? []}
          update={update}
        />
      )}

      {/* The hook's own hidden file input; opened imperatively by pickLogo. */}
      {logo.fileInput}
    </div>
  );
}
