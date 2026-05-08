import js from "@eslint/js";

const eslintConfig = [
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "**/*.ts", "**/*.tsx"],
  },
  js.configs.recommended,
];

export default eslintConfig;
