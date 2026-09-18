"use client";

import {
  ELEMENT_LABELS,
  INPUT_ELEMENT_TYPES,
  STATIC_ELEMENT_TYPES,
  type ElementType,
} from "@formcraft/schema";
import { useDraggable } from "@dnd-kit/core";

export const PALETTE_PREFIX = "palette:";

/** Reads the element type back out of a palette draggable's id. */
export function paletteTypeFromId(id: string): ElementType | null {
  if (!id.startsWith(PALETTE_PREFIX)) return null;
  return id.slice(PALETTE_PREFIX.length) as ElementType;
}

export function ElementPalette() {
  return (
    <div className="flex h-full w-56 flex-col gap-6 overflow-y-auto border-r border-black/10 p-4 dark:border-white/15">
      <Group title="Content" types={STATIC_ELEMENT_TYPES} />
      <Group title="Fields" types={INPUT_ELEMENT_TYPES} />
    </div>
  );
}

function Group({
  title,
  types,
}: {
  title: string;
  types: readonly ElementType[];
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-medium uppercase tracking-wide opacity-60">
        {title}
      </h2>
      <div className="flex flex-col gap-1">
        {types.map((type) => (
          <PaletteItem key={type} type={type} />
        ))}
      </div>
    </section>
  );
}

function PaletteItem({ type }: { type: ElementType }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${PALETTE_PREFIX}${type}`,
    data: { kind: "palette", type },
  });

  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      type="button"
      className="cursor-grab rounded-md border border-black/10 px-3 py-2 text-left text-sm hover:bg-black/5 active:cursor-grabbing dark:border-white/15 dark:hover:bg-white/10"
      style={{
        // The real feedback is the drag overlay following the cursor; fading
        // the source makes it clear which item is in flight.
        opacity: isDragging ? 0.4 : 1,
        touchAction: "none",
      }}
    >
      {ELEMENT_LABELS[type]}
    </button>
  );
}
