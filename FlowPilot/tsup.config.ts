import { defineConfig } from "tsup";

export default defineConfig({
  entry: { flow: "src/main.ts" },
  format: ["cjs"],
  target: "node20",
  clean: true,
  outExtension: () => ({ js: ".js" }),
});
