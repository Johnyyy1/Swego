import eslint from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import typescriptEslint from "typescript-eslint";

export default typescriptEslint.config(
  {
    ignores: [
      "**/.next/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/*.tsbuildinfo",
      "packages/db/drizzle/**",
    ],
  },
  eslint.configs.recommended,
  ...typescriptEslint.configs.recommended,
  ...nextVitals,
  ...nextTypeScript,
  {
    settings: {
      next: {
        rootDir: "apps/web/",
      },
      react: {
        version: "19.2",
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  prettier,
);
