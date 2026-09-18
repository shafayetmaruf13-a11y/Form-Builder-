import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @formcraft/schema is consumed as TypeScript source straight out of the
  // workspace (no build step), so Next has to transpile it like app code.
  transpilePackages: ["@formcraft/schema"],

  typescript: {
    // Never ship a build that doesn't typecheck.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
