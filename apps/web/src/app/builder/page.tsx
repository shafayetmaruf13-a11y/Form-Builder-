import type { Metadata } from "next";

import { Builder } from "@/builder/builder";

export const metadata: Metadata = {
  title: "Builder — Formcraft",
};

/**
 * Slice 2a: the builder's skeleton.
 *
 * Drag a field from the palette onto the page, move it, delete it, undo it.
 * Nothing is persisted to the server yet — Slice 3 owns that; a localStorage
 * draft stands in so a refresh does not lose work.
 */
export default function BuilderPage() {
  return <Builder />;
}
