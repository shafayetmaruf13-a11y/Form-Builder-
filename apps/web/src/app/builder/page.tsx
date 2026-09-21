import { redirect } from "next/navigation";

/**
 * The standalone builder from Slice 2.
 *
 * Every form now lives at `/forms/[id]`, because a builder that saves nowhere
 * has no reason to exist once saving works. Kept as a redirect so bookmarks and
 * the Slice 2 notes still land somewhere sensible.
 */
export default function BuilderRedirect() {
  redirect("/forms");
}
