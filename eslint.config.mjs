import js from "@eslint/js";

const eslintConfig = [
  {
    ignores: [
      ".claude/**",
      ".cursor/**",
      ".next/**",
      "node_modules/**",
      "packages/**/dist/**",
      "dist/**",
      "s12-evidence/**",
      "s13-evidence/**",
      "test-artifacts/**",
      "next-env.d.ts",
      "**/*.ts",
      "**/*.tsx",
    ],
  },
  js.configs.recommended,
  {
    // Example agents are standalone Node programs.
    files: ["examples/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", structuredClone: "readonly" },
    },
  },
];

export default eslintConfig;
