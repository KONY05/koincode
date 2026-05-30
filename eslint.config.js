import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  // Ignore generated and build output
  {
    ignores: [
      "**/generated/**",
      "**/dist/**",
      "**/node_modules/**",
    ],
  },

  // Base JS rules
  js.configs.recommended,

  // TypeScript rules across all packages
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Unused vars: ignore args prefixed with _, allow rest siblings
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // Allow explicit `any` in a few escape hatches but warn
      "@typescript-eslint/no-explicit-any": "warn",
      // Empty catch blocks are sometimes intentional — warn, not error
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },

  // React hooks rules for CLI package only
  {
    files: ["packages/cli/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
);
