import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "build/**",
      ".react-router/**",
      "node_modules/**",
      "test-results/**",
      "playwright-report/**",
      ".local-models/**",
      "public/resources/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    files: ["app/core/**/*", "app/languages/**/*"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            "react",
            "react-router",
            "@mantine/*",
            "**/adapters/**",
            "**/routes/**",
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "indexedDB",
        "navigator",
        "localStorage",
        "crypto",
      ],
    },
  },
);
