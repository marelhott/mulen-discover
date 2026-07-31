import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["app/api/**/*.ts", "scripts/**/*.ts"],
    rules: {
      // These files are boundary adapters for RSS, TMDB and other untyped APIs.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["components/FeedTab.tsx", "components/MovieGrid.tsx", "components/NewsTab.tsx"],
    rules: {
      // These three legacy caches will be migrated to a shared query store in a
      // follow-up; keep the rule active everywhere else.
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
    },
  },
]);

export default eslintConfig;
