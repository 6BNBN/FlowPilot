import { defineConfig } from "tsup";
import { cpSync, mkdirSync } from "fs";

export default defineConfig({
  entry: { flow: "src/main.ts" },
  format: ["cjs"],
  target: "node20",
  clean: true,
  outExtension: () => ({ js: ".js" }),
  onSuccess: async () => {
    mkdirSync("dist/templates", { recursive: true });
    cpSync("src/templates/protocol.md", "dist/templates/protocol.md");
  },
});
