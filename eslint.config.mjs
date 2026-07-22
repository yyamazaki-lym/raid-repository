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
    // public/ は素の静的アセット。sw.js / splash.js は Service Worker /
    // ブラウザグローバル前提の plain JS で、Next 向けルールの対象外とする。
    "public/**",
  ]),
]);

export default eslintConfig;
