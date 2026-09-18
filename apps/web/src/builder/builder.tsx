"use client";

import {
  type ElementType,
  createElement,
  emptyDocument,
  sampleDocument,
} from "@formcraft/schema";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { nanoid } from "nanoid";
import { useMemo, useRef, useState } from "react";

import { BuilderCanvas, CANVAS_DROPPABLE_ID } from "./canvas/builder-canvas";
import {
  DEFAULT_SCALE,
  screenDeltaToPage,
  screenToPage,
} from "./geometry/viewport";
import { useBuilderShortcuts } from "./keyboard/use-shortcuts";
import { ELEMENT_LABELS } from "@formcraft/schema";
import { ElementPalette, paletteTypeFromId } from "./palette/element-palette";
import { useDraftPersistence } from "./persistence/use-draft";
import { BuilderStore } from "./store/builder-store";
import { addElementCommand, moveElementsCommand } from "./store/commands";
import {
  BuilderStoreProvider,
  useActivePageId,
  useDocument,
  useHistoryState,
  useSelection,
  useBuilderStore,
} from "./store/use-builder";

/**
 * Ids for the starting document are fixed rather than generated.
 *
 * They appear in rendered `data-` attributes, so a `nanoid()` here would differ
 * between the server and client renders and trip hydration. Element ids are
 * still nanoids — those are only ever minted in response to a user gesture,
 * which is client-only by definition.
 */
const INITIAL_DOCUMENT_ID = "doc_draft";
const INITIAL_PAGE_ID = "page_1";

export function Builder() {
  // Lazy initialiser rather than a ref: the store must be created exactly once
  // per mount, and reading a ref during render is not allowed.
  const [store] = useState(
    () => new BuilderStore(emptyDocument(INITIAL_DOCUMENT_ID, INITIAL_PAGE_ID)),
  );

  return (
    <BuilderStoreProvider value={store}>
      <BuilderShell store={store} />
    </BuilderStoreProvider>
  );
}

function BuilderShell({ store }: { store: BuilderStore }) {
  const scale = DEFAULT_SCALE;
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [draggingType, setDraggingType] = useState<ElementType | null>(null);

  useBuilderShortcuts();
  useDraftPersistence(store);

  // A few pixels of movement before a drag starts, so a plain click selects
  // rather than nudging the element by one pixel.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function handleDragStart(event: DragStartEvent) {
    const type = paletteTypeFromId(String(event.active.id));
    if (type) {
      setDraggingType(type);
      return;
    }

    // Dragging an unselected element selects it first, so what moves is always
    // what is highlighted.
    const id = String(event.active.id);
    if (!store.getState().selection.includes(id)) store.select([id]);
  }

  function handleDragMove(event: DragMoveEvent) {
    if (event.active.data.current?.kind !== "element") return;

    const delta = screenDeltaToPage(event.delta, scale);
    // Only ephemeral state changes here — the document is untouched until the
    // gesture ends, which is what keeps a drag at 60fps and the undo history
    // at one entry per gesture.
    store.setDrag({
      ids: store.getState().selection,
      offset: { dx: delta.x, dy: delta.y },
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingType(null);
    store.setDrag(null);

    const type = paletteTypeFromId(String(event.active.id));
    if (type) {
      if (event.over?.id !== CANVAS_DROPPABLE_ID) return;
      dropNewElement(type, event);
      return;
    }

    if (event.active.data.current?.kind !== "element") return;

    const delta = screenDeltaToPage(event.delta, scale);
    const dx = Math.round(delta.x);
    const dy = Math.round(delta.y);
    if (dx === 0 && dy === 0) return;

    store.dispatch(moveElementsCommand(store.getState().selection, dx, dy));
  }

  function dropNewElement(type: ElementType, event: DragEndEvent) {
    const rect = pageRef.current?.getBoundingClientRect();
    if (!rect) return;

    const activator = event.activatorEvent;
    if (!(activator instanceof MouseEvent)) return;

    // Where the pointer ended up: where it went down, plus how far it moved.
    const pointer = screenToPage(
      {
        x: activator.clientX + event.delta.x,
        y: activator.clientY + event.delta.y,
      },
      rect,
      scale,
    );

    const id = nanoid();
    const { document, activePageId } = store.getState();
    const page = document.pages.find(
      (candidate) => candidate.id === activePageId,
    );
    const nextZ =
      page && page.elements.length > 0
        ? Math.max(...page.elements.map((element) => element.z)) + 1
        : 1;

    const element = createElement(type, id, { x: 0, y: 0, z: nextZ });

    // Centre the new element under the cursor, then round: a form laid out on
    // half-units is nobody's intention.
    const placed = {
      ...element,
      x: Math.round(pointer.x - element.w / 2),
      y: Math.round(pointer.y - element.h / 2),
    };

    store.dispatch(addElementCommand(activePageId, placed));
    store.select([id]);
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        setDraggingType(null);
        store.setDrag(null);
      }}
    >
      <div className="flex h-dvh flex-col">
        <BuilderToolbar />
        <div className="flex min-h-0 flex-1">
          <ElementPalette />
          <div className="min-w-0 flex-1 overflow-auto">
            <CanvasForActivePage pageRef={pageRef} scale={scale} />
          </div>
          <PropertiesPlaceholder />
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {draggingType && (
          <div className="rounded-md border border-blue-500 bg-white px-3 py-2 text-sm shadow-lg dark:bg-neutral-900">
            {ELEMENT_LABELS[draggingType]}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function CanvasForActivePage({
  pageRef,
  scale,
}: {
  pageRef: React.RefObject<HTMLDivElement | null>;
  scale: number;
}) {
  const document = useDocument();
  const activePageId = useActivePageId();
  const page =
    document.pages.find((candidate) => candidate.id === activePageId) ??
    document.pages[0];

  if (!page) return null;

  return <BuilderCanvas page={page} scale={scale} pageRef={pageRef} />;
}

function BuilderToolbar() {
  const store = useBuilderStore();
  const document = useDocument();
  const selection = useSelection();
  const { canUndo, canRedo, undoLabel, redoLabel } = useHistoryState();

  const elementCount = useMemo(
    () =>
      document.pages.reduce((total, page) => total + page.elements.length, 0),
    [document],
  );

  return (
    <header className="flex items-center gap-3 border-b border-black/10 px-4 py-2 text-sm dark:border-white/15">
      <span className="font-semibold">Formcraft</span>
      <span className="opacity-50">Slice 2a</span>

      <div className="ml-4 flex gap-1">
        <ToolbarButton
          onClick={() => {
            store.undo();
          }}
          disabled={!canUndo}
          title={
            undoLabel ? `Undo ${undoLabel.toLowerCase()}` : "Nothing to undo"
          }
        >
          Undo
        </ToolbarButton>
        <ToolbarButton
          onClick={() => {
            store.redo();
          }}
          disabled={!canRedo}
          title={
            redoLabel ? `Redo ${redoLabel.toLowerCase()}` : "Nothing to redo"
          }
        >
          Redo
        </ToolbarButton>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <span className="opacity-60">
          {elementCount} element{elementCount === 1 ? "" : "s"}
          {selection.length > 0 && ` · ${selection.length} selected`}
        </span>
        <ToolbarButton
          onClick={() => {
            store.replaceDocument(sampleDocument);
          }}
        >
          Load sample
        </ToolbarButton>
        <ToolbarButton
          onClick={() => {
            store.replaceDocument(
              emptyDocument(INITIAL_DOCUMENT_ID, INITIAL_PAGE_ID),
            );
          }}
        >
          Clear
        </ToolbarButton>
      </div>
    </header>
  );
}

function ToolbarButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded border border-black/10 px-2 py-1 text-xs hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/10"
    >
      {children}
    </button>
  );
}

function PropertiesPlaceholder() {
  const selection = useSelection();

  return (
    <aside className="hidden w-64 flex-col gap-3 border-l border-black/10 p-4 text-sm lg:flex dark:border-white/15">
      <h2 className="text-xs font-medium uppercase tracking-wide opacity-60">
        Properties
      </h2>
      <p className="text-xs opacity-60">
        {selection.length === 0
          ? "Nothing selected."
          : `${selection.length} selected.`}
      </p>
      <p className="text-xs opacity-50">
        Editing properties arrives in Slice 2c. Resize, rotate, multi-select,
        snapping and z-order arrive in 2b.
      </p>
    </aside>
  );
}
