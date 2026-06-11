import { defineConfig } from "vitest/config";

// `base` must match the GitHub Pages project path (R5 in the plan): the site is
// served from https://<org>.github.io/a11y-bugs-dashboard/. A custom domain or a
// user/org *.github.io site would let this be "/".
export default defineConfig({
  base: "/a11y-bugs-dashboard/",
  test: {
    environment: "node",
    include: ["ingest/**/*.test.ts", "src/**/*.test.ts"],
  },
});
