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
      "next-env.d.ts",
      "**/*.ts",
      "**/*.tsx",
    ],
  },
  js.configs.recommended,
];

export default eslintConfig;
