import { defineConfig } from "tsup";
import { readFileSync, writeFileSync } from "fs";

export default defineConfig({
  entry: { flow: "src/main.ts" },
  format: ["cjs"],
  target: "node20",
  clean: true,
  outExtension: () => ({ js: ".js" }),
  onSuccess: () => {
    const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
    const version = pkg.version;
    const flowPath = './dist/flow.js';
    let code = readFileSync(flowPath, 'utf-8');
    // 移除旧版本注释，注入新版本
    code = code.replace(/\/\/ FLOWPILOT_VERSION:.*\n/, '');
    code = code.replace('#!/usr/bin/env node\n', `#!/usr/bin/env node\n// FLOWPILOT_VERSION: ${version}\n`);
    writeFileSync(flowPath, code);
    console.log(`✅ 注入版本号: ${version}`);
  },
});
