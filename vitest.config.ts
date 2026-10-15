import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    exclude: [...configDefaults.exclude, ".claude/**", ".cursor/**", "packages/**"],
    fileParallelism: false,
    isolate: false,
    pool: "threads",
    testTimeout: 30000,
    retry: 1,
  },
});
