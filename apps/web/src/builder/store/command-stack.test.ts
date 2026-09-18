import {
  SCHEMA_VERSION,
  createElement,
  findElement,
  formDocumentSchema,
} from "@formcraft/schema";
import { describe, expect, it } from "vitest";

import { CommandStack, MERGE_WINDOW_MS } from "./command-stack";
import {
  addElementCommand,
  deleteElementsCommand,
  moveElementsCommand,
} from "./commands";

function doc(ids: string[] = []) {
  return formDocumentSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: "doc_1",
    title: "Test",
    pages: [
      {
        id: "page_1",
        elements: ids.map((id, index) =>
          createElement("text", id, { x: index * 10, y: index * 10 }),
        ),
      },
    ],
  });
}

describe("undo restores the exact prior document", () => {
  // The property that matters most: whatever a command did, undoing it must
  // land on a document equal to the one before. Everything else is detail.

  it("for a move", () => {
    const before = doc(["el_a"]);
    const stack = new CommandStack();

    const after = stack.execute(before, moveElementsCommand(["el_a"], 25, -10));
    expect(after).not.toEqual(before);
    expect(stack.undo(after)).toEqual(before);
  });

  it("for an add", () => {
    const before = doc([]);
    const stack = new CommandStack();
    const element = createElement("textInput", "el_new", { x: 40, y: 40 });

    const after = stack.execute(before, addElementCommand("page_1", element));
    expect(after.pages[0]?.elements).toHaveLength(1);
    expect(stack.undo(after)).toEqual(before);
  });

  it("for a delete from the middle of a page", () => {
    const before = doc(["el_a", "el_b", "el_c"]);
    const stack = new CommandStack();

    const after = stack.execute(
      before,
      deleteElementsCommand(before, ["el_b"]),
    );
    expect(after.pages[0]?.elements.map((e) => e.id)).toEqual(["el_a", "el_c"]);

    const undone = stack.undo(after);
    expect(undone).toEqual(before);
    expect(undone.pages[0]?.elements.map((e) => e.id)).toEqual([
      "el_a",
      "el_b",
      "el_c",
    ]);
  });

  it("for a stack of mixed edits unwound in order", () => {
    const start = doc(["el_a"]);
    const stack = new CommandStack();
    const element = createElement("shape", "el_new", { x: 10, y: 10 });

    let current = stack.execute(start, moveElementsCommand(["el_a"], 5, 5));
    const afterMove = current;
    current = stack.execute(current, addElementCommand("page_1", element));
    current = stack.execute(current, deleteElementsCommand(current, ["el_a"]));

    current = stack.undo(current);
    expect(current.pages[0]?.elements.map((e) => e.id)).toEqual([
      "el_a",
      "el_new",
    ]);

    current = stack.undo(current);
    expect(current).toEqual(afterMove);

    current = stack.undo(current);
    expect(current).toEqual(start);
    expect(stack.canUndo).toBe(false);
  });
});

describe("redo", () => {
  it("reapplies an undone edit", () => {
    const before = doc(["el_a"]);
    const stack = new CommandStack();

    const after = stack.execute(before, moveElementsCommand(["el_a"], 10, 10));
    const undone = stack.undo(after);

    expect(stack.canRedo).toBe(true);
    expect(stack.redo(undone)).toEqual(after);
  });

  it("is discarded once a new edit happens", () => {
    const before = doc(["el_a"]);
    const stack = new CommandStack();

    const moved = stack.execute(before, moveElementsCommand(["el_a"], 10, 0));
    const undone = stack.undo(moved);
    expect(stack.canRedo).toBe(true);

    stack.execute(undone, moveElementsCommand(["el_a"], 0, 99));
    expect(stack.canRedo).toBe(false);
  });

  it("does nothing on an empty stack", () => {
    const before = doc(["el_a"]);
    const stack = new CommandStack();

    expect(stack.undo(before)).toBe(before);
    expect(stack.redo(before)).toBe(before);
  });
});

describe("merging", () => {
  // A drag or a held arrow key produces a burst of commands. One gesture should
  // be one undo.

  it("collapses consecutive moves of the same elements", () => {
    const before = doc(["el_a"]);
    const stack = new CommandStack();

    let current = stack.execute(before, moveElementsCommand(["el_a"], 1, 0), 0);
    current = stack.execute(current, moveElementsCommand(["el_a"], 1, 0), 100);
    current = stack.execute(current, moveElementsCommand(["el_a"], 1, 0), 200);

    expect(findElement(current, "el_a")).toMatchObject({ x: 3 });
    expect(stack.depth).toBe(1);
    expect(stack.undo(current)).toEqual(before);
  });

  it("does not merge across the time window", () => {
    const before = doc(["el_a"]);
    const stack = new CommandStack();

    let current = stack.execute(before, moveElementsCommand(["el_a"], 1, 0), 0);
    current = stack.execute(
      current,
      moveElementsCommand(["el_a"], 1, 0),
      MERGE_WINDOW_MS + 1,
    );

    expect(stack.depth).toBe(2);
    expect(findElement(stack.undo(current), "el_a")).toMatchObject({ x: 1 });
  });

  it("does not merge moves of different elements", () => {
    const before = doc(["el_a", "el_b"]);
    const stack = new CommandStack();

    let current = stack.execute(before, moveElementsCommand(["el_a"], 1, 0), 0);
    current = stack.execute(current, moveElementsCommand(["el_b"], 1, 0), 10);

    expect(stack.depth).toBe(2);
    expect(findElement(current, "el_b")).toMatchObject({ x: 11 });
    expect(findElement(stack.undo(current), "el_b")).toMatchObject({ x: 10 });
  });

  it("merges regardless of the order ids are given in", () => {
    const before = doc(["el_a", "el_b"]);
    const stack = new CommandStack();

    let current = stack.execute(
      before,
      moveElementsCommand(["el_a", "el_b"], 1, 0),
      0,
    );
    current = stack.execute(
      current,
      moveElementsCommand(["el_b", "el_a"], 1, 0),
      10,
    );

    expect(stack.depth).toBe(1);
    expect(stack.undo(current)).toEqual(before);
  });

  it("never merges adds or deletes", () => {
    const before = doc([]);
    const stack = new CommandStack();

    let current = stack.execute(
      before,
      addElementCommand(
        "page_1",
        createElement("text", "el_1", { x: 0, y: 0 }),
      ),
      0,
    );
    current = stack.execute(
      current,
      addElementCommand(
        "page_1",
        createElement("text", "el_2", { x: 0, y: 0 }),
      ),
      10,
    );

    expect(stack.depth).toBe(2);
    expect(current.pages[0]?.elements.map((e) => e.id)).toEqual([
      "el_1",
      "el_2",
    ]);
    expect(stack.undo(current).pages[0]?.elements.map((e) => e.id)).toEqual([
      "el_1",
    ]);
  });

  it("does not let a redone command merge with what follows it", () => {
    const before = doc(["el_a"]);
    const stack = new CommandStack();

    const moved = stack.execute(before, moveElementsCommand(["el_a"], 5, 0), 0);
    const undone = stack.undo(moved);
    const redone = stack.redo(undone, 1000);

    const current = stack.execute(
      redone,
      moveElementsCommand(["el_a"], 5, 0),
      1000 + MERGE_WINDOW_MS + 1,
    );

    expect(stack.depth).toBe(2);
    expect(stack.undo(current)).toEqual(moved);
  });
});

describe("labels and clearing", () => {
  it("reports what undo and redo would do", () => {
    const before = doc(["el_a"]);
    const stack = new CommandStack();

    expect(stack.undoLabel).toBeNull();

    const after = stack.execute(
      before,
      deleteElementsCommand(before, ["el_a"]),
    );
    expect(stack.undoLabel).toBe("Delete element");

    stack.undo(after);
    expect(stack.redoLabel).toBe("Delete element");
  });

  it("clears both directions", () => {
    const before = doc(["el_a"]);
    const stack = new CommandStack();

    const after = stack.execute(before, moveElementsCommand(["el_a"], 1, 1));
    stack.undo(after);
    stack.clear();

    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
  });
});
