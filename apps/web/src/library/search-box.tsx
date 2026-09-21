"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Search, driven through the URL.
 *
 * The query lives in `?q=` so the list stays a server query — searching a
 * hundred forms should not mean shipping a hundred documents to the browser to
 * filter them there. It also makes a search result a link someone can keep.
 */
export function SearchBox({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(initialQuery);

  // Debounced, so typing does not fire a round trip per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set("q", value.trim());
      else next.delete("q");

      const query = next.toString();
      router.replace(query ? `/forms?${query}` : "/forms");
    }, 250);

    return () => clearTimeout(timer);
  }, [value, params, router]);

  return (
    <input
      type="search"
      value={value}
      placeholder="Search forms"
      aria-label="Search forms"
      className="w-56 rounded border border-black/15 bg-transparent px-2 py-1 text-sm outline-none focus:border-blue-500 dark:border-white/20"
      onChange={(event) => setValue(event.target.value)}
    />
  );
}
