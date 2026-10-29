import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import react from "eslint-plugin-react";

export default [
  { ignores: ["**/node_modules/**", "client/dist/**", "server/data/**"] },
  js.configs.recommended,
  {
    files: ["server/**/*.js", "shared/**/*.js", "tests/**/*.js", "eslint.config.js"],
    languageOptions: { ecmaVersion: 2023, sourceType: "module", globals: { ...globals.node } },
    rules: { "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] },
  },
  {
    files: ["client/**/*.{js,jsx}"],
    plugins: { "react-hooks": reactHooks, react },
    settings: { react: { version: "19" } },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "off",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^(_|React$)" }],
    },
  },
  {
    files: ["client/vite.config.js"],
    languageOptions: { globals: { ...globals.node } },
  },
];
