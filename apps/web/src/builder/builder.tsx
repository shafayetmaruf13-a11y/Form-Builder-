"use client";

import {
  ELEMENT_LABELS,
  type ElementType,
  type ZDirection,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BuilderCanvas, CANVAS_DROPPABLE_ID } from "./canvas/builder-canvas";
import {
  SNAP_THRESHOLD_PX,
  type SnapCandidates,
  collectSnapCandidates,
  resolveSnap,
  snapToGrid,
} from "./geometry/snapping";
import { type Rect, boundsOf } from "./geometry/transform";
import {
  ZOOM_LEVELS,
  screenDeltaToPage,
  screenToPage,
} from "./geometry/viewport";
import { useBuilderShortcuts } from "./keyboard/use-shortcuts";
import { ElementPalette, paletteTypeFromId } from "./palette/element-palette";
import { useDraftPersistence } from "./persistence/use-draft";
import { BuilderStore } from "./store/builder-store";
import {
  addElementCommand,
  moveElementsCommand,
  reorderZCommand,
} from "./store/commands";
import {
  BuilderStoreProvider,
  useActivePageId,
  useBuilderStore,
  useDocument,
  useHistoryState,
  useScale,
  useSelection,
  useSnapEnabled,
} from "./store/use-builder";

/**
 * Ids for the starting document are fixed rather than generated: they appear in
 * rendered `data-` attributes, so a `nanoid()` here would differ between server
 * and client renders and trip hydration. Element ids are still nanoids, minted
 * only in response to a gesture.
 */
const INITIAL_DOCUMENT_ID = "doc_draft";
const INITIAL_PAGE_ID = "page_1";

export function Builder() {
  const [store] = useState(
    () => new BuilderStore(emptyDocument(INITIAL_DOCUMENT_ID, INITIAL_PAGE_ID)),
  );

  return (
    <BuilderStoreProvider value={store}>
      <BuilderShell store={store} />
    </BuilderStoreProvider>
  );
}

/** What a move gesture needs to know, captured once when it starts. */
interface MoveContext {
  ids: readonly string[];
  bounds: Rect;
  candidates: SnapCandidates;
}

function BuilderShell({ store }: { store: BuilderStore }) {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const moveContext = useRef<MoveContext | null>(null);
  const [draggingType, setDraggingType] = useState<ElementType | null>(null);

  useBuilderShortcuts();
  useDraftPersistence(store);

  const sensors = useSensors(
    // A few pixels of movement before a drag starts, so a plain click selects
    // rather than nudging the element by a pixel.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function handleDragStart(event: DragStartEvent) {
    const type = paletteTypeFromId(String(event.active.id));
    if (type) {
      setDraggingType(type);
      return;
    }

    const id = String(event.active.id);
    if (!store.getState().selection.includes(id)) store.select([id]);

    const { selection, document, activePageId } = store.getState();
    const page = document.pages.find(
      (candidate) => candidate.id === activePageId,
    );
    const moving = new Set(selection);
    const bounds = boundsOf(
      (page?.elements ?? []).filter((element) => moving.has(element.id)),
    );
    if (!page || !bounds) return;

    // Candidates are collected once, here — recomputing every other element's
    // edges on each frame is the difference between a smooth drag and a janky
    // one once a page has a hundred elements on it.
    moveContext.current = {
      ids: selection,
      bounds,
      candidates: collectSnapCandidates(page.elements, selection),
    };
  }

  function handleDragMove(event: DragMoveEvent) {
    const context = moveContext.current;
    if (!context || event.active.data.current?.kind !== "element") return;

    const { scale, snapEnabled } = store.getState();
    const raw = screenDeltaToPage(event.delta, scale);

    const proposed = {
      ...context.bounds,
      x: context.bounds.x + raw.x,
      y: context.bounds.y + raw.y,
    };

    // Alignment first: lining up with a neighbour beats the grid, because it
    // is what the designer was aiming at. The grid only takes over on an axis
    // where nothing was near enough to align to.
    const snap = snapEnabled
      ? resolveSnap(proposed, context.candidates, SNAP_THRESHOLD_PX / scale)
      : { dx: 0, dy: 0, guides: [] };

    let dx = raw.x + snap.dx;
    let dy = raw.y + snap.dy;

    if (snapEnabled) {
      if (snap.dx === 0)
        dx = snapToGrid(context.bounds.x + raw.x) - context.bounds.x;
      if (snap.dy === 0)
        dy = snapToGrid(context.bounds.y + raw.y) - context.bounds.y;
    }

    // Only ephemeral state changes here — the document is untouched until the
    // gesture ends, which keeps the drag at 60fps and the undo history at one
    // entry per gesture.
    store.setMove(context.ids, { dx, dy }, snap.guides);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingType(null);

    const gesture = store.getState().gesture;
    const context = moveContext.current;
    moveContext.current = null;
    store.setGesture(null);

    const type = paletteTypeFromId(String(event.active.id));
    if (type) {
      if (event.over?.id !== CANVAS_DROPPABLE_ID) return;
      dropNewElement(type, event);
      return;
    }

    if (!context || gesture?.kind !== "move") return;

    // Commit exactly what was on screen, including any snap correction.
    const dx = Math.round(gesture.offset.dx);
    const dy = Math.round(gesture.offset.dy);
    if (dx === 0 && dy === 0) return;

    store.dispatch(moveElementsCommand(context.ids, dx, dy));
  }

  function dropNewElement(type: ElementType, event: DragEndEvent) {
    const rect = pageRef.current?.getBoundingClientRect();
    if (!rect) return;

    const activator = event.activatorEvent;
    if (!(activator instanceof MouseEvent)) return;

    const { scale, snapEnabled, document, activePageId } = store.getState();

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
    const page = document.pages.find(
      (candidate) => candidate.id === activePageId,
    );
    const nextZ =
      page && page.elements.length > 0
        ? Math.max(...page.elements.map((element) => element.z)) + 1
        : 1;

    const element = createElement(type, id, { x: 0, y: 0, z: nextZ });

    // Centre the new element under the cursor, then tidy it onto the grid.
    const x = pointer.x - element.w / 2;
    const y = pointer.y - element.h / 2;

    store.dispatch(
      addElementCommand(activePageId, {
        ...element,
        x: snapEnabled ? snapToGrid(x) : Math.round(x),
        y: snapEnabled ? snapToGrid(y) : Math.round(y),
      }),
    );
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
        moveContext.current = null;
        store.setGesture(null);
      }}
    >
      <div className="flex h-dvh flex-col">
        <BuilderToolbar />
        <div className="flex min-h-0 flex-1">
          <ElementPalette />
          <ScrollableCanvas pageRef={pageRef} />
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

/**
 * The scrolling viewport around the page.
 *
 * Panning is scrolling — holding space turns the pointer into a grab handle
 * that moves the scroll position. Building a separate pan transform would mean
 * a second way for the page to be positioned, and the whole architecture rests
 * on there being one.
 */
function ScrollableCanvas({
  pageRef,
}: {
  pageRef: React.RefObject<HTMLDivElement | null>;
}) {
  const store = useBuilderStore();
  const document = useDocument();
  const activePageId = useActivePageId();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const panning = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);

  const page =
    document.pages.find((candidate) => candidate.id === activePageId) ??
    document.pages[0];

  // Stable identity so the listener is registered once, not on every render.
  useSpaceKey(useCallback((held: boolean) => setSpaceHeld(held), []));

  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    // Ctrl+wheel is the browser's pinch-zoom gesture on a trackpad, so this is
    // what users expect zoom to be bound to.
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    store.zoomBy(event.deltaY < 0 ? 1 : -1);
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!spaceHeld || !scrollRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panning.current = {
      x: event.clientX,
      y: event.clientY,
      left: scrollRef.current.scrollLeft,
      top: scrollRef.current.scrollTop,
    };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const pan = panning.current;
    if (!pan || !scrollRef.current) return;
    scrollRef.current.scrollLeft = pan.left - (event.clientX - pan.x);
    scrollRef.current.scrollTop = pan.top - (event.clientY - pan.y);
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>) {
    if (!panning.current) return;
    panning.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  if (!page) return null;

  return (
    <div
      ref={scrollRef}
      className="min-w-0 flex-1 overflow-auto"
      onWheel={onWheel}
      onPointerDownCapture={onPointerDown}
      onPointerMoveCapture={onPointerMove}
      onPointerUpCapture={endPan}
      onPointerCancelCapture={endPan}
      style={{ cursor: spaceHeld ? "grab" : undefined }}
    >
      <BuilderCanvas page={page} pageRef={pageRef} />
    </div>
  );
}

/**
 * Tracks the space bar, which turns the canvas into a pan surface.
 *
 * Space is swallowed while held so it cannot also scroll the page, but only
 * when focus is not in a text field — where a space is just a space.
 */
function useSpaceKey(setHeld: (held: boolean) => void) {
  useEffect(() => {
    function down(event: KeyboardEvent) {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      setHeld(true);
    }

    function up(event: KeyboardEvent) {
      if (event.code === "Space") setHeld(false);
    }

    // Releasing space outside the window would otherwise leave the canvas
    // stuck in pan mode.
    function blur() {
      setHeld(false);
    }

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [setHeld]);
}

function BuilderToolbar() {
  const store = useBuilderStore();
  const document = useDocument();
  const selection = useSelection();
  const scale = useScale();
  const snapEnabled = useSnapEnabled();
  const { canUndo, canRedo, undoLabel, redoLabel } = useHistoryState();

  const elementCount = useMemo(
    () =>
      document.pages.reduce((total, page) => total + page.elements.length, 0),
    [document],
  );

  function restack(direction: ZDirection) {
    const { selection: ids, document: current } = store.getState();
    if (ids.length === 0) return;
    store.dispatch(reorderZCommand(current, ids, direction));
  }

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-black/10 px-4 py-2 text-sm dark:border-white/15">
      <span className="font-semibold">Formcraft</span>
      <span className="opacity-50">Slice 2b</span>

      <Divider />

      <div className="flex gap-1">
        <ToolbarButton
          onClick={() => store.undo()}
          disabled={!canUndo}
          title={
            undoLabel ? `Undo ${undoLabel.toLowerCase()}` : "Nothing to undo"
          }
        >
          Undo
        </ToolbarButton>
        <ToolbarButton
          onClick={() => store.redo()}
          disabled={!canRedo}
          title={
            redoLabel ? `Redo ${redoLabel.toLowerCase()}` : "Nothing to redo"
          }
        >
          Redo
        </ToolbarButton>
      </div>

      <Divider />

      <div className="flex gap-1">
        <ToolbarButton
          onClick={() => restack("back")}
          disabled={selection.length === 0}
          title="Send to back (⌘⇧[)"
        >
          Back
        </ToolbarButton>
        <ToolbarButton
          onClick={() => restack("backward")}
          disabled={selection.length === 0}
          title="Send backward (⌘[)"
        >
          −
        </ToolbarButton>
        <ToolbarButton
          onClick={() => restack("forward")}
          disabled={selection.length === 0}
          title="Bring forward (⌘])"
        >
          +
        </ToolbarButton>
        <ToolbarButton
          onClick={() => restack("front")}
          disabled={selection.length === 0}
          title="Bring to front (⌘⇧])"
        >
          Front
        </ToolbarButton>
      </div>

      <Divider />

      <div className="flex items-center gap-1">
        <ToolbarButton onClick={() => store.zoomBy(-1)} title="Zoom out (⌘−)">
          −
        </ToolbarButton>
        <select
          value={String(scale)}
          onChange={(event) => store.setScale(Number(event.target.value))}
          aria-label="Zoom"
          className="rounded border border-black/10 bg-transparent px-1 py-1 text-xs dark:border-white/15"
        >
          {ZOOM_LEVELS.map((level) => (
            <option key={level} value={level}>
              {Math.round(level * 100)}%
            </option>
          ))}
        </select>
        <ToolbarButton onClick={() => store.zoomBy(1)} title="Zoom in (⌘+)">
          +
        </ToolbarButton>
      </div>

      <ToolbarButton
        onClick={() => store.toggleSnap()}
        title="Snap to grid and alignment guides"
      >
        Snap {snapEnabled ? "on" : "off"}
      </ToolbarButton>

      <div className="ml-auto flex items-center gap-3">
        <span className="opacity-60">
          {elementCount} element{elementCount === 1 ? "" : "s"}
          {selection.length > 0 && ` · ${selection.length} selected`}
        </span>
        <ToolbarButton onClick={() => store.replaceDocument(sampleDocument)}>
          Load sample
        </ToolbarButton>
        <ToolbarButton
          onClick={() =>
            store.replaceDocument(
              emptyDocument(INITIAL_DOCUMENT_ID, INITIAL_PAGE_ID),
            )
          }
        >
          Clear
        </ToolbarButton>
      </div>
    </header>
  );
}

function Divider() {
  return <span className="h-4 w-px bg-black/10 dark:bg-white/15" />;
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
        Editing properties, multi-page and logo upload arrive in Slice 2c.
      </p>
    </aside>
  );
}
