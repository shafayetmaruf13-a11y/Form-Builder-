import {
  ELEMENT_TYPES,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  allElements,
  inputElements,
  sampleDocument,
} from "@formcraft/schema";
import Link from "next/link";

import { FormRenderer } from "@/components/renderer/form-renderer";

/**
 * Slice 1's proof.
 *
 * The same document is rendered twice at different scales. Nothing about the
 * document changes between them and no element knows its own scale — which is
 * the claim architecture rule 2 makes, shown rather than asserted. At Slice 5
 * the PDF worker becomes a third renderer of this same object at scale 1.
 */
export default function Home() {
  const elements = allElements(sampleDocument);
  const inputs = inputElements(sampleDocument);
  const typesPresent = new Set(elements.map((element) => element.type));

  return (
    <main className="mx-auto flex max-w-[1100px] flex-col gap-8 p-6 sm:p-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Form renderer</h1>
        <p className="mt-2 max-w-2xl text-sm opacity-70">
          Slice 1 — the document schema and a read-only renderer. The page below
          is drawn entirely from a JSON document validated by{" "}
          <code className="font-mono">@formcraft/schema</code>. There is no
          builder and no database in this path.
        </p>
      </header>

      <section className="flex flex-wrap gap-6 text-sm">
        <Stat label="Page units" value={`${PAGE_WIDTH} × ${PAGE_HEIGHT}`} />
        <Stat label="Elements" value={String(elements.length)} />
        <Stat label="Inputs" value={`${inputs.length} of ${elements.length}`} />
        <Stat
          label="Types covered"
          value={`${typesPresent.size} of ${ELEMENT_TYPES.length}`}
        />
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
            Scale 1.0
          </h2>
          <p className="mt-1 text-xs opacity-60">
            Exactly the coordinates stored in the document. This is what the PDF
            worker will render at Slice 5.
          </p>
        </div>
        <div className="overflow-x-auto">
          <div className="w-fit rounded-md border border-black/10 shadow-sm dark:border-white/15">
            <FormRenderer document={sampleDocument} />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
            Scale 0.25
          </h2>
          <p className="mt-1 text-xs opacity-60">
            The identical document and the identical component. Only the page
            surface is scaled — no element was told about it, and nothing was
            re-laid out. This is the thumbnail Slice 3 will use.
          </p>
        </div>
        <div className="w-fit rounded-md border border-black/10 shadow-sm dark:border-white/15">
          <FormRenderer document={sampleDocument} scale={0.25} />
        </div>
      </section>

      <footer className="border-t border-black/10 pt-6 text-xs opacity-60 dark:border-white/15">
        <p>
          Conditional rules are stored but not evaluated here: a design preview
          shows what was built, not what a filler would see. One element (
          <code className="font-mono">Which country?</code>) carries a condition
          to prove the schema round-trips it.
        </p>
        <p className="mt-2">
          Environment check at{" "}
          <Link className="underline" href="/health">
            /health
          </Link>
          .
        </p>
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-black/10 px-4 py-3 dark:border-white/15">
      <div className="text-xs uppercase tracking-wide opacity-60">{label}</div>
      <div className="mt-1 font-mono text-base">{value}</div>
    </div>
  );
}
