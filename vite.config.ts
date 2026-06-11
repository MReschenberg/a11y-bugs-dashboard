import { defineConfig } from "vitest/config";

// Served at the root of the custom domain (areweaccessibleyet.com), so base is "/".
export default defineConfig({
  base: "/",
  test: {
    environment: "node",
    include: ["ingest/**/*.test.ts", "src/**/*.test.ts"],
  },
});
