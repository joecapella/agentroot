import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  {
    ignores: [
      ".next/**",
      ".venv/**",
      ".azure/**",
      "node_modules/**",
      "src/CalculatorAgent/**",
      "src/CofounderAgent/**",
      "prisma/migrations/**",
      "next-env.d.ts",
      "*.config.mjs",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];
