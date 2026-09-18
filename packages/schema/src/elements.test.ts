import { describe, expect, it } from "vitest";

import {
  ELEMENT_TYPES,
  INPUT_ELEMENT_TYPES,
  elementSchema,
  isInputElement,
} from "./elements";
import { PAGE_HEIGHT, PAGE_WIDTH } from "./geometry";
import { defaultStyle, styleSchema } from "./style";

const rect = { x: 10, y: 20, w: 100, h: 40 };

/** The minimum valid payload for each element type. */
const minimal: Record<
  (typeof ELEMENT_TYPES)[number],
  Record<string, unknown>
> = {
  text: { type: "text", content: "hi" },
  image: { type: "image" },
  shape: { type: "shape", shape: "rect" },
  divider: { type: "divider" },
  textInput: { type: "textInput", label: "Name" },
  textarea: { type: "textarea", label: "Notes" },
  checkbox: { type: "checkbox", label: "Agree" },
  checkboxGroup: { type: "checkboxGroup", label: "Pick", options: [] },
  radioGroup: { type: "radioGroup", label: "Pick one", options: [] },
  select: { type: "select", label: "Choose", options: [] },
  date: { type: "date", label: "When" },
  number: { type: "number", label: "How many" },
  signature: { type: "signature", label: "Sign" },
  fileUpload: { type: "fileUpload", label: "Attach" },
};

describe("the page coordinate system", () => {
  it("is A4 at 96dpi and must not drift", () => {
    // Architecture rule 2. If these change, every stored document is wrong.
    expect(PAGE_WIDTH).toBe(794);
    expect(PAGE_HEIGHT).toBe(1123);
  });
});

describe("elements", () => {
  it("parses a minimal payload for every declared type", () => {
    for (const type of ELEMENT_TYPES) {
      const result = elementSchema.safeParse({
        id: `el_${type}`,
        ...rect,
        ...minimal[type],
      });

      expect(result.success, `${type} should parse`).toBe(true);
    }
  });

  it("rejects an unknown element type", () => {
    const result = elementSchema.safeParse({
      id: "el_1",
      ...rect,
      type: "carousel",
    });

    expect(result.success).toBe(false);
  });

  it("rejects zero-area and negative geometry", () => {
    for (const bad of [{ w: 0 }, { h: 0 }, { w: -10 }]) {
      const result = elementSchema.safeParse({
        id: "el_1",
        ...rect,
        ...bad,
        type: "text",
        content: "hi",
      });

      expect(result.success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("allows an element to hang off the page", () => {
    // Deliberate: clamping here would silently move a design mid-drag. The
    // renderer clips instead.
    const result = elementSchema.safeParse({
      id: "el_1",
      x: -50,
      y: 1100,
      w: 200,
      h: 100,
      type: "text",
      content: "hi",
    });

    expect(result.success).toBe(true);
  });

  it("defaults rotation and z so geometry is always complete", () => {
    const element = elementSchema.parse({
      id: "el_1",
      ...rect,
      type: "text",
      content: "hi",
    });

    expect(element.rotation).toBe(0);
    expect(element.z).toBe(0);
  });

  it("gives every element a fully populated style", () => {
    // The renderer never has to handle a missing style field, which is what
    // keeps the browser, builder and PDF renderers identical.
    const element = elementSchema.parse({
      id: "el_1",
      ...rect,
      type: "text",
      content: "hi",
    });

    expect(element.style).toEqual(defaultStyle());
    expect(element.style.opacity).toBe(1);
    expect(element.style.fontFamily).toBe("inter");
  });

  it("keeps supplied style fields and defaults the rest", () => {
    const element = elementSchema.parse({
      id: "el_1",
      ...rect,
      type: "text",
      content: "hi",
      style: { fontSize: 32, color: "#ff0000" },
    });

    expect(element.style.fontSize).toBe(32);
    expect(element.style.color).toBe("#ff0000");
    expect(element.style.fontWeight).toBe(400);
  });

  it("separates inputs from decoration", () => {
    for (const type of ELEMENT_TYPES) {
      const element = elementSchema.parse({
        id: `el_${type}`,
        ...rect,
        ...minimal[type],
      });
      const expected = (INPUT_ELEMENT_TYPES as readonly string[]).includes(
        type,
      );

      expect(isInputElement(element), type).toBe(expected);
    }
  });

  it("defaults an input to optional and unconditional", () => {
    const element = elementSchema.parse({
      id: "el_1",
      ...rect,
      type: "textInput",
      label: "Name",
    });

    expect(element).toMatchObject({ required: false, conditional: null });
  });

  it("requires a label on an input element", () => {
    const result = elementSchema.safeParse({
      id: "el_1",
      ...rect,
      type: "textInput",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a conditional missing its target", () => {
    const result = elementSchema.safeParse({
      id: "el_1",
      ...rect,
      type: "textInput",
      label: "Why?",
      conditional: { operator: "equals", value: "yes" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unknown conditional operator", () => {
    const result = elementSchema.safeParse({
      id: "el_1",
      ...rect,
      type: "textInput",
      label: "Why?",
      conditional: { targetId: "el_2", operator: "roughlyEquals", value: 1 },
    });

    expect(result.success).toBe(false);
  });

  it("defaults an image to no upload yet", () => {
    // Slice 2 fills objectKey in; the schema must not change when it does.
    const element = elementSchema.parse({ id: "el_1", ...rect, type: "image" });

    expect(element).toMatchObject({ objectKey: null, alt: "", fit: "contain" });
  });
});

describe("style", () => {
  it("rejects a colour that is not a hex string", () => {
    for (const bad of ["red", "rgb(0,0,0)", "#12345", ""]) {
      expect(styleSchema.safeParse({ color: bad }).success, bad).toBe(false);
    }
  });

  it("accepts 3, 6 and 8 digit hex", () => {
    for (const good of ["#abc", "#aabbcc", "#aabbccdd"]) {
      expect(styleSchema.safeParse({ color: good }).success, good).toBe(true);
    }
  });

  it("rejects a font family outside the self-hosted set", () => {
    // A family absent from headless Chromium silently changes the PDF, so the
    // set is closed on purpose.
    expect(styleSchema.safeParse({ fontFamily: "Comic Sans MS" }).success).toBe(
      false,
    );
  });

  it("rejects opacity outside 0..1", () => {
    expect(styleSchema.safeParse({ opacity: 1.5 }).success).toBe(false);
    expect(styleSchema.safeParse({ opacity: -0.1 }).success).toBe(false);
  });

  it("distinguishes transparent fill from a colour", () => {
    expect(defaultStyle().fill).toBeNull();
  });
});
