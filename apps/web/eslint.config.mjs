import coreWebVitals from "eslint-config-next/core-web-vitals";
import next from "eslint-config-next/typescript";

// eslint-config-next 16 exports flat configs directly, so there's no
// FlatCompat/.eslintrc shim here.
const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      "src/db/migrations/**",
    ],
  },
  ...coreWebVitals,
  ...next,
];

export default eslintConfig;
