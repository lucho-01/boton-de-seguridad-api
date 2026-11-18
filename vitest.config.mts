import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./app", import.meta.url)),
      "@ia": fileURLToPath(new URL("./ia", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["ia/**/*.test.ts", "tests/**/*.test.ts", "app/**/tests/**/*.test.ts"],
  },
});
