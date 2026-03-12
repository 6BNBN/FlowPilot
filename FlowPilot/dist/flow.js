#!/usr/bin/env node
"use strict";

// src/infrastructure/fs-repository.ts
var import_promises2 = require("fs/promises");
var import_path2 = require("path");
var import_fs2 = require("fs");
var import_os2 = require("os");

// src/infrastructure/git.ts
var import_node_child_process = require("child_process");
var import_node_fs = require("fs");
var import_node_path = require("path");
var FLOWPILOT_RUNTIME_PREFIXES = [".flowpilot/", ".workflow/"];
var FLOWPILOT_RUNTIME_FILES = /* @__PURE__ */ new Set([".claude/settings.json"]);
function normalizeGitPath(file) {
  return file.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}
function isFlowPilotRuntimePath(file) {
  const norm = normalizeGitPath(file);
  return FLOWPILOT_RUNTIME_FILES.has(norm) || FLOWPILOT_RUNTIME_PREFIXES.some((prefix) => norm === prefix.slice(0, -1) || norm.startsWith(prefix));
}
function filterCommitFiles(files) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const file of files) {
    const norm = normalizeGitPath(file);
    if (!norm || isFlowPilotRuntimePath(norm) || seen.has(norm)) continue;
    seen.add(norm);
    result.push(norm);
  }
  return result;
}
function hasCachedChanges(cwd, files) {
  try {
    (0, import_node_child_process.execFileSync)("git", ["diff", "--cached", "--quiet", "--", ...files], { stdio: "pipe", cwd });
    return false;
  } catch (e) {
    if (e?.status === 1) return true;
    throw e;
  }
}
function readGitPaths(cwd, args) {
  try {
    const out = (0, import_node_child_process.execFileSync)("git", args, { stdio: "pipe", cwd, encoding: "utf-8" });
    return out.split("\n").map(normalizeGitPath).filter(Boolean);
  } catch {
    return [];
  }
}
function getSubmodules(cwd = process.cwd()) {
  if (!(0, import_node_fs.existsSync)((0, import_node_path.join)(cwd, ".gitmodules"))) return [];
  const out = (0, import_node_child_process.execFileSync)("git", ["submodule", "--quiet", "foreach", "echo $sm_path"], { stdio: "pipe", cwd, encoding: "utf-8" });
  return out.split("\n").map(normalizeGitPath).filter(Boolean);
}
function listDirtySubmoduleFiles(cwd, submodulePath) {
  const submoduleCwd = (0, import_node_path.join)(cwd, submodulePath);
  const groups = [
    readGitPaths(submoduleCwd, ["diff", "--name-only", "--cached"]),
    readGitPaths(submoduleCwd, ["diff", "--name-only"]),
    readGitPaths(submoduleCwd, ["ls-files", "--others", "--exclude-standard"])
  ];
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const group of groups) {
    for (const file of group) {
      const fullPath = normalizeGitPath(`${submodulePath}/${file}`);
      if (seen.has(fullPath)) continue;
      seen.add(fullPath);
      result.push(fullPath);
    }
  }
  return result;
}
function groupBySubmodule(files, submodules) {
  const sorted = [...submodules].sort((a, b) => b.length - a.length);
  const groups = /* @__PURE__ */ new Map();
  for (const f of files) {
    const norm = normalizeGitPath(f);
    const sub = sorted.find((s) => norm.startsWith(s + "/"));
    const key = sub ?? "";
    const rel = sub ? norm.slice(sub.length + 1) : norm;
    groups.set(key, [...groups.get(key) ?? [], rel]);
  }
  return groups;
}
function skipped(reason) {
  return { status: "skipped", reason };
}
function commitIn(cwd, files, msg) {
  const opts = { stdio: "pipe", cwd, encoding: "utf-8" };
  if (!files.length) return skipped("runtime-only");
  try {
    for (const f of files) (0, import_node_child_process.execFileSync)("git", ["add", "--", f], opts);
    if (!hasCachedChanges(cwd, files)) {
      return skipped("no-staged-changes");
    }
    (0, import_node_child_process.execFileSync)("git", ["commit", "-F", "-", "--", ...files], { ...opts, input: msg });
    return { status: "committed" };
  } catch (e) {
    return { status: "failed", error: `${cwd}: ${e.stderr?.toString?.() || e.message}` };
  }
}
function gitCleanup() {
}
function listChangedFiles(cwd = process.cwd()) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  const submodules = getSubmodules(cwd);
  const submoduleSet = new Set(submodules);
  const groups = [
    readGitPaths(cwd, ["diff", "--name-only", "--cached"]),
    readGitPaths(cwd, ["diff", "--name-only"]),
    readGitPaths(cwd, ["ls-files", "--others", "--exclude-standard"])
  ];
  for (const group of groups) {
    for (const file of group) {
      if (submoduleSet.has(file)) {
        const nestedFiles = listDirtySubmoduleFiles(cwd, file);
        if (nestedFiles.length === 0) {
          if (!seen.has(file)) {
            seen.add(file);
            result.push(file);
          }
          continue;
        }
        for (const nestedFile of nestedFiles) {
          if (seen.has(nestedFile)) continue;
          seen.add(nestedFile);
          result.push(nestedFile);
        }
        continue;
      }
      if (seen.has(file)) continue;
      seen.add(file);
      result.push(file);
    }
  }
  return result;
}
function tagTask(taskId, cwd = process.cwd()) {
  try {
    (0, import_node_child_process.execFileSync)("git", ["tag", `flowpilot/task-${taskId}`], { stdio: "pipe", cwd });
    return null;
  } catch (e) {
    return e.stderr?.toString?.() || e.message;
  }
}
function rollbackToTask(taskId, cwd = process.cwd()) {
  const tag = `flowpilot/task-${taskId}`;
  try {
    (0, import_node_child_process.execFileSync)("git", ["rev-parse", tag], { stdio: "pipe", cwd });
    const log2 = (0, import_node_child_process.execFileSync)("git", ["log", "--oneline", `${tag}..HEAD`], { stdio: "pipe", cwd, encoding: "utf-8" }).trim();
    if (!log2) return "\u6CA1\u6709\u9700\u8981\u56DE\u6EDA\u7684\u63D0\u4EA4";
    (0, import_node_child_process.execFileSync)("git", ["revert", "--no-commit", `${tag}..HEAD`], { stdio: "pipe", cwd });
    (0, import_node_child_process.execFileSync)("git", ["commit", "-m", `rollback: revert to task-${taskId}`], { stdio: "pipe", cwd });
    return null;
  } catch (e) {
    try {
      (0, import_node_child_process.execFileSync)("git", ["revert", "--abort"], { stdio: "pipe", cwd });
    } catch {
    }
    return e.stderr?.toString?.() || e.message;
  }
}
function cleanTags(cwd = process.cwd()) {
  try {
    const tags = (0, import_node_child_process.execFileSync)("git", ["tag", "-l", "flowpilot/*"], { stdio: "pipe", cwd, encoding: "utf-8" }).trim();
    if (!tags) return;
    for (const t of tags.split("\n")) {
      if (t) (0, import_node_child_process.execFileSync)("git", ["tag", "-d", t], { stdio: "pipe", cwd });
    }
  } catch {
  }
}
function autoCommit(taskId, title, summary, files, cwd = process.cwd()) {
  const msg = `task-${taskId}: ${title}

${summary}`;
  if (!files?.length) return skipped("no-files");
  const commitFiles = filterCommitFiles(files);
  if (!commitFiles.length) return skipped("runtime-only");
  const submodules = getSubmodules(cwd);
  if (!submodules.length) {
    return commitIn(cwd, commitFiles, msg);
  }
  const groups = groupBySubmodule(commitFiles, submodules);
  const results = [];
  for (const [sub, subFiles] of groups) {
    if (!sub) continue;
    results.push(commitIn((0, import_node_path.join)(cwd, sub), subFiles, msg));
  }
  const parentFiles = groups.get("") ?? [];
  const touchedSubs = [...groups.keys()].filter((k) => k !== "");
  const parentTargets = [...touchedSubs, ...parentFiles];
  if (parentTargets.length) {
    results.push(commitIn(cwd, parentTargets, msg));
  }
  const failures = results.filter((result) => result.status === "failed" && Boolean(result.error));
  if (failures.length) {
    return { status: "failed", error: failures.map((result) => result.error).join("\n") };
  }
  if (results.some((result) => result.status === "committed")) {
    return { status: "committed" };
  }
  if (results.some((result) => result.status === "skipped" && result.reason === "no-staged-changes")) {
    return skipped("no-staged-changes");
  }
  return skipped("runtime-only");
}

// src/infrastructure/verify.ts
var import_node_child_process2 = require("child_process");
var import_node_fs2 = require("fs");
var import_node_path2 = require("path");
function loadConfig(cwd) {
  for (const configPath of [
    (0, import_node_path2.join)(cwd, ".flowpilot", "config.json"),
    (0, import_node_path2.join)(cwd, ".workflow", "config.json")
  ]) {
    try {
      const raw = (0, import_node_fs2.readFileSync)(configPath, "utf-8");
      const cfg = JSON.parse(raw);
      return cfg?.verify ?? {};
    } catch {
    }
  }
  return {};
}
function runVerify(cwd) {
  const config = loadConfig(cwd);
  const cmds = normalizeCommands(cwd, config.commands?.length ? config.commands : detectCommands(cwd));
  const timeout = (config.timeout ?? 300) * 1e3;
  if (!cmds.length) return { passed: true, status: "not-found", scripts: [], steps: [] };
  const steps = [];
  for (const cmd of cmds) {
    try {
      (0, import_node_child_process2.execSync)(cmd, { cwd, stdio: "pipe", timeout });
      steps.push({ command: cmd, status: "passed" });
    } catch (e) {
      const stderr = e.stderr?.length ? e.stderr.toString() : "";
      const stdout = e.stdout?.length ? e.stdout.toString() : "";
      const out = stderr || stdout || "";
      const noTestsReason = detectNoTestsReason(out);
      if (noTestsReason) {
        steps.push({ command: cmd, status: "skipped", reason: noTestsReason });
        continue;
      }
      const reason = out.slice(0, 500) || "\u547D\u4EE4\u6267\u884C\u5931\u8D25";
      steps.push({ command: cmd, status: "failed", reason });
      return { passed: false, status: "failed", scripts: cmds, steps, error: `${cmd} \u5931\u8D25:
${reason}` };
    }
  }
  return { passed: true, status: "passed", scripts: cmds, steps };
}
function detectNoTestsReason(output) {
  if (output.includes("No test files found")) return "\u672A\u627E\u5230\u6D4B\u8BD5\u6587\u4EF6";
  if (output.includes("no test files")) return "\u672A\u627E\u5230\u6D4B\u8BD5\u6587\u4EF6";
  return null;
}
function normalizeCommands(cwd, commands) {
  const testScript = loadPackageScripts(cwd).test;
  return commands.map((command) => {
    if (shouldForceVitestRun(command, testScript)) return "npm run test -- --run";
    const nested = matchNestedNpmTestCommand(command);
    if (!nested) return command;
    const nestedTestScript = loadPackageScripts((0, import_node_path2.join)(cwd, nested.dir)).test;
    return shouldForceVitestRun("npm run test", nestedTestScript) ? `cd ${nested.dir} && npm run test -- --run` : command;
  });
}
function loadPackageScripts(cwd) {
  try {
    const pkg = JSON.parse((0, import_node_fs2.readFileSync)((0, import_node_path2.join)(cwd, "package.json"), "utf-8"));
    const scripts = pkg?.scripts;
    if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return {};
    return Object.fromEntries(
      Object.entries(scripts).filter((entry) => typeof entry[1] === "string")
    );
  } catch {
    return {};
  }
}
function shouldForceVitestRun(command, testScript) {
  if (command !== "npm run test" || !testScript) return false;
  const normalizedScript = testScript.replace(/\s+/g, " ").trim();
  if (!/\bvitest\b/.test(normalizedScript)) return false;
  return !/\bvitest\b.*(?:\s|^)(?:run\b|--run\b)/.test(normalizedScript);
}
function matchNestedNpmTestCommand(command) {
  const match = /^cd\s+(.+?)\s+&&\s+npm run test$/.exec(command.trim());
  return match ? { dir: match[1] } : null;
}
function detectNodeCommands(projectDir) {
  try {
    const s = JSON.parse((0, import_node_fs2.readFileSync)((0, import_node_path2.join)(projectDir, "package.json"), "utf-8")).scripts || {};
    return ["build", "test", "lint"].filter((k) => k in s).map((k) => `npm run ${k}`);
  } catch {
    return [];
  }
}
function detectNestedProjectCommands(cwd) {
  const children = (0, import_node_fs2.readdirSync)(cwd, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules");
  const candidates = [];
  for (const child of children) {
    const childDir = (0, import_node_path2.join)(cwd, child.name);
    if ((0, import_node_fs2.existsSync)((0, import_node_path2.join)(childDir, "package.json"))) {
      const commands = detectNodeCommands(childDir);
      if (commands.length) candidates.push({ cwd: child.name, commands });
      continue;
    }
    if ((0, import_node_fs2.existsSync)((0, import_node_path2.join)(childDir, "Cargo.toml"))) {
      candidates.push({ cwd: child.name, commands: ["cargo build", "cargo test"] });
      continue;
    }
    if ((0, import_node_fs2.existsSync)((0, import_node_path2.join)(childDir, "go.mod"))) {
      candidates.push({ cwd: child.name, commands: ["go build ./...", "go test ./..."] });
    }
  }
  if (candidates.length !== 1) return [];
  return candidates[0].commands.map((command) => `cd ${candidates[0].cwd} && ${command}`);
}
function detectCommands(cwd) {
  const has = (f) => (0, import_node_fs2.existsSync)((0, import_node_path2.join)(cwd, f));
  if (has("package.json")) {
    const commands = detectNodeCommands(cwd);
    if (commands.length) return commands;
  }
  if (has("Cargo.toml")) return ["cargo build", "cargo test"];
  if (has("go.mod")) return ["go build ./...", "go test ./..."];
  if (has("pyproject.toml") || has("setup.py") || has("requirements.txt")) {
    const cmds = [];
    if (has("pyproject.toml")) {
      try {
        const txt = (0, import_node_fs2.readFileSync)((0, import_node_path2.join)(cwd, "pyproject.toml"), "utf-8");
        if (txt.includes("ruff")) cmds.push("ruff check .");
        if (txt.includes("mypy")) cmds.push("mypy .");
      } catch {
      }
    }
    cmds.push("python -m pytest --tb=short -q");
    return cmds;
  }
  if (has("pom.xml")) return ["mvn compile -q", "mvn test -q"];
  if (has("build.gradle") || has("build.gradle.kts")) return ["gradle build"];
  if (has("CMakeLists.txt")) return ["cmake --build build", "ctest --test-dir build"];
  if (has("Makefile")) {
    try {
      const mk = (0, import_node_fs2.readFileSync)((0, import_node_path2.join)(cwd, "Makefile"), "utf-8");
      const targets = [];
      if (/^build\s*:/m.test(mk)) targets.push("make build");
      if (/^test\s*:/m.test(mk)) targets.push("make test");
      if (/^lint\s*:/m.test(mk)) targets.push("make lint");
      if (targets.length) return targets;
    } catch {
    }
  }
  const nested = detectNestedProjectCommands(cwd);
  if (nested.length) return nested;
  return [];
}

// src/infrastructure/protocol-template.ts
var COMMON_AGENT_GUIDELINES = `
## \u901A\u7528\u5DE5\u4F5C\u89C4\u8303

> **\u6838\u5FC3\u539F\u5219**\uFF1A\u6700\u5927\u5316\u5E76\u884C\u3001\u6700\u5C0F\u5316\u963B\u585E\u3002\u5C06\u4EFB\u52A1\u62C6\u89E3\u4E3A**\u53EF\u72EC\u7ACB\u6267\u884C\u4E14\u4E92\u4E0D\u51B2\u7A81**\u7684\u5B50\u4EFB\u52A1\uFF1B\u80FD\u5E76\u884C\u5C31\u5E76\u884C\uFF0C\u80FD\u6279\u91CF\u5C31\u6279\u91CF\uFF0C\u5F85\u672C\u8F6E\u7ED3\u679C\u5168\u90E8\u8FD4\u56DE\u540E\u6574\u5408\u4E3A\u9636\u6BB5\u6027\u4EA7\u51FA\uFF0C\u518D\u9012\u5F52\u63A8\u8FDB\u4E0B\u4E00\u8F6E\uFF0C\u76F4\u81F3\u4EFB\u52A1\u5B8C\u6210\u3002

### \u8BED\u8A00\u89C4\u8303
- **\u5FC5\u987B**\u9ED8\u8BA4\u4F7F\u7528\u7B80\u4F53\u4E2D\u6587\u6C9F\u901A\u3001\u89E3\u91CA\u4E0E\u603B\u7ED3\uFF0C\u9664\u975E\u7528\u6237\u660E\u786E\u8981\u6C42\u5176\u4ED6\u8BED\u8A00\u3002

### \u6838\u5FC3\u4E0D\u53EF\u53D8\u539F\u5219
- **\u8D28\u91CF\u7B2C\u4E00**\uFF1A\u4EE3\u7801\u8D28\u91CF\u548C\u7CFB\u7EDF\u5B89\u5168\u4E0D\u53EF\u59A5\u534F\u3002
- **\u601D\u8003\u5148\u884C**\uFF1A\u7F16\u7801\u524D\u5FC5\u987B\u5148\u5206\u6790\u3001\u89C4\u5212\u5E76\u660E\u786E\u8FB9\u754C\u3002
- **Skills / \u5DE5\u5177\u4F18\u5148**\uFF1A\u4F18\u5148\u4F7F\u7528\u5F53\u524D\u73AF\u5883\u4E2D\u53EF\u7528\u7684 Skills\u3001MCP \u4E0E\u5DE5\u5177\u80FD\u529B\u89E3\u51B3\u95EE\u9898\u3002
- **\u900F\u660E\u8BB0\u5F55**\uFF1A\u5173\u952E\u51B3\u7B56\u3001\u91CD\u8981\u53D8\u66F4\u4E0E\u5F02\u5E38\u8FB9\u754C\u5FC5\u987B\u53EF\u8FFD\u6EAF\u3002

### \u8F93\u51FA\u98CE\u683C
- **\u5FC5\u987B**\u5148\u7ED9\u7ED3\u8BBA\uFF0C\u518D\u7ED9\u5FC5\u8981\u7EC6\u8282\u3002
- **\u5FC5\u987B**\u4FDD\u6301\u7B80\u6D01\u3001\u6E05\u6670\u3001\u7EC8\u7AEF\u53CB\u597D\u3002
- **\u5FC5\u987B**\u4F7F\u7528\u5F3A\u89C6\u89C9\u8FB9\u754C\u7EC4\u7EC7\u5185\u5BB9\uFF1A\u4F18\u5148\u4F7F\u7528 \`**\u7C97\u4F53\u5C0F\u6807\u9898**\` \u4F5C\u4E3A\u5206\u7EC4\u951A\u70B9\uFF0C\u5E76\u4FDD\u7559\u5FC5\u8981\u7559\u767D\u3002
- **\u5FC5\u987B**\u4F18\u5148\u4F7F\u7528\u77ED\u6BB5\u843D\u3001\u77ED\u5217\u8868\u548C\u6709\u5E8F\u6B65\u9AA4\uFF1B\u4E00\u4E2A\u8981\u70B9\u53EA\u8868\u8FBE\u4E00\u4E2A\u6838\u5FC3\u610F\u601D\u3002
- **\u5FC5\u987B**\u8BA9\u590D\u6742\u6D41\u7A0B\u4F18\u5148\u4F7F\u7528\u6709\u5E8F\u5217\u8868\u6216\u7B80\u77ED ASCII \u56FE\u793A\uFF0C\u4E0D\u8981\u7528\u5927\u6BB5\u7EAF\u6587\u5B57\u786C\u5806\u3002
- **\u5FC5\u987B**\u5C06\u793A\u4F8B\u3001\u914D\u7F6E\u3001\u65E5\u5FD7\u3001\u547D\u4EE4\u8F93\u51FA\u653E\u5165\u4EE3\u7801\u5757\uFF0C\u5E76\u5C3D\u91CF\u805A\u7126\u5173\u952E\u90E8\u5206\u3002
- **\u907F\u514D**\u4F7F\u7528\u8D85\u957F\u8868\u683C\u3001\u8D85\u957F\u6BB5\u843D\u3001\u8D85\u957F\u8DEF\u5F84\u548C\u5927\u6BB5\u65E0\u7ED3\u6784\u6587\u672C\u3002
- **\u53EF\u9002\u5EA6**\u4F7F\u7528 emoji \u5F3A\u5316\u89C6\u89C9\u5F15\u5BFC\uFF0C\u4F46\u4E0D\u5F97\u5806\u780C\u6216\u5F71\u54CD\u53EF\u8BFB\u6027\u3002

### AI \u5BF9\u7528\u6237\u8F93\u51FA\u98CE\u683C\uFF08\u53EA\u6539\u8868\u8FBE\uFF0C\u4E0D\u6539\u89C4\u5219\uFF09
- **\u5FC5\u987B**\u4F18\u5148\u4F7F\u7528\u53CB\u597D\u3001\u76F4\u63A5\u3001\u50CF\u540C\u4F34\u534F\u4F5C\u7684\u8BED\u6C14\uFF1B\u4E0D\u8981\u50F5\u786C\u64AD\u62A5\u5F0F\u8F93\u51FA\u3002
- **\u5FC5\u987B**\u4F18\u5148\u4F7F\u7528\u4EE5\u4E0B\u5206\u7EC4\u951A\u70B9\u7EC4\u7EC7\u7528\u6237\u53EF\u89C1\u56DE\u590D\uFF1A
  - \`**\u7ED3\u8BBA**\`
  - \`**\u5F53\u524D\u8FDB\u5C55**\`
  - \`**\u539F\u56E0**\`
  - \`**\u4E0B\u4E00\u6B65**\`
  - \`**\u98CE\u9669**\`
- **\u5EFA\u8BAE**\u5728\u4E0D\u5F71\u54CD\u53EF\u8BFB\u6027\u7684\u524D\u63D0\u4E0B\u4F7F\u7528\u5C11\u91CF\u6587\u5B57\u56FE\u6807\u6216 emoji \u5F3A\u5316\u626B\u63CF\u4F53\u9A8C\uFF0C\u4F8B\u5982\uFF1A
  - \`\u5B8C\u6210\` / \`\u5DF2\u5904\u7406\`
  - \`\u63D0\u793A\` / \`\u6CE8\u610F\`
  - \`\u4E0B\u4E00\u6B65\`
  - \`\u26A0\uFE0F\`\uFF08\u4EC5\u7528\u4E8E\u98CE\u9669\u6216\u963B\u585E\uFF09
- **\u5FC5\u987B**\u8BA9\u72B6\u6001\u66F4\u65B0\u5C3D\u91CF\u7B26\u5408\u4EE5\u4E0B\u6837\u5F0F\uFF1A
\`\`\`text
**\u5F53\u524D\u8FDB\u5C55**
\u5DF2\u5B8C\u6210 ...

**\u539F\u56E0**
\u73B0\u5728\u9700\u8981\u5148\u5904\u7406 ...

**\u4E0B\u4E00\u6B65**
\u63A5\u4E0B\u6765\u6211\u4F1A ...
\`\`\`
- **\u5FC5\u987B**\u4FDD\u6301\u534F\u8BAE\u6307\u4EE4\u3001\u547D\u4EE4\u3001checkpoint \u8981\u6C42\u7684\u539F\u610F\u4E0D\u53D8\uFF1B\u53EA\u80FD\u4F18\u5316\u8868\u8FBE\u548C\u6392\u7248\uFF0C\u4E0D\u80FD\u6539\u8BED\u4E49\u3002
- **\u907F\u514D**\u201C\u53E3\u53F7\u5F0F\u5938\u8D5E\u201D\u201C\u8FC7\u5EA6\u9F13\u52B1\u201D\u201C\u7A7A\u6D1E\u5BA2\u5957\u201D\uFF1B\u53CB\u597D\u4E0D\u7B49\u4E8E\u5197\u957F\u3002

### \u4EFB\u52A1\u6267\u884C
- **\u5FC5\u987B**\u5148\u5206\u6790\uFF0C\u518D\u6267\u884C\u3002
- **\u5FC5\u987B**\u5148\u8BC6\u522B\u4F9D\u8D56\u5173\u7CFB\u56FE\uFF0C\u533A\u5206\u300C\u53EF\u5E76\u884C\u8282\u70B9\u300D\u4E0E\u300C\u5FC5\u987B\u4E32\u884C\u8282\u70B9\u300D\u3002
- **\u63A8\u8350**\u6309\u300C\u4EFB\u52A1\u5206\u6790 \u2192 \u5E76\u884C\u8C03\u5EA6 \u2192 \u7ED3\u679C\u6C47\u603B \u2192 \u9012\u5F52\u8FED\u4EE3\u300D\u63A8\u8FDB\u590D\u6742\u4EFB\u52A1\uFF1B\u5148\u6536\u655B\u9636\u6BB5\u6027\u7ED3\u679C\uFF0C\u518D\u8FDB\u5165\u4E0B\u4E00\u8F6E\u62C6\u89E3\u3002
- \u5BF9\u4E8E\u53EF\u72EC\u7ACB\u6267\u884C\u4E14\u65E0\u51B2\u7A81\u7684\u4EFB\u52A1\uFF0C**\u4E0D\u5F97**\u65E0\u6545\u4FDD\u5B88\u4E32\u884C\u3002
- \u5E76\u884C\u4EFB\u52A1**\u5FC5\u987B**\u907F\u514D\u5199\u51B2\u7A81\uFF1B\u82E5\u5B58\u5728\u540C\u6587\u4EF6\u91CD\u53E0\u4FEE\u6539\uFF0C**\u5FC5\u987B**\u5148\u62C6\u6E05\u5199\u5165\u8FB9\u754C\uFF1B\u5728\u8FB9\u754C\u672A\u62C6\u6E05\u524D\uFF0C**\u7981\u6B62\u5E76\u884C\u6D3E\u53D1**\u3002
- \u9AD8\u98CE\u9669\u64CD\u4F5C\u524D**\u5FC5\u987B**\u8BF4\u660E\u5F71\u54CD\u8303\u56F4\u3001\u4E3B\u8981\u98CE\u9669\uFF0C\u5E76\u83B7\u5F97\u660E\u786E\u786E\u8BA4\u3002

### \u5DE5\u7A0B\u8D28\u91CF
- **\u8D28\u91CF\u7B2C\u4E00**\uFF1A\u6B63\u786E\u6027\u3001\u53EF\u7EF4\u62A4\u6027\u4E0E\u53EF\u9A8C\u8BC1\u6027\u4E0D\u53EF\u59A5\u534F\u3002
- \u5173\u952E\u53D8\u66F4**\u5FC5\u987B**\u6709\u6D4B\u8BD5\u3001\u9A8C\u8BC1\u6216\u660E\u786E\u8BC1\u636E\u652F\u6491\u3002
- \u91CD\u8981\u51B3\u7B56\u4E0E\u5F02\u5E38\u8FB9\u754C**\u5FC5\u987B**\u53EF\u8FFD\u6EAF\u3002

### \u8D28\u91CF\u6807\u51C6
- **\u67B6\u6784\u8BBE\u8BA1**\uFF1A\u9075\u5FAA SOLID\u3001DRY\u3001\u5173\u6CE8\u70B9\u5206\u79BB\u4E0E YAGNI\uFF0C\u907F\u514D\u8FC7\u5EA6\u8BBE\u8BA1\u3002
- **\u4EE3\u7801\u8D28\u91CF**\uFF1A\u4FDD\u6301\u6E05\u6670\u547D\u540D\u3001\u5408\u7406\u62BD\u8C61\uFF1B\u4EC5\u5728\u5173\u952E\u6D41\u7A0B\u3001\u6838\u5FC3\u903B\u8F91\u3001\u91CD\u70B9\u96BE\u70B9\u5904\u6DFB\u52A0\u5FC5\u8981\u7684\u7B80\u4F53\u4E2D\u6587\u6CE8\u91CA\u3002
- **\u6027\u80FD\u610F\u8BC6**\uFF1A\u8003\u8651\u65F6\u95F4\u590D\u6742\u5EA6\u3001\u7A7A\u95F4\u590D\u6742\u5EA6\u3001\u5185\u5B58\u4F7F\u7528\u3001IO \u6210\u672C\u4E0E\u8FB9\u754C\u6761\u4EF6\u3002
- **\u6D4B\u8BD5\u8981\u6C42**\uFF1A\u4F18\u5148\u4FDD\u8BC1\u53EF\u6D4B\u8BD5\u8BBE\u8BA1\u3001\u5355\u5143\u6D4B\u8BD5\u8986\u76D6\u3001\u9759\u6001\u68C0\u67E5\u3001\u683C\u5F0F\u5316\u3001\u4EE3\u7801\u5BA1\u67E5\u4E0E\u6301\u7EED\u9A8C\u8BC1\u3002
- **\u6D4B\u8BD5\u6267\u884C**\uFF1A\u540E\u53F0\u6267\u884C\u5355\u5143\u6D4B\u8BD5\u65F6\uFF0C\u5EFA\u8BAE\u8BBE\u7F6E\u5408\u7406\u8D85\u65F6\uFF08\u9ED8\u8BA4\u53EF\u53C2\u8003 60s\uFF09\uFF0C\u907F\u514D\u4EFB\u52A1\u957F\u65F6\u95F4\u5361\u6B7B\u3002
`;
var CODEX_ENHANCED_GUIDELINES = `
## Codex \u5E73\u53F0\u589E\u5F3A\u89C4\u5219

> **\u5E76\u884C\u94C1\u5F8B**\uFF1A\u5F53\u5E73\u53F0\u5177\u5907\u591A\u4EE3\u7406\u80FD\u529B\u65F6\uFF0C\u9ED8\u8BA4\u76EE\u6807\u4E0D\u662F\u201C\u5B89\u5168\u5730\u53EA\u6D3E 1 \u4E2A\u201D\uFF0C\u800C\u662F\u201C\u5728\u8FB9\u754C\u6E05\u6670\u524D\u63D0\u4E0B\u5C3D\u91CF\u6253\u6EE1\u5E76\u884C\u5EA6\u201D\u3002

### \u6807\u51C6\u6267\u884C\u6D41\u7A0B
1. **\u4EFB\u52A1\u5206\u6790**
   - \u5148\u8BC6\u522B\u4EFB\u52A1\u4E2D\u7684\u4F9D\u8D56\u5173\u7CFB\u56FE\uFF0C\u533A\u5206\u53EF\u5E76\u884C\u8282\u70B9\u4E0E\u5FC5\u987B\u4E32\u884C\u8282\u70B9\u3002

2. **\u5E76\u884C\u8C03\u5EA6\u4E0E\u5B50\u4EFB\u52A1\u4E0B\u53D1**
   - \u5C06\u6240\u6709\u65E0\u524D\u7F6E\u4F9D\u8D56\u4E14\u65E0\u5199\u51B2\u7A81\u7684\u5B50\u4EFB\u52A1\u4F18\u5148\u5E76\u53D1\u4E0B\u53D1\u3002
   - \u4F18\u5148\u4F7F\u7528 \`multi_agent\`\u3001\`spawn_agent\` \u6216\u7B49\u6548\u5B50\u4EE3\u7406\u80FD\u529B\u3002
   - \u786E\u4FDD\u5B50\u4EFB\u52A1\u4E4B\u95F4\u4E0D\u5B58\u5728\u5199\u51B2\u7A81\uFF1B\u82E5\u6709\u540C\u6587\u4EF6\u91CD\u53E0\u4FEE\u6539\uFF0C\u5FC5\u987B\u5148\u62C6\u6E05\u8FB9\u754C\u3002
   - \u5355\u8F6E\u6700\u591A\u540C\u65F6\u4E0B\u53D1 **50 \u4E2A**\u5B50\u4EFB\u52A1\uFF1B\u8D85\u51FA\u65F6\u6309\u4F18\u5148\u7EA7\u6216\u4F9D\u8D56\u6DF1\u5EA6\u5206\u6279\u8C03\u5EA6\uFF0C\u524D\u4E00\u6279\u5168\u90E8\u8FD4\u56DE\u540E\u518D\u4E0B\u53D1\u4E0B\u4E00\u6279\u3002

3. **\u7ED3\u679C\u6C47\u603B**
   - \u7B49\u5F85\u672C\u8F6E\u6240\u6709\u5E76\u884C\u4EFB\u52A1\u8FD4\u56DE\u3002
   - \u6821\u9A8C\u8F93\u51FA\u4E00\u81F4\u6027\uFF0C\u5904\u7406\u5F02\u5E38\u3001\u51B2\u7A81\u4E0E\u6F0F\u9879\u3002
   - \u5C06\u7ED3\u679C\u6574\u5408\u4E3A\u9636\u6BB5\u6027\u4EA7\u51FA\uFF0C\u4F5C\u4E3A\u4E0B\u4E00\u8F6E\u8F93\u5165\u3002

4. **\u9012\u5F52\u8FED\u4EE3**
   - \u57FA\u4E8E\u9636\u6BB5\u6027\u7ED3\u679C\u91CD\u590D\u201C\u5206\u6790 \u2192 \u5E76\u884C \u2192 \u6C47\u603B\u201D\u6D41\u7A0B\u3002
   - \u76F4\u81F3\u6240\u6709\u5B50\u4EFB\u52A1\u5B8C\u6210\uFF0C\u8F93\u51FA\u6700\u7EC8\u7ED3\u679C\u3002

### \u5E76\u884C\u4EE3\u7406\u8C03\u5EA6
- \u5F53 Codex \u5E73\u53F0\u63D0\u4F9B \`multi_agent\`\u3001\`spawn_agent\` \u6216\u7B49\u6548\u5B50\u4EE3\u7406\u80FD\u529B\u65F6\uFF0C**\u5FC5\u987B\u4F18\u5148**\u4F7F\u7528\u5B83\u4EEC\u505A\u5E76\u884C\u8C03\u5EA6\u3002
- **\u5FC5\u987B**\u5C06\u6240\u6709\u65E0\u524D\u7F6E\u4F9D\u8D56\u4E14\u65E0\u5199\u51B2\u7A81\u7684\u5B50\u4EFB\u52A1\u4F18\u5148\u5E76\u53D1\u4E0B\u53D1\uFF0C\u800C\u4E0D\u662F\u9010\u4E2A\u8BD5\u63A2\u6027\u6D3E\u53D1\u3002
- \u5355\u8F6E\u6700\u591A\u53EF\u540C\u65F6\u4E0B\u53D1 **50 \u4E2A**\u5B50\u4EFB\u52A1\uFF1B\u5728\u5E73\u53F0\u80FD\u529B\u3001\u4E0A\u4E0B\u6587\u5BB9\u91CF\u548C\u4EFB\u52A1\u72EC\u7ACB\u6027\u5141\u8BB8\u65F6\uFF0C**\u5FC5\u987B\u4F18\u5148\u6253\u6EE1\u53EF\u5B89\u5168\u5E76\u884C\u7684\u5B50\u4EE3\u7406\u6570\u91CF**\u3002
- \u82E5\u4EFB\u52A1\u53EF\u72EC\u7ACB\u4E14\u65E0\u5199\u51B2\u7A81\uFF0C**\u4E0D\u5F97**\u53EA\u6D3E 1 \u4E2A\u5B50\u4EE3\u7406\uFF1B\u65E0\u6545\u964D\u4E3A\u5355\u4EE3\u7406\u89C6\u4E3A\u541E\u5410\u9000\u5316\u3002
- **\u4E0D\u5F97**\u4EE5\u201C\u8C28\u614E\u201D\u201C\u4E60\u60EF\u201D\u6216\u201C\u65B9\u4FBF\u6C47\u603B\u201D\u4E3A\u7406\u7531\u7F29\u51CF\u672C\u8F6E\u53EF\u5E76\u884C\u4EFB\u52A1\u6570\u3002
- \u53EA\u6709\u5B58\u5728\u771F\u5B9E\u4F9D\u8D56\u3001\u5199\u51B2\u7A81\u6216\u6574\u5408\u538B\u529B\u65F6\uFF0C\u624D\u5141\u8BB8\u5206\u6279\u56DE\u9000\uFF1B\u5426\u5219\u89C6\u4E3A\u8FDD\u53CD\u5E76\u884C\u4F18\u5148\u539F\u5219\u3002

### \u5B50\u4EFB\u52A1\u5951\u7EA6
- \u4E0B\u53D1\u4EFB\u4F55\u5B50\u4EFB\u52A1\u65F6\uFF0C**\u5FC5\u987B**\u63D0\u4F9B\u6E05\u6670\u3001\u65E0\u6B67\u4E49\u7684\u6307\u4EE4\uFF0C\u5E76\u5305\u542B\u4EE5\u4E0B\u8981\u7D20\uFF1A
  - **\u4EE3\u7406\u540D\u79F0**\uFF1A\u51C6\u786E\u3001\u7B80\u77ED\uFF0C\u5EFA\u8BAE\u4F7F\u7528\u201C\u804C\u8D23 + \u7C7B\u578B\u201D\u547D\u540D\u3002
  - **\u4EFB\u52A1\u5B9A\u4E49**\uFF1A\u660E\u786E\u80CC\u666F\u3001\u6838\u5FC3\u76EE\u6807\u53CA\u4F9D\u8D56\u7684\u8F93\u5165\u4E0A\u4E0B\u6587\u3002
  - **\u6267\u884C\u52A8\u4F5C**\uFF1A\u7ED9\u51FA\u5177\u4F53\u64CD\u4F5C\u6B65\u9AA4\uFF0C\u660E\u786E\u5199\u5165\u8FB9\u754C\uFF0C\u4E0D\u5F97\u8D8A\u754C\u6267\u884C\u3002
  - **\u9884\u671F\u7ED3\u679C**\uFF1A\u8BF4\u660E\u5B8C\u6210\u6807\u5FD7\u3001\u4EA4\u4ED8\u7269\u5185\u5BB9\u53CA\u5F3A\u5236\u8F93\u51FA\u683C\u5F0F\u3002
- \u5B50\u4EFB\u52A1\u95F4**\u5FC5\u987B**\u4FDD\u6301\u6587\u4EF6\u8FB9\u754C\u6E05\u6670\uFF1B**\u4E0D\u5F97**\u8BA9\u591A\u4E2A\u5B50\u4EE3\u7406\u540C\u65F6\u4FEE\u6539\u540C\u4E00\u5757\u4EE3\u7801\u3002
- \u82E5\u8FB9\u754C\u4E0D\u6E05\uFF0C**\u5FC5\u987B\u5148\u62C6\u4EFB\u52A1\u6216\u91CD\u5212\u8FB9\u754C\uFF0C\u518D\u5E76\u884C\u6D3E\u53D1**\uFF1B\u4E0D\u8981\u628A\u8FB9\u754C\u6A21\u7CCA\u7684\u4EFB\u52A1\u76F4\u63A5\u4E22\u7ED9\u591A\u4E2A\u4EE3\u7406\u3002
`;
var FLOWPILOT_PROTOCOL_BODY = `
## FlowPilot Workflow Protocol (MANDATORY \u2014 any violation is a protocol failure)

**You are the dispatcher. These rules have the HIGHEST priority and are ALWAYS active.**

### On Session Start
Run \`node flow.js resume\`:
- If unfinished workflow and resume reports **reconciling** / "\u5DF2\u6682\u505C\u7EE7\u7EED\u8C03\u5EA6" \u2192 do **NOT** enter Execution Loop. First run \`node flow.js adopt <id> --files ...\`, or after confirming and handling only the listed task-owned changes run \`node flow.js restart <id>\`. If resume also reports ownership-ambiguous files, stop and review manually; never use whole-file \`git restore\` on files that may include user edits/deletions. Never touch baseline changes or unrelated project code.
- If unfinished workflow and no reconcile gate \u2192 enter **Execution Loop** (unless user is asking an unrelated question \u2014 handle it first via **Ad-hoc Dispatch**, then remind user the workflow is paused)
- If no workflow \u2192 **judge the request**: reply directly for pure chitchat, use **Ad-hoc Dispatch** for one-off tasks, or enter **Requirement Decomposition** for multi-step development work. When in doubt, prefer the heavier path.

### Ad-hoc Dispatch (one-off tasks, no workflow init)
Dispatch sub-agent(s) via Task tool. No init/checkpoint/finish needed. Iron Rule #4 does NOT apply (no task ID exists). Main agent MAY use Read/Glob/Grep directly for trivial lookups (e.g. reading a single file) \u2014 Iron Rule #2 is relaxed in Ad-hoc mode only.
**\u8BB0\u5FC6\u67E5\u8BE2**: \u56DE\u7B54\u7528\u6237\u95EE\u9898\u524D\uFF0C\u5148\u8FD0\u884C \`node flow.js recall <\u5173\u952E\u8BCD>\` \u68C0\u7D22\u5386\u53F2\u8BB0\u5FC6\uFF0C\u5C06\u7ED3\u679C\u4F5C\u4E3A\u56DE\u7B54\u7684\u53C2\u8003\u4F9D\u636E\u3002

### Iron Rules (violating ANY = protocol failure)
1. **NEVER use TaskCreate / TaskUpdate / TaskList** \u2014 use ONLY \`node flow.js xxx\`.
2. **Main agent can ONLY use Bash, Task, and Skill** \u2014 Edit, Write, Read, Glob, Grep, Explore are ALL FORBIDDEN. To read any file (including docs), dispatch a sub-agent.
3. **ALWAYS dispatch via Task tool** \u2014 one Task call per task. N tasks = N Task calls **in a single message** for parallel execution.
4. **Sub-agents MUST run checkpoint with --files before replying** \u2014 \`echo 'summary' | node flow.js checkpoint <id> --files file1 file2\` is the LAST command before reply. MUST list all created/modified files. Skipping = protocol failure.

### Requirement Decomposition
**Step 0 \u2014 Auto-detect (ALWAYS run first):**
1. If user's message directly contains a task list (numbered items or checkbox items) \u2192 pipe it into \`node flow.js init\` directly, skip to **Execution Loop**.
2. Search project root for \`tasks.md\` (run \`ls tasks.md 2>/dev/null\`). If found \u2192 ask user: "\u53D1\u73B0\u9879\u76EE\u4E2D\u6709 tasks.md\uFF0C\u662F\u5426\u4F5C\u4E3A\u672C\u6B21\u5DE5\u4F5C\u6D41\u7684\u4EFB\u52A1\u5217\u8868\uFF1F" If user confirms \u2192 \`cat tasks.md | node flow.js init\`, skip to **Execution Loop**. If user declines \u2192 continue to Path A/B.

**Path A \u2014 Standard (default):**
1. Dispatch a sub-agent to read requirement docs and return a summary.
2. Use /superpowers:brainstorming to brainstorm and produce a task list. **Throughput-first rule:** minimize dependencies; only add \`deps\` for true blocking/data dependencies. Prefer wider parallel frontiers over long chains whenever safe.
3. Pipe into init using this **exact format**:
\`\`\`bash
cat <<'EOF' | node flow.js init
1. [backend] Task title
   Description of what to do
2. [frontend] Another task (deps: 1)
   Description here
3. [general] Third task (deps: 1, 2)
EOF
\`\`\`
Format: \`[type]\` = frontend/backend/general, \`(deps: N)\` = dependency IDs, indented lines = description. **Do not add decorative or "just to be safe" dependencies.**

**Path B \u2014 OpenSpec (if \`openspec/\` directory exists AND \`openspec\` CLI is available):**
1. Verify: run \`npx openspec --version\`. If command fails \u2192 fall back to **Path A**.
2. Run \`/opsx:new <change-name>\` to create a change.
3. Run \`/opsx:ff\` to fast-forward (generates proposal \u2192 specs \u2192 design \u2192 tasks).
4. Pipe the generated tasks.md into init:
\`\`\`bash
cat openspec/changes/<change-name>/tasks.md | node flow.js init
\`\`\`
OpenSpec checkbox format (\`- [ ] 1.1 Task\`) is auto-detected. Group N tasks depend on group N-1.

### Execution Loop
1. Prefer running \`node flow.js next --batch\` when tasks are confirmed independent. **NOTE: this command will REFUSE to return tasks if any previous task is still \`active\`, or if the workflow is in \`reconciling\` state. In reconciling state you must adopt/restart/skip first, and restart may only follow handling of the listed task-owned changes. Ownership-ambiguous files must be reviewed manually; do not clear them with whole-file \`git restore\`. If write boundaries remain unclear, \`node flow.js next\` may be used for manual serialization.**
2. When using batch output, the result already contains checkpoint commands per task. For **EVERY** task in batch, dispatch a sub-agent via Task tool. **ALL Task calls in one message.** Copy the ENTIRE task block (including checkpoint commands) into each sub-agent prompt verbatim. **If the batch contains N independent tasks, dispatch N sub-agents immediately; do not downshift to 1 for caution.**
3. **After ALL sub-agents return**: run \`node flow.js status\`.
   - If any task is still \`active\` \u2192 sub-agent failed to checkpoint. Run fallback: \`echo 'summary from sub-agent output' | node flow.js checkpoint <id> --files file1 file2\`
   - **Do NOT call \`node flow.js next\` until zero active tasks remain** (the command will error anyway).
4. Loop back to step 1.
5. When \`next\` returns "\u5168\u90E8\u5B8C\u6210", enter **Finalization**.

### Mid-Workflow Commands
- \`node flow.js skip <id>\` \u2014 skip a stuck/unnecessary task (avoid skipping active tasks with running sub-agents)
- \`node flow.js adopt <id> --files ...\` \u2014 adopt interrupted task-owned changes as the task result and unblock scheduling
- \`node flow.js restart <id>\` \u2014 after confirming and handling only the listed task-owned changes, allow the task to be re-run from scratch; ownership-ambiguous files must be reviewed manually, and whole-file \`git restore\` is forbidden when user edits/deletions may be mixed in
- \`node flow.js add <\u63CF\u8FF0> [--type frontend|backend|general]\` \u2014 inject a new task mid-workflow

### Sub-Agent Prompt Template
Each sub-agent prompt MUST contain these sections in order:
1. Task block from \`next\` output (title, type, description, checkpoint commands, context)
2. **Pre-analysis (MANDATORY)**: Before writing ANY code, **MUST** invoke /superpowers:brainstorming to perform multi-dimensional analysis (requirements, edge cases, architecture, risks). Skipping = protocol failure.
3. **Skill routing**: type=frontend \u2192 **MUST** invoke /frontend-design, type=backend \u2192 **MUST** invoke /feature-dev, type=general \u2192 execute directly. **For ALL types, you MUST also check available skills and MCP tools; use any that match the task alongside the primary skill.**
4. **Unfamiliar APIs \u2192 MUST query context7 MCP first. Never guess.**

### Sub-Agent Live Progress
- \u5B50\u4EE3\u7406\u5728\u957F\u4EFB\u52A1\u4E2D**\u5FC5\u987B**\u6301\u7EED\u6C47\u62A5\u9636\u6BB5\u6027\u8FDB\u5C55\uFF0C\u800C\u4E0D\u662F\u53EA\u5728\u6700\u7EC8 checkpoint \u65F6\u56DE\u590D\u3002
- \u63A8\u8350\u81F3\u5C11\u8986\u76D6\u4EE5\u4E0B\u9636\u6BB5\uFF1A
  - \`analysis\`\uFF1A\u6B63\u5728\u9605\u8BFB\u4EE3\u7801 / \u6587\u6863 / \u5B9A\u4F4D\u95EE\u9898
  - \`implementation\`\uFF1A\u6B63\u5728\u4FEE\u6539\u5B9E\u73B0
  - \`verification\`\uFF1A\u6B63\u5728\u8FD0\u884C\u6D4B\u8BD5 / build / smoke
  - \`blocked\`\uFF1A\u9047\u5230\u5361\u70B9\u3001\u73AF\u5883\u95EE\u9898\u6216\u8FB9\u754C\u4E0D\u6E05
- \u82E5\u5E73\u53F0\u6216 CLI \u63D0\u4F9B\u8FDB\u5EA6\u4E0A\u62A5\u547D\u4EE4\uFF08\u4F8B\u5982 \`node flow.js pulse ...\`\uFF09\uFF0C**\u5FC5\u987B\u4F18\u5148**\u4F7F\u7528\uFF1B\u5426\u5219\u81F3\u5C11\u5728\u56DE\u590D\u4E2D\u660E\u786E\u9636\u6BB5\u3001\u6700\u8FD1\u6D3B\u52A8\u548C\u963B\u585E\u539F\u56E0\u3002
- \u82E5\u5355\u4E2A\u9636\u6BB5\u6301\u7EED\u65F6\u95F4\u8FC7\u957F\u4E14\u65E0\u65B0 checkpoint\uFF0C\u5FC5\u987B\u4E3B\u52A8\u4E0A\u62A5\u201C\u4ECD\u5728\u6267\u884C\u201D\u6216\u201C\u5DF2\u963B\u585E\u201D\uFF0C\u907F\u514D\u4E3B\u4EE3\u7406\u53EA\u80FD\u770B\u5230\u7B49\u5F85\u9762\u677F\u3002
- **\u5EFA\u8BAE**\u9636\u6BB5\u6027\u56DE\u590D\u5C3D\u91CF\u7B26\u5408\u4EE5\u4E0B\u683C\u5F0F\uFF1A
\`\`\`text
**\u5F53\u524D\u8FDB\u5C55**
\u9636\u6BB5\uFF1Aimplementation
\u6B63\u5728\u5904\u7406\uFF1A...

**\u539F\u56E0**
\u9700\u8981\u5148\u5B8C\u6210 ...

**\u4E0B\u4E00\u6B65**
\u5B8C\u6210\u540E\u6211\u4F1A ...
\`\`\`

### Sub-Agent Checkpoint (Iron Rule #4 \u2014 most common violation)
Sub-agent's LAST Bash command before replying MUST be:
\`\`\`
echo '\u6458\u8981 [REMEMBER] \u5173\u952E\u53D1\u73B0 [DECISION] \u6280\u672F\u51B3\u7B56' | node flow.js checkpoint <id> --files file1 file2 ...
\`\`\`
- **\u6458\u8981\u4E2D MUST \u5305\u542B\u81F3\u5C11\u4E00\u4E2A\u77E5\u8BC6\u6807\u7B7E**\uFF08\u7F3A\u5C11\u6807\u7B7E = \u534F\u8BAE\u8FDD\u89C4\uFF09:
  - \`[REMEMBER]\` \u503C\u5F97\u8BB0\u4F4F\u7684\u4E8B\u5B9E\u3001\u53D1\u73B0\u3001\u89E3\u51B3\u65B9\u6848\uFF08\u5982\uFF1A[REMEMBER] \u9879\u76EE\u4F7F\u7528 PostgreSQL + Drizzle ORM\uFF09
  - \`[DECISION]\` \u6280\u672F\u51B3\u7B56\u53CA\u539F\u56E0\uFF08\u5982\uFF1A[DECISION] \u9009\u62E9 JWT \u800C\u975E session\uFF0C\u56E0\u4E3A\u9700\u8981\u65E0\u72B6\u6001\u8BA4\u8BC1\uFF09
  - \`[ARCHITECTURE]\` \u67B6\u6784\u6A21\u5F0F\u3001\u6570\u636E\u6D41\uFF08\u5982\uFF1A[ARCHITECTURE] \u4E09\u5C42\u67B6\u6784\uFF1AController \u2192 Service \u2192 Repository\uFF09
- \`--files\` MUST list every created/modified file (enables isolated git commits).
- If task failed: \`echo 'FAILED: \u539F\u56E0 [REMEMBER] \u5931\u8D25\u6839\u56E0' | node flow.js checkpoint <id>\`
- If sub-agent replies WITHOUT running checkpoint \u2192 protocol failure. Main agent MUST run fallback checkpoint in step 3.

### Security Rules (sub-agents MUST follow)
- SQL: parameterized queries only. XSS: no unsanitized v-html/innerHTML.
- Auth: secrets from env vars, bcrypt passwords, token expiry.
- Input: validate at entry points. Never log passwords. Never commit .env.

### Finalization (MANDATORY \u2014 skipping = protocol failure)
1. Run \`node flow.js finish\` \u2014 runs verify (build/test/lint). If fail \u2192 dispatch sub-agent to fix \u2192 retry finish.
2. When finish output contains "\u9A8C\u8BC1\u901A\u8FC7" \u2192 dispatch a sub-agent to run /code-review:code-review. Fix issues if any.
3. Run \`node flow.js review\` to mark code-review done.
4. **AI \u53CD\u601D\uFF08\u8FDB\u5316\u5F15\u64CE\uFF0C\u53EF\u9009\uFF09**: \u8BE2\u95EE\u7528\u6237\uFF1A"\u672C\u8F6E\u5DE5\u4F5C\u6D41\u5DF2\u5B8C\u6210\uFF0C\u662F\u5426\u9488\u5BF9\u672C\u9879\u76EE\u8FDB\u884C\u53CD\u601D\u8FED\u4EE3\u8FDB\u5316\uFF1F\uFF08\u4F1A\u6D88\u8017\u989D\u5916 token\uFF09" \u7528\u6237\u540C\u610F\u540E\u624D\u6267\u884C\u3002Sub-agent MUST:
   - **MUST invoke /superpowers:brainstorming FIRST** \u2014 \u53CD\u601D\u5BF9\u8C61\u662F**\u5DE5\u4F5C\u6D41\u6267\u884C\u8FC7\u7A0B\u672C\u8EAB**\uFF08\u4EFB\u52A1\u6210\u529F\u7387\u3001\u91CD\u8BD5\u6A21\u5F0F\u3001\u5E76\u884C\u6548\u7387\u3001\u534F\u8BAE\u74F6\u9888\uFF09\uFF0CNOT \u76EE\u6807\u9879\u76EE\u7684\u4EE3\u7801\u6216\u67B6\u6784\u3002
   - Read \`.flowpilot/history/\` files to understand workflow stats
   - Read \`.flowpilot/evolution/\` files to see past experiments
   - Analyze: what went well, what could improve, config optimization opportunities
   - Pipe structured findings into: \`echo '[CONFIG] \u5C06 maxRetries \u63D0\u5347\u81F3 5\\n[PROTOCOL] \u5B50Agent\u5E94\u5148\u9A8C\u8BC1\u73AF\u5883\u518D\u7F16\u7801' | node flow.js evolve\`
   - Tags: \`[CONFIG]\` for config changes, \`[PROTOCOL]\` for instruction-file protocol changes
5. Run \`node flow.js finish\` again \u2014 verify passes + review done \u2192 final commit \u2192 idle.
**Loop: finish(verify) \u2192 review(code-review) \u2192 evolve(AI\u53CD\u601D) \u2192 fix \u2192 finish again. All gates must pass.**
`;
function getProtocolTemplate(client = "other") {
  const codexBlock = client === "codex" ? `${CODEX_ENHANCED_GUIDELINES}
` : "";
  return `<!-- flowpilot:start -->
${COMMON_AGENT_GUIDELINES}
${codexBlock}${FLOWPILOT_PROTOCOL_BODY}
<!-- flowpilot:end -->`;
}
var PROTOCOL_TEMPLATE = getProtocolTemplate("other");

// src/infrastructure/runtime-state.ts
var import_fs = require("fs");
var import_promises = require("fs/promises");
var import_os = require("os");
var import_path = require("path");
var DEFAULT_INVALID_LOCK_STALE_AFTER_MS = 3e4;
var LINUX_BOOT_ID_PATH = "/proc/sys/kernel/random/boot_id";
var RUNTIME_DIR = ".workflow";
var ACTIVATED_FILE = "activated.json";
var DIRTY_BASELINE_FILE = "dirty-baseline.json";
var OWNED_FILES_FILE = "owned-files.json";
var SETUP_OWNED_FILES_FILE = "setup-owned.json";
var RECONCILE_STATE_FILE = "reconcile-state.json";
var TASK_PULSES_FILE = "task-pulses.json";
var INJECTIONS_FILE = "injections.json";
var RUNTIME_PATH_PREFIXES = [".flowpilot/", ".workflow/"];
var RUNTIME_FILES = /* @__PURE__ */ new Set([".claude/settings.json"]);
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isValidCreatedAt(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
function runtimeDir(basePath2) {
  return (0, import_path.join)(basePath2, RUNTIME_DIR);
}
function runtimePath(basePath2, fileName) {
  return (0, import_path.join)(runtimeDir(basePath2), fileName);
}
function normalizeRuntimePath(file) {
  return file.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}
function isRuntimeMetadataPath(file) {
  return RUNTIME_FILES.has(file) || RUNTIME_PATH_PREFIXES.some((prefix) => file === prefix.slice(0, -1) || file.startsWith(prefix));
}
function isActivationMetadata(value) {
  return isRecord(value) && typeof value.time === "number" && Number.isFinite(value.time) && Number.isInteger(value.pid) && value.pid > 0;
}
function normalizeDirtyFiles(files) {
  const seen = /* @__PURE__ */ new Set();
  const normalized = files.map(normalizeRuntimePath).filter((file) => file.length > 0).filter((file) => !isRuntimeMetadataPath(file));
  for (const file of normalized) {
    seen.add(file);
  }
  return [...seen].sort();
}
function isOwnedFilesState(value) {
  return isRecord(value) && isRecord(value.byTask);
}
function isSetupOwnedState(value) {
  return isRecord(value) && Array.isArray(value.files);
}
function isReconcileState(value) {
  return isRecord(value) && Array.isArray(value.taskIds);
}
function isTaskPulsePhase(value) {
  return value === "analysis" || value === "implementation" || value === "verification" || value === "blocked";
}
function isTaskPulseStateEntry(value) {
  return isRecord(value) && isTaskPulsePhase(value.phase) && isValidCreatedAt(value.updatedAt) && (value.note === void 0 || typeof value.note === "string");
}
function isTaskPulseState(value) {
  return isRecord(value) && isRecord(value.byTask) && Object.values(value.byTask).every(isTaskPulseStateEntry);
}
function isHookEntry(value) {
  if (!isRecord(value) || typeof value.matcher !== "string" || !Array.isArray(value.hooks)) {
    return false;
  }
  return value.hooks.every((hook) => isRecord(hook) && typeof hook.type === "string" && typeof hook.prompt === "string");
}
function isExactFileSnapshot(value) {
  return isRecord(value) && typeof value.exists === "boolean" && (value.rawContent === void 0 || typeof value.rawContent === "string");
}
function isClaudeMdInjectionState(value) {
  return isRecord(value) && typeof value.created === "boolean" && typeof value.block === "string" && (value.path === void 0 || typeof value.path === "string") && (value.scaffold === void 0 || typeof value.scaffold === "string");
}
function isHooksInjectionState(value) {
  return isRecord(value) && typeof value.created === "boolean" && Array.isArray(value.preToolUse) && value.preToolUse.every(isHookEntry) && (value.settingsBaseline === void 0 || isExactFileSnapshot(value.settingsBaseline));
}
function isGitignoreInjectionState(value) {
  return isRecord(value) && typeof value.created === "boolean" && Array.isArray(value.rules) && value.rules.every((rule) => typeof rule === "string") && (value.baseline === void 0 || isExactFileSnapshot(value.baseline));
}
function isSetupInjectionManifest(value) {
  return isRecord(value) && (value.claudeMd === void 0 || isClaudeMdInjectionState(value.claudeMd)) && (value.roleMd === void 0 || isClaudeMdInjectionState(value.roleMd)) && (value.hooks === void 0 || isHooksInjectionState(value.hooks)) && (value.gitignore === void 0 || isGitignoreInjectionState(value.gitignore));
}
function normalizeSetupOwnedState(state) {
  return {
    files: normalizeDirtyFiles(state.files.filter((file) => typeof file === "string"))
  };
}
function normalizeReconcileState(state) {
  return {
    taskIds: [...new Set(
      state.taskIds.filter((taskId) => typeof taskId === "string").map((taskId) => taskId.trim()).filter((taskId) => taskId.length > 0)
    )]
  };
}
function normalizeTaskPulseState(state) {
  return {
    byTask: Object.fromEntries(
      Object.entries(state.byTask).filter(([taskId]) => taskId.trim().length > 0).filter(([, entry]) => isTaskPulseStateEntry(entry)).map(([taskId, entry]) => [
        taskId.trim(),
        {
          phase: entry.phase,
          updatedAt: entry.updatedAt,
          ...entry.note && entry.note.trim().length > 0 ? { note: entry.note.trim() } : {}
        }
      ])
    )
  };
}
function normalizeOwnedFilesState(state) {
  return {
    byTask: Object.fromEntries(
      Object.entries(state.byTask).filter(([taskId]) => taskId.trim().length > 0).map(([taskId, files]) => [taskId, normalizeDirtyFiles(Array.isArray(files) ? files.filter((file) => typeof file === "string") : [])])
    )
  };
}
function dedupeHookEntries(entries) {
  const byMatcher = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    byMatcher.set(entry.matcher, {
      matcher: entry.matcher,
      hooks: entry.hooks.map((hook) => ({ type: hook.type, prompt: hook.prompt }))
    });
  }
  return [...byMatcher.values()].sort((a, b) => a.matcher.localeCompare(b.matcher));
}
function normalizeSetupInjectionManifest(manifest) {
  const normalized = {};
  if (manifest.claudeMd) {
    normalized.claudeMd = {
      created: manifest.claudeMd.created,
      block: manifest.claudeMd.block,
      ...manifest.claudeMd.path !== void 0 ? { path: manifest.claudeMd.path } : {},
      ...manifest.claudeMd.scaffold !== void 0 ? { scaffold: manifest.claudeMd.scaffold } : {}
    };
  }
  if (manifest.roleMd) {
    normalized.roleMd = {
      created: manifest.roleMd.created,
      block: manifest.roleMd.block,
      ...manifest.roleMd.path !== void 0 ? { path: manifest.roleMd.path } : {},
      ...manifest.roleMd.scaffold !== void 0 ? { scaffold: manifest.roleMd.scaffold } : {}
    };
  }
  if (manifest.hooks) {
    normalized.hooks = {
      created: manifest.hooks.created,
      preToolUse: dedupeHookEntries(manifest.hooks.preToolUse),
      ...manifest.hooks.settingsBaseline ? {
        settingsBaseline: {
          exists: manifest.hooks.settingsBaseline.exists,
          ...manifest.hooks.settingsBaseline.rawContent !== void 0 ? { rawContent: manifest.hooks.settingsBaseline.rawContent } : {}
        }
      } : {}
    };
  }
  if (manifest.gitignore) {
    normalized.gitignore = {
      created: manifest.gitignore.created,
      rules: [...new Set(manifest.gitignore.rules)],
      ...manifest.gitignore.baseline ? {
        baseline: {
          exists: manifest.gitignore.baseline.exists,
          ...manifest.gitignore.baseline.rawContent !== void 0 ? { rawContent: manifest.gitignore.baseline.rawContent } : {}
        }
      } : {}
    };
  }
  return normalized;
}
function compareDirtyFilesAgainstBaseline(currentFiles, baselineFiles) {
  const normalizedCurrentFiles = normalizeDirtyFiles(currentFiles);
  const normalizedBaselineFiles = normalizeDirtyFiles(baselineFiles);
  const baselineSet = new Set(normalizedBaselineFiles);
  return {
    currentFiles: normalizedCurrentFiles,
    preservedBaselineFiles: normalizedCurrentFiles.filter((file) => baselineSet.has(file)),
    newDirtyFiles: normalizedCurrentFiles.filter((file) => !baselineSet.has(file))
  };
}
function classifyResumeDirtyFiles(currentFiles, baselineFiles, setupOwnedFiles, taskOwnedFiles) {
  const comparison = compareDirtyFilesAgainstBaseline(currentFiles, baselineFiles ?? []);
  const setupOwnedSet = new Set(normalizeDirtyFiles(setupOwnedFiles));
  const taskOwnedSet = new Set(normalizeDirtyFiles(taskOwnedFiles));
  const candidateFiles = (baselineFiles ? comparison.newDirtyFiles : comparison.currentFiles).filter((file) => !setupOwnedSet.has(file));
  return {
    currentFiles: comparison.currentFiles.filter((file) => !setupOwnedSet.has(file)),
    preservedBaselineFiles: comparison.preservedBaselineFiles.filter((file) => !setupOwnedSet.has(file)),
    taskOwnedResidueFiles: candidateFiles.filter((file) => taskOwnedSet.has(file)),
    ambiguousFiles: candidateFiles.filter((file) => !taskOwnedSet.has(file))
  };
}
function getRuntimeLocalityToken() {
  try {
    const token = (0, import_fs.readFileSync)(LINUX_BOOT_ID_PATH, "utf-8").trim();
    return token.length > 0 ? token : void 0;
  } catch {
    return void 0;
  }
}
function createRuntimeLockMetadata() {
  const localityToken = getRuntimeLocalityToken();
  return {
    pid: process.pid,
    hostname: (0, import_os.hostname)(),
    createdAt: (/* @__PURE__ */ new Date()).toISOString(),
    ...localityToken ? { localityToken } : {}
  };
}
function serializeRuntimeLock(metadata) {
  return JSON.stringify(metadata);
}
function parseRuntimeLock(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return { valid: false, reason: "invalid-shape" };
    const pid = parsed.pid;
    const hostname2 = parsed.hostname;
    const createdAt = parsed.createdAt;
    const localityToken = parsed.localityToken;
    if (!Number.isInteger(pid) || pid <= 0 || typeof hostname2 !== "string" || hostname2.length === 0 || !isValidCreatedAt(createdAt) || localityToken !== void 0 && (typeof localityToken !== "string" || localityToken.length === 0)) {
      return { valid: false, reason: "invalid-shape" };
    }
    return {
      valid: true,
      metadata: {
        pid,
        hostname: hostname2,
        createdAt,
        ...typeof localityToken === "string" ? { localityToken } : {}
      }
    };
  } catch {
    return { valid: false, reason: "invalid-json" };
  }
}
function getRuntimeLockAgeMs(metadata, nowMs = Date.now()) {
  return Math.max(0, nowMs - Date.parse(metadata.createdAt));
}
function isRuntimeLockOwnedByProcess(parsed, pid = process.pid, currentHostname = (0, import_os.hostname)(), currentLocalityToken = getRuntimeLocalityToken()) {
  if (!parsed.valid || parsed.metadata.pid !== pid || parsed.metadata.hostname !== currentHostname) {
    return false;
  }
  if (parsed.metadata.localityToken === void 0) {
    return true;
  }
  return currentLocalityToken !== void 0 && parsed.metadata.localityToken === currentLocalityToken;
}
function isRuntimeLockStale(input) {
  if (!input.parsed.valid) {
    return {
      stale: input.fileAgeMs >= input.staleAfterMs,
      reason: "invalid-lock-payload",
      ageMs: input.fileAgeMs
    };
  }
  const ageMs = getRuntimeLockAgeMs(input.parsed.metadata, input.nowMs ?? Date.now());
  if (input.parsed.metadata.hostname !== input.currentHostname) {
    return {
      stale: false,
      reason: "foreign-host-lock",
      owner: input.parsed.metadata,
      ageMs
    };
  }
  if (input.parsed.metadata.localityToken !== void 0 && input.currentLocalityToken !== void 0) {
    if (input.parsed.metadata.localityToken !== input.currentLocalityToken) {
      return {
        stale: false,
        reason: "foreign-host-lock",
        owner: input.parsed.metadata,
        ageMs
      };
    }
  } else {
    return {
      stale: false,
      reason: "unverified-locality",
      owner: input.parsed.metadata,
      ageMs
    };
  }
  if (input.isProcessAlive(input.parsed.metadata.pid)) {
    return {
      stale: false,
      reason: "live-owner",
      owner: input.parsed.metadata,
      ageMs
    };
  }
  return {
    stale: true,
    reason: "dead-owner",
    owner: input.parsed.metadata,
    ageMs
  };
}
async function loadActivationState(basePath2) {
  try {
    const parsed = JSON.parse(await (0, import_promises.readFile)(runtimePath(basePath2, ACTIVATED_FILE), "utf-8"));
    if (!isRecord(parsed)) return {};
    const entries = Object.entries(parsed).filter((entry) => isActivationMetadata(entry[1]));
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}
async function recordTaskActivations(basePath2, ids, nowMs = Date.now(), pid = process.pid) {
  const current = await loadActivationState(basePath2);
  const next = ids.reduce(
    (state, id) => ({ ...state, [id]: { time: nowMs, pid } }),
    current
  );
  await (0, import_promises.mkdir)(runtimeDir(basePath2), { recursive: true });
  const path = runtimePath(basePath2, ACTIVATED_FILE);
  await (0, import_promises.writeFile)(path + ".tmp", JSON.stringify(next), "utf-8");
  await (0, import_promises.rename)(path + ".tmp", path);
  return next;
}
async function getTaskActivationAge(basePath2, id, _pid = process.pid, nowMs = Date.now()) {
  const state = await loadActivationState(basePath2);
  const entry = state[id];
  if (!entry) return Infinity;
  return Math.max(0, nowMs - entry.time);
}
async function loadDirtyBaseline(basePath2) {
  try {
    const parsed = JSON.parse(await (0, import_promises.readFile)(runtimePath(basePath2, DIRTY_BASELINE_FILE), "utf-8"));
    if (!isRecord(parsed) || !isValidCreatedAt(parsed.capturedAt) || !Array.isArray(parsed.files)) {
      return null;
    }
    const files = parsed.files.filter((file) => typeof file === "string");
    return {
      capturedAt: parsed.capturedAt,
      files: normalizeDirtyFiles(files)
    };
  } catch {
    return null;
  }
}
async function saveDirtyBaseline(basePath2, files, capturedAt = (/* @__PURE__ */ new Date()).toISOString()) {
  const baseline = {
    capturedAt,
    files: normalizeDirtyFiles(files)
  };
  await (0, import_promises.mkdir)(runtimeDir(basePath2), { recursive: true });
  const path = runtimePath(basePath2, DIRTY_BASELINE_FILE);
  await (0, import_promises.writeFile)(path + ".tmp", JSON.stringify(baseline), "utf-8");
  await (0, import_promises.rename)(path + ".tmp", path);
  return baseline;
}
async function loadOwnedFiles(basePath2) {
  try {
    const parsed = JSON.parse(await (0, import_promises.readFile)(runtimePath(basePath2, OWNED_FILES_FILE), "utf-8"));
    if (!isOwnedFilesState(parsed)) {
      return { byTask: {} };
    }
    return normalizeOwnedFilesState(parsed);
  } catch {
    return { byTask: {} };
  }
}
async function recordOwnedFiles(basePath2, taskId, files) {
  const current = await loadOwnedFiles(basePath2);
  const next = normalizeOwnedFilesState({
    byTask: {
      ...current.byTask,
      [taskId]: normalizeDirtyFiles(files)
    }
  });
  await (0, import_promises.mkdir)(runtimeDir(basePath2), { recursive: true });
  const path = runtimePath(basePath2, OWNED_FILES_FILE);
  await (0, import_promises.writeFile)(path + ".tmp", JSON.stringify(next), "utf-8");
  await (0, import_promises.rename)(path + ".tmp", path);
  return next;
}
async function loadSetupOwnedFiles(basePath2) {
  try {
    const parsed = JSON.parse(await (0, import_promises.readFile)(runtimePath(basePath2, SETUP_OWNED_FILES_FILE), "utf-8"));
    if (!isSetupOwnedState(parsed)) {
      return { files: [] };
    }
    return normalizeSetupOwnedState(parsed);
  } catch {
    return { files: [] };
  }
}
async function loadTaskPulseState(basePath2) {
  try {
    const parsed = JSON.parse(await (0, import_promises.readFile)(runtimePath(basePath2, TASK_PULSES_FILE), "utf-8"));
    if (!isTaskPulseState(parsed)) return { byTask: {} };
    return normalizeTaskPulseState(parsed);
  } catch {
    return { byTask: {} };
  }
}
async function saveTaskPulseState(basePath2, state) {
  const normalized = normalizeTaskPulseState(state);
  await (0, import_promises.mkdir)(runtimeDir(basePath2), { recursive: true });
  const path = runtimePath(basePath2, TASK_PULSES_FILE);
  await (0, import_promises.writeFile)(path + ".tmp", JSON.stringify(normalized, null, 2) + "\n", "utf-8");
  await (0, import_promises.rename)(path + ".tmp", path);
  return normalized;
}
async function recordTaskPulse(basePath2, taskId, entry) {
  const current = await loadTaskPulseState(basePath2);
  return saveTaskPulseState(basePath2, {
    byTask: {
      ...current.byTask,
      [taskId]: {
        phase: entry.phase,
        updatedAt: entry.updatedAt,
        ...entry.note && entry.note.trim().length > 0 ? { note: entry.note.trim() } : {}
      }
    }
  });
}
async function clearTaskPulse(basePath2, taskId) {
  const current = await loadTaskPulseState(basePath2);
  if (!current.byTask[taskId]) return current;
  const next = { ...current.byTask };
  delete next[taskId];
  return saveTaskPulseState(basePath2, { byTask: next });
}
function mergeTaskPulsesIntoProgress(data, pulseState) {
  return {
    ...data,
    tasks: data.tasks.map((task) => {
      const pulse = pulseState.byTask[task.id];
      if (!pulse) return task;
      return {
        ...task,
        phase: pulse.phase,
        phaseUpdatedAt: pulse.updatedAt,
        ...pulse.note ? { phaseNote: pulse.note } : {}
      };
    })
  };
}
async function saveSetupOwnedFiles(basePath2, files) {
  const next = normalizeSetupOwnedState({ files });
  await (0, import_promises.mkdir)(runtimeDir(basePath2), { recursive: true });
  const path = runtimePath(basePath2, SETUP_OWNED_FILES_FILE);
  await (0, import_promises.writeFile)(path + ".tmp", JSON.stringify(next), "utf-8");
  await (0, import_promises.rename)(path + ".tmp", path);
  return next;
}
async function loadReconcileState(basePath2) {
  try {
    const parsed = JSON.parse(await (0, import_promises.readFile)(runtimePath(basePath2, RECONCILE_STATE_FILE), "utf-8"));
    if (!isReconcileState(parsed)) {
      return { taskIds: [] };
    }
    return normalizeReconcileState(parsed);
  } catch {
    return { taskIds: [] };
  }
}
async function saveReconcileState(basePath2, taskIds) {
  const next = normalizeReconcileState({ taskIds });
  await (0, import_promises.mkdir)(runtimeDir(basePath2), { recursive: true });
  const path = runtimePath(basePath2, RECONCILE_STATE_FILE);
  await (0, import_promises.writeFile)(path + ".tmp", JSON.stringify(next), "utf-8");
  await (0, import_promises.rename)(path + ".tmp", path);
  return next;
}
async function clearReconcileState(basePath2) {
  try {
    await (0, import_fs.unlink)(runtimePath(basePath2, RECONCILE_STATE_FILE));
  } catch {
  }
}
async function loadSetupInjectionManifest(basePath2) {
  try {
    const parsed = JSON.parse(await (0, import_promises.readFile)(runtimePath(basePath2, INJECTIONS_FILE), "utf-8"));
    if (!isSetupInjectionManifest(parsed)) {
      return {};
    }
    return normalizeSetupInjectionManifest(parsed);
  } catch {
    return {};
  }
}
async function mergeSetupInjectionManifest(basePath2, patch) {
  const current = await loadSetupInjectionManifest(basePath2);
  const next = normalizeSetupInjectionManifest({
    ...current,
    ...patch.claudeMd ? { claudeMd: patch.claudeMd } : {},
    ...patch.roleMd ? { roleMd: patch.roleMd } : {},
    ...patch.gitignore ? { gitignore: patch.gitignore } : {},
    ...patch.hooks ? {
      hooks: {
        created: current.hooks?.created || patch.hooks.created,
        preToolUse: [
          ...current.hooks?.preToolUse ?? [],
          ...patch.hooks.preToolUse
        ],
        settingsBaseline: current.hooks?.settingsBaseline ?? patch.hooks.settingsBaseline
      }
    } : {}
  });
  await (0, import_promises.mkdir)(runtimeDir(basePath2), { recursive: true });
  const path = runtimePath(basePath2, INJECTIONS_FILE);
  await (0, import_promises.writeFile)(path + ".tmp", JSON.stringify(next), "utf-8");
  await (0, import_promises.rename)(path + ".tmp", path);
  return next;
}
function collectOwnedFiles(state) {
  const allFiles = Object.values(state.byTask).flatMap((files) => files);
  return normalizeDirtyFiles(allFiles);
}
function defaultInvalidLockStaleAfterMs() {
  return DEFAULT_INVALID_LOCK_STALE_AFTER_MS;
}

// src/infrastructure/fs-repository.ts
var PERSISTENT_DIR = ".flowpilot";
var LEGACY_RUNTIME_DIR = ".workflow";
var CONFIG_FILE = "config.json";
var PRIMARY_INSTRUCTION_FILE = "AGENTS.md";
var LEGACY_INSTRUCTION_FILE = "CLAUDE.md";
var ROLE_INSTRUCTION_FILE = "ROLE.md";
var VALID_WORKFLOW_STATUS = /* @__PURE__ */ new Set(["idle", "running", "reconciling", "finishing", "completed", "aborted"]);
var VALID_TASK_STATUS = /* @__PURE__ */ new Set(["pending", "active", "done", "skipped", "failed"]);
function parseProgressMarkdown(raw) {
  const lines = raw.split("\n");
  const name = (lines[0] ?? "").replace(/^#\s*/, "").trim();
  let status = "idle";
  let current = null;
  let startTime;
  const tasks = [];
  for (const line of lines) {
    if (line.startsWith("\u72B6\u6001: ")) {
      const parsedStatus = line.slice(4).trim();
      status = VALID_WORKFLOW_STATUS.has(parsedStatus) ? parsedStatus : "idle";
    }
    if (line.startsWith("\u5F53\u524D: ")) current = line.slice(4).trim();
    if (current === "\u65E0") current = null;
    if (line.startsWith("\u5F00\u59CB: ")) startTime = line.slice(4).trim();
    const matchedTask = line.match(/^\|\s*(\d{3,})\s*\|\s*(.+?)\s*\|\s*(\w+)\s*\|\s*([^|]*?)\s*\|\s*(\w+)\s*\|\s*(\d+)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*(?:\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*)?\|$/);
    if (matchedTask) {
      const depsRaw = matchedTask[4].trim();
      const phase = matchedTask[9] === "-" || matchedTask[9] === void 0 ? void 0 : matchedTask[9];
      const phaseUpdatedAt = matchedTask[10] === "-" || matchedTask[10] === void 0 ? void 0 : matchedTask[10];
      const phaseNote = matchedTask[11] === "-" || matchedTask[11] === void 0 ? void 0 : matchedTask[11];
      tasks.push({
        id: matchedTask[1],
        title: matchedTask[2],
        type: matchedTask[3],
        deps: depsRaw === "-" ? [] : depsRaw.split(",").map((dep) => dep.trim()),
        status: VALID_TASK_STATUS.has(matchedTask[5]) ? matchedTask[5] : "pending",
        retries: parseInt(matchedTask[6], 10),
        summary: matchedTask[7] === "-" ? "" : matchedTask[7],
        description: matchedTask[8] === "-" ? "" : matchedTask[8],
        ...phase ? { phase } : {},
        ...phaseUpdatedAt ? { phaseUpdatedAt } : {},
        ...phaseNote ? { phaseNote } : {}
      });
    }
  }
  return { name, status, current, tasks, ...startTime ? { startTime } : {} };
}
async function readConfigFile(path) {
  try {
    const parsed = JSON.parse(await (0, import_promises2.readFile)(path, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return null;
  }
}
async function readPersistedConfig(basePath2) {
  const currentConfig = await readConfigFile((0, import_path2.join)(basePath2, PERSISTENT_DIR, CONFIG_FILE));
  if (currentConfig) return currentConfig;
  return readConfigFile((0, import_path2.join)(basePath2, LEGACY_RUNTIME_DIR, CONFIG_FILE));
}
async function loadProtocolTemplate(basePath2, client = "other") {
  const config = await readPersistedConfig(basePath2);
  const protocolTemplate = config?.protocolTemplate;
  if (typeof protocolTemplate === "string" && protocolTemplate.length > 0) {
    try {
      return await (0, import_promises2.readFile)((0, import_path2.join)(basePath2, protocolTemplate), "utf-8");
    } catch {
    }
  }
  return client === "other" ? PROTOCOL_TEMPLATE : getProtocolTemplate(client);
}
function hookEntry(matcher) {
  return {
    matcher,
    hooks: [{ type: "prompt", prompt: "BLOCK this tool call. FlowPilot requires using node flow.js commands instead of native task tools." }]
  };
}
function dedupeHookEntries2(entries) {
  const seen = /* @__PURE__ */ new Set();
  const result = [];
  for (const entry of entries) {
    if (seen.has(entry.matcher)) continue;
    seen.add(entry.matcher);
    result.push({
      matcher: entry.matcher,
      hooks: entry.hooks.map((hook) => ({ type: hook.type, prompt: hook.prompt }))
    });
  }
  return result;
}
function isHookEntry2(value) {
  return Boolean(value) && typeof value === "object" && typeof value.matcher === "string" && Array.isArray(value.hooks) && value.hooks.every((hook) => Boolean(hook) && typeof hook.type === "string" && typeof hook.prompt === "string");
}
function serializeHookEntry(entry) {
  return JSON.stringify({
    matcher: entry.matcher,
    hooks: entry.hooks.map((hook) => ({ type: hook.type, prompt: hook.prompt }))
  });
}
function normalizeCleanupContent(content) {
  if (content.trim().length === 0) {
    return "";
  }
  return content.replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
function cleanupClaudeContent(content, manifest) {
  const claude = manifest.claudeMd;
  if (!claude || claude.block.length === 0 || !content.includes(claude.block)) {
    return { effect: "noop" };
  }
  let next = content.replace(claude.block, "");
  if (claude.created && claude.scaffold && next.startsWith(claude.scaffold)) {
    next = next.slice(claude.scaffold.length);
  }
  const normalized = normalizeCleanupContent(next);
  if (normalized.length === 0) {
    return { effect: "delete" };
  }
  return normalized === content ? { effect: "noop" } : { effect: "write", content: normalized };
}
async function resolveInstructionFile(basePath2, client = "other") {
  const primaryPath = (0, import_path2.join)(basePath2, PRIMARY_INSTRUCTION_FILE);
  try {
    await (0, import_promises2.access)(primaryPath);
    return { absPath: primaryPath, relPath: PRIMARY_INSTRUCTION_FILE };
  } catch {
  }
  const legacyPath = (0, import_path2.join)(basePath2, LEGACY_INSTRUCTION_FILE);
  try {
    await (0, import_promises2.access)(legacyPath);
    return { absPath: legacyPath, relPath: LEGACY_INSTRUCTION_FILE };
  } catch {
  }
  if (client === "claude") {
    return { absPath: legacyPath, relPath: LEGACY_INSTRUCTION_FILE };
  }
  return { absPath: primaryPath, relPath: PRIMARY_INSTRUCTION_FILE };
}
async function ensureInstructionDocument(basePath2, relPath, client = "other") {
  const path = (0, import_path2.join)(basePath2, relPath);
  const marker = "<!-- flowpilot:start -->";
  const block = (await loadProtocolTemplate(basePath2, client)).trim();
  let created = false;
  let scaffold = "";
  try {
    const content = await (0, import_promises2.readFile)(path, "utf-8");
    if (content.includes(marker)) return false;
    await (0, import_promises2.writeFile)(path, content.trimEnd() + "\n\n" + block + "\n", "utf-8");
  } catch {
    created = true;
    scaffold = "# Project\n\n";
    await (0, import_promises2.writeFile)(path, `${scaffold}${block}
`, "utf-8");
  }
  await mergeSetupInjectionManifest(basePath2, {
    [relPath === ROLE_INSTRUCTION_FILE ? "roleMd" : "claudeMd"]: {
      created,
      block,
      path: relPath,
      ...created ? { scaffold } : {}
    }
  });
  return true;
}
function cleanupHookSettings(settings, manifest) {
  const hooksManifest = manifest.hooks;
  if (!hooksManifest) return { effect: "noop" };
  const settingsHooks = settings.hooks;
  const hooks = settingsHooks && typeof settingsHooks === "object" && !Array.isArray(settingsHooks) ? settingsHooks : {};
  const currentPreToolUse = hooks.PreToolUse;
  const existingPreToolUse = Array.isArray(currentPreToolUse) ? currentPreToolUse.filter(isHookEntry2) : [];
  const ownedCounts = hooksManifest.preToolUse.reduce((counts, entry) => {
    const key = serializeHookEntry(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, /* @__PURE__ */ new Map());
  const remainingPreToolUse = existingPreToolUse.filter((entry) => {
    const key = serializeHookEntry(entry);
    const remaining = ownedCounts.get(key) ?? 0;
    if (remaining === 0) return true;
    ownedCounts.set(key, remaining - 1);
    return false;
  });
  const nextHooks = { ...hooks };
  if (remainingPreToolUse.length > 0) {
    nextHooks.PreToolUse = remainingPreToolUse;
  } else {
    delete nextHooks.PreToolUse;
  }
  const nextSettings = { ...settings };
  if (Object.keys(nextHooks).length > 0) {
    nextSettings.hooks = nextHooks;
  } else {
    delete nextSettings.hooks;
  }
  if (hooksManifest.created && Object.keys(nextSettings).length === 0) {
    return { effect: "delete" };
  }
  const serializedCurrent = JSON.stringify(settings, null, 2) + "\n";
  const baselineRaw = hooksManifest.settingsBaseline?.rawContent;
  if (hooksManifest.settingsBaseline?.exists && baselineRaw !== void 0) {
    try {
      const parsedBaseline = JSON.parse(baselineRaw);
      if (JSON.stringify(parsedBaseline) === JSON.stringify(nextSettings)) {
        return baselineRaw === serializedCurrent ? { effect: "noop" } : { effect: "write", content: baselineRaw };
      }
    } catch {
    }
  }
  const serializedNext = JSON.stringify(nextSettings, null, 2) + "\n";
  return serializedNext === serializedCurrent ? { effect: "noop" } : { effect: "write", content: serializedNext };
}
function isExactFileSnapshotEqual(snapshot, current) {
  if (!snapshot) return false;
  if (snapshot.exists !== current.exists) return false;
  if (!snapshot.exists) return true;
  return snapshot.rawContent === current.rawContent;
}
function cleanupGitignoreContent(content, manifest) {
  const gitignore = manifest.gitignore;
  if (!gitignore) return { effect: "noop" };
  const ownedRules = new Set(gitignore.rules.map((rule) => rule.trimEnd()));
  let removed = false;
  const remainingLines = content.split(/\r?\n/).filter((line) => {
    if (ownedRules.has(line.trimEnd())) {
      removed = true;
      return false;
    }
    return true;
  });
  if (!removed) {
    return { effect: "noop" };
  }
  while (remainingLines.length > 0 && remainingLines[remainingLines.length - 1] === "") {
    remainingLines.pop();
  }
  const normalized = remainingLines.length > 0 ? `${remainingLines.join("\n")}
` : "";
  if (normalized.length === 0) {
    return { effect: "noop" };
  }
  return normalized === content ? { effect: "noop" } : { effect: "write", content: normalized };
}
var FsWorkflowRepository = class {
  root;
  ctxDir;
  historyDir;
  evolutionDir;
  configDir;
  base;
  async snapshotExactFile(path) {
    try {
      return {
        exists: true,
        rawContent: await (0, import_promises2.readFile)(path, "utf-8")
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { exists: false };
      }
      throw error;
    }
  }
  constructor(basePath2) {
    this.base = basePath2;
    this.root = (0, import_path2.join)(basePath2, LEGACY_RUNTIME_DIR);
    this.ctxDir = (0, import_path2.join)(this.root, "context");
    this.configDir = (0, import_path2.join)(basePath2, PERSISTENT_DIR);
    this.historyDir = (0, import_path2.join)(basePath2, PERSISTENT_DIR, "history");
    this.evolutionDir = (0, import_path2.join)(basePath2, PERSISTENT_DIR, "evolution");
  }
  projectRoot() {
    return this.base;
  }
  async ensure(dir) {
    await (0, import_promises2.mkdir)(dir, { recursive: true });
  }
  isProcessAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (error?.code === "ESRCH") return false;
      return true;
    }
  }
  async reclaimStaleLock(lockPath) {
    try {
      const [raw, fileStat] = await Promise.all([
        (0, import_promises2.readFile)(lockPath, "utf-8"),
        (0, import_promises2.stat)(lockPath)
      ]);
      const parsed = parseRuntimeLock(raw);
      const decision = isRuntimeLockStale({
        parsed,
        fileAgeMs: Date.now() - fileStat.mtimeMs,
        staleAfterMs: defaultInvalidLockStaleAfterMs(),
        isProcessAlive: (pid) => this.isProcessAlive(pid),
        currentHostname: (0, import_os2.hostname)(),
        currentLocalityToken: getRuntimeLocalityToken()
      });
      if (!decision.stale) return false;
      await (0, import_promises2.unlink)(lockPath);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return true;
      return false;
    }
  }
  async describeLockFailure(lockPath) {
    try {
      const raw = await (0, import_promises2.readFile)(lockPath, "utf-8");
      const parsed = parseRuntimeLock(raw);
      if (!parsed.valid) return "\u65E0\u6CD5\u83B7\u53D6\u6587\u4EF6\u9501\uFF1A\u73B0\u6709\u9501\u5143\u6570\u636E\u65E0\u6548\u4E14\u672A\u8FBE\u5230\u5B89\u5168\u56DE\u6536\u6761\u4EF6";
      const ageMs = Math.max(0, Date.now() - Date.parse(parsed.metadata.createdAt));
      if (parsed.metadata.hostname === (0, import_os2.hostname)() && parsed.metadata.localityToken === void 0) {
        return "\u65E0\u6CD5\u83B7\u53D6\u6587\u4EF6\u9501\uFF1A\u540C\u4E3B\u673A\u9501\u7F3A\u5C11\u53EF\u8BC1\u660E\u672C\u5730\u6027\u7684\u5143\u6570\u636E\uFF0C\u62D2\u7EDD\u76F2\u76EE\u56DE\u6536";
      }
      return `\u65E0\u6CD5\u83B7\u53D6\u6587\u4EF6\u9501\uFF1A\u5F53\u524D\u7531 pid ${parsed.metadata.pid} \u5728 ${parsed.metadata.hostname} \u4E0A\u6301\u6709\uFF0C\u5DF2\u5B58\u5728 ${ageMs}ms`;
    } catch {
      return "\u65E0\u6CD5\u83B7\u53D6\u6587\u4EF6\u9501";
    }
  }
  /** 文件锁：用 O_EXCL 创建 lockfile，防止并发读写 */
  async lock(maxWait = 5e3) {
    await this.ensure(this.root);
    const lockPath = (0, import_path2.join)(this.root, ".lock");
    const start = Date.now();
    const tryAcquire = async () => {
      let fd;
      try {
        fd = (0, import_fs2.openSync)(lockPath, "wx");
      } catch (error) {
        if (error?.code === "EEXIST") return false;
        throw error;
      }
      try {
        const payload = serializeRuntimeLock(createRuntimeLockMetadata());
        (0, import_fs2.writeFileSync)(fd, payload, "utf-8");
      } catch (error) {
        try {
          (0, import_fs2.closeSync)(fd);
        } catch {
        }
        try {
          await (0, import_promises2.unlink)(lockPath);
        } catch {
        }
        throw error;
      }
      try {
        (0, import_fs2.closeSync)(fd);
        return true;
      } catch (error) {
        try {
          await (0, import_promises2.unlink)(lockPath);
        } catch {
        }
        throw error;
      }
    };
    while (Date.now() - start < maxWait) {
      if (await tryAcquire()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    const reclaimed = await this.reclaimStaleLock(lockPath);
    if (reclaimed && await tryAcquire()) return;
    throw new Error(await this.describeLockFailure(lockPath));
  }
  async unlock() {
    const lockPath = (0, import_path2.join)(this.root, ".lock");
    try {
      const raw = await (0, import_promises2.readFile)(lockPath, "utf-8");
      const parsed = parseRuntimeLock(raw);
      if (!isRuntimeLockOwnedByProcess(parsed)) return;
      await (0, import_promises2.unlink)(lockPath);
    } catch {
    }
  }
  // --- progress.md 读写 ---
  async saveProgress(data) {
    await this.ensure(this.root);
    const lines = [
      `# ${data.name}`,
      "",
      `\u72B6\u6001: ${data.status}`,
      `\u5F53\u524D: ${data.current ?? "\u65E0"}`,
      ...data.startTime ? [`\u5F00\u59CB: ${data.startTime}`] : [],
      "",
      "| ID | \u6807\u9898 | \u7C7B\u578B | \u4F9D\u8D56 | \u72B6\u6001 | \u91CD\u8BD5 | \u6458\u8981 | \u63CF\u8FF0 | \u9636\u6BB5 | \u6700\u8FD1\u66F4\u65B0 | \u9636\u6BB5\u8FDB\u5C55 |",
      "|----|------|------|------|------|------|------|------|------|----------|----------|"
    ];
    for (const t of data.tasks) {
      const deps = t.deps.length ? t.deps.join(",") : "-";
      const esc = (s) => (s || "-").replace(/\|/g, "\u2223").replace(/\n/g, " ");
      lines.push(`| ${t.id} | ${esc(t.title)} | ${t.type} | ${deps} | ${t.status} | ${t.retries} | ${esc(t.summary)} | ${esc(t.description)} | ${esc(t.phase ?? "")} | ${esc(t.phaseUpdatedAt ?? "")} | ${esc(t.phaseNote ?? "")} |`);
    }
    const p = (0, import_path2.join)(this.root, "progress.md");
    await (0, import_promises2.writeFile)(p + ".tmp", lines.join("\n") + "\n", "utf-8");
    await (0, import_promises2.rename)(p + ".tmp", p);
  }
  async loadProgress() {
    try {
      const raw = await (0, import_promises2.readFile)((0, import_path2.join)(this.root, "progress.md"), "utf-8");
      const data = parseProgressMarkdown(raw);
      const pulseState = await loadTaskPulseState(this.base);
      const activationState = await loadActivationState(this.base);
      const dataWithActivation = {
        ...data,
        tasks: data.tasks.map((task) => ({
          ...task,
          activatedAt: activationState[task.id]?.time
        }))
      };
      return mergeTaskPulsesIntoProgress(dataWithActivation, pulseState);
    } catch {
      return null;
    }
  }
  // --- context/ 任务详细产出 ---
  async clearContext() {
    await (0, import_promises2.rm)(this.ctxDir, { recursive: true, force: true });
  }
  async clearAll() {
    await (0, import_promises2.rm)(this.root, { recursive: true, force: true });
  }
  async saveTaskContext(taskId, content) {
    await this.ensure(this.ctxDir);
    const p = (0, import_path2.join)(this.ctxDir, `task-${taskId}.md`);
    await (0, import_promises2.writeFile)(p + ".tmp", content, "utf-8");
    await (0, import_promises2.rename)(p + ".tmp", p);
  }
  async loadTaskContext(taskId) {
    try {
      return await (0, import_promises2.readFile)((0, import_path2.join)(this.ctxDir, `task-${taskId}.md`), "utf-8");
    } catch {
      return null;
    }
  }
  // --- summary.md ---
  async saveSummary(content) {
    await this.ensure(this.ctxDir);
    const p = (0, import_path2.join)(this.ctxDir, "summary.md");
    await (0, import_promises2.writeFile)(p + ".tmp", content, "utf-8");
    await (0, import_promises2.rename)(p + ".tmp", p);
  }
  async loadSummary() {
    try {
      return await (0, import_promises2.readFile)((0, import_path2.join)(this.ctxDir, "summary.md"), "utf-8");
    } catch {
      return "";
    }
  }
  // --- tasks.md ---
  async saveTasks(content) {
    await this.ensure(this.root);
    await (0, import_promises2.writeFile)((0, import_path2.join)(this.root, "tasks.md"), content, "utf-8");
  }
  async loadTasks() {
    try {
      return await (0, import_promises2.readFile)((0, import_path2.join)(this.root, "tasks.md"), "utf-8");
    } catch {
      return null;
    }
  }
  async saveTaskPulse(taskId, update) {
    await recordTaskPulse(this.base, taskId, {
      phase: update.phase,
      updatedAt: update.updatedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
      ...update.note ? { note: update.note } : {}
    });
  }
  async loadTaskPulses() {
    const state = await loadTaskPulseState(this.base);
    return { ...state.byTask };
  }
  async clearTaskPulse(taskId) {
    await clearTaskPulse(this.base, taskId);
  }
  async ensureClaudeMd(client = "other") {
    const { relPath } = await resolveInstructionFile(this.base, client);
    return ensureInstructionDocument(this.base, relPath, client);
  }
  async ensureRoleMd(client = "other") {
    return ensureInstructionDocument(this.base, ROLE_INSTRUCTION_FILE, client);
  }
  async ensureHooks() {
    const dir = (0, import_path2.join)(this.base, ".claude");
    const path = (0, import_path2.join)(dir, "settings.json");
    const settingsBaseline = await this.snapshotExactFile(path);
    let settings = {};
    let created = false;
    try {
      const parsed = JSON.parse(settingsBaseline.rawContent ?? "");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && !Object.prototype.hasOwnProperty.call(parsed, "__proto__") && !Object.prototype.hasOwnProperty.call(parsed, "constructor")) {
        settings = parsed;
      }
    } catch (error) {
      if (error?.code === "ENOENT" || !settingsBaseline.exists) created = true;
    }
    if (!settingsBaseline.exists) {
      created = true;
    }
    const requiredPreToolUse = [hookEntry("TaskCreate"), hookEntry("TaskUpdate"), hookEntry("TaskList")];
    const currentHooks = settings.hooks;
    const hooks = currentHooks && typeof currentHooks === "object" && !Array.isArray(currentHooks) ? currentHooks : {};
    const currentPreToolUse = hooks.PreToolUse;
    const existingPreToolUse = Array.isArray(currentPreToolUse) ? currentPreToolUse.filter(isHookEntry2) : [];
    const existingMatchers = new Set(existingPreToolUse.map((entry) => entry.matcher).filter((matcher) => Boolean(matcher)));
    const missingPreToolUse = requiredPreToolUse.filter((entry) => !existingMatchers.has(entry.matcher));
    if (!created && !missingPreToolUse.length) return false;
    const nextSettings = {
      ...settings,
      hooks: {
        ...hooks,
        PreToolUse: dedupeHookEntries2([...existingPreToolUse, ...missingPreToolUse])
      }
    };
    await this.ensure(dir);
    await (0, import_promises2.writeFile)(path, JSON.stringify(nextSettings, null, 2) + "\n", "utf-8");
    if (missingPreToolUse.length > 0 || created) {
      await mergeSetupInjectionManifest(this.base, {
        hooks: {
          created,
          preToolUse: missingPreToolUse,
          settingsBaseline
        }
      });
    }
    return true;
  }
  async ensureLocalStateIgnored() {
    const path = (0, import_path2.join)(this.base, ".gitignore");
    const rules = [".workflow/", ".flowpilot/", ".claude/settings.json", ".claude/worktrees/"];
    const baseline = await this.snapshotExactFile(path);
    let created = false;
    try {
      const content = await (0, import_promises2.readFile)(path, "utf-8");
      const lines = content.split(/\r?\n/);
      const existingRules = new Set(lines.map((line) => line.trimEnd()));
      const missingRules = rules.filter((rule) => !existingRules.has(rule));
      if (missingRules.length === 0) return false;
      const nextContent = content.length === 0 ? `${missingRules.join("\n")}
` : `${content}${content.endsWith("\n") ? "" : "\n"}${missingRules.join("\n")}
`;
      await (0, import_promises2.writeFile)(path, nextContent, "utf-8");
      await mergeSetupInjectionManifest(this.base, {
        gitignore: {
          created: false,
          rules: missingRules,
          baseline
        }
      });
      return true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      created = true;
      await (0, import_promises2.writeFile)(path, `${rules.join("\n")}
`, "utf-8");
      await mergeSetupInjectionManifest(this.base, {
        gitignore: {
          created,
          rules,
          baseline
        }
      });
      return true;
    }
  }
  listChangedFiles() {
    return listChangedFiles(this.base);
  }
  commit(taskId, title, summary, files) {
    return autoCommit(taskId, title, summary, files, this.base);
  }
  cleanup() {
    gitCleanup();
  }
  verify() {
    return runVerify(this.base);
  }
  // --- .flowpilot/history/ 永久存储 ---
  async saveHistory(stats) {
    await this.ensure(this.historyDir);
    const ts = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    const p = (0, import_path2.join)(this.historyDir, `${ts}.json`);
    await (0, import_promises2.writeFile)(p, JSON.stringify(stats, null, 2), "utf-8");
  }
  async loadHistory() {
    try {
      const files = (await (0, import_promises2.readdir)(this.historyDir)).filter((f) => f.endsWith(".json")).sort();
      const results = [];
      for (const f of files) {
        try {
          results.push(JSON.parse(await (0, import_promises2.readFile)((0, import_path2.join)(this.historyDir, f), "utf-8")));
        } catch {
        }
      }
      return results;
    } catch {
      return [];
    }
  }
  // --- .flowpilot/config.json（兼容读取旧的 .workflow/config.json） ---
  async loadConfig() {
    const currentConfig = await readConfigFile((0, import_path2.join)(this.configDir, CONFIG_FILE));
    if (currentConfig) return currentConfig;
    const legacyConfig = await readConfigFile((0, import_path2.join)(this.root, CONFIG_FILE));
    if (!legacyConfig) return {};
    await this.saveConfig(legacyConfig);
    return legacyConfig;
  }
  async saveConfig(config) {
    await this.ensure(this.configDir);
    const path = (0, import_path2.join)(this.configDir, CONFIG_FILE);
    await (0, import_promises2.writeFile)(path + ".tmp", JSON.stringify(config, null, 2) + "\n", "utf-8");
    await (0, import_promises2.rename)(path + ".tmp", path);
  }
  /** 清理注入的 instruction file 协议块、hooks 和 .gitignore 规则，仅移除 FlowPilot-owned 内容 */
  async cleanupInjections() {
    const manifest = await loadSetupInjectionManifest(this.base);
    for (const mdRelPath of [manifest.claudeMd?.path ?? LEGACY_INSTRUCTION_FILE, manifest.roleMd?.path].filter(Boolean)) {
      const mdPath = (0, import_path2.join)(this.base, mdRelPath);
      try {
        const content = await (0, import_promises2.readFile)(mdPath, "utf-8");
        const cleaned = cleanupClaudeContent(content, {
          ...manifest,
          claudeMd: mdRelPath === manifest.roleMd?.path ? manifest.roleMd : manifest.claudeMd
        });
        if (cleaned.effect === "delete") {
          await (0, import_promises2.unlink)(mdPath);
        } else if (cleaned.effect === "write") {
          await (0, import_promises2.writeFile)(mdPath, cleaned.content, "utf-8");
        }
      } catch {
      }
    }
    const claudeDirPath = (0, import_path2.join)(this.base, ".claude");
    const settingsPath = (0, import_path2.join)(claudeDirPath, "settings.json");
    try {
      const parsed = JSON.parse(await (0, import_promises2.readFile)(settingsPath, "utf-8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const cleaned = cleanupHookSettings(parsed, manifest);
        if (cleaned.effect === "delete") {
          await (0, import_promises2.unlink)(settingsPath);
          try {
            await (0, import_promises2.rmdir)(claudeDirPath);
          } catch {
          }
        } else if (cleaned.effect === "write") {
          await (0, import_promises2.writeFile)(settingsPath, cleaned.content, "utf-8");
        }
      }
    } catch {
    }
    const gitignorePath = (0, import_path2.join)(this.base, ".gitignore");
    try {
      const content = await (0, import_promises2.readFile)(gitignorePath, "utf-8");
      const cleaned = cleanupGitignoreContent(content, manifest);
      if (cleaned.effect === "delete") {
        await (0, import_promises2.unlink)(gitignorePath);
      } else if (cleaned.effect === "write") {
        await (0, import_promises2.writeFile)(gitignorePath, cleaned.content, "utf-8");
      }
    } catch {
    }
  }
  async doesSettingsResidueMatchBaseline() {
    const manifest = await loadSetupInjectionManifest(this.base);
    const hooksManifest = manifest.hooks;
    if (!hooksManifest) return true;
    const baseline = hooksManifest.settingsBaseline;
    if (!baseline) return false;
    const current = await this.snapshotExactFile((0, import_path2.join)(this.base, ".claude", "settings.json"));
    return isExactFileSnapshotEqual(baseline, current);
  }
  async doesGitignoreResidueMatchPolicy() {
    const manifest = await loadSetupInjectionManifest(this.base);
    const gitignoreManifest = manifest.gitignore;
    if (!gitignoreManifest) return true;
    const current = await this.snapshotExactFile((0, import_path2.join)(this.base, ".gitignore"));
    const baseline = gitignoreManifest.baseline;
    if (baseline?.exists) {
      return isExactFileSnapshotEqual(baseline, current);
    }
    if (!current.exists) return false;
    const expected = `${gitignoreManifest.rules.join("\n")}
`;
    return current.rawContent === expected;
  }
  tag(taskId) {
    return tagTask(taskId, this.base);
  }
  rollback(taskId) {
    return rollbackToTask(taskId, this.base);
  }
  cleanTags() {
    cleanTags(this.base);
  }
  // --- .flowpilot/evolution/ 进化日志 ---
  async saveEvolution(entry) {
    await this.ensure(this.evolutionDir);
    const ts = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    await (0, import_promises2.writeFile)((0, import_path2.join)(this.evolutionDir, `${ts}.json`), JSON.stringify(entry, null, 2), "utf-8");
  }
  async loadEvolutions() {
    try {
      const files = (await (0, import_promises2.readdir)(this.evolutionDir)).filter((f) => f.endsWith(".json")).sort();
      const results = [];
      for (const f of files) {
        try {
          results.push(JSON.parse(await (0, import_promises2.readFile)((0, import_path2.join)(this.evolutionDir, f), "utf-8")));
        } catch {
        }
      }
      return results;
    } catch {
      return [];
    }
  }
};

// src/domain/task-store.ts
function buildIndex(tasks) {
  const m = /* @__PURE__ */ new Map();
  for (const t of tasks) m.set(t.id, t);
  return m;
}
function makeTaskId(n) {
  return String(n).padStart(3, "0");
}
function cascadeSkip(tasks) {
  let result = tasks.map((t) => ({ ...t }));
  let changed = true;
  while (changed) {
    changed = false;
    const idx = buildIndex(result);
    for (let i = 0; i < result.length; i++) {
      const t = result[i];
      if (t.status !== "pending") continue;
      const blocked = t.deps.some((d) => {
        const dep = idx.get(d);
        return dep && (dep.status === "failed" || dep.status === "skipped");
      });
      if (blocked) {
        result[i] = { ...t, status: "skipped", summary: "\u4F9D\u8D56\u4EFB\u52A1\u5931\u8D25\uFF0C\u5DF2\u8DF3\u8FC7" };
        changed = true;
      }
    }
  }
  return result;
}
function detectCycles(tasks) {
  const idx = buildIndex(tasks);
  const visited = /* @__PURE__ */ new Set();
  const inStack = /* @__PURE__ */ new Set();
  const parent = /* @__PURE__ */ new Map();
  function dfs(id) {
    visited.add(id);
    inStack.add(id);
    const task = idx.get(id);
    if (task) {
      for (const dep of task.deps) {
        if (!visited.has(dep)) {
          parent.set(dep, id);
          const cycle = dfs(dep);
          if (cycle) return cycle;
        } else if (inStack.has(dep)) {
          const path = [dep];
          let cur = id;
          while (cur !== dep) {
            path.push(cur);
            cur = parent.get(cur);
          }
          path.push(dep);
          return path.reverse();
        }
      }
    }
    inStack.delete(id);
    return null;
  }
  for (const t of tasks) {
    if (!visited.has(t.id)) {
      const cycle = dfs(t.id);
      if (cycle) return cycle;
    }
  }
  return null;
}
function findNextTask(tasks) {
  const pending = tasks.filter((t) => t.status === "pending");
  const cycle = detectCycles(pending);
  if (cycle) throw new Error(`\u5FAA\u73AF\u4F9D\u8D56: ${cycle.join(" -> ")}`);
  const idx = buildIndex(tasks);
  for (const t of tasks) {
    if (t.status !== "pending") continue;
    if (t.deps.every((d) => idx.get(d)?.status === "done")) return t;
  }
  return null;
}
function completeTask(data, id, summary) {
  const idx = buildIndex(data.tasks);
  if (!idx.has(id)) throw new Error(`\u4EFB\u52A1 ${id} \u4E0D\u5B58\u5728`);
  return {
    ...data,
    current: null,
    tasks: data.tasks.map((t) => t.id === id ? { ...t, status: "done", summary } : t)
  };
}
function failTask(data, id, maxRetries = 3) {
  const idx = buildIndex(data.tasks);
  if (!idx.has(id)) throw new Error(`\u4EFB\u52A1 ${id} \u4E0D\u5B58\u5728`);
  const old = idx.get(id);
  const retries = old.retries + 1;
  if (retries >= maxRetries) {
    return {
      result: "skip",
      data: { ...data, current: null, tasks: data.tasks.map((t) => t.id === id ? { ...t, retries, status: "failed" } : t) }
    };
  }
  return {
    result: "retry",
    data: { ...data, current: null, tasks: data.tasks.map((t) => t.id === id ? { ...t, retries, status: "pending" } : t) }
  };
}
function resumeProgress(data) {
  const hasActive = data.tasks.some((t) => t.status === "active");
  if (!hasActive) {
    return { data, resetId: data.status === "running" ? data.current : null };
  }
  let firstId = null;
  const tasks = data.tasks.map((t) => {
    if (t.status === "active") {
      if (!firstId) firstId = t.id;
      return { ...t, status: "pending" };
    }
    return t;
  });
  return { data: { ...data, current: null, status: "running", tasks }, resetId: firstId };
}
function findParallelTasks(tasks) {
  const pending = tasks.filter((t) => t.status === "pending");
  const cycle = detectCycles(pending);
  if (cycle) throw new Error(`\u5FAA\u73AF\u4F9D\u8D56: ${cycle.join(" -> ")}`);
  const idx = buildIndex(tasks);
  return tasks.filter((t) => {
    if (t.status !== "pending") return false;
    return t.deps.every((d) => idx.get(d)?.status === "done");
  });
}
function isAllDone(tasks) {
  return tasks.every((t) => t.status === "done" || t.status === "skipped" || t.status === "failed");
}
function reopenRollbackBranch(tasks, targetId) {
  const idx = buildIndex(tasks);
  if (!idx.has(targetId)) throw new Error(`\u4EFB\u52A1 ${targetId} \u4E0D\u5B58\u5728`);
  const dependents = /* @__PURE__ */ new Map();
  for (const task of tasks) {
    for (const dep of task.deps) {
      const downstream = dependents.get(dep) ?? [];
      dependents.set(dep, [...downstream, task.id]);
    }
  }
  const affected = /* @__PURE__ */ new Set();
  const stack = [targetId];
  while (stack.length) {
    const current = stack.pop();
    if (affected.has(current)) continue;
    affected.add(current);
    for (const downstreamId of dependents.get(current) ?? []) {
      stack.push(downstreamId);
    }
  }
  return tasks.map((task) => {
    if (!affected.has(task.id)) return { ...task };
    return { ...task, status: "pending", summary: "", retries: 0 };
  });
}

// src/infrastructure/markdown-parser.ts
var TASK_RE = /^(\d+)\.\s+\[\s*(\w+)\s*\]\s+(.+?)(?:\s*\((?:deps?|依赖)\s*:\s*([^)]*)\))?\s*$/i;
var DESC_RE = /^\s{2,}(.+)$/;
var OPENSPEC_GROUP_RE = /^##\s+(\d+)\.\s+(.+)$/;
var OPENSPEC_TASK_RE = /^-\s+\[[ x]\]\s+(\d+)\.(\d+)\s+(.+)$/i;
function parseTasksMarkdown(markdown) {
  const isOpenSpec = markdown.split("\n").some((l) => OPENSPEC_TASK_RE.test(l));
  return isOpenSpec ? parseOpenSpecMarkdown(markdown) : parseFlowPilotMarkdown(markdown);
}
function parseOpenSpecMarkdown(markdown) {
  const lines = markdown.split("\n");
  let name = "";
  let description = "";
  const tasks = [];
  const groupTasks = /* @__PURE__ */ new Map();
  let currentGroup = 0;
  for (const line of lines) {
    if (!name && line.startsWith("# ") && !line.startsWith("## ")) {
      name = line.slice(2).trim();
      continue;
    }
    if (name && !description && !line.startsWith("#") && line.trim() && !OPENSPEC_TASK_RE.test(line)) {
      description = line.trim();
      continue;
    }
    const gm = line.match(OPENSPEC_GROUP_RE);
    if (gm) {
      currentGroup = parseInt(gm[1], 10);
      if (!groupTasks.has(currentGroup)) groupTasks.set(currentGroup, []);
      continue;
    }
    const tm = line.match(OPENSPEC_TASK_RE);
    if (tm) {
      const groupNum = parseInt(tm[1], 10);
      const sysId = makeTaskId(tasks.length + 1);
      if (!groupTasks.has(groupNum)) groupTasks.set(groupNum, []);
      groupTasks.get(groupNum).push(sysId);
      let titleText = tm[3].trim();
      let type = "general";
      const typeMatch = titleText.match(/^\[\s*(frontend|backend|general)\s*\]\s+(.+)$/i);
      if (typeMatch) {
        type = typeMatch[1].toLowerCase();
        titleText = typeMatch[2];
      }
      const deps = groupNum > 1 && groupTasks.has(groupNum - 1) ? [...groupTasks.get(groupNum - 1)] : [];
      tasks.push({ title: titleText, type, deps, description: "" });
    }
  }
  if (!name) name = "OpenSpec Workflow";
  return { name, description, tasks };
}
function parseFlowPilotMarkdown(markdown) {
  const lines = markdown.split("\n");
  let name = "";
  let description = "";
  const tasks = [];
  const numToId = /* @__PURE__ */ new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!name && line.startsWith("# ")) {
      name = line.slice(2).trim();
      continue;
    }
    if (name && !description && !line.startsWith("#") && line.trim() && !TASK_RE.test(line)) {
      description = line.trim();
      continue;
    }
    const m = line.match(TASK_RE);
    if (m) {
      const userNum = m[1];
      const sysId = makeTaskId(tasks.length + 1);
      numToId.set(userNum.padStart(3, "0"), sysId);
      numToId.set(userNum, sysId);
      const validTypes = /* @__PURE__ */ new Set(["frontend", "backend", "general"]);
      const rawType = m[2].toLowerCase();
      const type = validTypes.has(rawType) ? rawType : "general";
      const title = m[3].trim();
      const rawDeps = m[4] ? m[4].split(",").map((d) => d.trim()).filter(Boolean) : [];
      let desc = "";
      while (i + 1 < lines.length && DESC_RE.test(lines[i + 1])) {
        i++;
        desc += (desc ? "\n" : "") + lines[i].trim();
      }
      tasks.push({ title, type, deps: rawDeps, description: desc });
    }
  }
  for (const t of tasks) {
    t.deps = t.deps.map((d) => numToId.get(d.padStart(3, "0")) || numToId.get(d) || makeTaskId(parseInt(d, 10))).filter(Boolean);
  }
  return { name, description, tasks };
}

// src/infrastructure/hooks.ts
var import_promises3 = require("fs/promises");
var import_child_process = require("child_process");
var import_path4 = require("path");

// src/infrastructure/logger.ts
var import_fs3 = require("fs");
var import_path3 = require("path");
var verbose = process.env.FLOWPILOT_VERBOSE === "1";
var basePath = null;
var workflowName = null;
function enableVerbose() {
  verbose = true;
  process.env.FLOWPILOT_VERBOSE = "1";
}
function configureLogger(projectPath) {
  basePath = projectPath;
}
function setWorkflowName(name) {
  workflowName = name;
}
function logFilePath() {
  if (!basePath || !workflowName) return null;
  return (0, import_path3.join)(basePath, ".flowpilot", "logs", `${workflowName}.jsonl`);
}
function persist(entry) {
  const p = logFilePath();
  if (!p) return;
  try {
    (0, import_fs3.mkdirSync)((0, import_path3.dirname)(p), { recursive: true });
    (0, import_fs3.appendFileSync)(p, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
  }
}
var log = {
  debug(msg) {
    if (verbose) process.stderr.write(`[DEBUG] ${msg}
`);
  },
  info(msg) {
    process.stderr.write(`[INFO] ${msg}
`);
  },
  warn(msg) {
    process.stderr.write(`[WARN] ${msg}
`);
  },
  /** 记录结构化日志条目 */
  step(step, message, opts) {
    const entry = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      step,
      level: opts?.level ?? "info",
      message,
      ...opts?.taskId != null && { taskId: opts.taskId },
      ...opts?.data != null && { data: opts.data },
      ...opts?.durationMs != null && { durationMs: opts.durationMs }
    };
    persist(entry);
    if (verbose) {
      process.stderr.write(`[STEP:${step}] ${message}
`);
    }
  }
};

// src/infrastructure/hooks.ts
async function loadHooksConfig(basePath2) {
  for (const configPath of [
    (0, import_path4.join)(basePath2, ".flowpilot", "config.json"),
    (0, import_path4.join)(basePath2, ".workflow", "config.json")
  ]) {
    try {
      return JSON.parse(await (0, import_promises3.readFile)(configPath, "utf-8"));
    } catch {
    }
  }
  return null;
}
async function runLifecycleHook(hookName, basePath2, env) {
  const config = await loadHooksConfig(basePath2);
  if (!config) {
    return;
  }
  const cmd = config.hooks?.[hookName];
  if (!cmd) return;
  try {
    log.debug(`hook "${hookName}" executing: ${cmd}`);
    (0, import_child_process.execSync)(cmd, {
      cwd: basePath2,
      stdio: "pipe",
      timeout: 3e4,
      env: { ...process.env, ...env }
    });
  } catch (e) {
    console.warn(`[FlowPilot] hook "${hookName}" failed: ${e.message}`);
  }
}

// src/infrastructure/extractor.ts
var import_https = require("https");
async function callClaude(prompt, systemPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey) return null;
  const baseUrl = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const parsed = new URL(base + "/v1/messages");
  return new Promise((resolve2) => {
    const body = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }]
    });
    const req = (0, import_https.request)({
      hostname: parsed.hostname,
      port: parsed.port || void 0,
      path: parsed.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      }
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          if (res.statusCode !== 200) {
            resolve2(null);
            return;
          }
          const json = JSON.parse(data);
          resolve2(json.content?.[0]?.text ?? null);
        } catch {
          resolve2(null);
        }
      });
    });
    req.on("error", () => resolve2(null));
    req.setTimeout(15e3, () => {
      req.destroy();
      resolve2(null);
    });
    req.write(body);
    req.end();
  });
}
function parseJsonArray(text) {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) return parsed;
      } catch {
      }
    }
  }
  return null;
}
async function llmExtract(text) {
  const system = `You are a knowledge extraction engine. Extract key facts, decisions, and technical insights from the given text. Return a JSON array of objects with "content" and "source" fields. Source should be one of: "decision", "architecture", "tech-stack", "insight". Only extract genuinely important information. Return [] if nothing worth remembering.`;
  const result = await callClaude(`Extract knowledge from:

${text}`, system);
  if (!result) return null;
  const arr = parseJsonArray(result);
  return arr ? arr.filter((e) => typeof e.content === "string" && typeof e.source === "string") : null;
}
async function llmDecide(newFacts, existingMemories) {
  if (!newFacts.length) return [];
  const system = `You are a memory deduplication engine. Given new facts and existing memories, decide which new facts to ADD (truly new), UPDATE (refines existing), or SKIP (already known). Return a JSON array of objects with "content", "source", and "action" fields. Action is "ADD", "UPDATE", or "SKIP". Only return ADD and UPDATE items.`;
  const prompt = `New facts:
${JSON.stringify(newFacts)}

Existing memories:
${existingMemories.map((m, i) => `${i + 1}. ${m}`).join("\n")}`;
  const result = await callClaude(prompt, system);
  if (!result) return null;
  const arr = parseJsonArray(result);
  return arr ? arr.filter((e) => typeof e.content === "string" && e.action !== "SKIP") : null;
}
function extractTaggedKnowledge(text, source) {
  const TAG_RE = /\[(?:REMEMBER|DECISION|ARCHITECTURE|IMPORTANT)\]\s*(.+)/gi;
  const results = [];
  for (const line of text.split("\n")) {
    const m = TAG_RE.exec(line);
    if (m) results.push({ content: m[1].trim(), source });
    TAG_RE.lastIndex = 0;
  }
  return results;
}
function extractDecisionPatterns(text, source) {
  const patterns = [
    /选择了(.+?)而非(.+)/g,
    /因为(.+?)所以(.+)/g,
    /决定使用(.+)/g,
    /放弃(.+?)改用(.+)/g,
    /chose\s+(.+?)\s+over\s+(.+)/gi,
    /decided\s+to\s+use\s+(.+)/gi,
    /switched\s+from\s+(.+?)\s+to\s+(.+)/gi
  ];
  const results = [];
  const seen = /* @__PURE__ */ new Set();
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const content = m[0].trim();
      if (!seen.has(content)) {
        seen.add(content);
        results.push({ content, source });
      }
    }
  }
  return results;
}
function extractTechStack(text, source) {
  const TECH_NAMES = [
    "React",
    "Vue",
    "Angular",
    "Svelte",
    "Next\\.js",
    "Nuxt",
    "Express",
    "Fastify",
    "Koa",
    "NestJS",
    "Hono",
    "PostgreSQL",
    "MySQL",
    "MongoDB",
    "Redis",
    "SQLite",
    "TypeScript",
    "GraphQL",
    "Prisma",
    "Drizzle",
    "Sequelize",
    "Tailwind",
    "Vite",
    "Webpack",
    "esbuild",
    "Rollup",
    "Docker",
    "Kubernetes",
    "Terraform",
    "AWS",
    "Vitest",
    "Jest"
  ];
  const techRe = new RegExp(`\\b(${TECH_NAMES.join("|")})\\b`, "gi");
  const configRe = /\b[\w-]+\.config\b|\.\w+rc\b/g;
  const results = [];
  const seen = /* @__PURE__ */ new Set();
  for (const m of text.matchAll(techRe)) {
    const name = m[1];
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      results.push({ content: `\u6280\u672F\u6808: ${name}`, source });
    }
  }
  for (const m of text.matchAll(configRe)) {
    const cfg = m[0];
    if (!seen.has(cfg.toLowerCase())) {
      seen.add(cfg.toLowerCase());
      results.push({ content: `\u914D\u7F6E\u9879: ${cfg}`, source });
    }
  }
  return results;
}
function ruleExtract(text, source) {
  const tagged = extractTaggedKnowledge(text, source);
  const decisions = extractDecisionPatterns(text, source);
  const primary = [...tagged, ...decisions];
  const primaryText = primary.map((e) => e.content).join(" ").toLowerCase();
  const tech = extractTechStack(text, source).filter((e) => {
    const keyword = e.content.replace(/^(技术栈|配置项): /i, "").toLowerCase();
    return !primaryText.includes(keyword);
  });
  const seen = /* @__PURE__ */ new Set();
  const all = [...primary, ...tech].filter((e) => {
    if (seen.has(e.content)) return false;
    seen.add(e.content);
    return true;
  });
  if (!all.length && text.trim()) {
    all.push({ content: text.trim().slice(0, 500), source });
  }
  return all;
}
async function extractAll(text, source, existingMemories) {
  const llmResult = await llmExtract(text);
  if (llmResult !== null) {
    if (existingMemories?.length) {
      const decided = await llmDecide(llmResult, existingMemories);
      if (decided !== null) return decided;
    }
    return llmResult;
  }
  return ruleExtract(text, source);
}

// src/infrastructure/history.ts
var import_promises4 = require("fs/promises");
var import_path5 = require("path");
var PERSISTENT_CONFIG_PATH = [".flowpilot", "config.json"];
var LEGACY_SNAPSHOT_CONFIG_KEY = "config.json";
var SNAPSHOT_CONFIG_KEY = ".flowpilot/config.json";
function collectStats(data) {
  const tasksByType = {};
  const failsByType = {};
  let retryTotal = 0, doneCount = 0, skipCount = 0, failCount = 0;
  for (const t of data.tasks) {
    tasksByType[t.type] = (tasksByType[t.type] ?? 0) + 1;
    retryTotal += t.retries;
    if (t.status === "done") doneCount++;
    else if (t.status === "skipped") skipCount++;
    else if (t.status === "failed") {
      failCount++;
      failsByType[t.type] = (failsByType[t.type] ?? 0) + 1;
    }
  }
  return {
    name: data.name,
    totalTasks: data.tasks.length,
    doneCount,
    skipCount,
    failCount,
    retryTotal,
    tasksByType,
    failsByType,
    taskResults: data.tasks.map((t) => ({ id: t.id, type: t.type, status: t.status, retries: t.retries, summary: t.summary || void 0 })),
    startTime: data.startTime || (/* @__PURE__ */ new Date()).toISOString(),
    endTime: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function analyzeHistory(history) {
  if (!history.length) return { suggestions: [], recommendedConfig: {} };
  const suggestions = [];
  const recommendedConfig = {};
  const typeTotal = {};
  const typeFails = {};
  let totalRetries = 0, totalTasks = 0;
  for (const h of history) {
    totalTasks += h.totalTasks;
    totalRetries += h.retryTotal;
    for (const [t, n] of Object.entries(h.tasksByType)) {
      typeTotal[t] = (typeTotal[t] ?? 0) + n;
    }
    for (const [t, n] of Object.entries(h.failsByType)) {
      typeFails[t] = (typeFails[t] ?? 0) + n;
    }
  }
  for (const [type, total] of Object.entries(typeTotal)) {
    const fails = typeFails[type] ?? 0;
    const rate = fails / total;
    if (rate > 0.2 && total >= 3) {
      suggestions.push(`${type} \u7C7B\u578B\u4EFB\u52A1\u5386\u53F2\u5931\u8D25\u7387 ${(rate * 100).toFixed(0)}%\uFF08${fails}/${total}\uFF09\uFF0C\u5EFA\u8BAE\u62C6\u5206\u66F4\u7EC6`);
    }
  }
  if (totalTasks > 0) {
    const avgRetry = totalRetries / totalTasks;
    if (avgRetry > 1) {
      suggestions.push(`\u5E73\u5747\u91CD\u8BD5\u6B21\u6570 ${avgRetry.toFixed(1)}\uFF0C\u5EFA\u8BAE\u589E\u52A0 retry \u4E0A\u9650`);
      recommendedConfig.maxRetries = Math.min(Math.ceil(avgRetry) + 2, 8);
    }
  }
  const totalSkips = history.reduce((s, h) => s + h.skipCount, 0);
  if (totalTasks > 0 && totalSkips / totalTasks > 0.15) {
    suggestions.push(`\u5386\u53F2\u8DF3\u8FC7\u7387 ${(totalSkips / totalTasks * 100).toFixed(0)}%\uFF0C\u5EFA\u8BAE\u51CF\u5C11\u4EFB\u52A1\u95F4\u4F9D\u8D56`);
  }
  return { suggestions, recommendedConfig };
}
async function llmReflect(stats) {
  const system = `\u4F60\u662F\u5DE5\u4F5C\u6D41\u53CD\u601D\u5F15\u64CE\u3002\u5206\u6790\u7ED9\u5B9A\u7684\u5DE5\u4F5C\u6D41\u7EDF\u8BA1\u6570\u636E\uFF0C\u627E\u51FA\u5931\u8D25\u6A21\u5F0F\u548C\u6539\u8FDB\u673A\u4F1A\u3002\u8FD4\u56DE JSON: {"findings": ["\u53D1\u73B01", ...], "experiments": [{"trigger":"\u89E6\u53D1\u539F\u56E0","observation":"\u89C2\u5BDF\u73B0\u8C61","action":"\u5EFA\u8BAE\u884C\u52A8","expected":"\u9884\u671F\u6548\u679C","target":"config\u6216claude-md"}, ...]}\u3002target=claude-md \u8868\u793A\u4FEE\u6539 CLAUDE.md \u534F\u8BAE\u533A\u57DF\u3002\u53EA\u8FD4\u56DE JSON\uFF0C\u4E0D\u8981\u5176\u4ED6\u5185\u5BB9\u3002`;
  const result = await callClaude(JSON.stringify(stats), system);
  if (!result) return null;
  try {
    const match = result.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : result);
    if (Array.isArray(parsed.findings) && Array.isArray(parsed.experiments)) {
      return { timestamp: (/* @__PURE__ */ new Date()).toISOString(), findings: parsed.findings, experiments: parsed.experiments };
    }
  } catch {
  }
  return null;
}
function fourDimensionAnalysis(stats) {
  const findings = [];
  const experiments = [];
  const results = stats.taskResults ?? [];
  const FAIL_RE = /fail|error|timeout|FAILED|异常|超时/i;
  const failedWithSummary = results.filter((r) => r.status === "failed" && r.summary);
  const frictionPatterns = /* @__PURE__ */ new Map();
  for (const r of failedWithSummary) {
    const matches = r.summary.match(FAIL_RE);
    if (matches) {
      const key = matches[0].toLowerCase();
      frictionPatterns.set(key, (frictionPatterns.get(key) ?? 0) + 1);
    }
  }
  for (const [pattern, count] of frictionPatterns) {
    if (count >= 2) {
      findings.push(`[friction] \u5931\u8D25\u6A21\u5F0F "${pattern}" \u51FA\u73B0 ${count} \u6B21`);
      experiments.push({
        trigger: `\u91CD\u590D\u5931\u8D25\u6A21\u5F0F: ${pattern}`,
        observation: `${count} \u4E2A\u4EFB\u52A1\u56E0 "${pattern}" \u5931\u8D25`,
        action: `\u5728\u5B50Agent\u63D0\u793A\u6A21\u677F\u4E2D\u6DFB\u52A0 "${pattern}" \u9884\u9632\u68C0\u67E5`,
        expected: "\u51CF\u5C11\u540C\u7C7B\u5931\u8D25",
        target: "claude-md"
      });
    }
  }
  const efficient = results.filter((r) => r.status === "done" && r.retries === 0);
  if (efficient.length > 0 && stats.totalTasks > 0) {
    const rate = (efficient.length / stats.totalTasks * 100).toFixed(0);
    findings.push(`[delight] ${efficient.length}/${stats.totalTasks} \u4EFB\u52A1\u4E00\u6B21\u901A\u8FC7 (${rate}%)`);
    if (efficient.length === stats.totalTasks && stats.totalTasks >= 3) {
      findings.push("[delight] \u541E\u5410\u7A33\u5B9A\uFF0C\u53EF\u7EE7\u7EED\u4FDD\u6301\u9AD8\u5E76\u884C\u4EBA\u5DE5\u914D\u7F6E");
    }
  }
  const retriedButDone = results.filter((r) => r.status === "done" && r.retries > 0);
  if (retriedButDone.length) {
    findings.push(`[delight] ${retriedButDone.length} \u4E2A\u4EFB\u52A1\u7ECF\u91CD\u8BD5\u540E\u6210\u529F`);
    experiments.push({
      trigger: "\u91CD\u8BD5\u540E\u6210\u529F",
      observation: `${retriedButDone.map((r) => r.id).join(",")} \u9700\u8981\u91CD\u8BD5`,
      action: "\u5728\u5B50Agent\u63D0\u793A\u6A21\u677F\u4E2D\u5F3A\u8C03\u5148\u9A8C\u8BC1\u73AF\u5883\u518D\u52A8\u624B\u7F16\u7801",
      expected: "\u51CF\u5C11\u9996\u6B21\u5931\u8D25\u7387",
      target: "claude-md"
    });
  }
  const typeEntries = Object.entries(stats.tasksByType);
  if (typeEntries.length > 0) {
    findings.push(`[patterns] \u7C7B\u578B\u5206\u5E03: ${typeEntries.map(([t, n]) => `${t}=${n}`).join(", ")}`);
  }
  const keywords = /* @__PURE__ */ new Map();
  for (const r of results) {
    if (!r.summary) continue;
    for (const w of r.summary.split(/\s+/).filter((w2) => w2.length > 2)) {
      keywords.set(w, (keywords.get(w) ?? 0) + 1);
    }
  }
  const topKw = [...keywords.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (topKw.length) {
    findings.push(`[patterns] \u9AD8\u9891\u5173\u952E\u8BCD: ${topKw.map(([w, c]) => `${w}(${c})`).join(", ")}`);
  }
  const skipped2 = results.filter((r) => r.status === "skipped");
  if (skipped2.length) {
    findings.push(`[gaps] ${skipped2.length} \u4E2A\u4EFB\u52A1\u88AB\u8DF3\u8FC7: ${skipped2.map((r) => r.id).join(",")}`);
  }
  let chain = 0, maxChain = 0;
  for (const r of results) {
    chain = r.status === "failed" ? chain + 1 : 0;
    maxChain = Math.max(maxChain, chain);
  }
  if (maxChain >= 2) {
    findings.push(`[gaps] \u6700\u957F\u8FDE\u7EED\u5931\u8D25\u94FE: ${maxChain} \u4E2A\u4EFB\u52A1`);
  }
  return { findings, experiments };
}
function ruleReflect(stats) {
  const findings = [];
  const experiments = [];
  const results = stats.taskResults ?? [];
  const fourD = fourDimensionAnalysis(stats);
  findings.push(...fourD.findings);
  experiments.push(...fourD.experiments);
  let streak = 0;
  for (let i = 0; i < results.length; i++) {
    streak = results[i].status === "failed" ? streak + 1 : 0;
    if (streak >= 2) {
      findings.push(`\u8FDE\u7EED\u5931\u8D25\u94FE\uFF1A\u4ECE\u4EFB\u52A1 ${results[i - streak + 1].id} \u5F00\u59CB\u8FDE\u7EED\u5931\u8D25`);
      experiments.push({
        trigger: "\u8FDE\u7EED\u5931\u8D25\u94FE",
        observation: `${streak} \u4E2A\u4EFB\u52A1\u8FDE\u7EED\u5931\u8D25`,
        action: "\u5728\u5931\u8D25\u4EFB\u52A1\u95F4\u63D2\u5165\u8BCA\u65AD\u6B65\u9AA4",
        expected: "\u6253\u65AD\u5931\u8D25\u4F20\u64AD",
        target: "claude-md"
      });
      break;
    }
  }
  for (const [type, total] of Object.entries(stats.tasksByType)) {
    const fails = stats.failsByType[type] ?? 0;
    if (total > 0 && fails / total > 0.3) {
      findings.push(`\u7C7B\u578B ${type} \u5931\u8D25\u96C6\u4E2D\uFF1A${fails}/${total}`);
      experiments.push({
        trigger: "\u7C7B\u578B\u5931\u8D25\u96C6\u4E2D",
        observation: `${type} \u5931\u8D25\u7387 ${(fails / total * 100).toFixed(0)}%`,
        action: `\u62C6\u5206 ${type} \u4EFB\u52A1\u4E3A\u66F4\u5C0F\u7C92\u5EA6`,
        expected: "\u964D\u4F4E\u5355\u4EFB\u52A1\u5931\u8D25\u7387",
        target: "config"
      });
    }
  }
  for (const r of results) {
    if (r.retries > 2) {
      findings.push(`\u91CD\u8BD5\u70ED\u70B9\uFF1A\u4EFB\u52A1 ${r.id} \u91CD\u8BD5 ${r.retries} \u6B21`);
      experiments.push({
        trigger: "\u91CD\u8BD5\u70ED\u70B9",
        observation: `\u4EFB\u52A1 ${r.id} \u91CD\u8BD5 ${r.retries} \u6B21`,
        action: "\u589E\u52A0\u8BE5\u4EFB\u52A1\u7684\u4E0A\u4E0B\u6587\u6216\u524D\u7F6E\u68C0\u67E5",
        expected: "\u51CF\u5C11\u91CD\u8BD5\u6B21\u6570",
        target: "claude-md"
      });
    }
  }
  if (stats.totalTasks > 0 && stats.skipCount / stats.totalTasks > 0.2) {
    const rate = (stats.skipCount / stats.totalTasks * 100).toFixed(0);
    findings.push(`\u7EA7\u8054\u8DF3\u8FC7\u4E25\u91CD\uFF1A\u8DF3\u8FC7\u7387 ${rate}%`);
    experiments.push({
      trigger: "\u7EA7\u8054\u8DF3\u8FC7",
      observation: `${stats.skipCount}/${stats.totalTasks} \u4EFB\u52A1\u88AB\u8DF3\u8FC7`,
      action: "\u51CF\u5C11\u4EFB\u52A1\u95F4\u786C\u4F9D\u8D56\uFF0C\u6539\u7528\u8F6F\u4F9D\u8D56",
      expected: "\u964D\u4F4E\u8DF3\u8FC7\u7387\u81F3 10% \u4EE5\u4E0B",
      target: "config"
    });
  }
  return { timestamp: (/* @__PURE__ */ new Date()).toISOString(), findings, experiments };
}
async function reflect(stats, basePath2) {
  const llmReport = await llmReflect(stats);
  const report = llmReport ?? ruleReflect(stats);
  const ts = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const p = (0, import_path5.join)(basePath2, ".flowpilot", "evolution", `reflect-${ts}.json`);
  await (0, import_promises4.mkdir)((0, import_path5.dirname)(p), { recursive: true });
  await (0, import_promises4.writeFile)(p, JSON.stringify(report, null, 2), "utf-8");
  return report;
}
async function safeRead(p, fallback) {
  try {
    return await (0, import_promises4.readFile)(p, "utf-8");
  } catch {
    return fallback;
  }
}
function resolvePersistentConfigPath(basePath2) {
  return (0, import_path5.join)(basePath2, ...PERSISTENT_CONFIG_PATH);
}
function readSnapshotConfig(snapshot) {
  return snapshot.files[SNAPSHOT_CONFIG_KEY] ?? snapshot.files[LEGACY_SNAPSHOT_CONFIG_KEY] ?? null;
}
var KNOWN_PARAMS = ["maxRetries", "timeout", "verifyTimeout"];
function parseConfigAction(action) {
  for (const k of KNOWN_PARAMS) {
    const re = new RegExp(k + "\\D*(\\d+)");
    const m = action.match(re);
    if (m) return { key: k, value: Number(m[1]) };
  }
  const CN_MAP = {
    "\u91CD\u8BD5": "maxRetries",
    "\u8D85\u65F6": "timeout",
    "\u9A8C\u8BC1\u8D85\u65F6": "verifyTimeout"
  };
  const cnEntries = Object.entries(CN_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [cn, key] of cnEntries) {
    if (action.includes(cn)) {
      const m = action.match(/(\d+)/);
      if (m) return { key, value: Number(m[1]) };
    }
  }
  return null;
}
async function saveSnapshot(basePath2, files) {
  const ts = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const p = (0, import_path5.join)(basePath2, ".flowpilot", "evolution", `snapshot-${ts}.json`);
  const snapshot = { timestamp: (/* @__PURE__ */ new Date()).toISOString(), files };
  await (0, import_promises4.mkdir)((0, import_path5.dirname)(p), { recursive: true });
  await (0, import_promises4.writeFile)(p, JSON.stringify(snapshot, null, 2), "utf-8");
  return p;
}
async function loadLatestSnapshot(basePath2) {
  const dir = (0, import_path5.join)(basePath2, ".flowpilot", "evolution");
  try {
    const files = (await (0, import_promises4.readdir)(dir)).filter((f) => f.startsWith("snapshot-") && f.endsWith(".json")).sort();
    if (!files.length) return null;
    return JSON.parse(await (0, import_promises4.readFile)((0, import_path5.join)(dir, files[files.length - 1]), "utf-8"));
  } catch {
    return null;
  }
}
function findLatestExperimentSnapshotLog(logs) {
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const logEntry = logs[index];
    if (logEntry?.snapshotFile) return logEntry;
  }
  return null;
}
async function appendExperimentsMd(basePath2, expLog, report) {
  const mdPath = (0, import_path5.join)(basePath2, ".flowpilot", "EXPERIMENTS.md");
  const existing = await safeRead(mdPath, "# Evolution Experiments\n");
  const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const applied = expLog.experiments.filter((e) => e.applied);
  if (!applied.length) return;
  const entries = applied.map(
    (e) => `### [${date}] ${e.trigger}
**\u89E6\u53D1**: ${e.trigger}
**\u89C2\u5BDF**: ${e.observation}
**\u884C\u52A8**: ${e.action} (target: ${e.target})
**\u9884\u671F\u6548\u679C**: ${e.expected}
**\u72B6\u6001**: ${expLog.status}
`
  ).join("\n");
  await (0, import_promises4.mkdir)((0, import_path5.dirname)(mdPath), { recursive: true });
  await (0, import_promises4.writeFile)(mdPath, existing.trimEnd() + "\n\n" + entries, "utf-8");
}
async function experiment(report, basePath2) {
  const log2 = { timestamp: (/* @__PURE__ */ new Date()).toISOString(), experiments: [], status: "completed" };
  if (!report.experiments.length) return log2;
  const configPath = resolvePersistentConfigPath(basePath2);
  const configSnapshot = await safeRead(configPath, "{}");
  const snapshotFile = await saveSnapshot(basePath2, { [SNAPSHOT_CONFIG_KEY]: configSnapshot });
  log2.snapshotFile = snapshotFile;
  try {
    let configObj = JSON.parse(configSnapshot);
    for (const exp of report.experiments) {
      const applied = { ...exp, applied: false, snapshotBefore: "" };
      try {
        if (exp.target === "config") {
          applied.snapshotBefore = configSnapshot;
          const parsed = parseConfigAction(exp.action);
          if (parsed) {
            configObj = { ...configObj, [parsed.key]: parsed.value };
            applied.applied = true;
          }
        } else if (exp.target === "claude-md") {
          applied.snapshotBefore = configSnapshot;
          const hints = configObj.hints ?? [];
          if (hints.length < 10 && !hints.includes(exp.action)) {
            configObj = { ...configObj, hints: [...hints, exp.action] };
            applied.applied = true;
          }
        }
      } catch {
      }
      log2.experiments.push(applied);
    }
    if (log2.experiments.some((e) => e.applied)) {
      await (0, import_promises4.mkdir)((0, import_path5.dirname)(configPath), { recursive: true });
      await (0, import_promises4.writeFile)(configPath, JSON.stringify(configObj, null, 2), "utf-8");
    }
  } catch {
    log2.status = "failed";
  }
  const logPath = (0, import_path5.join)(basePath2, ".flowpilot", "evolution", "experiments.json");
  await (0, import_promises4.mkdir)((0, import_path5.dirname)(logPath), { recursive: true });
  let existing = [];
  try {
    existing = JSON.parse(await (0, import_promises4.readFile)(logPath, "utf-8"));
  } catch {
  }
  existing.push(log2);
  await (0, import_promises4.writeFile)(logPath, JSON.stringify(existing, null, 2), "utf-8");
  await appendExperimentsMd(basePath2, log2, report);
  return log2;
}
async function review(basePath2) {
  const checks = [];
  let rolledBack = false;
  let rollbackReason;
  const historyDir = (0, import_path5.join)(basePath2, ".flowpilot", "history");
  const configPath = resolvePersistentConfigPath(basePath2);
  const expPath = (0, import_path5.join)(basePath2, ".flowpilot", "evolution", "experiments.json");
  let history = [];
  try {
    const files = (await (0, import_promises4.readdir)(historyDir)).filter((f) => f.endsWith(".json")).sort();
    const recent = files.slice(-2);
    for (const f of recent) {
      try {
        history.push(JSON.parse(await (0, import_promises4.readFile)((0, import_path5.join)(historyDir, f), "utf-8")));
      } catch {
      }
    }
  } catch {
  }
  if (history.length >= 2) {
    const [prev, curr] = [history[history.length - 2], history[history.length - 1]];
    const rate = (s, fn) => s.totalTasks > 0 ? fn(s) / s.totalTasks : 0;
    const metrics = [
      { name: "failRate", fn: (s) => s.failCount },
      { name: "skipRate", fn: (s) => s.skipCount },
      { name: "retryRate", fn: (s) => s.retryTotal }
    ];
    for (const m of metrics) {
      const prevR = rate(prev, m.fn), currR = rate(curr, m.fn);
      const delta = currR - prevR;
      const passed = delta <= 0.1;
      checks.push({
        name: m.name,
        passed,
        detail: `${(prevR * 100).toFixed(1)}% \u2192 ${(currR * 100).toFixed(1)}% (delta ${(delta * 100).toFixed(1)}pp)`
      });
      if (!passed && !rolledBack) {
        rolledBack = true;
        rollbackReason = `${m.name} \u6076\u5316 ${(delta * 100).toFixed(1)} \u4E2A\u767E\u5206\u70B9`;
      }
    }
  } else {
    checks.push({ name: "metrics", passed: true, detail: "\u5386\u53F2\u4E0D\u8DB3\u4E24\u8F6E\uFF0C\u8DF3\u8FC7\u5BF9\u6BD4" });
  }
  const configRaw = await safeRead(configPath, "");
  if (configRaw) {
    try {
      JSON.parse(configRaw);
      checks.push({ name: "config.json", passed: true, detail: "\u5408\u6CD5 JSON" });
    } catch {
      checks.push({ name: "config.json", passed: false, detail: "JSON \u89E3\u6790\u5931\u8D25" });
    }
  } else {
    checks.push({ name: "config.json", passed: true, detail: "\u6587\u4EF6\u4E0D\u5B58\u5728\uFF0C\u8DF3\u8FC7" });
  }
  const expRaw = await safeRead(expPath, "");
  if (expRaw) {
    try {
      JSON.parse(expRaw);
      checks.push({ name: "experiments.json", passed: true, detail: "\u53EF\u89E3\u6790" });
    } catch {
      checks.push({ name: "experiments.json", passed: false, detail: "\u89E3\u6790\u5931\u8D25" });
    }
  } else {
    checks.push({ name: "experiments.json", passed: true, detail: "\u6587\u4EF6\u4E0D\u5B58\u5728\uFF0C\u8DF3\u8FC7" });
  }
  if (rolledBack) {
    try {
      const logs = JSON.parse(await (0, import_promises4.readFile)(expPath, "utf-8"));
      const latestSnapshotLog = findLatestExperimentSnapshotLog(logs);
      let snapshot = null;
      if (latestSnapshotLog?.snapshotFile) {
        try {
          snapshot = JSON.parse(await (0, import_promises4.readFile)(latestSnapshotLog.snapshotFile, "utf-8"));
        } catch {
        }
      }
      if (!snapshot) snapshot = await loadLatestSnapshot(basePath2);
      const snapshotConfig = snapshot ? readSnapshotConfig(snapshot) : null;
      if (snapshotConfig !== null) {
        await (0, import_promises4.mkdir)((0, import_path5.dirname)(configPath), { recursive: true });
        await (0, import_promises4.writeFile)(configPath, snapshotConfig, "utf-8");
      }
      if (logs.length) {
        logs[logs.length - 1].status = "skipped";
        await (0, import_promises4.writeFile)(expPath, JSON.stringify(logs, null, 2), "utf-8");
      }
    } catch (e) {
      log.warn(`[review] rollback failed: ${e}`);
    }
  }
  const result = {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    checks,
    rolledBack,
    ...rollbackReason ? { rollbackReason } : {}
  };
  const ts = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const outPath = (0, import_path5.join)(basePath2, ".flowpilot", "evolution", `review-${ts}.json`);
  await (0, import_promises4.mkdir)((0, import_path5.dirname)(outPath), { recursive: true });
  await (0, import_promises4.writeFile)(outPath, JSON.stringify(result, null, 2), "utf-8");
  return result;
}

// src/infrastructure/memory.ts
var import_promises7 = require("fs/promises");
var import_path8 = require("path");
var import_crypto2 = require("crypto");

// src/infrastructure/lang-analyzers.ts
var STOP_WORDS = {
  en: /* @__PURE__ */ new Set(["the", "is", "at", "which", "on", "a", "an", "and", "or", "but", "in", "of", "to", "for", "with", "that", "this", "it", "be", "as", "are", "was", "were", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "shall", "should", "may", "might", "can", "could", "not", "no", "nor", "so", "if", "then", "than", "too", "very", "just", "about", "above", "after", "before", "between", "into", "through", "during", "from", "up", "down", "out", "off", "over", "under", "again", "further", "once", "here", "there", "when", "where", "why", "how", "all", "each", "every", "both", "few", "more", "most", "other", "some", "such", "only", "own", "same", "also", "by", "i", "me", "my", "we", "our", "you", "your", "he", "him", "his", "she", "her", "they", "them", "their", "its", "what", "who", "whom"]),
  zh: /* @__PURE__ */ new Set(["\u7684", "\u4E86", "\u5728", "\u662F", "\u6211", "\u6709", "\u548C", "\u5C31", "\u4E0D", "\u90FD", "\u800C", "\u53CA", "\u4E0E", "\u8FD9", "\u90A3", "\u4F60", "\u4ED6", "\u5979", "\u5B83", "\u4EEC", "\u4F1A", "\u80FD", "\u8981", "\u4E5F", "\u5F88", "\u628A", "\u88AB", "\u8BA9", "\u7ED9", "\u4ECE", "\u5230", "\u5BF9", "\u8BF4", "\u53BB", "\u6765", "\u505A", "\u53EF\u4EE5", "\u6CA1\u6709", "\u56E0\u4E3A", "\u6240\u4EE5", "\u5982\u679C", "\u4F46\u662F", "\u867D\u7136", "\u5DF2\u7ECF", "\u8FD8\u662F", "\u6216\u8005", "\u4EE5\u53CA", "\u5173\u4E8E"]),
  ja: /* @__PURE__ */ new Set(["\u306E", "\u306B", "\u306F", "\u3092", "\u305F", "\u304C", "\u3067", "\u3066", "\u3068", "\u3057", "\u308C", "\u3055", "\u3042\u308B", "\u3044\u308B", "\u3082", "\u3059\u308B", "\u304B\u3089", "\u306A", "\u3053\u3068", "\u3088\u3046", "\u306A\u3044", "\u306A\u308B", "\u304A", "\u307E\u3059", "\u3067\u3059", "\u3060", "\u305D\u306E", "\u3053\u306E", "\u305D\u308C", "\u3053\u308C", "\u3042\u306E", "\u3069\u306E", "\u3078", "\u3088\u308A", "\u307E\u3067", "\u305F\u3081"]),
  ko: /* @__PURE__ */ new Set(["\uC758", "\uAC00", "\uC774", "\uC740", "\uB294", "\uC744", "\uB97C", "\uC5D0", "\uC640", "\uACFC", "\uB3C4", "\uB85C", "\uC73C\uB85C", "\uC5D0\uC11C", "\uAE4C\uC9C0", "\uBD80\uD130", "\uB9CC", "\uBCF4\uB2E4", "\uCC98\uB7FC", "\uAC19\uC774", "\uD558\uB2E4", "\uC788\uB2E4", "\uB418\uB2E4", "\uC5C6\uB2E4", "\uC54A\uB2E4", "\uADF8", "\uC774", "\uC800", "\uAC83", "\uC218", "\uB4F1", "\uB54C"]),
  fr: /* @__PURE__ */ new Set(["le", "la", "les", "de", "des", "un", "une", "et", "en", "du", "au", "aux", "ce", "ces", "que", "qui", "ne", "pas", "par", "pour", "sur", "avec", "dans", "est", "sont", "a", "ont", "il", "elle", "nous", "vous", "ils", "elles", "se", "son", "sa", "ses", "leur", "leurs", "mais", "ou", "donc", "car", "ni"]),
  de: /* @__PURE__ */ new Set(["der", "die", "das", "ein", "eine", "und", "in", "von", "zu", "mit", "auf", "f\xFCr", "an", "bei", "nach", "\xFCber", "vor", "aus", "wie", "als", "oder", "aber", "wenn", "auch", "noch", "nur", "nicht", "ist", "sind", "hat", "haben", "wird", "werden", "ich", "du", "er", "sie", "es", "wir", "ihr"]),
  es: /* @__PURE__ */ new Set(["el", "la", "los", "las", "de", "en", "un", "una", "y", "que", "del", "al", "es", "por", "con", "no", "se", "su", "para", "como", "m\xE1s", "pero", "sus", "le", "ya", "o", "fue", "ha", "son", "est\xE1", "muy", "tambi\xE9n", "desde", "todo", "nos", "cuando", "entre", "sin", "sobre", "ser", "tiene"]),
  pt: /* @__PURE__ */ new Set(["o", "a", "os", "as", "de", "em", "um", "uma", "e", "que", "do", "da", "dos", "das", "no", "na", "nos", "nas", "por", "para", "com", "n\xE3o", "se", "seu", "sua", "mais", "mas", "como", "foi", "s\xE3o", "est\xE1", "tem", "j\xE1", "ou", "ser", "ter", "muito", "tamb\xE9m", "ao", "aos", "pela", "pelo"]),
  ru: /* @__PURE__ */ new Set(["\u0438", "\u0432", "\u043D\u0435", "\u043D\u0430", "\u044F", "\u0447\u0442\u043E", "\u043E\u043D", "\u0441", "\u044D\u0442\u043E", "\u0430", "\u043A\u0430\u043A", "\u043D\u043E", "\u043E\u043D\u0430", "\u043E\u043D\u0438", "\u043C\u044B", "\u0432\u044B", "\u0432\u0441\u0435", "\u0435\u0433\u043E", "\u0435\u0451", "\u0438\u0445", "\u043E\u0442", "\u043F\u043E", "\u0437\u0430", "\u0434\u043B\u044F", "\u0438\u0437", "\u0434\u043E", "\u0442\u0430\u043A", "\u0436\u0435", "\u0442\u043E", "\u0431\u044B", "\u0431\u044B\u043B\u043E", "\u0431\u044B\u0442\u044C", "\u0443\u0436\u0435", "\u0435\u0449\u0451", "\u0438\u043B\u0438", "\u043D\u0438", "\u043D\u0435\u0442", "\u0434\u0430", "\u0435\u0441\u0442\u044C", "\u0431\u044B\u043B", "\u0431\u044B\u043B\u0430", "\u0431\u044B\u043B\u0438"]),
  ar: /* @__PURE__ */ new Set(["\u0641\u064A", "\u0645\u0646", "\u0639\u0644\u0649", "\u0625\u0644\u0649", "\u0623\u0646", "\u0647\u0630\u0627", "\u0627\u0644\u062A\u064A", "\u0627\u0644\u0630\u064A", "\u0647\u0648", "\u0647\u064A", "\u0645\u0627", "\u0644\u0627", "\u0643\u0627\u0646", "\u0639\u0646", "\u0645\u0639", "\u0647\u0630\u0647", "\u0643\u0644", "\u0628\u064A\u0646", "\u0642\u062F", "\u0630\u0644\u0643", "\u0628\u0639\u062F", "\u0639\u0646\u062F", "\u0644\u0645", "\u0623\u0648", "\u062D\u062A\u0649", "\u0625\u0630\u0627", "\u062B\u0645", "\u0623\u064A", "\u0642\u0628\u0644", "\u0641\u0642\u0637", "\u0645\u0646\u0630", "\u0623\u0646\u0647", "\u0644\u0643\u0646", "\u0646\u062D\u0646", "\u0647\u0645", "\u0623\u0646\u0627", "\u0643\u0627\u0646\u062A"])
};
function stem(word) {
  if (word.length < 4) return word;
  let w = word;
  if (w.endsWith("ies") && w.length > 4) w = w.slice(0, -3) + "i";
  else if (w.endsWith("sses")) w = w.slice(0, -2);
  else if (w.endsWith("ness")) w = w.slice(0, -4);
  else if (w.endsWith("ment")) w = w.slice(0, -4);
  else if (w.endsWith("ingly")) w = w.slice(0, -5);
  else if (w.endsWith("edly")) w = w.slice(0, -4);
  else if (w.endsWith("ing") && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith("tion")) w = w.slice(0, -3) + "t";
  else if (w.endsWith("sion")) w = w.slice(0, -3) + "s";
  else if (w.endsWith("ful")) w = w.slice(0, -3);
  else if (w.endsWith("ous")) w = w.slice(0, -3);
  else if (w.endsWith("ive")) w = w.slice(0, -3);
  else if (w.endsWith("able")) w = w.slice(0, -4);
  else if (w.endsWith("ible")) w = w.slice(0, -4);
  else if (w.endsWith("ally")) w = w.slice(0, -4) + "al";
  else if (w.endsWith("ly") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("ed") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("er") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("es") && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) w = w.slice(0, -1);
  if (w.endsWith("ational")) w = w.slice(0, -7) + "ate";
  else if (w.endsWith("izer")) w = w.slice(0, -1);
  else if (w.endsWith("fulness")) w = w.slice(0, -4);
  return w.length >= 2 ? w : word;
}
function isJapaneseKana(cp) {
  return cp >= 12352 && cp <= 12447 || cp >= 12448 && cp <= 12543;
}
function isHangul(cp) {
  return cp >= 44032 && cp <= 55215 || cp >= 4352 && cp <= 4607;
}
function isCJKIdeograph(cp) {
  return cp >= 19968 && cp <= 40959 || cp >= 13312 && cp <= 19903 || cp >= 131072 && cp <= 173791 || cp >= 63744 && cp <= 64255;
}
function isCyrillic(cp) {
  return cp >= 1024 && cp <= 1279;
}
function isArabic(cp) {
  return cp >= 1536 && cp <= 1791 || cp >= 1872 && cp <= 1919;
}
var LATIN_LANG_MARKERS = [
  ["fr", /\b(le|la|les|des|une|est|dans|pour|avec|sont|nous|vous|cette|aussi|mais|comme|très|être|avoir|fait|tout|quel|cette|ces|aux|sur|par|qui|que)\b/gi],
  ["de", /\b(der|die|das|ein|eine|und|ist|sind|nicht|auf|für|mit|auch|noch|nur|oder|aber|wenn|wird|haben|über|nach|vor|aus|wie|als|ich|wir|ihr)\b/gi],
  ["es", /\b(el|los|las|una|del|por|con|para|como|más|pero|fue|está|muy|también|desde|todo|cuando|entre|sin|sobre|tiene|puede|hay|ser|este|esta|estos)\b/gi],
  ["pt", /\b(os|uma|das|dos|pela|pelo|para|com|não|mais|mas|como|foi|são|está|tem|muito|também|seu|sua|nos|nas|quando|entre|desde|pode|ser|ter|este|esta)\b/gi]
];
function detectLanguage(text) {
  const sample = text.slice(0, 500);
  if (!sample.trim()) return "en";
  let kana = 0, hangul = 0, cjk = 0, cyrillic = 0, arabic = 0, latin = 0, total = 0;
  for (const ch of sample) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 32) continue;
    total++;
    if (isJapaneseKana(cp)) kana++;
    else if (isHangul(cp)) hangul++;
    else if (isCJKIdeograph(cp)) cjk++;
    else if (isCyrillic(cp)) cyrillic++;
    else if (isArabic(cp)) arabic++;
    else if (cp >= 65 && cp <= 90 || cp >= 97 && cp <= 122 || cp >= 192 && cp <= 591) latin++;
  }
  if (total === 0) return "en";
  if (kana / total > 0.1) return "ja";
  if (hangul / total > 0.1) return "ko";
  if (cjk / total > 0.15) return "zh";
  if (cyrillic / total > 0.15) return "ru";
  if (arabic / total > 0.15) return "ar";
  if (latin / total > 0.4) {
    let bestLang = "en", bestScore = 0;
    for (const [lang, re] of LATIN_LANG_MARKERS) {
      const matches = sample.match(re);
      const score = matches ? matches.length : 0;
      if (score > bestScore) {
        bestScore = score;
        bestLang = lang;
      }
    }
    return bestScore >= 3 ? bestLang : "en";
  }
  return "en";
}
function removeStopWords(tokens, lang) {
  const stops = STOP_WORDS[lang];
  if (!stops) return tokens;
  return tokens.filter((t) => !stops.has(t));
}
function analyze(tokens, lang) {
  const detectedLang = lang ?? "en";
  let result = removeStopWords(tokens, detectedLang);
  if (detectedLang === "en") result = result.map(stem);
  return { tokens: result, lang: detectedLang };
}

// src/infrastructure/embedding.ts
var import_https2 = require("https");
var import_crypto = require("crypto");
var import_promises5 = require("fs/promises");
var import_path6 = require("path");
var TIMEOUT_MS = 15e3;
var CACHE_FILE = "embedding-cache.json";
var memCache = null;
function sha256(text) {
  return (0, import_crypto.createHash)("sha256").update(text).digest("hex");
}
function cachePath(basePath2) {
  return (0, import_path6.join)(basePath2, ".flowpilot", CACHE_FILE);
}
async function loadEmbeddingCache(basePath2) {
  if (memCache) return memCache;
  try {
    memCache = JSON.parse(await (0, import_promises5.readFile)(cachePath(basePath2), "utf-8"));
    return memCache;
  } catch {
    memCache = /* @__PURE__ */ Object.create(null);
    return memCache;
  }
}
async function saveEmbeddingCache(basePath2, cache) {
  const p = cachePath(basePath2);
  await (0, import_promises5.mkdir)((0, import_path6.dirname)(p), { recursive: true });
  await (0, import_promises5.writeFile)(p, JSON.stringify(cache), "utf-8");
}
function getConfig() {
  const apiKey = process.env.EMBEDDING_API_KEY;
  if (!apiKey) return null;
  const rawUrl = process.env.EMBEDDING_API_URL || "https://api.voyageai.com/v1/embeddings";
  const model = process.env.EMBEDDING_MODEL || "voyage-3-lite";
  try {
    return { url: new URL(rawUrl), apiKey, model };
  } catch {
    return null;
  }
}
function callEmbeddingAPI(text, config) {
  return new Promise((resolve2) => {
    const body = JSON.stringify({ input: text, model: config.model });
    const req = (0, import_https2.request)({
      hostname: config.url.hostname,
      port: config.url.port || void 0,
      path: config.url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`
      }
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          if (res.statusCode !== 200) {
            resolve2(null);
            return;
          }
          const json = JSON.parse(data);
          const embedding = json.data?.[0]?.embedding;
          resolve2(Array.isArray(embedding) ? embedding : null);
        } catch {
          resolve2(null);
        }
      });
    });
    req.on("error", () => resolve2(null));
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      resolve2(null);
    });
    req.write(body);
    req.end();
  });
}
async function embedText(text, basePath2) {
  const config = getConfig();
  if (!config) return null;
  const hash = sha256(text);
  if (basePath2) {
    const cache = await loadEmbeddingCache(basePath2);
    if (cache[hash]) return cache[hash];
  }
  const vector = await callEmbeddingAPI(text, config);
  if (!vector) {
    log.debug("embedding: API \u8C03\u7528\u5931\u8D25\uFF0C\u964D\u7EA7");
    return null;
  }
  if (basePath2) {
    const cache = await loadEmbeddingCache(basePath2);
    memCache = { ...cache, [hash]: vector };
    await saveEmbeddingCache(basePath2, memCache);
  }
  log.debug(`embedding: \u83B7\u53D6 ${vector.length} \u7EF4\u5411\u91CF`);
  return vector;
}
var VISION_TIMEOUT_MS = 3e4;
async function describeImage(imageUrl) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Promise((resolve2) => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "url", url: imageUrl } },
          { type: "text", text: "\u7528\u7B80\u77ED\u6587\u672C\u63CF\u8FF0\u8FD9\u5F20\u56FE\u7247\u7684\u5185\u5BB9\uFF0C\u4E0D\u8D85\u8FC7200\u5B57\u3002" }
        ]
      }]
    });
    const req = (0, import_https2.request)({
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      }
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          if (res.statusCode !== 200) {
            resolve2(null);
            return;
          }
          const json = JSON.parse(data);
          const text = json.content?.[0]?.text;
          resolve2(typeof text === "string" ? text : null);
        } catch {
          resolve2(null);
        }
      });
    });
    req.on("error", () => resolve2(null));
    req.setTimeout(VISION_TIMEOUT_MS, () => {
      req.destroy();
      resolve2(null);
    });
    req.write(body);
    req.end();
  });
}

// src/infrastructure/vector-store.ts
var import_promises6 = require("fs/promises");
var import_path7 = require("path");
var DENSE_VECTOR_FILE = "dense-vectors.json";
function denseVectorPath(dir) {
  return (0, import_path7.join)(dir, ".flowpilot", DENSE_VECTOR_FILE);
}
async function loadDenseVectors(dir) {
  try {
    return JSON.parse(await (0, import_promises6.readFile)(denseVectorPath(dir), "utf-8"));
  } catch {
    return [];
  }
}
async function saveDenseVectors(dir, entries) {
  const p = denseVectorPath(dir);
  await (0, import_promises6.mkdir)((0, import_path7.dirname)(p), { recursive: true });
  await (0, import_promises6.writeFile)(p, JSON.stringify(entries), "utf-8");
}
function denseCosineSim(a, b) {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
function denseSearch(query, entries, topK) {
  return entries.map((e) => ({ id: e.id, score: denseCosineSim(query, e.vector) })).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, topK);
}

// src/infrastructure/memory.ts
var BM25_K1 = 1.2;
var BM25_B = 0.75;
var SPARSE_DIM_BITS = 20;
var SPARSE_DIM_MASK = (1 << SPARSE_DIM_BITS) - 1;
function termHash(term) {
  let h = 2166136261;
  for (let i = 0; i < term.length; i++) {
    h ^= term.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 & SPARSE_DIM_MASK;
}
var MEMORY_FILE = "memory.json";
var DF_FILE = "memory-df.json";
var SNAPSHOT_FILE = "memory-snapshot.json";
var VECTOR_FILE = "vectors.json";
var EVERGREEN_SOURCES = ["architecture", "identity", "decision"];
var CACHE_FILE2 = "memory-cache.json";
var CACHE_MAX = 50;
var CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
var dfDirty = false;
function sha2562(text) {
  return (0, import_crypto2.createHash)("sha256").update(text).digest("hex");
}
function cachePath2(basePath2) {
  return (0, import_path8.join)(basePath2, ".flowpilot", CACHE_FILE2);
}
async function loadCache(basePath2) {
  try {
    const cache = JSON.parse(await (0, import_promises7.readFile)(cachePath2(basePath2), "utf-8"));
    const now = Date.now();
    for (const k of Object.keys(cache.entries)) {
      if (now - (cache.entries[k].createdAt ?? 0) > CACHE_TTL_MS) delete cache.entries[k];
    }
    return cache;
  } catch {
    return { entries: {} };
  }
}
async function saveCache(basePath2, cache) {
  const p = cachePath2(basePath2);
  await (0, import_promises7.mkdir)((0, import_path8.dirname)(p), { recursive: true });
  const now = Date.now();
  for (const k of Object.keys(cache.entries)) {
    if (now - (cache.entries[k].createdAt ?? 0) > CACHE_TTL_MS) delete cache.entries[k];
  }
  const keys = Object.keys(cache.entries);
  if (keys.length > CACHE_MAX) {
    const sorted = keys.sort(
      (a, b) => (cache.entries[a].createdAt ?? 0) - (cache.entries[b].createdAt ?? 0)
    );
    const pruneCount = Math.ceil(keys.length * 0.25);
    for (const k of sorted.slice(0, pruneCount)) delete cache.entries[k];
  }
  await (0, import_promises7.writeFile)(p, JSON.stringify(cache), "utf-8");
}
async function clearCache(basePath2) {
  try {
    await (0, import_promises7.unlink)(cachePath2(basePath2));
  } catch {
  }
}
function temporalDecayScore(entry, halfLifeDays = 30) {
  if (entry.evergreen || EVERGREEN_SOURCES.some((s) => entry.source.includes(s))) return 1;
  const ageDays = (Date.now() - new Date(entry.timestamp).getTime()) / (24 * 60 * 60 * 1e3);
  return Math.exp(-Math.LN2 / halfLifeDays * ageDays);
}
function memoryPath(basePath2) {
  return (0, import_path8.join)(basePath2, ".flowpilot", MEMORY_FILE);
}
function dfPath(basePath2) {
  return (0, import_path8.join)(basePath2, ".flowpilot", DF_FILE);
}
function snapshotPath(basePath2) {
  return (0, import_path8.join)(basePath2, ".flowpilot", SNAPSHOT_FILE);
}
function vectorFilePath(basePath2) {
  return (0, import_path8.join)(basePath2, ".flowpilot", VECTOR_FILE);
}
async function loadVectors(basePath2) {
  try {
    return JSON.parse(await (0, import_promises7.readFile)(vectorFilePath(basePath2), "utf-8"));
  } catch {
    return [];
  }
}
async function saveVectors(basePath2, vectors) {
  const p = vectorFilePath(basePath2);
  await (0, import_promises7.mkdir)((0, import_path8.dirname)(p), { recursive: true });
  await (0, import_promises7.writeFile)(p, JSON.stringify(vectors), "utf-8");
}
function vectorSearch(queryVec, vectors, entries, k) {
  const contentMap = new Map(entries.map((e) => [e.content, e]));
  return vectors.map((v) => {
    const stored = new Map(Object.entries(v.vector).map(([k2, val]) => [Number(k2), val]));
    const entry = contentMap.get(v.content);
    if (!entry) return null;
    return { entry, score: cosineSimilarity(queryVec, stored) };
  }).filter((x) => x !== null && x.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
}
async function rebuildVectorIndex(basePath2, active, stats) {
  const vectors = active.map((e) => ({
    content: e.content,
    vector: Object.fromEntries(bm25Vector(tokenize(e.content), stats, detectLanguage(e.content)))
  }));
  await saveVectors(basePath2, vectors);
}
function isCJKRune(cp) {
  return cp >= 19968 && cp <= 40959 || cp >= 13312 && cp <= 19903 || cp >= 131072 && cp <= 173791 || cp >= 173824 && cp <= 177983 || cp >= 177984 && cp <= 178207 || cp >= 178208 && cp <= 183983 || cp >= 183984 && cp <= 191471 || cp >= 63744 && cp <= 64255 || cp >= 12288 && cp <= 12351 || cp >= 12352 && cp <= 12447 || cp >= 12448 && cp <= 12543 || cp >= 44032 && cp <= 55215 || cp >= 4352 && cp <= 4607;
}
function fastDetectLanguage(text) {
  let cjk = 0, total = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 32) continue;
    total++;
    if (isCJKRune(cp)) cjk++;
  }
  if (total === 0) return "en";
  return cjk / total > 0.15 ? "cjk" : "en";
}
var CJK_TECH_DICT = /* @__PURE__ */ new Set([
  "\u6570\u636E\u5E93",
  "\u670D\u52A1\u5668",
  "\u5BA2\u6237\u7AEF",
  "\u4E2D\u95F4\u4EF6",
  "\u5FAE\u670D\u52A1",
  "\u8D1F\u8F7D\u5747\u8861",
  "\u6D88\u606F\u961F\u5217",
  "\u7F13\u5B58",
  "\u7D22\u5F15",
  "\u4E8B\u52A1",
  "\u5E76\u53D1",
  "\u5F02\u6B65",
  "\u540C\u6B65",
  "\u56DE\u8C03",
  "\u63A5\u53E3",
  "\u8BA4\u8BC1",
  "\u6388\u6743",
  "\u52A0\u5BC6",
  "\u89E3\u5BC6",
  "\u54C8\u5E0C",
  "\u4EE4\u724C",
  "\u4F1A\u8BDD",
  "\u7EC4\u4EF6",
  "\u6A21\u5757",
  "\u63D2\u4EF6",
  "\u6846\u67B6",
  "\u4F9D\u8D56",
  "\u914D\u7F6E",
  "\u90E8\u7F72",
  "\u5BB9\u5668",
  "\u6D4B\u8BD5",
  "\u5355\u5143\u6D4B\u8BD5",
  "\u96C6\u6210\u6D4B\u8BD5",
  "\u7AEF\u5230\u7AEF",
  "\u8986\u76D6\u7387",
  "\u65AD\u8A00",
  "\u8DEF\u7531",
  "\u63A7\u5236\u5668",
  "\u6A21\u578B",
  "\u89C6\u56FE",
  "\u6A21\u677F",
  "\u6E32\u67D3",
  "\u524D\u7AEF",
  "\u540E\u7AEF",
  "\u5168\u6808",
  "\u54CD\u5E94\u5F0F",
  "\u72B6\u6001\u7BA1\u7406",
  "\u751F\u547D\u5468\u671F",
  "\u6027\u80FD",
  "\u4F18\u5316",
  "\u91CD\u6784",
  "\u8FC1\u79FB",
  "\u5347\u7EA7",
  "\u56DE\u6EDA",
  "\u7248\u672C",
  "\u65E5\u5FD7",
  "\u76D1\u63A7",
  "\u544A\u8B66",
  "\u8C03\u8BD5",
  "\u9519\u8BEF\u5904\u7406",
  "\u5F02\u5E38",
  "\u5206\u9875",
  "\u6392\u5E8F",
  "\u8FC7\u6EE4",
  "\u641C\u7D22",
  "\u805A\u5408",
  "\u5173\u8054",
  "\u5DE5\u4F5C\u6D41",
  "\u4EFB\u52A1",
  "\u8C03\u5EA6",
  "\u961F\u5217",
  "\u7BA1\u9053",
  "\u6D41\u6C34\u7EBF",
  "\u67B6\u6784",
  "\u8BBE\u8BA1\u6A21\u5F0F",
  "\u5355\u4F8B",
  "\u5DE5\u5382",
  "\u89C2\u5BDF\u8005",
  "\u7B56\u7565",
  "\u7C7B\u578B",
  "\u6CDB\u578B",
  "\u679A\u4E3E",
  "\u8054\u5408\u7C7B\u578B",
  "\u4EA4\u53C9\u7C7B\u578B",
  "\u7F16\u8BD1",
  "\u6784\u5EFA",
  "\u6253\u5305",
  "\u538B\u7F29",
  "\u8F6C\u8BD1",
  "\u4ED3\u5E93",
  "\u5206\u652F",
  "\u5408\u5E76",
  "\u51B2\u7A81",
  "\u63D0\u4EA4",
  "\u62C9\u53D6\u8BF7\u6C42"
]);
function tokenize(text) {
  const lang = detectLanguage(text);
  const lower = text.toLowerCase();
  const rawTokens = [];
  for (const m of lower.matchAll(/[a-z0-9_]{2,}|[a-z]/g)) {
    rawTokens.push(m[0]);
  }
  const cjk = [];
  for (const ch of lower) {
    if (isCJKRune(ch.codePointAt(0) ?? 0)) cjk.push(ch);
  }
  let ci = 0;
  while (ci < cjk.length) {
    let matched = false;
    for (let len = 4; len >= 2; len--) {
      if (ci + len <= cjk.length) {
        const word = cjk.slice(ci, ci + len).join("");
        if (CJK_TECH_DICT.has(word)) {
          rawTokens.push(word);
          ci += len;
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      rawTokens.push(cjk[ci]);
      if (ci + 1 < cjk.length) rawTokens.push(cjk[ci] + cjk[ci + 1]);
      if (ci + 2 < cjk.length) rawTokens.push(cjk[ci] + cjk[ci + 1] + cjk[ci + 2]);
      ci++;
    }
  }
  return analyze(rawTokens, lang).tokens;
}
function termFrequency(tokens) {
  const tf = /* @__PURE__ */ new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}
async function loadDf(basePath2) {
  try {
    const stats = JSON.parse(await (0, import_promises7.readFile)(dfPath(basePath2), "utf-8"));
    const cleaned = {};
    for (const [k, v] of Object.entries(stats.df)) {
      if (k.includes(":")) cleaned[k] = v;
    }
    stats.df = cleaned;
    return stats;
  } catch {
    return { docCount: 0, df: {}, avgDocLen: 0 };
  }
}
async function saveDf(basePath2, stats) {
  const p = dfPath(basePath2);
  await (0, import_promises7.mkdir)((0, import_path8.dirname)(p), { recursive: true });
  await (0, import_promises7.writeFile)(p, JSON.stringify(stats), "utf-8");
  dfDirty = false;
}
var _lastDfStats = null;
function rebuildDf(entries) {
  const active = entries.filter((e) => !e.archived);
  const df = {};
  let totalLen = 0;
  for (const e of active) {
    const lang = detectLanguage(e.content);
    const tokens = tokenize(e.content);
    totalLen += tokens.length;
    const unique = new Set(tokens);
    for (const t of unique) {
      const key = `${lang}:${t}`;
      df[key] = (df[key] ?? 0) + 1;
    }
  }
  return { docCount: active.length, df, avgDocLen: active.length ? totalLen / active.length : 0 };
}
function lookupDf(stats, term, lang) {
  return stats.df[`${lang}:${term}`] ?? stats.df[term] ?? 0;
}
function bm25Vector(tokens, stats, lang = "en") {
  const tf = termFrequency(tokens);
  const vec = /* @__PURE__ */ new Map();
  const N = Math.max(stats.docCount, 1);
  const avgDl = stats.avgDocLen || 1;
  const docLen = tokens.length;
  for (const [term, freq] of tf) {
    const dfVal = lookupDf(stats, term, lang);
    const idf = Math.log(1 + (N - dfVal + 0.5) / (dfVal + 0.5));
    const tfNorm = freq * (BM25_K1 + 1) / (freq + BM25_K1 * (1 - BM25_B + BM25_B * docLen / avgDl));
    const w = tfNorm * idf;
    if (w === 0) continue;
    const idx = termHash(term);
    vec.set(idx, (vec.get(idx) ?? 0) + w);
  }
  return vec;
}
function bm25QueryVector(tokens, stats, lang = "en") {
  const tf = termFrequency(tokens);
  const vec = /* @__PURE__ */ new Map();
  for (const [term, freq] of tf) {
    if (lookupDf(stats, term, lang) === 0) continue;
    const idx = termHash(term);
    vec.set(idx, (vec.get(idx) ?? 0) + freq);
  }
  return vec;
}
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (const [k, v] of a) {
    normA += v * v;
    const bv = b.get(k);
    if (bv !== void 0) dot += v * bv;
  }
  for (const v of b.values()) normB += v * v;
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
async function loadMemory(basePath2) {
  try {
    return JSON.parse(await (0, import_promises7.readFile)(memoryPath(basePath2), "utf-8"));
  } catch {
    return [];
  }
}
async function saveMemory(basePath2, entries) {
  const p = memoryPath(basePath2);
  await (0, import_promises7.mkdir)((0, import_path8.dirname)(p), { recursive: true });
  await (0, import_promises7.writeFile)(p, JSON.stringify(entries, null, 2), "utf-8");
}
async function resolveSearchableText(entry) {
  const ct = entry.contentType ?? "text";
  if (ct === "text") return entry;
  if (ct === "image") {
    const url = entry.metadata?.imageUrl;
    if (!url) return entry;
    const desc = await describeImage(url) ?? url;
    return { ...entry, content: desc, metadata: { ...entry.metadata, description: desc } };
  }
  if (ct === "mixed") {
    const desc = entry.metadata?.description ?? "";
    const merged = desc ? `${entry.content}
${desc}` : entry.content;
    return { ...entry, content: merged };
  }
  return entry;
}
async function appendMemory(basePath2, entry) {
  const resolved = await resolveSearchableText(entry);
  const entries = await loadMemory(basePath2);
  const diskDf = await loadDf(basePath2);
  const stats = diskDf.docCount > 0 ? diskDf : rebuildDf(entries);
  const entryLang = detectLanguage(resolved.content);
  const queryTokens = tokenize(resolved.content);
  const queryVec = bm25Vector(queryTokens, stats, entryLang);
  const idx = entries.findIndex((e) => {
    if (e.archived) return false;
    const vec2 = bm25Vector(tokenize(e.content), stats, detectLanguage(e.content));
    return cosineSimilarity(queryVec, vec2) > 0.8;
  });
  if (idx >= 0) {
    const oldContent = entries[idx].content;
    const updated = entries.map(
      (e, i) => i === idx ? { ...e, content: resolved.content, timestamp: resolved.timestamp, source: resolved.source, ...resolved.contentType ? { contentType: resolved.contentType } : {}, ...resolved.metadata ? { metadata: resolved.metadata } : {} } : e
    );
    log.debug(`memory: \u66F4\u65B0\u5DF2\u6709\u6761\u76EE (\u76F8\u4F3C\u5EA6>0.8)`);
    await saveMemory(basePath2, updated);
    const vectors2 = await loadVectors(basePath2);
    await saveVectors(basePath2, vectors2.filter((v) => v.content !== oldContent));
    const denseVecs = await loadDenseVectors(basePath2);
    await saveDenseVectors(basePath2, denseVecs.filter((v) => v.id !== sha256(oldContent)));
  } else {
    const newEntries = [...entries, { ...resolved, refs: 0, archived: false }];
    log.debug(`memory: \u65B0\u589E\u6761\u76EE, \u603B\u8BA1 ${newEntries.length}`);
    await saveMemory(basePath2, newEntries);
  }
  const saved = await loadMemory(basePath2);
  const newStats = rebuildDf(saved);
  dfDirty = true;
  _lastDfStats = newStats;
  await saveDf(basePath2, newStats);
  const vec = bm25Vector(tokenize(resolved.content), newStats, entryLang);
  const vecRecord = Object.fromEntries(vec);
  const vectors = await loadVectors(basePath2);
  const vi = vectors.findIndex((v) => v.content === resolved.content);
  const newVectors = vi >= 0 ? vectors.map((v, i) => i === vi ? { content: resolved.content, vector: vecRecord } : v) : [...vectors, { content: resolved.content, vector: vecRecord }];
  await saveVectors(basePath2, newVectors);
  const denseVec = await embedText(resolved.content, basePath2);
  if (denseVec) {
    const denseVecs = await loadDenseVectors(basePath2);
    const resolvedHash = sha256(resolved.content);
    const di = denseVecs.findIndex((v) => v.id === resolvedHash);
    const newDense = { id: resolvedHash, vector: denseVec };
    const updatedDense = di >= 0 ? denseVecs.map((v, i) => i === di ? newDense : v) : [...denseVecs, newDense];
    await saveDenseVectors(basePath2, updatedDense);
  }
  await clearCache(basePath2);
}
function mmrRerank(candidates, k, lambda = 0.7) {
  const selected = [];
  const remaining = [...candidates];
  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0, bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const rel = remaining[i].score;
      let maxSim = 0;
      for (const s of selected) {
        maxSim = Math.max(maxSim, cosineSimilarity(remaining[i].vec, s.vec));
      }
      const mmr = lambda * rel - (1 - lambda) * maxSim;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestIdx = i;
      }
    }
    selected.push(remaining.splice(bestIdx, 1)[0]);
  }
  return selected.map((s) => ({ entry: s.entry, score: s.score }));
}
function rrfFuse(sources) {
  const RRF_K = 60;
  const scores = /* @__PURE__ */ new Map();
  for (const source of sources) {
    for (let rank = 0; rank < source.length; rank++) {
      const { entry } = source[rank];
      const key = entry.content;
      const prev = scores.get(key);
      const rrfScore = 1 / (RRF_K + rank + 1);
      scores.set(key, {
        entry,
        score: (prev?.score ?? 0) + rrfScore
      });
    }
  }
  return [...scores.values()].sort((a, b) => b.score - a.score);
}
async function queryMemory(basePath2, taskDescription, contentTypeFilter) {
  const cacheKey = sha2562(taskDescription + (contentTypeFilter ?? ""));
  const cache = await loadCache(basePath2);
  if (cache.entries[cacheKey]) {
    log.debug("memory: \u7F13\u5B58\u547D\u4E2D");
    return cache.entries[cacheKey].results;
  }
  const entries = await loadMemory(basePath2);
  let active = entries.filter((e) => !e.archived);
  if (contentTypeFilter) {
    active = active.filter((e) => (e.contentType ?? "text") === contentTypeFilter);
  }
  if (!active.length) return [];
  const stats = await loadDf(basePath2);
  const fallback = stats.docCount > 0 ? stats : rebuildDf(entries);
  const queryLang = detectLanguage(taskDescription);
  const queryVec = bm25QueryVector(tokenize(taskDescription), fallback, queryLang);
  const source1 = active.map((e) => {
    const vec = bm25Vector(tokenize(e.content), fallback, detectLanguage(e.content));
    return { entry: e, score: cosineSimilarity(queryVec, vec) * temporalDecayScore(e), vec };
  }).filter((s) => s.score > 0.05);
  const vectors = await loadVectors(basePath2);
  const source2 = vectorSearch(queryVec, vectors, active, 10);
  const rrfSources = [
    source1.map((s) => ({ entry: s.entry, score: s.score })),
    source2
  ];
  const denseQueryVec = await embedText(taskDescription, basePath2);
  if (denseQueryVec) {
    const denseVecs = await loadDenseVectors(basePath2);
    const hashMap = new Map(active.map((e) => [sha256(e.content), e]));
    const denseHits = denseSearch(denseQueryVec, denseVecs, 10);
    const source3 = denseHits.map((h) => ({ entry: hashMap.get(h.id), score: h.score })).filter((h) => h.entry !== void 0);
    if (source3.length) rrfSources.push(source3);
  }
  const fused = rrfFuse(rrfSources);
  const candidates = fused.map((f) => {
    const vec = bm25Vector(tokenize(f.entry.content), fallback, detectLanguage(f.entry.content));
    return { entry: f.entry, score: f.score, vec };
  });
  const reranked = mmrRerank(candidates, 5);
  if (reranked.length) {
    const hitSet = new Set(reranked.map((s) => s.entry));
    const updated = entries.map((e) => hitSet.has(e) ? { ...e, refs: e.refs + 1 } : e);
    await saveMemory(basePath2, updated);
    log.debug(`memory: \u67E5\u8BE2\u547D\u4E2D ${reranked.length} \u6761`);
  }
  const results = reranked.map((s) => ({ ...s.entry, refs: s.entry.refs + 1 }));
  cache.entries[cacheKey] = { results, timestamp: (/* @__PURE__ */ new Date()).toISOString(), createdAt: Date.now() };
  await saveCache(basePath2, cache);
  return results;
}
async function decayMemory(basePath2) {
  const entries = await loadMemory(basePath2);
  let count = 0;
  const updated = entries.map((e) => {
    if (!e.archived && e.refs === 0 && temporalDecayScore(e) < 0.1) {
      count++;
      return { ...e, archived: true };
    }
    return e;
  });
  if (count) {
    await saveMemory(basePath2, updated);
    log.debug(`memory: \u8870\u51CF\u5F52\u6863 ${count} \u6761`);
  }
  return count;
}
async function saveSnapshot2(basePath2, entries) {
  const p = snapshotPath(basePath2);
  await (0, import_promises7.mkdir)((0, import_path8.dirname)(p), { recursive: true });
  await (0, import_promises7.writeFile)(p, JSON.stringify(entries, null, 2), "utf-8");
}
async function compactMemory(basePath2, targetCount) {
  const entries = await loadMemory(basePath2);
  const active = entries.filter((e) => !e.archived);
  if (active.length <= 1) return 0;
  await saveSnapshot2(basePath2, entries);
  const stats = rebuildDf(entries);
  const vecs = active.map((e) => bm25Vector(tokenize(e.content), stats, detectLanguage(e.content)));
  const merged = /* @__PURE__ */ new Set();
  const result = [...entries.filter((e) => e.archived)];
  for (let i = 0; i < active.length; i++) {
    if (merged.has(i)) continue;
    let current = active[i];
    for (let j = i + 1; j < active.length; j++) {
      if (merged.has(j)) continue;
      if (cosineSimilarity(vecs[i], vecs[j]) > 0.7) {
        const newer = new Date(active[j].timestamp) > new Date(current.timestamp) ? active[j] : current;
        current = { ...newer, refs: Math.max(current.refs, active[j].refs) };
        merged.add(j);
      }
    }
    result.push(current);
  }
  const activeResult = result.filter((e) => !e.archived);
  if (targetCount && activeResult.length > targetCount) {
    const sorted = [...activeResult].sort(
      (a, b) => a.refs !== b.refs ? a.refs - b.refs : new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    const toRemove = new Set(sorted.slice(0, activeResult.length - targetCount));
    const final = result.filter((e) => !toRemove.has(e));
    await saveMemory(basePath2, final);
    const finalStats = rebuildDf(final);
    dfDirty = true;
    _lastDfStats = finalStats;
    await saveDf(basePath2, finalStats);
    await rebuildVectorIndex(basePath2, final.filter((e) => !e.archived), finalStats);
    await clearCache(basePath2);
    log.debug(`memory: \u538B\u7F29 ${entries.length} \u2192 ${final.length} \u6761`);
    return entries.length - final.length;
  }
  await saveMemory(basePath2, result);
  const resultStats = rebuildDf(result);
  dfDirty = true;
  _lastDfStats = resultStats;
  await saveDf(basePath2, resultStats);
  await rebuildVectorIndex(basePath2, result.filter((e) => !e.archived), resultStats);
  await clearCache(basePath2);
  const removed = entries.length - result.length;
  if (removed) log.debug(`memory: \u538B\u7F29\u5408\u5E76 ${removed} \u6761`);
  return removed;
}

// src/infrastructure/truncation.ts
function estimateCharsPerToken(text) {
  return fastDetectLanguage(text) === "cjk" ? 1.5 : 3.5;
}
function truncateHeadTail(text, maxChars) {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.7);
  const tail = Math.floor(maxChars * 0.2);
  return `${text.slice(0, head)}

[...truncated ${text.length - head - tail} chars...]

${text.slice(-tail)}`;
}
function computeMaxChars(contextWindow = 128e3, sample) {
  const cpt = sample ? estimateCharsPerToken(sample) : 3.5;
  return Math.floor(contextWindow * 0.3 * cpt);
}

// src/infrastructure/loop-detector.ts
var import_promises9 = require("fs/promises");
var import_path10 = require("path");

// src/infrastructure/heartbeat.ts
var import_promises8 = require("fs/promises");
var import_path9 = require("path");
var TASK_TIMEOUT_MS = 30 * 60 * 1e3;
var MEMORY_COMPACT_THRESHOLD = 100;
var DEFAULT_INTERVAL_MS = 5 * 60 * 1e3;
function getTimedOutTaskIds(activeIds, activationState, lastCheckpointTimeMs, nowMs = Date.now()) {
  return activeIds.filter((id) => {
    const activatedAt = activationState[id]?.time;
    if (typeof activatedAt === "number" && Number.isFinite(activatedAt)) {
      return nowMs - activatedAt > TASK_TIMEOUT_MS;
    }
    return lastCheckpointTimeMs > 0 && nowMs - lastCheckpointTimeMs > TASK_TIMEOUT_MS;
  });
}
function isWithinActiveHours(cfg) {
  if (!cfg?.activeHoursStart && cfg?.activeHoursStart !== 0) return true;
  const now = cfg.timezone ? new Date((/* @__PURE__ */ new Date()).toLocaleString("en-US", { timeZone: cfg.timezone })) : /* @__PURE__ */ new Date();
  const hour = now.getHours();
  const day = now.getDay();
  if (cfg.activeDays?.length && !cfg.activeDays.includes(day)) return false;
  const start = cfg.activeHoursStart;
  const end = cfg.activeHoursEnd ?? 23;
  return start <= end ? hour >= start && hour <= end : hour >= start || hour <= end;
}
async function runHeartbeat(basePath2, config) {
  if (!isWithinActiveHours(config)) return { warnings: [], actions: [] };
  const warnings = [];
  const actions = [];
  try {
    const raw = await (0, import_promises8.readFile)((0, import_path9.join)(basePath2, ".workflow", "progress.md"), "utf-8");
    const data = parseProgressMarkdown(raw);
    if (data.status === "running") {
      const activeIds = data.tasks.filter((task) => task.status === "active").map((task) => task.id);
      if (activeIds.length) {
        const [window, activationState, pulseState] = await Promise.all([
          loadWindow(basePath2),
          loadActivationState(basePath2),
          loadTaskPulseState(basePath2)
        ]);
        const lastCheckpointTimeMs = window.length ? new Date(window[window.length - 1].timestamp).getTime() : 0;
        const timedOutIds = getTimedOutTaskIds(activeIds, activationState, lastCheckpointTimeMs);
        if (timedOutIds.length) {
          warnings.push(`[TIMEOUT] \u4EFB\u52A1 ${timedOutIds.join(",")} \u8D85\u8FC730\u5206\u949F\u65E0checkpoint`);
        }
        const stalePulseIds = activeIds.filter((id) => {
          const updatedAt = pulseState.byTask[id]?.updatedAt;
          if (!updatedAt) return false;
          return Date.now() - new Date(updatedAt).getTime() > TASK_TIMEOUT_MS;
        });
        if (stalePulseIds.length) {
          warnings.push(`[STALL] \u4EFB\u52A1 ${stalePulseIds.join(",")} \u8D85\u8FC730\u5206\u949F\u65E0\u9636\u6BB5\u4E0A\u62A5`);
        }
      }
    }
  } catch {
  }
  try {
    const memories = await loadMemory(basePath2);
    const activeCount = memories.filter((e) => !e.archived).length;
    if (activeCount > MEMORY_COMPACT_THRESHOLD) {
      await compactMemory(basePath2);
      actions.push(`compacted memory from ${activeCount} entries`);
      warnings.push(`[MEMORY] \u6D3B\u8DC3\u8BB0\u5FC6 ${activeCount} \u6761\uFF0C\u5DF2\u81EA\u52A8\u538B\u7F29`);
    }
  } catch {
  }
  try {
    const dfStats = await loadDf(basePath2);
    if (dfStats.docCount > 0) {
      const memories = await loadMemory(basePath2);
      const rebuilt = rebuildDf(memories);
      const diff = Math.abs(dfStats.docCount - rebuilt.docCount) / Math.max(dfStats.docCount, 1);
      if (diff > 0.1) {
        await saveDf(basePath2, rebuilt);
        actions.push("rebuilt DF stats");
        warnings.push(`[DF] docCount \u504F\u5DEE ${(diff * 100).toFixed(0)}%\uFF0C\u5DF2\u91CD\u5EFA`);
      }
    }
  } catch {
  }
  if (warnings.length) log.info(`[heartbeat] ${warnings.join("; ")}`);
  return { warnings, actions };
}
function startHeartbeat(basePath2, intervalMs = DEFAULT_INTERVAL_MS, config) {
  const timer = setInterval(() => {
    runHeartbeat(basePath2, config).catch(() => {
    });
  }, intervalMs);
  timer.unref();
  log.debug(`[heartbeat] started (interval=${intervalMs}ms)`);
  return () => {
    clearInterval(timer);
    log.debug("[heartbeat] stopped");
  };
}

// src/infrastructure/loop-detector.ts
var WINDOW_SIZE = 20;
var STATE_FILE = "loop-state.json";
function fnv1a(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = h * 16777619 >>> 0;
  }
  return h;
}
function tokenize2(text) {
  const tokens = /* @__PURE__ */ new Set();
  for (const m of text.toLowerCase().matchAll(/[a-z0-9_]+|[\u4e00-\u9fff]/g)) {
    tokens.add(m[0]);
  }
  return tokens;
}
function similarity(a, b) {
  const sa = tokenize2(a), sb = tokenize2(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}
function statePath(basePath2) {
  return (0, import_path10.join)(basePath2, ".workflow", STATE_FILE);
}
async function loadWindow(basePath2) {
  try {
    return JSON.parse(await (0, import_promises9.readFile)(statePath(basePath2), "utf-8"));
  } catch {
    return [];
  }
}
async function saveWindow(basePath2, window) {
  const p = statePath(basePath2);
  await (0, import_promises9.mkdir)((0, import_path10.dirname)(p), { recursive: true });
  await (0, import_promises9.writeFile)(p, JSON.stringify(window), "utf-8");
}
function repeatedNoProgress(window) {
  if (window.length < 3) return null;
  const last3 = window.slice(-3);
  if (!last3.every((r) => r.status === "failed")) return null;
  const sim01 = similarity(last3[0].summary, last3[1].summary);
  const sim12 = similarity(last3[1].summary, last3[2].summary);
  if (sim01 > 0.8 && sim12 > 0.8) {
    return {
      stuck: true,
      strategy: "repeatedNoProgress",
      message: `\u8FDE\u7EED3\u6B21\u76F8\u4F3C\u5931\u8D25\uFF08\u76F8\u4F3C\u5EA6 ${sim01.toFixed(2)}/${sim12.toFixed(2)}\uFF09\uFF0C\u4EFB\u52A1\u53EF\u80FD\u9677\u5165\u6B7B\u5FAA\u73AF`
    };
  }
  return null;
}
function pingPong(window) {
  if (window.length < 4) return null;
  const last4 = window.slice(-4);
  if (!last4.every((r) => r.status === "failed")) return null;
  if (last4[0].taskId === last4[2].taskId && last4[1].taskId === last4[3].taskId && last4[0].taskId !== last4[1].taskId) {
    return {
      stuck: true,
      strategy: "pingPong",
      message: `\u4EFB\u52A1 ${last4[0].taskId} \u548C ${last4[1].taskId} \u4EA4\u66FF\u5931\u8D25\uFF0C\u7591\u4F3C\u4E52\u4E53\u5FAA\u73AF`
    };
  }
  return null;
}
function globalCircuitBreaker(window) {
  if (window.length < 5) return null;
  const failCount = window.filter((r) => r.status === "failed").length;
  const rate = failCount / window.length;
  if (rate > 0.6) {
    return {
      stuck: true,
      strategy: "globalCircuitBreaker",
      message: `\u6ED1\u52A8\u7A97\u53E3\u5931\u8D25\u7387 ${(rate * 100).toFixed(0)}%\uFF08${failCount}/${window.length}\uFF09\uFF0C\u5EFA\u8BAE\u6682\u505C\u5DE5\u4F5C\u6D41\u6392\u67E5\u95EE\u9898`
    };
  }
  return null;
}
async function detect(basePath2, taskId, summary, failed, activeHours) {
  if (!isWithinActiveHours(activeHours)) return null;
  const window = await loadWindow(basePath2);
  const record = {
    taskId,
    summary,
    status: failed ? "failed" : "done",
    hash: fnv1a(summary),
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  const updated = [...window, record].slice(-WINDOW_SIZE);
  await saveWindow(basePath2, updated);
  return repeatedNoProgress(updated) ?? pingPong(updated) ?? globalCircuitBreaker(updated);
}

// src/interfaces/formatter.ts
var ICON = {
  pending: "\u25CB",
  active: "\u23F3",
  done: "\u2713",
  skipped: "\u2298",
  failed: "\u2717"
};
function workflowName2(name) {
  return name?.trim() ? name : "\u672A\u547D\u540D\u5DE5\u4F5C\u6D41";
}
function summarizeCounts(data) {
  const done = data.tasks.filter((t) => t.status === "done").length;
  const active = data.tasks.filter((t) => t.status === "active").length;
  const pending = data.tasks.filter((t) => t.status === "pending").length;
  const skipped2 = data.tasks.filter((t) => t.status === "skipped").length;
  const failed = data.tasks.filter((t) => t.status === "failed").length;
  const parts = [
    done === data.tasks.length ? "\u2713 \u5168\u90E8\u5B8C\u6210" : `${done}/${data.tasks.length} \u5DF2\u5B8C\u6210`,
    active ? `\u23F3 ${active} \u8FDB\u884C\u4E2D` : "",
    pending ? `\u25CB ${pending} \u5F85\u6267\u884C` : "",
    skipped2 ? `\u2298 ${skipped2} \u8DF3\u8FC7` : "",
    failed ? `\u2717 ${failed} \u5931\u8D25` : ""
  ].filter(Boolean);
  return parts.join(" | ");
}
function readLiveValue(task, keys) {
  for (const key of keys) {
    const value = task[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return void 0;
}
function calcActiveDuration(activatedAt) {
  if (!activatedAt) return null;
  const elapsed = Date.now() - activatedAt;
  const mins = Math.floor(elapsed / 6e4);
  const secs = Math.floor(elapsed % 6e4 / 1e3);
  if (mins === 0) return `\u23F1\uFE0F ${secs}\u79D2`;
  return `\u23F1\uFE0F ${mins}\u5206${secs}\u79D2`;
}
function isTimeout(activatedAt) {
  if (!activatedAt) return false;
  return Date.now() - activatedAt > 5 * 60 * 1e3;
}
function formatTaskMeta(task) {
  const stage = readLiveValue(task, ["stage", "phase", "liveStage"]);
  const recent = readLiveValue(task, ["recentActivity", "lastActivityText", "activityAge"]);
  const progress = readLiveValue(task, ["progressText", "latestProgress", "activitySummary"]);
  const activatedAt = typeof task.activatedAt === "number" ? task.activatedAt : void 0;
  const activeDuration = task.status === "active" ? calcActiveDuration(activatedAt) : null;
  const timeoutWarning = task.status === "active" && isTimeout(activatedAt) ? "\u26A0\uFE0F \u8D85\u65F6" : "";
  const parts = [
    stage ? `\u{1F4CD} ${stage}` : "",
    recent ? `\u{1F550} ${recent}` : "",
    progress ? `\u{1F4C8} ${progress}` : "",
    activeDuration ? activeDuration : "",
    timeoutWarning
  ].filter(Boolean);
  return parts.length ? `   ${parts.join(" \xB7 ")}` : null;
}
function formatTaskLine(task) {
  const icon = ICON[task.status] ?? "\u25CB";
  const typeTag = `[${task.type}]`;
  const summary = task.summary ? ` \u2014 ${task.summary}` : "";
  const lines = [`${icon} ${task.id} ${typeTag} ${task.title}${summary}`];
  const meta = formatTaskMeta(task);
  if (meta) lines.push(meta);
  return lines;
}
function formatStatus(data) {
  const activeTasks = data.tasks.filter((task) => task.status === "active");
  const blockedTasks = data.tasks.filter((task) => readLiveValue(task, ["stage", "phase", "liveStage"]) === "blocked");
  const statusEmoji = data.status === "running" ? "\u{1F504}" : data.status === "finishing" ? "\u{1F3C1}" : "\u23F8";
  const lines = [
    `**\u2550\u2550\u2550 \u5DE5\u4F5C\u6D41\u72B6\u6001 \u2550\u2550\u2550**`,
    `${statusEmoji} ${workflowName2(data.name)} \xB7 ${data.status}`,
    `\u{1F4CA} ${summarizeCounts(data)}`,
    "",
    "**\u2550\u2550\u2550 \u4EFB\u52A1\u8FDB\u5EA6 \u2550\u2550\u2550**",
    ...data.tasks.flatMap((task) => formatTaskLine(task))
  ];
  const nextSteps = [
    activeTasks.length ? `\u23F3 \u7EE7\u7EED\u8DDF\u8FDB\u8FDB\u884C\u4E2D\u7684\u4EFB\u52A1 (${activeTasks.map((task) => task.id).join(", ")})` : "",
    blockedTasks.length ? `\u26A0\uFE0F \u4F18\u5148\u5904\u7406\u963B\u585E\u4EFB\u52A1 (${blockedTasks.map((task) => task.id).join(", ")})` : "",
    !activeTasks.length && !blockedTasks.length && data.tasks.some((task) => task.status === "pending") ? "\u{1F4A1} \u8FD0\u884C `node flow.js next` \u83B7\u53D6\u4E0B\u4E00\u6279\u4EFB\u52A1" : ""
  ].filter(Boolean);
  if (nextSteps.length) {
    lines.push("", "**\u2550\u2550\u2550 \u4E0B\u4E00\u6B65 \u2550\u2550\u2550**", ...nextSteps.map((step) => `- ${step}`));
  }
  return lines.join("\n");
}
function formatTask(task, context) {
  const icon = ICON[task.status] ?? "\u25CB";
  const typeIcon = task.type === "frontend" ? "\u{1F3A8}" : task.type === "backend" ? "\u2699\uFE0F" : "\u{1F4CB}";
  const lines = [
    `**\u2550\u2550\u2550 \u4EFB\u52A1 ${task.id} \u2550\u2550\u2550**`,
    `${icon} **${task.title}**`,
    "",
    `${typeIcon} \u7C7B\u578B: ${task.type}`,
    `\u{1F4CE} \u4F9D\u8D56: ${task.deps.length ? task.deps.join(", ") : "\u65E0"}`,
    `\u{1F3AF} \u76EE\u6807: ${task.description || "\u672A\u63D0\u4F9B\u989D\u5916\u63CF\u8FF0"}`,
    "",
    "**Checkpoint \u6307\u4EE4**",
    "```",
    `echo '\u4E00\u53E5\u8BDD\u6458\u8981' | node flow.js checkpoint ${task.id} --files <file1> <file2>`,
    "```"
  ];
  if (context) {
    lines.push("", "**\u2550\u2550\u2550 \u4E0A\u4E0B\u6587 \u2550\u2550\u2550**", context);
  }
  return lines.join("\n");
}
function formatBatch(items) {
  const lines = [
    "**\u2550\u2550\u2550 \u5E76\u884C\u4EFB\u52A1\u6279\u6B21 \u2550\u2550\u2550**",
    `\u{1F4E6} \u672C\u8F6E\u5171 ${items.length} \u4E2A\u72EC\u7ACB\u4EFB\u52A1`,
    "\u26A1 \u8981\u6C42: \u5728\u540C\u4E00\u6761\u6D88\u606F\u4E2D\u5E76\u884C\u6D3E\u53D1\u5168\u90E8\u4EFB\u52A1",
    "\u{1F4A1} \u63D0\u793A: \u53EF\u628A\u8FD9\u4E00\u6279\u5F53\u4F5C\u540C\u4E00\u8F6E\u5E76\u884C\u524D\u6CBF\uFF0C\u4E00\u6B21\u6D3E\u5B8C\u518D\u7EDF\u4E00\u6C47\u603B",
    ""
  ];
  for (const { task, context } of items) {
    lines.push(formatTask(task, context), "");
  }
  return lines.join("\n");
}
function formatFinalSummary(data) {
  const done = data.tasks.filter((t) => t.status === "done").length;
  const skipped2 = data.tasks.filter((t) => t.status === "skipped").length;
  const failed = data.tasks.filter((t) => t.status === "failed").length;
  const pending = data.tasks.filter((t) => t.status === "pending" || t.status === "active").length;
  const stats = [
    `\u2713 ${done} \u5B8C\u6210`,
    skipped2 ? `\u2298 ${skipped2} \u8DF3\u8FC7` : "",
    failed ? `\u2717 ${failed} \u5931\u8D25` : "",
    pending ? `\u25CB ${pending} \u672A\u5B8C\u6210` : ""
  ].filter(Boolean).join(" \xB7 ");
  return [
    "**\u2550\u2550\u2550 \u6700\u7EC8\u603B\u7ED3 \u2550\u2550\u2550**",
    `\u{1F4CB} \u5DE5\u4F5C\u6D41: ${workflowName2(data.name)}`,
    `\u{1F4CA} \u7EDF\u8BA1: ${stats}`,
    "",
    "**\u2550\u2550\u2550 \u4EFB\u52A1\u5217\u8868 \u2550\u2550\u2550**",
    ...data.tasks.flatMap((task) => formatTaskLine(task))
  ].join("\n");
}

// src/application/workflow-service.ts
var import_node_child_process3 = require("child_process");
var import_promises10 = require("fs/promises");
var import_path11 = require("path");
var CHECKPOINT_FAILURE_PATTERNS = [
  /^FAILED\b/i,
  /^(?:fail(?:ed)?|error|crash(?:ed)?|timeout|timed out|rate[- ]?limit(?:ed)?)\b(?:(?:\s*[:\-])|(?:\s+(?:while|when|after|before|during|waiting|connecting|applying|fetching|reading|writing|running|executing|acquiring|get(?:ting)?|to|for))|$)/i,
  /^(?:失败|异常|超时|崩溃|限流|中断|未完成)(?:(?:[:：，。；、])|(?:导致|发生|退出|终止|中断|等待|卡住)|$)/,
  /^无法(?:完成|继续|执行|连接|获取|读取|写入|启动|构建|运行|应用)/
];
function isExplicitFailureCheckpoint(detail) {
  const normalized = detail.trim();
  return CHECKPOINT_FAILURE_PATTERNS.some((pattern) => pattern.test(normalized));
}
var CANONICAL_SETUP_NON_COMMITTABLE_FILES = ["AGENTS.md", "CLAUDE.md", ".gitignore"];
var NON_BLOCKING_SETUP_RESIDUE_FILES = /* @__PURE__ */ new Set(["AGENTS.md", "CLAUDE.md", "ROLE.md"]);
var WorkflowService = class {
  constructor(repo2, parse) {
    this.repo = repo2;
    this.parse = parse;
  }
  stopHeartbeat = null;
  locallyActivatedTaskIds = /* @__PURE__ */ new Set();
  loopWarningPath() {
    return (0, import_path11.join)(this.repo.projectRoot(), ".workflow", "loop-warning.txt");
  }
  async saveLoopWarning(msg) {
    const p = this.loopWarningPath();
    await (0, import_promises10.mkdir)((0, import_path11.join)(this.repo.projectRoot(), ".workflow"), { recursive: true });
    await (0, import_promises10.writeFile)(p, msg, "utf-8");
  }
  async loadAndClearLoopWarning() {
    try {
      const msg = await (0, import_promises10.readFile)(this.loopWarningPath(), "utf-8");
      await (0, import_promises10.unlink)(this.loopWarningPath());
      return msg || null;
    } catch {
      return null;
    }
  }
  /** 跨进程激活时长(ms)，仅当前实例刚激活的任务返回 Infinity（跳过检查） */
  async getActivationAge(id) {
    if (this.locallyActivatedTaskIds.has(id)) {
      return Infinity;
    }
    return getTaskActivationAge(this.repo.projectRoot(), id);
  }
  async loadSetupOwnedSet() {
    const persistedSetupOwnedFiles = (await loadSetupOwnedFiles(this.repo.projectRoot())).files;
    return /* @__PURE__ */ new Set([...CANONICAL_SETUP_NON_COMMITTABLE_FILES, ...persistedSetupOwnedFiles]);
  }
  async loadPreferredClient() {
    const config = await this.repo.loadConfig();
    const client = config.client;
    return client === "claude" || client === "codex" || client === "cursor" || client === "snow-cli" || client === "other" ? client : "other";
  }
  finalSummaryPath() {
    return (0, import_path11.join)(this.repo.projectRoot(), ".workflow", "final-summary.md");
  }
  async persistFinalSummary(content) {
    const path = this.finalSummaryPath();
    await (0, import_promises10.mkdir)((0, import_path11.join)(this.repo.projectRoot(), ".workflow"), { recursive: true });
    await (0, import_promises10.writeFile)(`${path}.tmp`, `${content}
`, "utf-8");
    await (0, import_promises10.rename)(`${path}.tmp`, path);
  }
  createEmptyFinalCommit(title, summary) {
    const cwd = this.repo.projectRoot();
    try {
      (0, import_node_child_process3.execFileSync)("git", ["rev-parse", "--is-inside-work-tree"], { cwd, stdio: "pipe" });
    } catch {
      return { status: "skipped", reason: "no-files" };
    }
    const msg = `task-finish: ${title}

${summary}`;
    try {
      (0, import_node_child_process3.execFileSync)("git", ["commit", "--allow-empty", "-F", "-"], {
        cwd,
        stdio: "pipe",
        input: msg
      });
      return { status: "committed" };
    } catch (error) {
      return {
        status: "failed",
        error: `${cwd}: ${error?.stderr?.toString?.() || error?.message || String(error)}`
      };
    }
  }
  async getResumeDirtyState(currentDirtyFiles = this.repo.listChangedFiles()) {
    const baseline = await loadDirtyBaseline(this.repo.projectRoot());
    const setupOwnedSet = await this.loadSetupOwnedSet();
    const taskOwnedFiles = collectOwnedFiles(await loadOwnedFiles(this.repo.projectRoot()));
    const classified = classifyResumeDirtyFiles(
      currentDirtyFiles,
      baseline?.files ?? null,
      [...setupOwnedSet],
      taskOwnedFiles
    );
    const residueFiles = classified.taskOwnedResidueFiles;
    const ambiguousFiles = classified.ambiguousFiles;
    if (!baseline) {
      if (!residueFiles.length && !ambiguousFiles.length) {
        return {
          lines: ["\u672A\u627E\u5230 dirty baseline\uFF1B\u5F53\u524D\u5DE5\u4F5C\u533A\u65E0\u672A\u5F52\u6863\u53D8\u66F4\uFF0C\u4F46\u65E0\u6CD5\u8BC1\u660E\u8FD9\u662F\u5E72\u51C0\u91CD\u542F"],
          residueFiles,
          ambiguousFiles,
          baselineFound: false
        };
      }
      const lines2 = [
        "\u672A\u627E\u5230 dirty baseline\uFF1B\u65E0\u6CD5\u53EF\u9760\u533A\u5206\u542F\u52A8\u524D\u53D8\u66F4\u3001\u4E2D\u65AD\u4EFB\u52A1\u6B8B\u7559\u4E0E\u7528\u6237\u624B\u52A8\u4FEE\u6539/\u5220\u9664\u3002"
      ];
      if (residueFiles.length) {
        lines2.push(`\u5DF2\u4FDD\u7559 ${residueFiles.length} \u4E2A\u7531\u663E\u5F0F ownership \u652F\u6491\u7684\u5F85\u63A5\u7BA1\u53D8\u66F4:`);
        lines2.push(...residueFiles.map((file) => `- ${file}`));
      }
      if (ambiguousFiles.length) {
        lines2.push(`\u4FDD\u5B88\u4FDD\u7559 ${ambiguousFiles.length} \u4E2A\u5F52\u5C5E\u672A\u660E\u53D8\u66F4\uFF08\u53EF\u80FD\u5305\u542B\u7528\u6237\u624B\u52A8\u4FEE\u6539/\u5220\u9664\uFF0CFlowPilot \u4E0D\u4F1A\u81EA\u52A8\u6062\u590D\u8FD9\u4E9B\u6587\u4EF6\uFF09:`);
        lines2.push(...ambiguousFiles.map((file) => `- ${file}`));
      }
      return {
        lines: lines2,
        residueFiles,
        ambiguousFiles,
        baselineFound: false
      };
    }
    if (!classified.currentFiles.length || !classified.preservedBaselineFiles.length && !residueFiles.length && !ambiguousFiles.length) {
      return {
        lines: ["\u5F53\u524D\u5DE5\u4F5C\u533A\u65E0\u5F85\u63A5\u7BA1\u53D8\u66F4\uFF0C\u672C\u6B21\u6062\u590D\u662F\u5E72\u51C0\u91CD\u542F"],
        residueFiles: [],
        ambiguousFiles: [],
        baselineFound: true
      };
    }
    const lines = [];
    if (classified.preservedBaselineFiles.length) {
      lines.push(`\u5DE5\u4F5C\u6D41\u542F\u52A8\u524D\u5DF2\u6709 ${classified.preservedBaselineFiles.length} \u4E2A\u672A\u5F52\u6863\u53D8\u66F4\u4ECD\u7136\u4FDD\u7559:`);
      lines.push(...classified.preservedBaselineFiles.map((file) => `- ${file}`));
    }
    if (residueFiles.length) {
      lines.push(`\u5DF2\u4FDD\u7559 ${residueFiles.length} \u4E2A\u7531\u663E\u5F0F ownership \u652F\u6491\u7684\u5F85\u63A5\u7BA1\u53D8\u66F4:`);
      lines.push(...residueFiles.map((file) => `- ${file}`));
    }
    if (ambiguousFiles.length) {
      lines.push(`\u53D1\u73B0 ${ambiguousFiles.length} \u4E2A\u5DE5\u4F5C\u6D41\u671F\u95F4\u65B0\u589E\u4F46\u5F52\u5C5E\u672A\u660E\u7684\u53D8\u66F4\uFF08\u53EF\u80FD\u5305\u542B\u7528\u6237\u624B\u52A8\u4FEE\u6539/\u5220\u9664\uFF0CFlowPilot \u4E0D\u4F1A\u81EA\u52A8\u6062\u590D\u8FD9\u4E9B\u6587\u4EF6\uFF09:`);
      lines.push(...ambiguousFiles.map((file) => `- ${file}`));
    }
    return { lines, residueFiles, ambiguousFiles, baselineFound: true };
  }
  async assertNotReconciling(data) {
    if (data.status !== "reconciling") return;
    const reconcile = await loadReconcileState(this.repo.projectRoot());
    const taskText = reconcile.taskIds.length ? ` ${reconcile.taskIds.join(", ")}` : "";
    throw new Error(`\u5F53\u524D\u5DE5\u4F5C\u6D41\u5904\u4E8E reconciling \u72B6\u6001\uFF0C\u9700\u5148\u5904\u7406\u4E2D\u65AD\u4EFB\u52A1${taskText}\u3002\u8BF7\u5148\u6267\u884C node flow.js adopt <id> --files ...\uFF0C\u6216\u5728\u786E\u8BA4\u5E76\u5904\u7406\u5217\u51FA\u7684\u672C\u4EFB\u52A1\u53D8\u66F4\u540E\u6267\u884C node flow.js restart <id>\u3002\u82E5\u5B58\u5728\u5F52\u5C5E\u672A\u660E\u53D8\u66F4\uFF0C\u5FC5\u987B\u5148\u4EBA\u5DE5\u786E\u8BA4\uFF1B\u4E0D\u8981\u5BF9\u6DF7\u6709\u624B\u52A8\u4FEE\u6539/\u5220\u9664\u7684\u6587\u4EF6\u6267\u884C\u6574\u6587\u4EF6 git restore\u3002\u4E0D\u5F97\u5904\u7406 baseline \u53D8\u66F4\u6216\u672A\u5217\u51FA\u7684\u5176\u4ED6\u9879\u76EE\u4EE3\u7801\uFF1B\u5FC5\u8981\u65F6\u53EF node flow.js skip <id>`);
  }
  async finalizeSuccessfulTask(data, task, detail, files) {
    if (!detail.trim()) throw new Error(`\u4EFB\u52A1 ${task.id} checkpoint\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A`);
    const existingMems = (await loadMemory(this.repo.projectRoot())).filter((m) => !m.archived).map((m) => m.content);
    const maxChars = computeMaxChars(128e3, detail);
    const truncated = detail.length > maxChars ? truncateHeadTail(detail, maxChars) : detail;
    const summaryLine = truncated.split("\n")[0].slice(0, 80);
    this.locallyActivatedTaskIds.delete(task.id);
    const newData = completeTask(data, task.id, summaryLine);
    log.debug(`checkpoint ${task.id}: \u5B8C\u6210, summary="${summaryLine}"`);
    await this.repo.saveProgress(newData);
    await this.repo.saveTaskContext(task.id, `# task-${task.id}: ${task.title}

${detail}
`);
    await recordOwnedFiles(this.repo.projectRoot(), task.id, files ?? []);
    for (const entry of await extractAll(detail, `task-${task.id}`, existingMems)) {
      await appendMemory(this.repo.projectRoot(), {
        content: entry.content,
        source: entry.source,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    const loopResult = await detect(this.repo.projectRoot(), task.id, summaryLine, false);
    if (loopResult) {
      log.step("loop_detected", loopResult.message, { taskId: task.id, data: { strategy: loopResult.strategy } });
      await this.saveLoopWarning(`[LOOP WARNING - ${loopResult.strategy}] ${loopResult.message}`);
    }
    await this.updateSummary(newData);
    const commitResult = this.repo.commit(task.id, task.title, summaryLine, files);
    if (commitResult.status === "committed") this.repo.tag(task.id);
    await runLifecycleHook("onTaskComplete", this.repo.projectRoot(), { TASK_ID: task.id, TASK_TITLE: task.title });
    const doneCount = newData.tasks.filter((t) => t.status === "done").length;
    let msg = `\u4EFB\u52A1 ${task.id} \u5B8C\u6210 (${doneCount}/${newData.tasks.length})`;
    msg += this.formatCommitMessage(commitResult, "task");
    return isAllDone(newData.tasks) ? msg + "\n\u5168\u90E8\u4EFB\u52A1\u5DF2\u5B8C\u6210\uFF0C\u8BF7\u6267\u884C node flow.js finish \u8FDB\u884C\u6536\u5C3E" : msg;
  }
  /** init: 解析任务markdown → 生成progress/tasks */
  async init(tasksMd, force = false) {
    try {
      const reviewResult = await review(this.repo.projectRoot());
      if (reviewResult.rolledBack) log.info(`[\u81EA\u6108] \u5DF2\u56DE\u6EDA: ${reviewResult.rollbackReason}`);
      for (const c of reviewResult.checks.filter((c2) => !c2.passed)) log.info(`[\u81EA\u6108] ${c.name}: ${c.detail}`);
    } catch (e) {
      log.debug(`[\u81EA\u6108] review \u8DF3\u8FC7: ${e}`);
    }
    const existing = await this.repo.loadProgress();
    if (existing && existing.status === "running" && !force) {
      throw new Error(`\u5DF2\u6709\u8FDB\u884C\u4E2D\u7684\u5DE5\u4F5C\u6D41: ${existing.name}\uFF0C\u4F7F\u7528 --force \u8986\u76D6`);
    }
    const def = this.parse(tasksMd);
    const tasks = def.tasks.map((t, i) => ({
      id: makeTaskId(i + 1),
      title: t.title,
      description: t.description,
      type: t.type,
      status: "pending",
      deps: t.deps,
      summary: "",
      retries: 0
    }));
    const data = {
      name: def.name,
      status: "running",
      current: null,
      tasks,
      startTime: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.locallyActivatedTaskIds.clear();
    setWorkflowName(def.name);
    await this.repo.saveProgress(data);
    await this.repo.saveTasks(tasksMd);
    await this.repo.saveSummary(`# ${def.name}

${def.description}
`);
    await clearReconcileState(this.repo.projectRoot());
    await saveDirtyBaseline(this.repo.projectRoot(), this.repo.listChangedFiles(), data.startTime);
    const client = await this.loadPreferredClient();
    const setupOwnedFiles = [];
    if (await this.repo.ensureClaudeMd(client)) {
      setupOwnedFiles.push((await loadSetupInjectionManifest(this.repo.projectRoot())).claudeMd?.path ?? "AGENTS.md");
    }
    if (client === "snow-cli" && await this.repo.ensureRoleMd(client)) setupOwnedFiles.push("ROLE.md");
    if (client === "claude" && await this.repo.ensureHooks()) setupOwnedFiles.push(".claude/settings.json");
    if (await this.repo.ensureLocalStateIgnored()) setupOwnedFiles.push(".gitignore");
    await saveSetupOwnedFiles(this.repo.projectRoot(), setupOwnedFiles);
    await this.applyHistoryInsights();
    await decayMemory(this.repo.projectRoot());
    const memories = await loadMemory(this.repo.projectRoot());
    if (memories.filter((e) => !e.archived).length > 50) {
      await compactMemory(this.repo.projectRoot());
    }
    this.stopHeartbeat?.();
    this.stopHeartbeat = startHeartbeat(this.repo.projectRoot());
    return data;
  }
  /** next: 获取下一个可执行任务（含依赖上下文） */
  async next() {
    await this.repo.lock();
    try {
      const data = await this.requireProgress();
      await this.assertNotReconciling(data);
      if (isAllDone(data.tasks)) return null;
      const active = data.tasks.filter((t) => t.status === "active");
      if (active.length) {
        throw new Error(`\u6709 ${active.length} \u4E2A\u4EFB\u52A1\u4ECD\u4E3A active \u72B6\u6001\uFF08${active.map((t) => t.id).join(",")}\uFF09\uFF0C\u8BF7\u5148\u6267\u884C node flow.js status \u68C0\u67E5\u5E76\u8865 checkpoint\uFF0C\u6216 node flow.js resume \u91CD\u7F6E`);
      }
      const cascaded = cascadeSkip(data.tasks);
      const skippedByC = cascaded.filter((t, i) => t.status === "skipped" && data.tasks[i].status !== "skipped");
      if (skippedByC.length) log.debug(`next: cascade skip ${skippedByC.map((t) => t.id).join(",")}`);
      const task = findNextTask(cascaded);
      if (!task) {
        await this.repo.saveProgress({ ...data, tasks: cascaded });
        log.debug("next: \u65E0\u53EF\u6267\u884C\u4EFB\u52A1");
        return null;
      }
      log.debug(`next: \u6FC0\u6D3B\u4EFB\u52A1 ${task.id} (deps: ${task.deps.join(",") || "\u65E0"})`);
      const activated = cascaded.map((t) => t.id === task.id ? { ...t, status: "active" } : t);
      await this.repo.saveProgress({ ...data, current: task.id, tasks: activated });
      this.locallyActivatedTaskIds.add(task.id);
      await recordTaskActivations(this.repo.projectRoot(), [task.id]);
      await runLifecycleHook("onTaskStart", this.repo.projectRoot(), { TASK_ID: task.id, TASK_TITLE: task.title });
      const parts = [];
      const summary = await this.repo.loadSummary();
      if (summary) parts.push(summary);
      for (const depId of task.deps) {
        const ctx = await this.repo.loadTaskContext(depId);
        if (ctx) parts.push(ctx);
      }
      const memories = await queryMemory(this.repo.projectRoot(), `${task.title} ${task.description}`);
      const useful = memories.filter((m) => m.content.length > 20);
      if (useful.length) {
        parts.push("## \u76F8\u5173\u8BB0\u5FC6\n\n" + useful.map((m) => `- [${m.source}] ${m.content}`).join("\n"));
      }
      const loopWarning = await this.loadAndClearLoopWarning();
      if (loopWarning) {
        parts.push(`## \u5FAA\u73AF\u68C0\u6D4B\u8B66\u544A

${loopWarning}`);
      }
      const hcWarnings = await this.healthCheck();
      if (hcWarnings.length) {
        parts.push("## \u5065\u5EB7\u68C0\u67E5\u8B66\u544A\n\n" + hcWarnings.map((w) => `- ${w}`).join("\n"));
      }
      const cfg = await this.repo.loadConfig();
      const hints = cfg.hints;
      if (hints?.length) {
        parts.push("## \u8FDB\u5316\u5EFA\u8BAE\n\n" + hints.map((h) => `- ${h}`).join("\n"));
      }
      const parallelTasks = findParallelTasks(cascaded);
      if (parallelTasks.length > 1) {
        parts.push(`## \u5E76\u884C\u63D0\u793A

\u5F53\u524D\u6709 ${parallelTasks.length} \u4E2A\u4F9D\u8D56\u4E0A\u53EF\u5E76\u884C\u7684\u4EFB\u52A1\uFF08${parallelTasks.map((taskEntry) => taskEntry.id).join(", ")}\uFF09\u3002\u82E5\u786E\u8BA4\u5B83\u4EEC\u65E0\u5199\u51B2\u7A81\uFF0C\u53EF\u6539\u7528 \`node flow.js next --batch\` \u63D0\u9AD8\u541E\u5410\u91CF\u3002`);
      }
      return { task, context: parts.join("\n\n---\n\n") };
    } finally {
      await this.repo.unlock();
    }
  }
  /** nextBatch: 获取所有可并行执行的任务 */
  async nextBatch() {
    await this.repo.lock();
    try {
      const data = await this.requireProgress();
      await this.assertNotReconciling(data);
      if (isAllDone(data.tasks)) return [];
      const active = data.tasks.filter((t) => t.status === "active");
      if (active.length) {
        throw new Error(`\u6709 ${active.length} \u4E2A\u4EFB\u52A1\u4ECD\u4E3A active \u72B6\u6001\uFF08${active.map((t) => t.id).join(",")}\uFF09\uFF0C\u8BF7\u5148\u6267\u884C node flow.js status \u68C0\u67E5\u5E76\u8865 checkpoint\uFF0C\u6216 node flow.js resume \u91CD\u7F6E`);
      }
      const cascaded = cascadeSkip(data.tasks);
      let tasks = findParallelTasks(cascaded);
      if (!tasks.length) {
        await this.repo.saveProgress({ ...data, tasks: cascaded });
        log.debug("nextBatch: \u65E0\u53EF\u5E76\u884C\u4EFB\u52A1");
        return [];
      }
      log.debug(`nextBatch: \u6FC0\u6D3B ${tasks.map((t) => t.id).join(",")}`);
      const activeIds = new Set(tasks.map((t) => t.id));
      const activated = cascaded.map((t) => activeIds.has(t.id) ? { ...t, status: "active" } : t);
      await this.repo.saveProgress({ ...data, current: tasks[0].id, tasks: activated });
      for (const task of tasks) {
        this.locallyActivatedTaskIds.add(task.id);
      }
      await recordTaskActivations(this.repo.projectRoot(), tasks.map((t) => t.id));
      for (const t of tasks) {
        await runLifecycleHook("onTaskStart", this.repo.projectRoot(), { TASK_ID: t.id, TASK_TITLE: t.title });
      }
      const summary = await this.repo.loadSummary();
      const loopWarning = await this.loadAndClearLoopWarning();
      const config = await this.repo.loadConfig();
      const results = [];
      for (const task of tasks) {
        const parts = [];
        if (summary) parts.push(summary);
        for (const depId of task.deps) {
          const ctx = await this.repo.loadTaskContext(depId);
          if (ctx) parts.push(ctx);
        }
        const memories = await queryMemory(this.repo.projectRoot(), `${task.title} ${task.description}`);
        const useful = memories.filter((m) => m.content.length > 20);
        if (useful.length) {
          parts.push("## \u76F8\u5173\u8BB0\u5FC6\n\n" + useful.map((m) => `- [${m.source}] ${m.content}`).join("\n"));
        }
        if (loopWarning) {
          parts.push(`## \u5FAA\u73AF\u68C0\u6D4B\u8B66\u544A

${loopWarning}`);
        }
        const hints = config.hints;
        if (hints?.length) {
          parts.push("## \u8FDB\u5316\u5EFA\u8BAE\n\n" + hints.map((h) => `- ${h}`).join("\n"));
        }
        results.push({ task, context: parts.join("\n\n---\n\n") });
      }
      return results;
    } finally {
      await this.repo.unlock();
    }
  }
  /** checkpoint: 记录任务完成 */
  async checkpoint(id, detail, files) {
    await this.repo.lock();
    try {
      const data = await this.requireProgress();
      const task = data.tasks.find((t) => t.id === id);
      if (!task) throw new Error(`\u4EFB\u52A1 ${id} \u4E0D\u5B58\u5728`);
      log.debug(`checkpoint ${id}: \u5F53\u524D\u72B6\u6001=${task.status}, retries=${task.retries}`);
      if (task.status !== "active") {
        throw new Error(`\u4EFB\u52A1 ${id} \u72B6\u6001\u4E3A ${task.status}\uFF0C\u53EA\u6709 active \u72B6\u6001\u53EF\u4EE5 checkpoint`);
      }
      const existingMems = (await loadMemory(this.repo.projectRoot())).filter((m) => !m.archived).map((m) => m.content);
      const isFailed = isExplicitFailureCheckpoint(detail);
      if (isFailed) {
        this.locallyActivatedTaskIds.delete(id);
        await this.appendFailureContext(id, task, detail);
        const patternWarn = await this.detectFailurePattern(id, task);
        const loopResult = await detect(this.repo.projectRoot(), id, detail, true);
        if (loopResult) {
          log.step("loop_detected", loopResult.message, { taskId: id, data: { strategy: loopResult.strategy } });
          await this.saveLoopWarning(`[LOOP WARNING - ${loopResult.strategy}] ${loopResult.message}`);
        }
        for (const entry of await extractAll(detail, `task-${id}-fail`, existingMems)) {
          await appendMemory(this.repo.projectRoot(), {
            content: entry.content,
            source: entry.source,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
        const config = await this.repo.loadConfig();
        const maxRetries = config.maxRetries ?? 3;
        const { result, data: newData } = failTask(data, id, maxRetries);
        await this.repo.saveProgress(newData);
        log.debug(`checkpoint ${id}: failTask result=${result}, retries=${task.retries + 1}`);
        const msg = result === "retry" ? `\u4EFB\u52A1 ${id} \u5931\u8D25(\u7B2C${task.retries + 1}\u6B21)\uFF0C\u5C06\u91CD\u8BD5` : `\u4EFB\u52A1 ${id} \u8FDE\u7EED\u5931\u8D25${maxRetries}\u6B21\uFF0C\u5DF2\u8DF3\u8FC7`;
        const warns = [patternWarn, loopResult ? `[LOOP] ${loopResult.message}` : null].filter(Boolean);
        return warns.length ? `${msg}
${warns.join("\n")}` : msg;
      }
      return await this.finalizeSuccessfulTask(data, task, detail, files);
    } finally {
      await this.repo.unlock();
    }
  }
  /** pulse: 记录任务阶段进展 */
  async pulse(id, phase, note = "") {
    await this.repo.lock();
    try {
      const data = await this.requireProgress();
      const task = data.tasks.find((t) => t.id === id);
      if (!task) throw new Error(`\u4EFB\u52A1 ${id} \u4E0D\u5B58\u5728`);
      if (task.status !== "active") {
        throw new Error(`\u4EFB\u52A1 ${id} \u72B6\u6001\u4E3A ${task.status}\uFF0C\u53EA\u6709 active \u72B6\u6001\u53EF\u4EE5 pulse`);
      }
      await this.repo.saveTaskPulse(id, {
        phase,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        note: note.trim() || void 0
      });
      return note.trim() ? `\u5DF2\u8BB0\u5F55\u4EFB\u52A1 ${id} \u9636\u6BB5 ${phase}: ${note.trim()}` : `\u5DF2\u8BB0\u5F55\u4EFB\u52A1 ${id} \u9636\u6BB5 ${phase}`;
    } finally {
      await this.repo.unlock();
    }
  }
  /** resume: 中断恢复 */
  async resume() {
    const data = await this.repo.loadProgress();
    if (!data) return "\u65E0\u6D3B\u8DC3\u5DE5\u4F5C\u6D41\uFF0C\u7B49\u5F85\u9700\u6C42\u8F93\u5165";
    log.debug(`resume: status=${data.status}, current=${data.current}`);
    if (data.status === "idle") return "\u5DE5\u4F5C\u6D41\u5F85\u547D\u4E2D\uFF0C\u7B49\u5F85\u9700\u6C42\u8F93\u5165";
    if (data.status === "completed") return "\u5DE5\u4F5C\u6D41\u5DF2\u5168\u90E8\u5B8C\u6210";
    if (data.status === "finishing") {
      return [
        "**\u2550\u2550\u2550 \u5F53\u524D\u72B6\u6001 \u2550\u2550\u2550**",
        `\u{1F3C1} \u5DE5\u4F5C\u6D41: ${data.name || "\u672A\u547D\u540D\u5DE5\u4F5C\u6D41"}`,
        "\u{1F4CD} \u72B6\u6001: \u6536\u5C3E\u9636\u6BB5",
        "",
        "**\u2550\u2550\u2550 \u4E0B\u4E00\u6B65 \u2550\u2550\u2550**",
        "\u{1F449} \u8FD0\u884C `node flow.js finish` \u5B8C\u6210\u6700\u7EC8\u6536\u5C3E"
      ].join("\n");
    }
    if (data.status === "reconciling") {
      const doneCount2 = data.tasks.filter((t) => t.status === "done").length;
      const total2 = data.tasks.length;
      const reconcile = await loadReconcileState(this.repo.projectRoot());
      const dirtyState2 = await this.getResumeDirtyState();
      return [
        "**\u2550\u2550\u2550 \u6062\u590D\u5DE5\u4F5C\u6D41 \u2550\u2550\u2550**",
        `\u{1F4C2} ${data.name}`,
        `\u{1F4CA} \u8FDB\u5EA6: ${doneCount2}/${total2}`,
        `\u26A0\uFE0F \u5F85\u63A5\u7BA1\u4E2D\u65AD\u4EFB\u52A1: ${reconcile.taskIds.join(", ") || data.current || "\u672A\u77E5"}`,
        "",
        "\u{1F449} \u8BF7\u5148\u6267\u884C `node flow.js adopt <id> --files ...`",
        "   \u6216\u5728\u786E\u8BA4\u5E76\u5904\u7406\u5217\u51FA\u7684\u672C\u4EFB\u52A1\u53D8\u66F4\u540E `node flow.js restart <id>`",
        "   \u82E5\u5B58\u5728\u5F52\u5C5E\u672A\u660E\u53D8\u66F4\uFF0C\u5FC5\u987B\u5148\u4EBA\u5DE5\u786E\u8BA4\uFF1B\u4E0D\u8981\u6574\u6587\u4EF6 git restore",
        "   \u4E0D\u5F97\u5904\u7406 baseline \u53D8\u66F4\u6216\u672A\u5217\u51FA\u7684\u5176\u4ED6\u9879\u76EE\u4EE3\u7801",
        ...dirtyState2.lines
      ].join("\n");
    }
    const hadActiveTasks = data.tasks.filter((t) => t.status === "active").map((t) => t.id);
    const { data: resumedData, resetId } = resumeProgress(data);
    this.locallyActivatedTaskIds.clear();
    const dirtyState = await this.getResumeDirtyState();
    const shouldReconcile = hadActiveTasks.length > 0 && (dirtyState.residueFiles.length > 0 || dirtyState.ambiguousFiles.length > 0);
    const newData = shouldReconcile ? { ...resumedData, status: "reconciling", current: hadActiveTasks[0] ?? resumedData.current } : resumedData;
    await this.repo.saveProgress(newData);
    if (shouldReconcile) {
      await saveReconcileState(this.repo.projectRoot(), hadActiveTasks);
    } else {
      await clearReconcileState(this.repo.projectRoot());
    }
    if (resetId && !shouldReconcile) {
      log.debug(`resume: \u91CD\u7F6E\u4EFB\u52A1 ${resetId}`);
      this.repo.cleanup();
    }
    const doneCount = newData.tasks.filter((t) => t.status === "done").length;
    const total = newData.tasks.length;
    this.stopHeartbeat?.();
    this.stopHeartbeat = startHeartbeat(this.repo.projectRoot());
    const statusIcon = shouldReconcile ? "\u26A0\uFE0F" : resetId ? "\u{1F504}" : "\u25B6\uFE0F";
    const statusMsg = shouldReconcile ? `\u68C0\u6D4B\u5230\u4E2D\u65AD\u4EFB\u52A1 ${hadActiveTasks.join(", ")} \u7684\u5F85\u5904\u7406\u53D8\u66F4\uFF0C\u5DF2\u6682\u505C\u8C03\u5EA6` : resetId ? `\u4E2D\u65AD\u4EFB\u52A1 ${resetId} \u5DF2\u91CD\u7F6E\uFF0C\u5C06\u91CD\u65B0\u6267\u884C` : "\u7EE7\u7EED\u6267\u884C";
    const lines = [
      "**\u2550\u2550\u2550 \u6062\u590D\u5DE5\u4F5C\u6D41 \u2550\u2550\u2550**",
      `\u{1F4C2} ${newData.name}`,
      `\u{1F4CA} \u8FDB\u5EA6: ${doneCount}/${total}`,
      statusIcon + " " + statusMsg,
      ...dirtyState.lines
    ];
    if (shouldReconcile) {
      lines.push("");
      lines.push("\u{1F449} \u8BF7\u5148\u6267\u884C `node flow.js adopt " + hadActiveTasks[0] + " --files ...`");
      lines.push("   \u6216\u786E\u8BA4\u5E76\u5904\u7406\u5217\u51FA\u7684\u672C\u4EFB\u52A1\u53D8\u66F4\u540E `node flow.js restart " + hadActiveTasks[0] + "`");
    }
    return lines.join("\n");
  }
  async adopt(id, detail, files) {
    await this.repo.lock();
    try {
      const data = await this.requireProgress();
      if (data.status !== "reconciling") {
        throw new Error("\u5F53\u524D\u5DE5\u4F5C\u6D41\u4E0D\u5904\u4E8E reconciling \u72B6\u6001\uFF0C\u65E0\u9700 adopt");
      }
      const reconcile = await loadReconcileState(this.repo.projectRoot());
      if (!reconcile.taskIds.includes(id)) {
        throw new Error(`\u4EFB\u52A1 ${id} \u4E0D\u5728\u5F85\u63A5\u7BA1\u5217\u8868\u4E2D`);
      }
      const task = data.tasks.find((t) => t.id === id);
      if (!task) throw new Error(`\u4EFB\u52A1 ${id} \u4E0D\u5B58\u5728`);
      const remainingTaskIds = reconcile.taskIds.filter((taskId) => taskId !== id);
      const baseData = {
        ...data,
        status: remainingTaskIds.length ? "reconciling" : "running",
        current: remainingTaskIds[0] ?? null
      };
      const message = await this.finalizeSuccessfulTask(baseData, task, detail, files);
      if (remainingTaskIds.length) {
        await saveReconcileState(this.repo.projectRoot(), remainingTaskIds);
        return `${message}
\u4ECD\u6709 ${remainingTaskIds.length} \u4E2A\u4E2D\u65AD\u4EFB\u52A1\u5F85\u63A5\u7BA1`;
      }
      await clearReconcileState(this.repo.projectRoot());
      return `${message}
\u4E2D\u65AD\u6B8B\u7559\u5DF2\u63A5\u7BA1\uFF0C\u5DE5\u4F5C\u6D41\u6062\u590D running`;
    } finally {
      await this.repo.unlock();
    }
  }
  async restart(id) {
    await this.repo.lock();
    try {
      const data = await this.requireProgress();
      if (data.status !== "reconciling") {
        throw new Error("\u5F53\u524D\u5DE5\u4F5C\u6D41\u4E0D\u5904\u4E8E reconciling \u72B6\u6001\uFF0C\u65E0\u9700 restart");
      }
      const reconcile = await loadReconcileState(this.repo.projectRoot());
      if (!reconcile.taskIds.includes(id)) {
        throw new Error(`\u4EFB\u52A1 ${id} \u4E0D\u5728\u5F85\u63A5\u7BA1\u5217\u8868\u4E2D`);
      }
      const dirtyState = await this.getResumeDirtyState();
      if (dirtyState.ambiguousFiles.length > 0) {
        throw new Error(`\u68C0\u6D4B\u5230 ${dirtyState.ambiguousFiles.length} \u4E2A\u5F52\u5C5E\u672A\u660E\u53D8\u66F4\uFF1A${dirtyState.ambiguousFiles.join(", ")}\u3002\u8FD9\u4E9B\u6587\u4EF6\u53EF\u80FD\u5305\u542B\u7528\u6237\u624B\u52A8\u4FEE\u6539/\u5220\u9664\uFF1BFlowPilot \u4E0D\u4F1A\u5EFA\u8BAE\u6574\u6587\u4EF6 git restore\u3002\u8BF7\u5148\u4EBA\u5DE5\u786E\u8BA4\uFF0C\u5C5E\u4E8E\u4EFB\u52A1\u4EA7\u7269\u5219\u4F7F\u7528 node flow.js adopt ${id} --files ... \u663E\u5F0F\u63A5\u7BA1\uFF0C\u5426\u5219\u4FDD\u7559\u8FD9\u4E9B\u6539\u52A8\u5E76\u907F\u514D\u8D8A\u754C\u6E05\u7406`);
      }
      if (dirtyState.residueFiles.length > 0) {
        throw new Error(`\u8BF7\u5148\u786E\u8BA4\u5E76\u5904\u7406\u5F53\u524D\u5217\u51FA\u7684\u672C\u4EFB\u52A1\u53D8\u66F4\u540E\u518D restart\uFF1A${dirtyState.residueFiles.join(", ")}\u3002\u82E5\u6587\u4EF6\u6DF7\u6709\u624B\u52A8\u4FEE\u6539/\u5220\u9664\uFF0C\u4E0D\u5F97\u6574\u6587\u4EF6 git restore\u3002\u4E0D\u5F97\u5904\u7406 baseline \u53D8\u66F4\u6216\u672A\u5217\u51FA\u7684\u5176\u4ED6\u9879\u76EE\u4EE3\u7801`);
      }
      const remainingTaskIds = reconcile.taskIds.filter((taskId) => taskId !== id);
      const newData = {
        ...data,
        status: remainingTaskIds.length ? "reconciling" : "running",
        current: null
      };
      await this.repo.saveProgress(newData);
      if (remainingTaskIds.length) {
        await saveReconcileState(this.repo.projectRoot(), remainingTaskIds);
        return `\u4EFB\u52A1 ${id} \u5DF2\u786E\u8BA4\u4ECE\u5934\u91CD\u505A\uFF0C\u4ECD\u6709 ${remainingTaskIds.length} \u4E2A\u4E2D\u65AD\u4EFB\u52A1\u5F85\u63A5\u7BA1`;
      }
      await clearReconcileState(this.repo.projectRoot());
      return `\u4EFB\u52A1 ${id} \u5DF2\u786E\u8BA4\u4ECE\u5934\u91CD\u505A\uFF0C\u5DE5\u4F5C\u6D41\u6062\u590D running`;
    } finally {
      await this.repo.unlock();
    }
  }
  /** 计算 finish 的 workflow-owned 提交边界，必要时拒绝最终提交 */
  async resolveFinishCommitFiles() {
    const baseline = await loadDirtyBaseline(this.repo.projectRoot());
    const checkpointOwnedFiles = collectOwnedFiles(await loadOwnedFiles(this.repo.projectRoot()));
    const checkpointOwnedSet = new Set(checkpointOwnedFiles);
    const persistedSetupOwnedFiles = (await loadSetupOwnedFiles(this.repo.projectRoot())).files;
    const setupOwnedFiles = [.../* @__PURE__ */ new Set([...CANONICAL_SETUP_NON_COMMITTABLE_FILES, ...persistedSetupOwnedFiles])];
    const setupOwnedSet = new Set(setupOwnedFiles);
    await this.repo.cleanupInjections();
    if (!await this.repo.doesSettingsResidueMatchBaseline()) {
      return {
        ok: false,
        message: [
          "\u62D2\u7EDD\u6700\u7EC8\u63D0\u4EA4\uFF1Asetup-owned \u6587\u4EF6\u5728\u7CBE\u786E cleanup \u540E\u4ECD\u6709\u7528\u6237\u6B8B\u7559\u6539\u52A8\u3002",
          "- .claude/settings.json"
        ].join("\n")
      };
    }
    const gitignorePolicyMatches = await this.repo.doesGitignoreResidueMatchPolicy();
    if (!gitignorePolicyMatches) {
      return {
        ok: false,
        message: [
          "\u62D2\u7EDD\u6700\u7EC8\u63D0\u4EA4\uFF1Asetup-owned \u6587\u4EF6\u5728\u7CBE\u786E cleanup \u540E\u4ECD\u6709\u7528\u6237\u6B8B\u7559\u6539\u52A8\u3002",
          "- .gitignore"
        ].join("\n")
      };
    }
    const currentDirtyFiles = this.repo.listChangedFiles();
    const comparison = compareDirtyFilesAgainstBaseline(currentDirtyFiles, baseline?.files ?? []);
    const explainableOwnedSet = /* @__PURE__ */ new Set([...setupOwnedFiles, ...checkpointOwnedFiles]);
    if (!baseline) {
      const details = comparison.currentFiles.length > 0 ? [
        `\u672A\u627E\u5230 dirty baseline\uFF1B\u4FDD\u5B88\u8DF3\u8FC7\u6700\u7EC8 auto-commit\uFF0C\u5E76\u4FDD\u7559\u5F53\u524D ${comparison.currentFiles.length} \u4E2A\u672A\u5F52\u6863\u53D8\u66F4:`,
        ...comparison.currentFiles.map((file) => `- ${file}`)
      ] : ["\u672A\u627E\u5230 dirty baseline\uFF1B\u5F53\u524D\u5DE5\u4F5C\u533A\u65E0\u672A\u5F52\u6863\u53D8\u66F4\uFF0C\u4FDD\u5B88\u8DF3\u8FC7\u6700\u7EC8 auto-commit\u3002"];
      return {
        ok: "degraded",
        message: details.join("\n")
      };
    }
    const unexplainedDirtyFiles = comparison.newDirtyFiles.filter((file) => !explainableOwnedSet.has(file));
    if (unexplainedDirtyFiles.length > 0) {
      return {
        ok: false,
        message: [
          "\u62D2\u7EDD\u6700\u7EC8\u63D0\u4EA4\uFF1A\u68C0\u6D4B\u5230\u672A\u5F52\u5C5E\u7ED9 workflow checkpoint \u7684\u810F\u6587\u4EF6\u3002",
          ...unexplainedDirtyFiles.map((file) => `- ${file}`)
        ].join("\n")
      };
    }
    const leftoverSetupOwnedFiles = comparison.newDirtyFiles.filter(
      (file) => setupOwnedSet.has(file) && !NON_BLOCKING_SETUP_RESIDUE_FILES.has(file) && !(file === ".gitignore" && gitignorePolicyMatches)
    );
    if (leftoverSetupOwnedFiles.length > 0) {
      return {
        ok: false,
        message: [
          "\u62D2\u7EDD\u6700\u7EC8\u63D0\u4EA4\uFF1Asetup-owned \u6587\u4EF6\u5728\u7CBE\u786E cleanup \u540E\u4ECD\u6709\u7528\u6237\u6B8B\u7559\u6539\u52A8\u3002",
          ...leftoverSetupOwnedFiles.map((file) => `- ${file}`)
        ].join("\n")
      };
    }
    const finishFiles = comparison.newDirtyFiles.filter((file) => checkpointOwnedSet.has(file) && !setupOwnedSet.has(file));
    return { ok: true, files: finishFiles };
  }
  /** add: 追加任务 */
  async add(title, type) {
    await this.repo.lock();
    try {
      const data = await this.requireProgress();
      const maxNum = data.tasks.reduce((m, t) => Math.max(m, parseInt(t.id, 10)), 0);
      const id = makeTaskId(maxNum + 1);
      const newTask = {
        id,
        title,
        description: "",
        type,
        status: "pending",
        deps: [],
        summary: "",
        retries: 0
      };
      const newTasks = [...data.tasks, newTask];
      await this.repo.saveProgress({ ...data, tasks: newTasks });
      return `\u5DF2\u8FFD\u52A0\u4EFB\u52A1 ${id}: ${title} [${type}]`;
    } finally {
      await this.repo.unlock();
    }
  }
  /** skip: 手动跳过任务 */
  async skip(id) {
    await this.repo.lock();
    try {
      const data = await this.requireProgress();
      const task = data.tasks.find((t) => t.id === id);
      if (!task) throw new Error(`\u4EFB\u52A1 ${id} \u4E0D\u5B58\u5728`);
      if (task.status === "done") return `\u4EFB\u52A1 ${id} \u5DF2\u5B8C\u6210\uFF0C\u65E0\u9700\u8DF3\u8FC7`;
      const warn = task.status === "active" ? "\uFF08\u8B66\u544A: \u8BE5\u4EFB\u52A1\u4E3A active \u72B6\u6001\uFF0C\u5B50Agent\u53EF\u80FD\u4ECD\u5728\u8FD0\u884C\uFF09" : "";
      const reconcile = data.status === "reconciling" ? await loadReconcileState(this.repo.projectRoot()) : { taskIds: [] };
      if (data.status === "reconciling" && !reconcile.taskIds.includes(id)) {
        throw new Error(`\u4EFB\u52A1 ${id} \u4E0D\u5728\u5F85\u63A5\u7BA1\u5217\u8868\u4E2D\uFF1B\u5F53\u524D\u5FC5\u987B\u5148\u5904\u7406 ${reconcile.taskIds.join(", ")}`);
      }
      const remainingTaskIds = reconcile.taskIds.filter((taskId) => taskId !== id);
      const newTasks = data.tasks.map(
        (t) => t.id === id ? { ...t, status: "skipped", summary: "\u624B\u52A8\u8DF3\u8FC7" } : t
      );
      const nextData = {
        ...data,
        status: data.status === "reconciling" && remainingTaskIds.length === 0 ? "running" : data.status,
        current: null,
        tasks: newTasks
      };
      await this.repo.saveProgress(nextData);
      if (data.status === "reconciling") {
        if (remainingTaskIds.length) {
          await saveReconcileState(this.repo.projectRoot(), remainingTaskIds);
          return `\u5DF2\u8DF3\u8FC7\u4EFB\u52A1 ${id}: ${task.title}${warn}
\u4ECD\u6709 ${remainingTaskIds.length} \u4E2A\u4E2D\u65AD\u4EFB\u52A1\u5F85\u63A5\u7BA1`;
        }
        await clearReconcileState(this.repo.projectRoot());
      }
      return `\u5DF2\u8DF3\u8FC7\u4EFB\u52A1 ${id}: ${task.title}${warn}`;
    } finally {
      await this.repo.unlock();
    }
  }
  /** setup: 项目接管模式 - 写入 instruction file */
  async setup(client = "other") {
    const existing = await this.repo.loadProgress();
    const configBefore = await this.repo.loadConfig();
    await this.repo.saveConfig({ ...configBefore, client });
    const wrote = await this.repo.ensureClaudeMd(client);
    const roleWrote = client === "snow-cli" ? await this.repo.ensureRoleMd(client) : false;
    if (client === "claude") {
      await this.repo.ensureHooks();
    }
    await this.repo.ensureLocalStateIgnored();
    const lines = [];
    if (existing && (existing.status === "running" || existing.status === "finishing")) {
      const done = existing.tasks.filter((t) => t.status === "done").length;
      const statusIcon = existing.status === "finishing" ? "\u{1F3C1}" : "\u{1F504}";
      lines.push("**\u2550\u2550\u2550 \u68C0\u6D4B\u5230\u8FDB\u884C\u4E2D\u7684\u5DE5\u4F5C\u6D41 \u2550\u2550\u2550**");
      lines.push(`\u{1F4C2} ${existing.name}`);
      lines.push(`\u{1F4CA} \u8FDB\u5EA6: ${done}/${existing.tasks.length}`);
      lines.push("");
      if (existing.status === "finishing") {
        lines.push("**\u2550\u2550\u2550 \u5F53\u524D\u72B6\u6001 \u2550\u2550\u2550**");
        lines.push("\u{1F4CD} \u72B6\u6001: \u6536\u5C3E\u9636\u6BB5");
        lines.push("\u{1F449} \u8FD0\u884C `node flow.js finish` \u7EE7\u7EED");
      } else {
        lines.push("**\u2550\u2550\u2550 \u5F53\u524D\u72B6\u6001 \u2550\u2550\u2550**");
        lines.push("\u23F8 \u72B6\u6001: " + existing.status);
        lines.push("\u{1F449} \u8FD0\u884C `node flow.js resume` \u7EE7\u7EED");
      }
    } else {
      lines.push("**\u2550\u2550\u2550 \u9879\u76EE\u72B6\u6001 \u2550\u2550\u2550**");
      lines.push("\u2705 \u9879\u76EE\u5DF2\u63A5\u7BA1\uFF0C\u5DE5\u4F5C\u6D41\u5DE5\u5177\u5C31\u7EEA");
      lines.push("\u23F3 \u7B49\u5F85\u9700\u6C42\u8F93\u5165\uFF08\u6587\u6863\u6216\u5BF9\u8BDD\u63CF\u8FF0\uFF09");
      lines.push("");
      lines.push("**\u2550\u2550\u2550 \u4E0B\u4E00\u6B65 \u2550\u2550\u2550**");
      lines.push("\u{1F4A1} \u63CF\u8FF0\u4F60\u7684\u5F00\u53D1\u4EFB\u52A1\u5373\u53EF\u542F\u52A8\u5168\u81EA\u52A8\u5F00\u53D1");
    }
    lines.push("");
    lines.push("**\u2550\u2550\u2550 \u751F\u6210\u7ED3\u679C \u2550\u2550\u2550**");
    if (wrote) {
      const instructionPath = (await loadSetupInjectionManifest(this.repo.projectRoot())).claudeMd?.path ?? "AGENTS.md";
      lines.push(`\u2713 ${instructionPath} \u5DF2\u66F4\u65B0\uFF1A\u6DFB\u52A0\u4E86\u5DE5\u4F5C\u6D41\u534F\u8BAE`);
    }
    if (roleWrote) {
      lines.push("\u2713 ROLE.md \u5DF2\u66F4\u65B0\uFF1A\u4E0E AGENTS.md \u4FDD\u6301\u4E00\u81F4");
    }
    if (client === "claude") {
      lines.push("\u2713 .claude/settings.json \u5DF2\u66F4\u65B0\uFF1A\u6DFB\u52A0\u4E86 Claude Code Hooks");
    }
    if (!lines.includes("\u63CF\u8FF0\u4F60\u7684\u5F00\u53D1\u4EFB\u52A1\u5373\u53EF\u542F\u52A8\u5168\u81EA\u52A8\u5F00\u53D1")) {
      lines.push("");
      lines.push("**\u2550\u2550\u2550 \u4E0B\u4E00\u6B65 \u2550\u2550\u2550**");
      lines.push("\u{1F4A1} \u63CF\u8FF0\u4F60\u7684\u5F00\u53D1\u4EFB\u52A1\u5373\u53EF\u542F\u52A8\u5168\u81EA\u52A8\u5F00\u53D1");
    }
    return lines.join("\n");
  }
  /** review: 标记已通过code-review，解锁finish */
  async review() {
    const data = await this.requireProgress();
    if (!isAllDone(data.tasks)) throw new Error("\u8FD8\u6709\u672A\u5B8C\u6210\u7684\u4EFB\u52A1\uFF0C\u8BF7\u5148\u5B8C\u6210\u6240\u6709\u4EFB\u52A1");
    if (data.status === "finishing") return "**\u2550\u2550\u2550 \u4EE3\u7801\u5BA1\u67E5 \u2550\u2550\u2550**\n\u2713 \u5DF2\u5904\u4E8E review \u901A\u8FC7\u72B6\u6001\n\n**\u2550\u2550\u2550 \u4E0B\u4E00\u6B65 \u2550\u2550\u2550**\n\u{1F449} \u8FD0\u884C `node flow.js finish` \u5B8C\u6210\u6536\u5C3E";
    await this.repo.saveProgress({ ...data, status: "finishing" });
    return "**\u2550\u2550\u2550 \u4EE3\u7801\u5BA1\u67E5 \u2550\u2550\u2550**\n\u2705 \u4EE3\u7801\u5BA1\u67E5\u5DF2\u901A\u8FC7\n\n**\u2550\u2550\u2550 \u4E0B\u4E00\u6B65 \u2550\u2550\u2550**\n\u{1F449} \u8FD0\u884C `node flow.js finish` \u5B8C\u6210\u6536\u5C3E";
  }
  /** finish: 智能收尾 - 先verify，review后置 */
  async finish() {
    const data = await this.requireProgress();
    log.debug(`finish: status=${data.status}`);
    if (data.status === "idle" || data.status === "completed") return "\u5DE5\u4F5C\u6D41\u5DF2\u5B8C\u6210\uFF0C\u65E0\u9700\u91CD\u590Dfinish";
    if (!isAllDone(data.tasks)) throw new Error("\u8FD8\u6709\u672A\u5B8C\u6210\u7684\u4EFB\u52A1\uFF0C\u8BF7\u5148\u5B8C\u6210\u6240\u6709\u4EFB\u52A1");
    this.stopHeartbeat?.();
    this.stopHeartbeat = null;
    const result = this.repo.verify();
    log.debug(`finish: verify passed=${result.passed}`);
    if (!result.passed) {
      return [
        "**\u2550\u2550\u2550 \u9A8C\u8BC1\u7ED3\u679C \u2550\u2550\u2550**",
        "\u2717 \u9A8C\u8BC1\u5931\u8D25",
        "",
        "\u{1F4CB} \u9519\u8BEF\u8BE6\u60C5:",
        result.error,
        "",
        "\u{1F449} \u8BF7\u4FEE\u590D\u540E\u91CD\u65B0\u6267\u884C `node flow.js finish`"
      ].join("\n");
    }
    const verifySummary = this.formatVerifySummary(result);
    if (data.status !== "finishing") {
      return [
        "**\u2550\u2550\u2550 \u9A8C\u8BC1\u7ED3\u679C \u2550\u2550\u2550**",
        "\u2705 \u9A8C\u8BC1\u901A\u8FC7",
        verifySummary,
        "",
        "**\u2550\u2550\u2550 \u4E0B\u4E00\u6B65 \u2550\u2550\u2550**",
        "1. \u6D3E\u5B50Agent\u6267\u884C code-review",
        "2. \u5B8C\u6210\u540E\u8FD0\u884C `node flow.js review`",
        "3. \u518D\u8FD0\u884C `node flow.js finish`"
      ].join("\n");
    }
    const done = data.tasks.filter((t) => t.status === "done");
    const skipped2 = data.tasks.filter((t) => t.status === "skipped");
    const failed = data.tasks.filter((t) => t.status === "failed");
    const stats = [`${done.length} done`, skipped2.length ? `${skipped2.length} skipped` : "", failed.length ? `${failed.length} failed` : ""].filter(Boolean).join(", ");
    const finalSummary = formatFinalSummary(data);
    const finishBoundary = await this.resolveFinishCommitFiles();
    if (finishBoundary.ok === false) {
      return [
        "**\u2550\u2550\u2550 \u9A8C\u8BC1\u7ED3\u679C \u2550\u2550\u2550**",
        "\u2705 \u9A8C\u8BC1\u901A\u8FC7",
        verifySummary,
        "",
        "**\u2550\u2550\u2550 \u5B8C\u6210\u7EDF\u8BA1 \u2550\u2550\u2550**",
        stats,
        "",
        finalSummary,
        finishBoundary.message
      ].join("\n");
    }
    if (finishBoundary.ok === "degraded") {
      await this.persistFinalSummary(finalSummary);
      return [
        "**\u2550\u2550\u2550 \u9A8C\u8BC1\u7ED3\u679C \u2550\u2550\u2550**",
        "\u2705 \u9A8C\u8BC1\u901A\u8FC7",
        verifySummary,
        "",
        "**\u2550\u2550\u2550 \u5B8C\u6210\u7EDF\u8BA1 \u2550\u2550\u2550**",
        stats,
        "",
        finalSummary,
        finishBoundary.message,
        "",
        "**\u2550\u2550\u2550 \u4E0B\u4E00\u6B65 \u2550\u2550\u2550**",
        "\u26A0\uFE0F \u672A\u63D0\u4EA4\u6700\u7EC8commit\uFF1A\u672A\u627E\u5230 dirty baseline\uFF0C\u4FDD\u5B88\u8DF3\u8FC7 auto-commit",
        "\u{1F449} \u5DE5\u4F5C\u6D41\u4ECD\u505C\u7559\u5728\u6536\u5C3E\u9636\u6BB5\uFF0C\u8BF7\u5148\u5904\u7406\u6700\u7EC8\u63D0\u4EA4\u8FB9\u754C\uFF0C\u518D\u91CD\u65B0\u6267\u884C `node flow.js finish`"
      ].join("\n");
    }
    const titles = done.map((t) => `- ${t.id}: ${t.title}`).join("\n");
    const finishCommitSummary = `${stats}

${titles}`;
    const commitResult = finishBoundary.files.length > 0 ? this.repo.commit("finish", data.name || "\u5DE5\u4F5C\u6D41\u5B8C\u6210", finishCommitSummary, finishBoundary.files) : this.createEmptyFinalCommit(data.name || "\u5DE5\u4F5C\u6D41\u5B8C\u6210", finishCommitSummary);
    if (commitResult.status === "committed") {
      await this.persistFinalSummary(finalSummary);
      await runLifecycleHook("onWorkflowFinish", this.repo.projectRoot(), { WORKFLOW_NAME: data.name });
      const wfStats = collectStats(data);
      await this.repo.saveHistory(wfStats);
      const configBeforeEvolution = await this.repo.loadConfig();
      const reflectReport = await reflect(wfStats, this.repo.projectRoot());
      const experimentRan = reflectReport.experiments.length > 0;
      if (experimentRan) {
        await experiment(reflectReport, this.repo.projectRoot());
      }
      const configAfterEvolution = await this.repo.loadConfig();
      const changedConfigKeys = this.diffConfigKeys(configBeforeEvolution, configAfterEvolution);
      if (changedConfigKeys.length > 0) {
        await this.repo.saveEvolution({
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          workflowName: data.name,
          configBefore: configBeforeEvolution,
          configAfter: configAfterEvolution,
          suggestions: []
        });
      }
      const evolutionSummary = this.formatEvolutionSummary({
        reflectRan: true,
        experimentRan,
        changedConfigKeys
      });
      this.repo.cleanTags();
      await this.repo.clearAll();
      return [
        "**\u2550\u2550\u2550 \u9A8C\u8BC1\u7ED3\u679C \u2550\u2550\u2550**",
        "\u2705 \u9A8C\u8BC1\u901A\u8FC7",
        verifySummary,
        "",
        "**\u2550\u2550\u2550 \u5B8C\u6210\u7EDF\u8BA1 \u2550\u2550\u2550**",
        stats,
        "",
        finalSummary,
        `${evolutionSummary}${this.formatCommitMessage(commitResult, "finish")}`,
        "",
        "**\u2550\u2550\u2550 \u5DE5\u4F5C\u6D41\u5B8C\u6210 \u2550\u2550\u2550**",
        "\u{1F389} \u5DE5\u4F5C\u6D41\u5DF2\u56DE\u5230\u5F85\u547D\u72B6\u6001",
        "\u23F3 \u7B49\u5F85\u4E0B\u4E00\u4E2A\u9700\u6C42..."
      ].join("\n");
    }
    await this.persistFinalSummary(finalSummary);
    const nextStep = commitResult.status === "failed" ? "\u6700\u7EC8commit\u5931\u8D25\uFF0C\u5DE5\u4F5C\u6D41\u4ECD\u505C\u7559\u5728\u6536\u5C3E\u9636\u6BB5\uFF1B\u8BF7\u4FEE\u590D\u540E\u91CD\u65B0\u6267\u884C node flow.js finish" : "\u6700\u7EC8commit\u5C1A\u672A\u5B8C\u6210\uFF0C\u5DE5\u4F5C\u6D41\u4ECD\u505C\u7559\u5728\u6536\u5C3E\u9636\u6BB5\uFF1B\u8BF7\u5904\u7406\u63D0\u4EA4\u8FB9\u754C\u540E\u91CD\u65B0\u6267\u884C node flow.js finish";
    return [
      "**\u2550\u2550\u2550 \u9A8C\u8BC1\u7ED3\u679C \u2550\u2550\u2550**",
      "\u2705 \u9A8C\u8BC1\u901A\u8FC7",
      verifySummary,
      "",
      "**\u2550\u2550\u2550 \u5B8C\u6210\u7EDF\u8BA1 \u2550\u2550\u2550**",
      stats,
      "",
      finalSummary,
      this.formatCommitMessage(commitResult, "finish"),
      "",
      "**\u2550\u2550\u2550 \u4E0B\u4E00\u6B65 \u2550\u2550\u2550**",
      "\u26A0\uFE0F " + nextStep
    ].join("\n");
  }
  /** 计算 config 变更的键列表（浅比较，键名排序） */
  diffConfigKeys(before, after) {
    const keys = /* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort();
  }
  /** 格式化 finish 阶段的进化摘要 */
  formatEvolutionSummary(summary) {
    const changedKeysText = summary.changedConfigKeys.length ? summary.changedConfigKeys.join(", ") : "\u65E0";
    return [
      "\u8FDB\u5316\u6458\u8981:",
      `- reflect: ${summary.reflectRan ? "\u5DF2\u6267\u884C" : "\u672A\u6267\u884C"}`,
      `- experiment: ${summary.experimentRan ? "\u5DF2\u6267\u884C" : "\u672A\u6267\u884C"}`,
      `- config\u53D8\u66F4: ${summary.changedConfigKeys.length > 0 ? "\u662F" : "\u5426"}`,
      `- \u53D8\u66F4\u952E: ${changedKeysText}`
    ].join("\n");
  }
  /** 格式化验证结果，让 passed/skipped/not-found 对用户可见 */
  formatVerifySummary(result) {
    if (result.status === "not-found") {
      return "\u9A8C\u8BC1\u7ED3\u679C: \u672A\u53D1\u73B0\u53EF\u6267\u884C\u7684\u9A8C\u8BC1\u547D\u4EE4";
    }
    const steps = result.steps ?? result.scripts.map((command) => ({ command, status: "passed" }));
    const lines = ["\u9A8C\u8BC1\u7ED3\u679C:"];
    for (const step of steps) {
      if (step.status === "passed") {
        lines.push(`- \u901A\u8FC7: ${step.command}`);
        continue;
      }
      if (step.status === "skipped") {
        lines.push(`- \u8DF3\u8FC7: ${step.command}${step.reason ? `\uFF08${step.reason}\uFF09` : ""}`);
      }
    }
    return lines.join("\n");
  }
  /** 将 git 提交结果映射为面向用户的真实提示语 */
  formatCommitMessage(result, stage) {
    if (result.status === "committed") {
      return stage === "task" ? " [\u5DF2\u81EA\u52A8\u63D0\u4EA4]" : "\n\u5DF2\u63D0\u4EA4\u6700\u7EC8commit";
    }
    if (result.status === "failed") {
      return `
[git\u63D0\u4EA4\u5931\u8D25] ${result.error}
\u8BF7\u6839\u636E\u9519\u8BEF\u4FEE\u590D\u540E\u624B\u52A8\u68C0\u67E5\u5E76\u63D0\u4EA4\u9700\u8981\u7684\u6587\u4EF6`;
    }
    const reasonMap = {
      "no-files": "\u672A\u63D0\u4F9B --files\uFF0C\u672A\u81EA\u52A8\u63D0\u4EA4",
      "runtime-only": "\u4EC5\u68C0\u6D4B\u5230 FlowPilot \u8FD0\u884C\u65F6\u6587\u4EF6\uFF0C\u672A\u81EA\u52A8\u63D0\u4EA4",
      "no-staged-changes": "\u6307\u5B9A\u6587\u4EF6\u65E0\u53EF\u63D0\u4EA4\u53D8\u66F4\uFF0C\u672A\u81EA\u52A8\u63D0\u4EA4"
    };
    const reason = result.reason ? reasonMap[result.reason] : "\u672A\u81EA\u52A8\u63D0\u4EA4";
    return stage === "task" ? `
[\u672A\u81EA\u52A8\u63D0\u4EA4] ${reason}` : `
\u672A\u63D0\u4EA4\u6700\u7EC8commit\uFF1A${reason}`;
  }
  /** rollback: 回滚到指定任务的快照 */
  async rollback(id) {
    await this.repo.lock();
    try {
      const data = await this.requireProgress();
      const task = data.tasks.find((t) => t.id === id);
      if (!task) throw new Error(`\u4EFB\u52A1 ${id} \u4E0D\u5B58\u5728`);
      if (task.status !== "done") throw new Error(`\u4EFB\u52A1 ${id} \u72B6\u6001\u4E3A ${task.status}\uFF0C\u53EA\u80FD\u56DE\u6EDA\u5DF2\u5B8C\u6210\u7684\u4EFB\u52A1`);
      const err = this.repo.rollback(id);
      if (err) return `\u56DE\u6EDA\u5931\u8D25: ${err}`;
      const newTasks = reopenRollbackBranch(data.tasks, id);
      const newData = { ...data, status: "running", current: null, tasks: newTasks };
      await this.repo.saveProgress(newData);
      await this.updateSummary(newData);
      const resetCount = newTasks.filter(
        (taskEntry, index) => taskEntry.status === "pending" && data.tasks[index].status !== "pending"
      ).length;
      return `\u5DF2\u56DE\u6EDA\u5230\u4EFB\u52A1 ${id} \u4E4B\u524D\u7684\u72B6\u6001\uFF0C${resetCount} \u4E2A\u4EFB\u52A1\u91CD\u7F6E\u4E3A pending`;
    } finally {
      await this.repo.unlock();
    }
  }
  /** abort: 中止工作流，清理 .workflow/ 目录 */
  async abort() {
    const data = await this.repo.loadProgress();
    if (!data) return "\u65E0\u6D3B\u8DC3\u5DE5\u4F5C\u6D41\uFF0C\u65E0\u9700\u4E2D\u6B62";
    await this.repo.saveProgress({ ...data, status: "aborted" });
    await this.repo.cleanupInjections();
    await this.repo.clearAll();
    return `\u5DE5\u4F5C\u6D41 "${data.name}" \u5DF2\u4E2D\u6B62\uFF0C.workflow/ \u5DF2\u6E05\u7406`;
  }
  /** rollbackEvolution: 从进化日志恢复历史 config */
  async rollbackEvolution(index) {
    const evolutions = await this.repo.loadEvolutions();
    if (!evolutions.length) return "\u65E0\u8FDB\u5316\u65E5\u5FD7";
    if (index < 0 || index >= evolutions.length) return `\u7D22\u5F15\u8D8A\u754C\uFF0C\u6709\u6548\u8303\u56F4: 0-${evolutions.length - 1}`;
    const target = evolutions[index];
    const configBefore = await this.repo.loadConfig();
    await this.repo.saveConfig(target.configBefore);
    await this.repo.saveEvolution({
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      workflowName: `rollback-to-${index}`,
      configBefore,
      configAfter: target.configBefore,
      suggestions: ["\u624B\u52A8\u56DE\u6EDA"]
    });
    return `\u5DF2\u56DE\u6EDA\u5230\u8FDB\u5316\u70B9 ${index}\uFF08${target.timestamp}\uFF09`;
  }
  /** recall: 查询相关记忆 */
  async recall(query) {
    const memories = await queryMemory(this.repo.projectRoot(), query);
    if (!memories.length) return "\u65E0\u76F8\u5173\u8BB0\u5FC6";
    return memories.map((m) => `- [${m.source}] ${m.content}`).join("\n");
  }
  /** evolve: 接收CC子Agent的反思结果，执行进化实验 */
  async evolve(reflectionText) {
    let stats;
    try {
      const data = await this.repo.loadProgress();
      if (!data) throw new Error("no progress");
      stats = collectStats(data);
    } catch {
      stats = { name: "", totalTasks: 0, doneCount: 0, skipCount: 0, failCount: 0, retryTotal: 0, tasksByType: {}, failsByType: {}, taskResults: [], startTime: (/* @__PURE__ */ new Date()).toISOString(), endTime: (/* @__PURE__ */ new Date()).toISOString() };
    }
    const report = await reflect(stats, this.repo.projectRoot());
    const lines = reflectionText.split("\n").filter((l) => l.trim());
    const experiments = [];
    for (const line of lines) {
      const m = line.match(/^\[(.+?)\]\s*(.+)/);
      if (m) {
        const tag = m[1].toLowerCase();
        const target = tag.includes("config") ? "config" : "claude-md";
        experiments.push({ trigger: "cc-ai-reflect", observation: m[2], action: m[2], expected: "\u57FA\u4E8EAI\u5206\u6790\u7684\u6539\u8FDB", target });
      }
    }
    if (!experiments.length && lines.length) {
      for (const line of lines.slice(0, 3)) {
        experiments.push({ trigger: "cc-ai-reflect", observation: line, action: line, expected: "\u57FA\u4E8EAI\u5206\u6790\u7684\u6539\u8FDB", target: "claude-md" });
      }
    }
    if (!experiments.length) return "\u65E0\u53EF\u6267\u884C\u7684\u8FDB\u5316\u5EFA\u8BAE";
    const merged = { ...report, experiments: [...report.experiments, ...experiments] };
    await experiment(merged, this.repo.projectRoot());
    return `\u5DF2\u5E94\u7528 ${experiments.length} \u6761\u8FDB\u5316\u5EFA\u8BAE`;
  }
  /** status: 全局进度 */
  async status() {
    return this.repo.loadProgress();
  }
  /** 从文本中提取标记行 [DECISION]/[ARCHITECTURE]/[IMPORTANT] */
  extractTaggedLines(text) {
    const TAG_RE = /\[(?:DECISION|ARCHITECTURE|IMPORTANT)\]/i;
    return text.split("\n").filter((l) => TAG_RE.test(l)).map((l) => l.trim());
  }
  /** 词袋 tokenize（兼容 CJK：连续非空白拉丁词 + 单个 CJK 字符） */
  tokenize(text) {
    const tokens = /* @__PURE__ */ new Set();
    for (const m of text.toLowerCase().matchAll(/[a-z0-9_]+|[\u4e00-\u9fff]/g)) {
      tokens.add(m[0]);
    }
    return tokens;
  }
  /** Jaccard 相似度 */
  similarity(a, b) {
    const sa = this.tokenize(a), sb = this.tokenize(b);
    if (!sa.size || !sb.size) return 0;
    let inter = 0;
    for (const t of sa) if (sb.has(t)) inter++;
    return inter / (sa.size + sb.size - inter);
  }
  /** 语义去重：相似度 > 0.8 的摘要合并 */
  dedup(items) {
    const result = [];
    for (const item of items) {
      if (!result.some((r) => this.similarity(r.text, item.text) > 0.8)) {
        result.push(item);
      }
    }
    return result;
  }
  /** 智能滚动摘要：保留关键决策 + 时间衰减 + 语义去重 */
  async updateSummary(data) {
    const done = data.tasks.filter((t) => t.status === "done");
    const lines = [`# ${data.name}
`];
    const taggedLines = [];
    for (const t of done) {
      const ctx = await this.repo.loadTaskContext(t.id);
      if (ctx) taggedLines.push(...this.extractTaggedLines(ctx));
    }
    const uniqueTagged = [...new Set(taggedLines)];
    if (uniqueTagged.length) {
      lines.push("## \u5173\u952E\u51B3\u7B56\n");
      for (const l of uniqueTagged) lines.push(`- ${l}`);
      lines.push("");
    }
    const recent = done.slice(-5);
    const mid = done.slice(-10, -5);
    const old = done.slice(0, -10);
    const progressItems = [];
    for (const t of old) {
      progressItems.push({ label: `[${t.type}] ${t.title}`, text: t.title });
    }
    for (const t of mid) {
      const firstLine = t.summary.split("\n")[0] || "";
      const text = firstLine ? `${t.title}: ${firstLine}` : t.title;
      progressItems.push({ label: `[${t.type}] ${text}`, text });
    }
    for (const t of recent) {
      const summary = t.summary && t.summary.length > 500 ? truncateHeadTail(t.summary, 500) : t.summary;
      const text = summary ? `${t.title}: ${summary}` : t.title;
      progressItems.push({ label: `[${t.type}] ${text}`, text });
    }
    const deduped = this.dedup(progressItems);
    lines.push("## \u4EFB\u52A1\u8FDB\u5C55\n");
    for (const item of deduped) lines.push(`- ${item.label}`);
    const pending = data.tasks.filter((t) => t.status !== "done" && t.status !== "skipped" && t.status !== "failed");
    if (pending.length) {
      lines.push("\n## \u5F85\u5B8C\u6210\n");
      for (const t of pending) lines.push(`- [${t.type}] ${t.title}`);
    }
    let totalSummary = lines.join("\n") + "\n";
    if (totalSummary.length > 3e3) totalSummary = truncateHeadTail(totalSummary, 3e3);
    await this.repo.saveSummary(totalSummary);
  }
  /** 读取历史经验，输出建议，自动写入 config.json（闭环进化） */
  async applyHistoryInsights() {
    const history = await this.repo.loadHistory();
    if (!history.length) return;
    const { suggestions, recommendedConfig } = analyzeHistory(history);
    if (suggestions.length) {
      log.info("[\u5386\u53F2\u7ECF\u9A8C\u5EFA\u8BAE]");
      for (const s of suggestions) log.info(`  - ${s}`);
    }
    if (!Object.keys(recommendedConfig).length) return;
    const configBefore = await this.repo.loadConfig();
    const merged = { ...configBefore };
    let changed = false;
    for (const [k, v] of Object.entries(recommendedConfig)) {
      if (!(k in merged)) {
        merged[k] = v;
        changed = true;
      }
    }
    if (changed) {
      await this.repo.saveConfig(merged);
      await this.repo.saveEvolution({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        workflowName: (await this.repo.loadProgress())?.name ?? "",
        configBefore,
        configAfter: merged,
        suggestions
      });
      log.info("[\u5386\u53F2\u7ECF\u9A8C] \u5DF2\u57FA\u4E8E\u5386\u53F2\u6570\u636E\u81EA\u52A8\u8C03\u6574\u9ED8\u8BA4\u53C2\u6570");
    }
  }
  /** 将失败原因追加到 context/task-{id}.md，标记 [FAILED] */
  async appendFailureContext(id, task, detail) {
    const existing = await this.repo.loadTaskContext(id) ?? "";
    const entry = `
## [FAILED] \u7B2C${task.retries + 1}\u6B21\u5931\u8D25

${detail}
`;
    const content = existing ? existing.trimEnd() + "\n" + entry : `# task-${id}: ${task.title}
${entry}`;
    await this.repo.saveTaskContext(id, content);
  }
  /** 检测连续失败模式：3次FAILED且摘要相似(>60%)时输出警告 */
  async detectFailurePattern(id, task) {
    if (task.retries < 2) return null;
    const ctx = await this.repo.loadTaskContext(id);
    if (!ctx) return null;
    const reasons = [...ctx.matchAll(/## \[FAILED\] .+?\n\n(.+?)(?=\n##|\n*$)/gs)].map((m) => m[1].trim());
    if (reasons.length < 3) return null;
    const last3 = reasons.slice(-3);
    const sim01 = this.similarity(last3[0], last3[1]);
    const sim12 = this.similarity(last3[1], last3[2]);
    log.debug(`detectFailurePattern ${id}: sim01=${sim01.toFixed(2)}, sim12=${sim12.toFixed(2)}`);
    if (sim01 > 0.6 && sim12 > 0.6) {
      const msg = `[WARN] \u4EFB\u52A1 ${id} \u9677\u5165\u91CD\u590D\u5931\u8D25\u6A21\u5F0F\uFF0C\u5EFA\u8BAE skip \u6216\u4FEE\u6539\u4EFB\u52A1\u63CF\u8FF0`;
      log.warn(msg);
      return msg;
    }
    return null;
  }
  /** 心跳自检：委托给 heartbeat 模块 */
  async healthCheck() {
    const result = await runHeartbeat(this.repo.projectRoot());
    return result.warnings;
  }
  async requireProgress() {
    const data = await this.repo.loadProgress();
    if (!data) throw new Error("\u65E0\u6D3B\u8DC3\u5DE5\u4F5C\u6D41\uFF0C\u8BF7\u5148 node flow.js init");
    setWorkflowName(data.name);
    return data;
  }
};

// src/interfaces/cli.ts
var import_fs4 = require("fs");
var import_path12 = require("path");

// src/interfaces/stdin.ts
var import_promises11 = require("readline/promises");
function isTTY() {
  return process.stdin.isTTY === true;
}
function readStdinIfPiped(timeout = 3e4) {
  if (isTTY()) return Promise.resolve("");
  return new Promise((resolve2, reject) => {
    const chunks = [];
    const timer = setTimeout(() => {
      process.stdin.destroy();
      resolve2("");
    }, timeout);
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve2(Buffer.concat(chunks).toString("utf-8"));
    });
    process.stdin.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}
var CLIENT_OPTIONS = [
  { key: "1", value: "claude", label: "Claude Code", detail: "\u9ED8\u8BA4\u751F\u6210 CLAUDE.md + .claude/settings.json" },
  { key: "2", value: "codex", label: "Codex", detail: "\u53EA\u751F\u6210 AGENTS.md" },
  { key: "3", value: "cursor", label: "Cursor", detail: "\u53EA\u751F\u6210 AGENTS.md" },
  { key: "4", value: "snow-cli", label: "snow-cli", detail: "\u751F\u6210 AGENTS.md + ROLE.md" },
  { key: "5", value: "other", label: "Other", detail: "\u53EA\u751F\u6210 AGENTS.md" }
];
function resolveSetupClientChoice(answer) {
  const trimmed = answer.trim();
  const matched = CLIENT_OPTIONS.find((option) => option.key === trimmed);
  return matched?.value ?? "other";
}
async function promptSetupClient() {
  if (!isTTY()) return "other";
  process.stdout.write([
    "**\u5BA2\u6237\u7AEF\u9009\u62E9**",
    "\u8BF7\u9009\u62E9\u76EE\u6807\u5BA2\u6237\u7AEF\u3002\u8FD9\u91CC\u7684\u9009\u62E9\u53EA\u5F71\u54CD\u751F\u6210\u8BF4\u660E\u6587\u4EF6\u4E0E\u5BA2\u6237\u7AEF\u914D\u7F6E\uFF0C\u4E0D\u4F1A\u6539\u53D8 FlowPilot \u7684\u534F\u8BAE\u4F18\u5148\u7EA7\u548C\u8C03\u5EA6\u89C4\u5219\u3002",
    ...CLIENT_OPTIONS.map((option) => `${option.key}. ${option.label} - ${option.detail}`),
    "",
    "**\u63D0\u793A**",
    "- Claude Code \u9ED8\u8BA4\u751F\u6210 CLAUDE.md",
    "- Codex / Cursor / Other \u9ED8\u8BA4\u751F\u6210 AGENTS.md",
    "- \u76F4\u63A5\u56DE\u8F66\u9ED8\u8BA4\u9009\u62E9 5. Other",
    ""
  ].join("\n"));
  const rl = (0, import_promises11.createInterface)({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("\u9009\u62E9 [1-5]\uFF1A");
    return resolveSetupClientChoice(answer);
  } finally {
    rl.close();
  }
}

// src/interfaces/cli.ts
function normalizePulsePhase(raw) {
  const value = (raw ?? "").trim().toLowerCase();
  switch (value) {
    case "analysis":
    case "\u5206\u6790":
      return "analysis";
    case "implementation":
    case "\u5B9E\u73B0":
      return "implementation";
    case "verification":
    case "\u9A8C\u8BC1":
      return "verification";
    case "blocked":
    case "\u963B\u585E":
      return "blocked";
    default:
      throw new Error("\u9700\u8981\u5408\u6CD5\u7684\u9636\u6BB5\uFF1Aanalysis|implementation|verification|blocked");
  }
}
var CLI = class {
  constructor(service2, deps = {}) {
    this.service = service2;
    this.deps = deps;
  }
  async run(argv) {
    const args = argv.slice(2);
    const verboseIdx = args.indexOf("--verbose");
    if (verboseIdx >= 0) {
      enableVerbose();
      args.splice(verboseIdx, 1);
    }
    try {
      const output = await this.dispatch(args);
      process.stdout.write(output + "\n");
    } catch (e) {
      process.stderr.write(`\u9519\u8BEF: ${e instanceof Error ? e.message : e}
`);
      process.exitCode = 1;
    }
  }
  async dispatch(args) {
    const [cmd, ...rest] = args;
    const s = this.service;
    switch (cmd) {
      case "init": {
        const force = rest.includes("--force");
        const md = await (this.deps.readStdinIfPiped ?? readStdinIfPiped)();
        let out;
        if (md.trim()) {
          const data = await s.init(md, force);
          out = `\u2705 \u5DF2\u521D\u59CB\u5316\u5DE5\u4F5C\u6D41: ${data.name} (${data.tasks.length} \u4E2A\u4EFB\u52A1)`;
        } else {
          const client = await (this.deps.promptSetupClient ?? promptSetupClient)();
          out = await s.setup(client);
        }
        return `${out}

**\u2550\u2550\u2550 \u63D0\u793A \u2550\u2550\u2550**
\u{1F4A1} \u5EFA\u8BAE\u5148\u901A\u8FC7 /plugin \u5B89\u88C5\u63D2\u4EF6: superpowers\u3001frontend-design\u3001feature-dev\u3001code-review\u3001context7
   \u672A\u5B89\u88C5\u65F6\uFF0C\u5B50Agent\u65E0\u6CD5\u4F7F\u7528\u4E13\u4E1A\u6280\u80FD\uFF0C\u4F53\u9A8C\u4F1A\u964D\u7EA7
   \u5982\u9700\u67E5\u770B\u5F53\u524D\u72B6\u6001\uFF0C\u53EF\u6267\u884C \`node flow.js status\``;
      }
      case "next": {
        if (rest.includes("--batch")) {
          const items = await s.nextBatch();
          if (!items.length) return "\u2705 \u5168\u90E8\u5B8C\u6210";
          return formatBatch(items);
        }
        const result = await s.next();
        if (!result) return "\u2705 \u5168\u90E8\u5B8C\u6210";
        return formatTask(result.task, result.context);
      }
      case "checkpoint": {
        const id = rest[0];
        if (!id) throw new Error("\u9700\u8981\u4EFB\u52A1ID");
        const filesIdx = rest.indexOf("--files");
        const fileIdx = rest.indexOf("--file");
        let detail;
        let files;
        if (filesIdx >= 0) {
          files = [];
          for (let i = filesIdx + 1; i < rest.length && !rest[i].startsWith("--"); i++) {
            files.push(rest[i]);
          }
        }
        if (fileIdx >= 0 && rest[fileIdx + 1]) {
          const filePath = (0, import_path12.resolve)(rest[fileIdx + 1]);
          if ((0, import_path12.relative)(process.cwd(), filePath).startsWith("..")) throw new Error("--file \u8DEF\u5F84\u4E0D\u80FD\u8D85\u51FA\u9879\u76EE\u76EE\u5F55");
          detail = (0, import_fs4.readFileSync)(filePath, "utf-8");
        } else if (rest.length > 1 && fileIdx < 0 && filesIdx < 0) {
          detail = rest.slice(1).join(" ");
        } else {
          detail = await (this.deps.readStdinIfPiped ?? readStdinIfPiped)();
        }
        return await s.checkpoint(id, detail.trim(), files);
      }
      case "pulse": {
        const id = rest[0];
        if (!id) throw new Error("\u9700\u8981\u4EFB\u52A1ID");
        const phaseIdx = rest.indexOf("--phase");
        const noteIdx = rest.indexOf("--note");
        const phaseSource = phaseIdx >= 0 ? rest[phaseIdx + 1] : rest[1];
        const phase = normalizePulsePhase(phaseSource);
        let note = "";
        if (noteIdx >= 0) {
          note = rest.slice(noteIdx + 1).join(" ").trim();
        } else {
          const startIdx = phaseIdx >= 0 ? phaseIdx + 2 : 2;
          note = rest.slice(startIdx).join(" ").trim();
        }
        return await s.pulse(id, phase, note);
      }
      case "adopt": {
        const id = rest[0];
        if (!id) throw new Error("\u9700\u8981\u4EFB\u52A1ID");
        const filesIdx = rest.indexOf("--files");
        const fileIdx = rest.indexOf("--file");
        let detail;
        let files;
        if (filesIdx >= 0) {
          files = [];
          for (let i = filesIdx + 1; i < rest.length && !rest[i].startsWith("--"); i++) {
            files.push(rest[i]);
          }
        }
        if (fileIdx >= 0 && rest[fileIdx + 1]) {
          const filePath = (0, import_path12.resolve)(rest[fileIdx + 1]);
          if ((0, import_path12.relative)(process.cwd(), filePath).startsWith("..")) throw new Error("--file \u8DEF\u5F84\u4E0D\u80FD\u8D85\u51FA\u9879\u76EE\u76EE\u5F55");
          detail = (0, import_fs4.readFileSync)(filePath, "utf-8");
        } else if (rest.length > 1 && fileIdx < 0 && filesIdx < 0) {
          detail = rest.slice(1).join(" ");
        } else {
          detail = await (this.deps.readStdinIfPiped ?? readStdinIfPiped)();
        }
        return await s.adopt(id, detail.trim(), files);
      }
      case "restart": {
        const id = rest[0];
        if (!id) throw new Error("\u9700\u8981\u4EFB\u52A1ID");
        return await s.restart(id);
      }
      case "skip": {
        const id = rest[0];
        if (!id) throw new Error("\u9700\u8981\u4EFB\u52A1ID");
        return await s.skip(id);
      }
      case "status": {
        const data = await s.status();
        if (!data) return "\u23F3 \u65E0\u6D3B\u8DC3\u5DE5\u4F5C\u6D41";
        return formatStatus(data);
      }
      case "review":
        return await s.review();
      case "finish":
        return await s.finish();
      case "resume":
        return await s.resume();
      case "abort":
        return await s.abort();
      case "rollback": {
        const id = rest[0];
        if (!id) throw new Error("\u9700\u8981\u4EFB\u52A1ID");
        return await s.rollback(id);
      }
      case "evolve": {
        const text = await (this.deps.readStdinIfPiped ?? readStdinIfPiped)();
        if (!text.trim()) throw new Error("\u9700\u8981\u901A\u8FC7 stdin \u4F20\u5165\u53CD\u601D\u7ED3\u679C");
        return await s.evolve(text.trim());
      }
      case "recall": {
        const query = rest.join(" ");
        if (!query) throw new Error("\u9700\u8981\u67E5\u8BE2\u5173\u952E\u8BCD");
        return await s.recall(query);
      }
      case "add": {
        const typeIdx = rest.indexOf("--type");
        const rawType = typeIdx >= 0 && rest[typeIdx + 1] || "general";
        const validTypes = /* @__PURE__ */ new Set(["frontend", "backend", "general"]);
        const type = validTypes.has(rawType) ? rawType : "general";
        const title = rest.filter((_, i) => i !== typeIdx && i !== typeIdx + 1).join(" ");
        if (!title) throw new Error("\u9700\u8981\u4EFB\u52A1\u63CF\u8FF0");
        return await s.add(title, type);
      }
      default:
        return USAGE;
    }
  }
};
var USAGE = `**\u2550\u2550\u2550 FlowPilot \u7528\u6CD5 \u2550\u2550\u2550**
node flow.js [--verbose] <command>

\u{1F4CB} \u5DE5\u4F5C\u6D41\u547D\u4EE4:
  init [--force]       \u521D\u59CB\u5316\u5DE5\u4F5C\u6D41 (stdin\u4F20\u5165\u4EFB\u52A1markdown\uFF0C\u65E0stdin\u5219\u663E\u793A\u5BA2\u6237\u7AEF\u9009\u9879)
  next [--batch]       \u83B7\u53D6\u4E0B\u4E00\u6279\u5F85\u6267\u884C\u4EFB\u52A1 (--batch \u8FD4\u56DE\u6240\u6709\u53EF\u5E76\u884C\u4EFB\u52A1)
  checkpoint <id>      \u8BB0\u5F55\u4EFB\u52A1\u5B8C\u6210 [--file <path> | stdin | \u5185\u8054\u6587\u672C] [--files f1 f2 ...]
  pulse <id> <phase>   \u8BB0\u5F55\u4EFB\u52A1\u9636\u6BB5 [--phase <phase>] [--note <text>]
  adopt <id>           \u63A5\u7BA1\u4E2D\u65AD\u53D8\u66F4\u5E76\u8865 checkpoint [--file <path> | stdin] [--files f1 f2 ...]
  restart <id>         \u786E\u8BA4\u53D8\u66F4\u540E\u5141\u8BB8\u4EFB\u52A1\u91CD\u505A (\u9700\u5148\u5904\u7406\u5F52\u5C5E\u660E\u786E\u7684\u53D8\u66F4)
  skip <id>            \u624B\u52A8\u8DF3\u8FC7\u4EFB\u52A1
  review               \u6807\u8BB0 code-review \u5DF2\u5B8C\u6210 (finish \u524D\u5FC5\u987B\u6267\u884C)
  finish               \u667A\u80FD\u6536\u5C3E (\u9A8C\u8BC1+\u603B\u7ED3+\u63D0\u4EA4\uFF0C\u9700\u5148 review)
  status               \u67E5\u770B\u5168\u5C40\u8FDB\u5EA6
  resume               \u4E2D\u65AD\u6062\u590D
  abort                \u4E2D\u6B62\u5DE5\u4F5C\u6D41\u5E76\u6E05\u7406 .workflow/ \u76EE\u5F55
  rollback <id>        \u56DE\u6EDA\u5230\u6307\u5B9A\u4EFB\u52A1 (git revert + \u91CD\u7F6E\u540E\u7EED\u4EFB\u52A1)
  evolve               \u63A5\u6536 AI \u53CD\u601D\u7ED3\u679C\u5E76\u6267\u884C\u8FDB\u5316 (stdin \u4F20\u5165)
  recall <\u5173\u952E\u8BCD>       \u67E5\u8BE2\u76F8\u5173\u8BB0\u5FC6
  add <\u63CF\u8FF0>           \u8FFD\u52A0\u4EFB\u52A1 [--type frontend|backend|general]

\u2699\uFE0F \u5168\u5C40\u9009\u9879:
  --verbose            \u8F93\u51FA\u8C03\u8BD5\u65E5\u5FD7 (\u7B49\u540C FLOWPILOT_VERBOSE=1)`;

// src/main.ts
configureLogger(process.cwd());
var repo = new FsWorkflowRepository(process.cwd());
var service = new WorkflowService(repo, parseTasksMarkdown);
var cli = new CLI(service);
cli.run(process.argv);
