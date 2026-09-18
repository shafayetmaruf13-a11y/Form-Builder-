"use client";

import { type FormElement, elementSchema } from "@formcraft/schema";
import { useCallback } from "react";

import { updateElementCommand } from "../store/commands";
import { useBuilderStore } from "../store/use-builder";

/**
 * Turns a properties-panel edit into an undoable command.
 *
 * The patch is validated here, before it becomes a command, for two reasons.
 * An invalid patch should be a no-op rather than an undo entry that does
 * nothing, and the command needs a concrete after-state so it can invert
 * itself without re-deriving anything.
 */
export function useElementUpdate(element: FormElement | undefined) {
  const store = useBuilderStore();

  const update = useCallback(
    (patch: Record<string, unknown>, label = "Edit") => {
      if (!element) return;

      const parsed = elementSchema.safeParse({ ...element, ...patch });
      if (!parsed.success) return;
      if (parsed.data === element) return;

      store.dispatch(
        updateElementCommand(element.id, element, parsed.data, label),
      );
    },
    [element, store],
  );

  const updateStyle = useCallback(
    (patch: Record<string, unknown>, label = "Style") => {
      if (!element) return;
      update({ style: { ...element.style, ...patch } }, label);
    },
    [element, update],
  );

  return { update, updateStyle };
}
