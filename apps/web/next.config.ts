import { join } from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @formcraft/schema is consumed as TypeScript source straight out of the
  // workspace (no build step), so Next has to transpile it like app code.
  transpilePackages: ["@formcraft/schema"],

  // Emits a self-contained server with only the files actually reached, which
  // is what makes a deployable image reasonable rather than shipping the whole
  // pnpm store. Harmless locally: `next dev` and `next start` ignore it.
  output: "standalone",

  // The workspace root, not apps/web — otherwise tracing misses
  // @formcraft/schema and the server starts without the one package every
  // other part of it derives from.
  outputFileTracingRoot: join(import.meta.dirname, "../.."),

  // Playwright reads `browsers.json` at runtime rather than importing it, so
  // tracing does not see it and the standalone build ships a server that
  // starts, serves pages and exports Excel — then fails every PDF with
  // "Cannot find module browsers.json". Included for every route because the
  // PDF path is reached from the download route, the submit route's `after()`
  // and the responses page's forward action.
  outputFileTracingIncludes: {
    "/*": [
      "../../node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/browsers.json",
    ],
  },

  typescript: {
    // Never ship a build that doesn't typecheck.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
