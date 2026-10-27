import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // External example agents import the SDK by its package name.
      "@reeprov/client": fileURLToPath(new URL("./packages/client-typescript/src/index.ts", import.meta.url)),
    },
  },
  test: {
    exclude: [...configDefaults.exclude, ".claude/**", ".cursor/**", "packages/**"],
    fileParallelism: false,
    isolate: false,
    pool: "threads",
    testTimeout: 30000,
    setupFiles: ["./tests/setup/restoreEnv.ts"],
    retry: 1,
  },
});
