#!/usr/bin/env node
"use strict";

// src/infrastructure/fs-repository.ts
var import_promises = require("fs/promises");
var import_path = require("path");
var import_fs = require("fs");

// src/infrastructure/git.ts
var import_node_child_process = require("child_process");
var import_node_fs = require("fs");
function getSubmodules() {
  if (!(0, import_node_fs.existsSync)(".gitmodules")) return [];
  const out = (0, import_node_child_process.execFileSync)("git", ["submodule", "--quiet", "foreach", "echo $sm_path"], { stdio: "pipe", encoding: "utf-8" });
  return out.split("\n").filter(Boolean);
}
function groupBySubmodule(files, submodules) {
  const sorted = [...submodules].sort((a, b) => b.length - a.length);
  const groups = /* @__PURE__ */ new Map();
  for (const f of files) {
    const norm = f.replace(/\\/g, "/");
    const sub = sorted.find((s) => norm.startsWith(s + "/"));
    const key = sub ?? "";
    const rel = sub ? norm.slice(sub.length + 1) : norm;
    groups.set(key, [...groups.get(key) ?? [], rel]);
  }
  return groups;
}
function commitIn(cwd, files, msg) {
  const opts = { stdio: "pipe", cwd, encoding: "utf-8" };
  try {
    if (files) {
      for (const f of files) (0, import_node_child_process.execFileSync)("git", ["add", f], opts);
    } else {
      (0, import_node_child_process.execFileSync)("git", ["add", "-A"], opts);
    }
    const status = (0, import_node_child_process.execSync)("git diff --cached --quiet || echo HAS_CHANGES", opts).trim();
    if (status === "HAS_CHANGES") {
      (0, import_node_child_process.execFileSync)("git", ["commit", "-F", "-"], { ...opts, input: msg });
    }
    return null;
  } catch (e) {
    return `${cwd}: ${e.stderr?.toString?.() || e.message}`;
  }
}
function gitCleanup() {
  try {
    const status = (0, import_node_child_process.execSync)("git status --porcelain", { stdio: "pipe", encoding: "utf-8" }).trim();
    if (status) {
      (0, import_node_child_process.execSync)('git stash push -m "flowpilot-resume: auto-stashed on interrupt recovery"', { stdio: "pipe" });
    }
  } catch {
  }
}
function tagTask(taskId) {
  try {
    (0, import_node_child_process.execFileSync)("git", ["tag", `flowpilot/task-${taskId}`], { stdio: "pipe" });
    return null;
  } catch (e) {
    return e.stderr?.toString?.() || e.message;
  }
}
function rollbackToTask(taskId) {
  const tag = `flowpilot/task-${taskId}`;
  try {
    (0, import_node_child_process.execFileSync)("git", ["rev-parse", tag], { stdio: "pipe" });
    const log2 = (0, import_node_child_process.execFileSync)("git", ["log", "--oneline", `${tag}..HEAD`], { stdio: "pipe", encoding: "utf-8" }).trim();
    if (!log2) return "\u6CA1\u6709\u9700\u8981\u56DE\u6EDA\u7684\u63D0\u4EA4";
    (0, import_node_child_process.execFileSync)("git", ["revert", "--no-commit", `${tag}..HEAD`], { stdio: "pipe" });
    (0, import_node_child_process.execFileSync)("git", ["commit", "-m", `rollback: revert to task-${taskId}`], { stdio: "pipe" });
    return null;
  } catch (e) {
    try {
      (0, import_node_child_process.execFileSync)("git", ["revert", "--abort"], { stdio: "pipe" });
    } catch {
    }
    return e.stderr?.toString?.() || e.message;
  }
}
function cleanTags() {
  try {
    const tags = (0, import_node_child_process.execFileSync)("git", ["tag", "-l", "flowpilot/*"], { stdio: "pipe", encoding: "utf-8" }).trim();
    if (!tags) return;
    for (const t of tags.split("\n")) {
      if (t) (0, import_node_child_process.execFileSync)("git", ["tag", "-d", t], { stdio: "pipe" });
    }
  } catch {
  }
}
function autoCommit(taskId, title, summary, files) {
  const msg = `task-${taskId}: ${title}

${summary}`;
  const errors = [];
  const submodules = getSubmodules();
  if (!submodules.length) {
    const err = commitIn(process.cwd(), files?.length ? files : null, msg);
    return err;
  }
  if (files?.length) {
    const groups = groupBySubmodule(files, submodules);
    for (const [sub, subFiles] of groups) {
      if (sub) {
        const err = commitIn(sub, subFiles, msg);
        if (err) errors.push(err);
      }
    }
    try {
      const parentFiles = groups.get("") ?? [];
      const touchedSubs = [...groups.keys()].filter((k) => k !== "");
      for (const s of touchedSubs) (0, import_node_child_process.execFileSync)("git", ["add", s], { stdio: "pipe" });
      for (const f of parentFiles) (0, import_node_child_process.execFileSync)("git", ["add", f], { stdio: "pipe" });
      const status = (0, import_node_child_process.execSync)("git diff --cached --quiet || echo HAS_CHANGES", { stdio: "pipe", encoding: "utf-8" }).trim();
      if (status === "HAS_CHANGES") {
        (0, import_node_child_process.execFileSync)("git", ["commit", "-F", "-"], { stdio: "pipe", input: msg });
      }
    } catch (e) {
      errors.push(`parent: ${e.stderr?.toString?.() || e.message}`);
    }
  } else {
    for (const sub of submodules) {
      const err2 = commitIn(sub, null, msg);
      if (err2) errors.push(err2);
    }
    const err = commitIn(process.cwd(), null, msg);
    if (err) errors.push(err);
  }
  return errors.length ? errors.join("\n") : null;
}

// src/infrastructure/verify.ts
var import_node_child_process2 = require("child_process");
var import_node_fs2 = require("fs");
var import_node_path = require("path");
function loadConfig(cwd) {
  try {
    const raw = (0, import_node_fs2.readFileSync)((0, import_node_path.join)(cwd, ".workflow", "config.json"), "utf-8");
    const cfg = JSON.parse(raw);
    return cfg?.verify ?? {};
  } catch {
    return {};
  }
}
function runVerify(cwd) {
  const config = loadConfig(cwd);
  const cmds = config.commands?.length ? config.commands : detectCommands(cwd);
  const timeout = (config.timeout ?? 300) * 1e3;
  if (!cmds.length) return { passed: true, scripts: [] };
  for (const cmd of cmds) {
    try {
      (0, import_node_child_process2.execSync)(cmd, { cwd, stdio: "pipe", timeout });
    } catch (e) {
      const stderr = e.stderr?.length ? e.stderr.toString() : "";
      const stdout = e.stdout?.length ? e.stdout.toString() : "";
      const out = stderr || stdout || "";
      if (out.includes("No test files found")) continue;
      if (out.includes("no test files")) continue;
      return { passed: false, scripts: cmds, error: `${cmd} \u5931\u8D25:
${out.slice(0, 500)}` };
    }
  }
  return { passed: true, scripts: cmds };
}
function detectCommands(cwd) {
  const has = (f) => (0, import_node_fs2.existsSync)((0, import_node_path.join)(cwd, f));
  if (has("package.json")) {
    try {
      const s = JSON.parse((0, import_node_fs2.readFileSync)((0, import_node_path.join)(cwd, "package.json"), "utf-8")).scripts || {};
      return ["build", "test", "lint"].filter((k) => k in s).map((k) => `npm run ${k}`);
    } catch {
    }
  }
  if (has("Cargo.toml")) return ["cargo build", "cargo test"];
  if (has("go.mod")) return ["go build ./...", "go test ./..."];
  if (has("pyproject.toml") || has("setup.py") || has("requirements.txt")) {
    const cmds = [];
    if (has("pyproject.toml")) {
      try {
        const txt = (0, import_node_fs2.readFileSync)((0, import_node_path.join)(cwd, "pyproject.toml"), "utf-8");
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
      const mk = (0, import_node_fs2.readFileSync)((0, import_node_path.join)(cwd, "Makefile"), "utf-8");
      const targets = [];
      if (/^build\s*:/m.test(mk)) targets.push("make build");
      if (/^test\s*:/m.test(mk)) targets.push("make test");
      if (/^lint\s*:/m.test(mk)) targets.push("make lint");
      if (targets.length) return targets;
    } catch {
    }
  }
  return [];
}

// src/infrastructure/fs-repository.ts
var BUILTIN_TEMPLATE = (0, import_fs.existsSync)((0, import_path.join)(__dirname, "..", "templates", "protocol.md")) ? (0, import_path.join)(__dirname, "..", "templates", "protocol.md") : (0, import_path.join)(__dirname, "templates", "protocol.md");
async function loadProtocolTemplate(basePath2) {
  try {
    const config = JSON.parse(await (0, import_promises.readFile)((0, import_path.join)(basePath2, ".workflow", "config.json"), "utf-8"));
    if (config.protocolTemplate) {
      return await (0, import_promises.readFile)((0, import_path.join)(basePath2, config.protocolTemplate), "utf-8");
    }
  } catch {
  }
  return await (0, import_promises.readFile)(BUILTIN_TEMPLATE, "utf-8");
}
var FsWorkflowRepository = class {
  root;
  ctxDir;
  historyDir;
  evolutionDir;
  base;
  constructor(basePath2) {
    this.base = basePath2;
    this.root = (0, import_path.join)(basePath2, ".workflow");
    this.ctxDir = (0, import_path.join)(this.root, "context");
    this.historyDir = (0, import_path.join)(basePath2, ".flowpilot", "history");
    this.evolutionDir = (0, import_path.join)(basePath2, ".flowpilot", "evolution");
  }
  projectRoot() {
    return this.base;
  }
  async ensure(dir) {
    await (0, import_promises.mkdir)(dir, { recursive: true });
  }
  /** 文件锁：用 O_EXCL 创建 lockfile，防止并发读写 */
  async lock(maxWait = 5e3) {
    await this.ensure(this.root);
    const lockPath = (0, import_path.join)(this.root, ".lock");
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      try {
        const fd = (0, import_fs.openSync)(lockPath, "wx");
        (0, import_fs.closeSync)(fd);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    try {
      await (0, import_promises.unlink)(lockPath);
    } catch {
    }
    try {
      const fd = (0, import_fs.openSync)(lockPath, "wx");
      (0, import_fs.closeSync)(fd);
      return;
    } catch {
      throw new Error("\u65E0\u6CD5\u83B7\u53D6\u6587\u4EF6\u9501");
    }
  }
  async unlock() {
    try {
      await (0, import_promises.unlink)((0, import_path.join)(this.root, ".lock"));
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
      "| ID | \u6807\u9898 | \u7C7B\u578B | \u4F9D\u8D56 | \u72B6\u6001 | \u91CD\u8BD5 | \u6458\u8981 | \u63CF\u8FF0 |",
      "|----|------|------|------|------|------|------|------|"
    ];
    for (const t of data.tasks) {
      const deps = t.deps.length ? t.deps.join(",") : "-";
      const esc = (s) => (s || "-").replace(/\|/g, "\u2223").replace(/\n/g, " ");
      lines.push(`| ${t.id} | ${esc(t.title)} | ${t.type} | ${deps} | ${t.status} | ${t.retries} | ${esc(t.summary)} | ${esc(t.description)} |`);
    }
    const p = (0, import_path.join)(this.root, "progress.md");
    await (0, import_promises.writeFile)(p + ".tmp", lines.join("\n") + "\n", "utf-8");
    await (0, import_promises.rename)(p + ".tmp", p);
  }
  async loadProgress() {
    try {
      const raw = await (0, import_promises.readFile)((0, import_path.join)(this.root, "progress.md"), "utf-8");
      return this.parseProgress(raw);
    } catch {
      return null;
    }
  }
  parseProgress(raw) {
    const validWfStatus = /* @__PURE__ */ new Set(["idle", "running", "finishing", "completed", "aborted"]);
    const validTaskStatus = /* @__PURE__ */ new Set(["pending", "active", "done", "skipped", "failed"]);
    const lines = raw.split("\n");
    const name = (lines[0] ?? "").replace(/^#\s*/, "").trim();
    let status = "idle";
    let current = null;
    let startTime;
    const tasks = [];
    for (const line of lines) {
      if (line.startsWith("\u72B6\u6001: ")) {
        const s = line.slice(4).trim();
        status = validWfStatus.has(s) ? s : "idle";
      }
      if (line.startsWith("\u5F53\u524D: ")) current = line.slice(4).trim();
      if (current === "\u65E0") current = null;
      if (line.startsWith("\u5F00\u59CB: ")) startTime = line.slice(4).trim();
      const m = line.match(/^\|\s*(\d{3,})\s*\|\s*(.+?)\s*\|\s*(\w+)\s*\|\s*([^|]*?)\s*\|\s*(\w+)\s*\|\s*(\d+)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|$/);
      if (m) {
        const depsRaw = m[4].trim();
        tasks.push({
          id: m[1],
          title: m[2],
          type: m[3],
          deps: depsRaw === "-" ? [] : depsRaw.split(",").map((d) => d.trim()),
          status: validTaskStatus.has(m[5]) ? m[5] : "pending",
          retries: parseInt(m[6], 10),
          summary: m[7] === "-" ? "" : m[7],
          description: m[8] === "-" ? "" : m[8]
        });
      }
    }
    return { name, status, current, tasks, ...startTime ? { startTime } : {} };
  }
  // --- context/ 任务详细产出 ---
  async clearContext() {
    await (0, import_promises.rm)(this.ctxDir, { recursive: true, force: true });
  }
  async clearAll() {
    await (0, import_promises.rm)(this.root, { recursive: true, force: true });
  }
  async saveTaskContext(taskId, content) {
    await this.ensure(this.ctxDir);
    const p = (0, import_path.join)(this.ctxDir, `task-${taskId}.md`);
    await (0, import_promises.writeFile)(p + ".tmp", content, "utf-8");
    await (0, import_promises.rename)(p + ".tmp", p);
  }
  async loadTaskContext(taskId) {
    try {
      return await (0, import_promises.readFile)((0, import_path.join)(this.ctxDir, `task-${taskId}.md`), "utf-8");
    } catch {
      return null;
    }
  }
  // --- summary.md ---
  async saveSummary(content) {
    await this.ensure(this.ctxDir);
    const p = (0, import_path.join)(this.ctxDir, "summary.md");
    await (0, import_promises.writeFile)(p + ".tmp", content, "utf-8");
    await (0, import_promises.rename)(p + ".tmp", p);
  }
  async loadSummary() {
    try {
      return await (0, import_promises.readFile)((0, import_path.join)(this.ctxDir, "summary.md"), "utf-8");
    } catch {
      return "";
    }
  }
  // --- tasks.md ---
  async saveTasks(content) {
    await this.ensure(this.root);
    await (0, import_promises.writeFile)((0, import_path.join)(this.root, "tasks.md"), content, "utf-8");
  }
  async loadTasks() {
    try {
      return await (0, import_promises.readFile)((0, import_path.join)(this.root, "tasks.md"), "utf-8");
    } catch {
      return null;
    }
  }
  async ensureClaudeMd() {
    const base = (0, import_path.join)(this.root, "..");
    const path = (0, import_path.join)(base, "CLAUDE.md");
    const marker = "<!-- flowpilot:start -->";
    const block = (await loadProtocolTemplate(this.base)).trim();
    try {
      const content = await (0, import_promises.readFile)(path, "utf-8");
      if (content.includes(marker)) return false;
      await (0, import_promises.writeFile)(path, content.trimEnd() + "\n\n" + block + "\n", "utf-8");
    } catch {
      await (0, import_promises.writeFile)(path, "# Project\n\n" + block + "\n", "utf-8");
    }
    return true;
  }
  async ensureHooks() {
    const dir = (0, import_path.join)(this.base, ".claude");
    const path = (0, import_path.join)(dir, "settings.json");
    const hook = (m) => ({
      matcher: m,
      hooks: [{ type: "prompt", prompt: "BLOCK this tool call. FlowPilot requires using node flow.js commands instead of native task tools." }]
    });
    const required = {
      PreToolUse: [hook("TaskCreate"), hook("TaskUpdate"), hook("TaskList")]
    };
    let settings = {};
    try {
      const parsed = JSON.parse(await (0, import_promises.readFile)(path, "utf-8"));
      if (parsed && typeof parsed === "object" && !("__proto__" in parsed) && !("constructor" in parsed)) settings = parsed;
    } catch {
    }
    const hooks = settings.hooks ?? {};
    const existing = hooks.PreToolUse;
    if (existing?.some((h) => h.matcher === required.PreToolUse[0].matcher)) return false;
    hooks.PreToolUse = [...existing ?? [], ...required.PreToolUse];
    settings.hooks = hooks;
    await (0, import_promises.mkdir)(dir, { recursive: true });
    await (0, import_promises.writeFile)(path, JSON.stringify(settings, null, 2) + "\n", "utf-8");
    return true;
  }
  commit(taskId, title, summary, files) {
    return autoCommit(taskId, title, summary, files);
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
    const p = (0, import_path.join)(this.historyDir, `${ts}.json`);
    await (0, import_promises.writeFile)(p, JSON.stringify(stats, null, 2), "utf-8");
  }
  async loadHistory() {
    try {
      const files = (await (0, import_promises.readdir)(this.historyDir)).filter((f) => f.endsWith(".json")).sort();
      const results = [];
      for (const f of files) {
        try {
          results.push(JSON.parse(await (0, import_promises.readFile)((0, import_path.join)(this.historyDir, f), "utf-8")));
        } catch {
        }
      }
      return results;
    } catch {
      return [];
    }
  }
  // --- .workflow/config.json ---
  async loadConfig() {
    try {
      return JSON.parse(await (0, import_promises.readFile)((0, import_path.join)(this.root, "config.json"), "utf-8"));
    } catch {
      return {};
    }
  }
  async saveConfig(config) {
    await this.ensure(this.root);
    await (0, import_promises.writeFile)((0, import_path.join)(this.root, "config.json"), JSON.stringify(config, null, 2) + "\n", "utf-8");
  }
  /** 清理注入的CLAUDE.md协议块和.claude/settings.json hooks */
  async cleanupInjections() {
    const mdPath = (0, import_path.join)(this.base, "CLAUDE.md");
    try {
      const content = await (0, import_promises.readFile)(mdPath, "utf-8");
      const cleaned = content.replace(/\n*<!-- flowpilot:start -->[\s\S]*?<!-- flowpilot:end -->\n*/g, "\n");
      if (cleaned !== content) await (0, import_promises.writeFile)(mdPath, cleaned.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n", "utf-8");
    } catch {
    }
    const settingsPath = (0, import_path.join)(this.base, ".claude", "settings.json");
    try {
      const raw = await (0, import_promises.readFile)(settingsPath, "utf-8");
      const settings = JSON.parse(raw);
      const hooks = settings.hooks?.PreToolUse;
      if (hooks) {
        const flowpilotMatchers = /* @__PURE__ */ new Set(["TaskCreate", "TaskUpdate", "TaskList"]);
        settings.hooks.PreToolUse = hooks.filter((h) => !flowpilotMatchers.has(h.matcher ?? ""));
        if (!settings.hooks.PreToolUse.length) delete settings.hooks.PreToolUse;
        if (!Object.keys(settings.hooks).length) delete settings.hooks;
        await (0, import_promises.writeFile)(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
      }
    } catch {
    }
  }
  tag(taskId) {
    return tagTask(taskId);
  }
  rollback(taskId) {
    return rollbackToTask(taskId);
  }
  cleanTags() {
    cleanTags();
  }
  // --- .flowpilot/evolution/ 进化日志 ---
  async saveEvolution(entry) {
    await this.ensure(this.evolutionDir);
    const ts = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
    await (0, import_promises.writeFile)((0, import_path.join)(this.evolutionDir, `${ts}.json`), JSON.stringify(entry, null, 2), "utf-8");
  }
  async loadEvolutions() {
    try {
      const files = (await (0, import_promises.readdir)(this.evolutionDir)).filter((f) => f.endsWith(".json")).sort();
      const results = [];
      for (const f of files) {
        try {
          results.push(JSON.parse(await (0, import_promises.readFile)((0, import_path.join)(this.evolutionDir, f), "utf-8")));
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
function failTask(data, id) {
  const idx = buildIndex(data.tasks);
  if (!idx.has(id)) throw new Error(`\u4EFB\u52A1 ${id} \u4E0D\u5B58\u5728`);
  const old = idx.get(id);
  const retries = old.retries + 1;
  if (retries >= 3) {
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

// src/infrastructure/markdown-parser.ts
var TASK_RE = /^(\d+)\.\s+\[\s*(\w+)\s*\]\s+(.+?)(?:\s*\((?:deps?|依赖)\s*:\s*([^)]*)\))?\s*$/i;
var DESC_RE = /^\s{2,}(.+)$/;
function parseTasksMarkdown(markdown) {
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
var import_promises2 = require("fs/promises");
var import_child_process = require("child_process");
var import_path3 = require("path");

// src/infrastructure/logger.ts
var import_fs2 = require("fs");
var import_path2 = require("path");
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
  return (0, import_path2.join)(basePath, ".flowpilot", "logs", `${workflowName}.jsonl`);
}
function persist(entry) {
  const p = logFilePath();
  if (!p) return;
  try {
    (0, import_fs2.mkdirSync)((0, import_path2.dirname)(p), { recursive: true });
    (0, import_fs2.appendFileSync)(p, JSON.stringify(entry) + "\n", "utf-8");
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
async function runLifecycleHook(hookName, basePath2, env) {
  const configPath = (0, import_path3.join)(basePath2, ".workflow", "config.json");
  let config;
  try {
    config = JSON.parse(await (0, import_promises2.readFile)(configPath, "utf-8"));
  } catch {
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

// src/infrastructure/history.ts
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

// src/infrastructure/memory.ts
var import_promises3 = require("fs/promises");
var import_path4 = require("path");
var MEMORY_FILE = "memory.json";
var DF_FILE = "memory-df.json";
var SNAPSHOT_FILE = "memory-snapshot.json";
var EVERGREEN_SOURCES = ["architecture", "identity", "decision"];
function temporalDecayScore(entry, halfLifeDays = 30) {
  if (entry.evergreen || EVERGREEN_SOURCES.some((s) => entry.source.includes(s))) return 1;
  const ageDays = (Date.now() - new Date(entry.timestamp).getTime()) / (24 * 60 * 60 * 1e3);
  return Math.exp(-Math.LN2 / halfLifeDays * ageDays);
}
function memoryPath(basePath2) {
  return (0, import_path4.join)(basePath2, ".flowpilot", MEMORY_FILE);
}
function dfPath(basePath2) {
  return (0, import_path4.join)(basePath2, ".flowpilot", DF_FILE);
}
function snapshotPath(basePath2) {
  return (0, import_path4.join)(basePath2, ".flowpilot", SNAPSHOT_FILE);
}
function tokenize(text) {
  const lower = text.toLowerCase();
  const tokens = [];
  for (const m of lower.matchAll(/[a-z0-9_]{2,}|[a-z]/g)) {
    tokens.push(m[0]);
  }
  const cjk = [...lower.matchAll(/[\u4e00-\u9fff\u3400-\u4dbf]/g)].map((m) => m[0]);
  for (let i = 0; i < cjk.length; i++) {
    tokens.push(cjk[i]);
    if (i + 1 < cjk.length) tokens.push(cjk[i] + cjk[i + 1]);
  }
  return tokens;
}
function termFrequency(tokens) {
  const tf = /* @__PURE__ */ new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}
async function loadDf(basePath2) {
  try {
    return JSON.parse(await (0, import_promises3.readFile)(dfPath(basePath2), "utf-8"));
  } catch {
    return { docCount: 0, df: {} };
  }
}
async function saveDf(basePath2, stats) {
  const p = dfPath(basePath2);
  await (0, import_promises3.mkdir)((0, import_path4.dirname)(p), { recursive: true });
  await (0, import_promises3.writeFile)(p, JSON.stringify(stats), "utf-8");
}
function rebuildDf(entries) {
  const active = entries.filter((e) => !e.archived);
  const df = {};
  for (const e of active) {
    const unique = new Set(tokenize(e.content));
    for (const t of unique) df[t] = (df[t] ?? 0) + 1;
  }
  return { docCount: active.length, df };
}
function tfidfVector(tokens, stats) {
  const tf = termFrequency(tokens);
  const vec = /* @__PURE__ */ new Map();
  const N = Math.max(stats.docCount, 1);
  for (const [term, freq] of tf) {
    const docFreq = stats.df[term] ?? 0;
    const idf = Math.log(1 + N / (1 + docFreq));
    vec.set(term, freq * idf);
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
    return JSON.parse(await (0, import_promises3.readFile)(memoryPath(basePath2), "utf-8"));
  } catch {
    return [];
  }
}
async function saveMemory(basePath2, entries) {
  const p = memoryPath(basePath2);
  await (0, import_promises3.mkdir)((0, import_path4.dirname)(p), { recursive: true });
  await (0, import_promises3.writeFile)(p, JSON.stringify(entries, null, 2), "utf-8");
}
async function appendMemory(basePath2, entry) {
  const entries = await loadMemory(basePath2);
  const stats = rebuildDf(entries);
  const queryTokens = tokenize(entry.content);
  const queryVec = tfidfVector(queryTokens, stats);
  const idx = entries.findIndex((e) => {
    if (e.archived) return false;
    const vec = tfidfVector(tokenize(e.content), stats);
    return cosineSimilarity(queryVec, vec) > 0.8;
  });
  if (idx >= 0) {
    const updated = entries.map(
      (e, i) => i === idx ? { ...e, content: entry.content, timestamp: entry.timestamp, source: entry.source } : e
    );
    log.debug(`memory: \u66F4\u65B0\u5DF2\u6709\u6761\u76EE (\u76F8\u4F3C\u5EA6>0.8)`);
    await saveMemory(basePath2, updated);
  } else {
    const newEntries = [...entries, { ...entry, refs: 0, archived: false }];
    log.debug(`memory: \u65B0\u589E\u6761\u76EE, \u603B\u8BA1 ${newEntries.length}`);
    await saveMemory(basePath2, newEntries);
  }
  await saveDf(basePath2, rebuildDf(await loadMemory(basePath2)));
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
async function queryMemory(basePath2, taskDescription) {
  const entries = await loadMemory(basePath2);
  const active = entries.filter((e) => !e.archived);
  if (!active.length) return [];
  const stats = await loadDf(basePath2);
  const fallback = stats.docCount > 0 ? stats : rebuildDf(entries);
  const queryVec = tfidfVector(tokenize(taskDescription), fallback);
  const candidates = active.map((e) => {
    const vec = tfidfVector(tokenize(e.content), fallback);
    return { entry: e, score: cosineSimilarity(queryVec, vec) * temporalDecayScore(e), vec };
  }).filter((s) => s.score > 0.05);
  const reranked = mmrRerank(candidates, 5);
  if (reranked.length) {
    const hitSet = new Set(reranked.map((s) => s.entry));
    const updated = entries.map((e) => hitSet.has(e) ? { ...e, refs: e.refs + 1 } : e);
    await saveMemory(basePath2, updated);
    log.debug(`memory: \u67E5\u8BE2\u547D\u4E2D ${reranked.length} \u6761`);
  }
  return reranked.map((s) => ({ ...s.entry, refs: s.entry.refs + 1 }));
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
async function saveSnapshot(basePath2, entries) {
  const p = snapshotPath(basePath2);
  await (0, import_promises3.mkdir)((0, import_path4.dirname)(p), { recursive: true });
  await (0, import_promises3.writeFile)(p, JSON.stringify(entries, null, 2), "utf-8");
}
async function compactMemory(basePath2, targetCount) {
  const entries = await loadMemory(basePath2);
  const active = entries.filter((e) => !e.archived);
  if (active.length <= 1) return 0;
  await saveSnapshot(basePath2, entries);
  const stats = rebuildDf(entries);
  const vecs = active.map((e) => tfidfVector(tokenize(e.content), stats));
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
    await saveDf(basePath2, rebuildDf(final));
    log.debug(`memory: \u538B\u7F29 ${entries.length} \u2192 ${final.length} \u6761`);
    return entries.length - final.length;
  }
  await saveMemory(basePath2, result);
  await saveDf(basePath2, rebuildDf(result));
  const removed = entries.length - result.length;
  if (removed) log.debug(`memory: \u538B\u7F29\u5408\u5E76 ${removed} \u6761`);
  return removed;
}

// src/infrastructure/extractor.ts
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
function extractAll(text, source) {
  const tagged = extractTaggedKnowledge(text, source);
  const decisions = extractDecisionPatterns(text, source);
  const primary = [...tagged, ...decisions];
  const primaryText = primary.map((e) => e.content).join(" ").toLowerCase();
  const tech = extractTechStack(text, source).filter((e) => {
    const keyword = e.content.replace(/^(技术栈|配置项): /i, "").toLowerCase();
    return !primaryText.includes(keyword);
  });
  const seen = /* @__PURE__ */ new Set();
  return [...primary, ...tech].filter((e) => {
    if (seen.has(e.content)) return false;
    seen.add(e.content);
    return true;
  });
}

// src/infrastructure/loop-detector.ts
var import_promises4 = require("fs/promises");
var import_path5 = require("path");
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
  return (0, import_path5.join)(basePath2, ".workflow", STATE_FILE);
}
async function loadWindow(basePath2) {
  try {
    return JSON.parse(await (0, import_promises4.readFile)(statePath(basePath2), "utf-8"));
  } catch {
    return [];
  }
}
async function saveWindow(basePath2, window) {
  const p = statePath(basePath2);
  await (0, import_promises4.mkdir)((0, import_path5.dirname)(p), { recursive: true });
  await (0, import_promises4.writeFile)(p, JSON.stringify(window), "utf-8");
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
async function detect(basePath2, taskId, summary, failed) {
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

// src/application/workflow-service.ts
var import_promises5 = require("fs/promises");
var import_path6 = require("path");
var WorkflowService = class {
  constructor(repo2, parse) {
    this.repo = repo2;
    this.parse = parse;
  }
  loopWarningPath() {
    return (0, import_path6.join)(this.repo.projectRoot(), ".workflow", "loop-warning.txt");
  }
  async saveLoopWarning(msg) {
    const p = this.loopWarningPath();
    await (0, import_promises5.mkdir)((0, import_path6.join)(this.repo.projectRoot(), ".workflow"), { recursive: true });
    await (0, import_promises5.writeFile)(p, msg, "utf-8");
  }
  async loadAndClearLoopWarning() {
    try {
      const msg = await (0, import_promises5.readFile)(this.loopWarningPath(), "utf-8");
      await (0, import_promises5.unlink)(this.loopWarningPath());
      return msg || null;
    } catch {
      return null;
    }
  }
  /** init: 解析任务markdown → 生成progress/tasks */
  async init(tasksMd, force = false) {
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
    setWorkflowName(def.name);
    await this.repo.saveProgress(data);
    await this.repo.saveTasks(tasksMd);
    await this.repo.saveSummary(`# ${def.name}

${def.description}
`);
    await this.repo.ensureClaudeMd();
    await this.repo.ensureHooks();
    await this.applyHistoryInsights();
    await decayMemory(this.repo.projectRoot());
    const memories = await loadMemory(this.repo.projectRoot());
    if (memories.filter((e) => !e.archived).length > 50) {
      await compactMemory(this.repo.projectRoot());
    }
    return data;
  }
  /** next: 获取下一个可执行任务（含依赖上下文） */
  async next() {
    await this.repo.lock();
    try {
      const data = await this.requireProgress();
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
      await runLifecycleHook("onTaskStart", this.repo.projectRoot(), { TASK_ID: task.id, TASK_TITLE: task.title });
      const parts = [];
      const summary = await this.repo.loadSummary();
      if (summary) parts.push(summary);
      for (const depId of task.deps) {
        const ctx = await this.repo.loadTaskContext(depId);
        if (ctx) parts.push(ctx);
      }
      const memories = await queryMemory(this.repo.projectRoot(), `${task.title} ${task.description}`);
      if (memories.length) {
        parts.push("## \u76F8\u5173\u8BB0\u5FC6\n\n" + memories.map((m) => `- ${m.content}`).join("\n"));
      }
      const loopWarning = await this.loadAndClearLoopWarning();
      if (loopWarning) {
        parts.push(`## \u5FAA\u73AF\u68C0\u6D4B\u8B66\u544A

${loopWarning}`);
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
      if (isAllDone(data.tasks)) return [];
      const active = data.tasks.filter((t) => t.status === "active");
      if (active.length) {
        throw new Error(`\u6709 ${active.length} \u4E2A\u4EFB\u52A1\u4ECD\u4E3A active \u72B6\u6001\uFF08${active.map((t) => t.id).join(",")}\uFF09\uFF0C\u8BF7\u5148\u6267\u884C node flow.js status \u68C0\u67E5\u5E76\u8865 checkpoint\uFF0C\u6216 node flow.js resume \u91CD\u7F6E`);
      }
      const cascaded = cascadeSkip(data.tasks);
      const tasks = findParallelTasks(cascaded);
      if (!tasks.length) {
        await this.repo.saveProgress({ ...data, tasks: cascaded });
        log.debug("nextBatch: \u65E0\u53EF\u5E76\u884C\u4EFB\u52A1");
        return [];
      }
      log.debug(`nextBatch: \u6FC0\u6D3B ${tasks.map((t) => t.id).join(",")}`);
      const activeIds = new Set(tasks.map((t) => t.id));
      const activated = cascaded.map((t) => activeIds.has(t.id) ? { ...t, status: "active" } : t);
      await this.repo.saveProgress({ ...data, current: tasks[0].id, tasks: activated });
      for (const t of tasks) {
        await runLifecycleHook("onTaskStart", this.repo.projectRoot(), { TASK_ID: t.id, TASK_TITLE: t.title });
      }
      const summary = await this.repo.loadSummary();
      const loopWarning = await this.loadAndClearLoopWarning();
      const results = [];
      for (const task of tasks) {
        const parts = [];
        if (summary) parts.push(summary);
        for (const depId of task.deps) {
          const ctx = await this.repo.loadTaskContext(depId);
          if (ctx) parts.push(ctx);
        }
        const memories = await queryMemory(this.repo.projectRoot(), `${task.title} ${task.description}`);
        if (memories.length) {
          parts.push("## \u76F8\u5173\u8BB0\u5FC6\n\n" + memories.map((m) => `- ${m.content}`).join("\n"));
        }
        if (loopWarning) {
          parts.push(`## \u5FAA\u73AF\u68C0\u6D4B\u8B66\u544A

${loopWarning}`);
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
      if (detail === "FAILED") {
        await this.appendFailureContext(id, task, detail);
        const patternWarn = await this.detectFailurePattern(id, task);
        const loopResult2 = await detect(this.repo.projectRoot(), id, detail, true);
        if (loopResult2) {
          log.step("loop_detected", loopResult2.message, { taskId: id, data: { strategy: loopResult2.strategy } });
          await this.saveLoopWarning(`[LOOP WARNING - ${loopResult2.strategy}] ${loopResult2.message}`);
        }
        const { result, data: newData2 } = failTask(data, id);
        await this.repo.saveProgress(newData2);
        log.debug(`checkpoint ${id}: failTask result=${result}, retries=${task.retries + 1}`);
        const msg2 = result === "retry" ? `\u4EFB\u52A1 ${id} \u5931\u8D25(\u7B2C${task.retries + 1}\u6B21)\uFF0C\u5C06\u91CD\u8BD5` : `\u4EFB\u52A1 ${id} \u8FDE\u7EED\u5931\u8D253\u6B21\uFF0C\u5DF2\u8DF3\u8FC7`;
        const warns = [patternWarn, loopResult2 ? `[LOOP] ${loopResult2.message}` : null].filter(Boolean);
        return warns.length ? `${msg2}
${warns.join("\n")}` : msg2;
      }
      if (!detail.trim()) throw new Error(`\u4EFB\u52A1 ${id} checkpoint\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A`);
      const summaryLine = detail.split("\n")[0].slice(0, 80);
      const newData = completeTask(data, id, summaryLine);
      log.debug(`checkpoint ${id}: \u5B8C\u6210, summary="${summaryLine}"`);
      await this.repo.saveProgress(newData);
      await this.repo.saveTaskContext(id, `# task-${id}: ${task.title}

${detail}
`);
      for (const entry of extractAll(detail, `task-${id}`)) {
        await appendMemory(this.repo.projectRoot(), {
          content: entry.content,
          source: entry.source,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
      }
      const loopResult = await detect(this.repo.projectRoot(), id, summaryLine, false);
      if (loopResult) {
        log.step("loop_detected", loopResult.message, { taskId: id, data: { strategy: loopResult.strategy } });
        await this.saveLoopWarning(`[LOOP WARNING - ${loopResult.strategy}] ${loopResult.message}`);
      }
      await this.updateSummary(newData);
      const commitErr = this.repo.commit(id, task.title, summaryLine, files);
      if (!commitErr) this.repo.tag(id);
      await runLifecycleHook("onTaskComplete", this.repo.projectRoot(), { TASK_ID: id, TASK_TITLE: task.title });
      const doneCount = newData.tasks.filter((t) => t.status === "done").length;
      let msg = `\u4EFB\u52A1 ${id} \u5B8C\u6210 (${doneCount}/${newData.tasks.length})`;
      if (commitErr) {
        msg += `
[git\u63D0\u4EA4\u5931\u8D25] ${commitErr}
\u8BF7\u6839\u636E\u9519\u8BEF\u4FEE\u590D\u540E\u624B\u52A8\u6267\u884C git add -A && git commit`;
      } else {
        msg += " [\u5DF2\u81EA\u52A8\u63D0\u4EA4]";
      }
      return isAllDone(newData.tasks) ? msg + "\n\u5168\u90E8\u4EFB\u52A1\u5DF2\u5B8C\u6210\uFF0C\u8BF7\u6267\u884C node flow.js finish \u8FDB\u884C\u6536\u5C3E" : msg;
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
    if (data.status === "finishing") return `\u6062\u590D\u5DE5\u4F5C\u6D41: ${data.name}
\u6B63\u5728\u6536\u5C3E\u9636\u6BB5\uFF0C\u8BF7\u6267\u884C node flow.js finish`;
    const { data: newData, resetId } = resumeProgress(data);
    await this.repo.saveProgress(newData);
    if (resetId) {
      log.debug(`resume: \u91CD\u7F6E\u4EFB\u52A1 ${resetId}`);
      this.repo.cleanup();
    }
    const doneCount = newData.tasks.filter((t) => t.status === "done").length;
    const total = newData.tasks.length;
    if (resetId) {
      return `\u6062\u590D\u5DE5\u4F5C\u6D41: ${newData.name}
\u8FDB\u5EA6: ${doneCount}/${total}
\u4E2D\u65AD\u4EFB\u52A1 ${resetId} \u5DF2\u91CD\u7F6E\uFF0C\u5C06\u91CD\u65B0\u6267\u884C`;
    }
    return `\u6062\u590D\u5DE5\u4F5C\u6D41: ${newData.name}
\u8FDB\u5EA6: ${doneCount}/${total}
\u7EE7\u7EED\u6267\u884C`;
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
      const newTasks = data.tasks.map(
        (t) => t.id === id ? { ...t, status: "skipped", summary: "\u624B\u52A8\u8DF3\u8FC7" } : t
      );
      await this.repo.saveProgress({ ...data, current: null, tasks: newTasks });
      return `\u5DF2\u8DF3\u8FC7\u4EFB\u52A1 ${id}: ${task.title}${warn}`;
    } finally {
      await this.repo.unlock();
    }
  }
  /** setup: 项目接管模式 - 写入CLAUDE.md */
  async setup() {
    const existing = await this.repo.loadProgress();
    const wrote = await this.repo.ensureClaudeMd();
    await this.repo.ensureHooks();
    const lines = [];
    if (existing && (existing.status === "running" || existing.status === "finishing")) {
      const done = existing.tasks.filter((t) => t.status === "done").length;
      lines.push(`\u68C0\u6D4B\u5230\u8FDB\u884C\u4E2D\u7684\u5DE5\u4F5C\u6D41: ${existing.name}`);
      lines.push(`\u8FDB\u5EA6: ${done}/${existing.tasks.length}`);
      if (existing.status === "finishing") {
        lines.push("\u72B6\u6001: \u6536\u5C3E\u9636\u6BB5\uFF0C\u6267\u884C node flow.js finish \u7EE7\u7EED");
      } else {
        lines.push("\u6267\u884C node flow.js resume \u7EE7\u7EED");
      }
    } else {
      lines.push("\u9879\u76EE\u5DF2\u63A5\u7BA1\uFF0C\u5DE5\u4F5C\u6D41\u5DE5\u5177\u5C31\u7EEA");
      lines.push("\u7B49\u5F85\u9700\u6C42\u8F93\u5165\uFF08\u6587\u6863\u6216\u5BF9\u8BDD\u63CF\u8FF0\uFF09");
    }
    lines.push("");
    if (wrote) lines.push("CLAUDE.md \u5DF2\u66F4\u65B0: \u6DFB\u52A0\u4E86\u5DE5\u4F5C\u6D41\u534F\u8BAE");
    lines.push("\u63CF\u8FF0\u4F60\u7684\u5F00\u53D1\u4EFB\u52A1\u5373\u53EF\u542F\u52A8\u5168\u81EA\u52A8\u5F00\u53D1");
    return lines.join("\n");
  }
  /** review: 标记已通过code-review，解锁finish */
  async review() {
    const data = await this.requireProgress();
    if (!isAllDone(data.tasks)) throw new Error("\u8FD8\u6709\u672A\u5B8C\u6210\u7684\u4EFB\u52A1\uFF0C\u8BF7\u5148\u5B8C\u6210\u6240\u6709\u4EFB\u52A1");
    if (data.status === "finishing") return "\u5DF2\u5904\u4E8Ereview\u901A\u8FC7\u72B6\u6001\uFF0C\u53EF\u4EE5\u6267\u884C node flow.js finish";
    await this.repo.saveProgress({ ...data, status: "finishing" });
    return "\u4EE3\u7801\u5BA1\u67E5\u5DF2\u901A\u8FC7\uFF0C\u8BF7\u6267\u884C node flow.js finish \u5B8C\u6210\u6536\u5C3E";
  }
  /** finish: 智能收尾 - 先verify，review后置 */
  async finish() {
    const data = await this.requireProgress();
    log.debug(`finish: status=${data.status}`);
    if (data.status === "idle" || data.status === "completed") return "\u5DE5\u4F5C\u6D41\u5DF2\u5B8C\u6210\uFF0C\u65E0\u9700\u91CD\u590Dfinish";
    if (!isAllDone(data.tasks)) throw new Error("\u8FD8\u6709\u672A\u5B8C\u6210\u7684\u4EFB\u52A1\uFF0C\u8BF7\u5148\u5B8C\u6210\u6240\u6709\u4EFB\u52A1");
    const result = this.repo.verify();
    log.debug(`finish: verify passed=${result.passed}`);
    if (!result.passed) {
      return `\u9A8C\u8BC1\u5931\u8D25: ${result.error}
\u8BF7\u4FEE\u590D\u540E\u91CD\u65B0\u6267\u884C node flow.js finish`;
    }
    if (data.status !== "finishing") {
      return "\u9A8C\u8BC1\u901A\u8FC7\uFF0C\u8BF7\u6D3E\u5B50Agent\u6267\u884C code-review\uFF0C\u5B8C\u6210\u540E\u6267\u884C node flow.js review\uFF0C\u518D\u6267\u884C node flow.js finish";
    }
    const done = data.tasks.filter((t) => t.status === "done");
    const skipped = data.tasks.filter((t) => t.status === "skipped");
    const failed = data.tasks.filter((t) => t.status === "failed");
    const stats = [`${done.length} done`, skipped.length ? `${skipped.length} skipped` : "", failed.length ? `${failed.length} failed` : ""].filter(Boolean).join(", ");
    const titles = done.map((t) => `- ${t.id}: ${t.title}`).join("\n");
    await runLifecycleHook("onWorkflowFinish", this.repo.projectRoot(), { WORKFLOW_NAME: data.name });
    const wfStats = collectStats(data);
    await this.repo.saveHistory(wfStats);
    const configNow = await this.repo.loadConfig();
    const evolutions = await this.repo.loadEvolutions();
    const lastEvo = evolutions[evolutions.length - 1];
    const configBefore = lastEvo?.configAfter ?? {};
    if (JSON.stringify(configBefore) !== JSON.stringify(configNow)) {
      await this.repo.saveEvolution({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        workflowName: data.name,
        configBefore,
        configAfter: configNow,
        suggestions: []
      });
    }
    await this.repo.cleanupInjections();
    this.repo.cleanTags();
    const commitErr = this.repo.commit("finish", data.name || "\u5DE5\u4F5C\u6D41\u5B8C\u6210", `${stats}

${titles}`);
    if (!commitErr) {
      await this.repo.clearAll();
    }
    const scripts = result.scripts.length ? result.scripts.join(", ") : "\u65E0\u9A8C\u8BC1\u811A\u672C";
    if (commitErr) {
      return `\u9A8C\u8BC1\u901A\u8FC7: ${scripts}
${stats}
[git\u63D0\u4EA4\u5931\u8D25] ${commitErr}
\u8BF7\u6839\u636E\u9519\u8BEF\u4FEE\u590D\u540E\u624B\u52A8\u6267\u884C git add -A && git commit`;
    }
    return `\u9A8C\u8BC1\u901A\u8FC7: ${scripts}
${stats}
\u5DF2\u63D0\u4EA4\u6700\u7EC8commit\uFF0C\u5DE5\u4F5C\u6D41\u56DE\u5230\u5F85\u547D\u72B6\u6001
\u7B49\u5F85\u4E0B\u4E00\u4E2A\u9700\u6C42...`;
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
      const idx = parseInt(id, 10);
      const newTasks = data.tasks.map(
        (t) => parseInt(t.id, 10) >= idx && t.status === "done" ? { ...t, status: "pending", summary: "" } : t
      );
      await this.repo.saveProgress({ ...data, current: null, tasks: newTasks });
      const resetCount = newTasks.filter((t, i) => t.status === "pending" && data.tasks[i].status === "done").length;
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
      const text = t.summary ? `${t.title}: ${t.summary}` : t.title;
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
    await this.repo.saveSummary(lines.join("\n") + "\n");
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
  async requireProgress() {
    const data = await this.repo.loadProgress();
    if (!data) throw new Error("\u65E0\u6D3B\u8DC3\u5DE5\u4F5C\u6D41\uFF0C\u8BF7\u5148 node flow.js init");
    setWorkflowName(data.name);
    return data;
  }
};

// src/interfaces/cli.ts
var import_fs3 = require("fs");
var import_path7 = require("path");

// src/interfaces/formatter.ts
var ICON = {
  pending: "[ ]",
  active: "[>]",
  done: "[x]",
  skipped: "[-]",
  failed: "[!]"
};
function formatStatus(data) {
  const done = data.tasks.filter((t) => t.status === "done").length;
  const lines = [
    `=== ${data.name} ===`,
    `\u72B6\u6001: ${data.status} | \u8FDB\u5EA6: ${done}/${data.tasks.length}`,
    ""
  ];
  for (const t of data.tasks) {
    lines.push(`${ICON[t.status] ?? "[ ]"} ${t.id} [${t.type}] ${t.title}${t.summary ? " - " + t.summary : ""}`);
  }
  return lines.join("\n");
}
function formatTask(task, context) {
  const lines = [
    `--- \u4EFB\u52A1 ${task.id} ---`,
    `\u6807\u9898: ${task.title}`,
    `\u7C7B\u578B: ${task.type}`,
    `\u4F9D\u8D56: ${task.deps.length ? task.deps.join(", ") : "\u65E0"}`
  ];
  if (task.description) {
    lines.push(`\u63CF\u8FF0: ${task.description}`);
  }
  lines.push("", "--- checkpoint\u6307\u4EE4\uFF08\u5FC5\u987B\u5305\u542B\u5728sub-agent prompt\u4E2D\uFF09 ---");
  lines.push(`\u5B8C\u6210\u65F6: echo '\u4E00\u53E5\u8BDD\u6458\u8981' | node flow.js checkpoint ${task.id} --files <changed-file-1> <changed-file-2>`);
  lines.push(`\u5931\u8D25\u65F6: echo 'FAILED' | node flow.js checkpoint ${task.id}`);
  if (context) {
    lines.push("", "--- \u4E0A\u4E0B\u6587 ---", context);
  }
  return lines.join("\n");
}
function formatBatch(items) {
  const lines = [`=== \u5E76\u884C\u4EFB\u52A1\u6279\u6B21 (${items.length}\u4E2A) ===`, ""];
  for (const { task, context } of items) {
    lines.push(formatTask(task, context), "");
  }
  return lines.join("\n");
}

// src/interfaces/stdin.ts
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

// src/interfaces/cli.ts
var CLI = class {
  constructor(service2) {
    this.service = service2;
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
        const md = await readStdinIfPiped();
        let out;
        if (md.trim()) {
          const data = await s.init(md, force);
          out = `\u5DF2\u521D\u59CB\u5316\u5DE5\u4F5C\u6D41: ${data.name} (${data.tasks.length} \u4E2A\u4EFB\u52A1)`;
        } else {
          out = await s.setup();
        }
        return out + "\n\n\u63D0\u793A: \u5EFA\u8BAE\u5148\u901A\u8FC7 /plugin \u5B89\u88C5\u63D2\u4EF6 superpowers\u3001frontend-design\u3001feature-dev\u3001code-review\u3001context7\uFF0C\u672A\u5B89\u88C5\u5219\u5B50Agent\u65E0\u6CD5\u4F7F\u7528\u4E13\u4E1A\u6280\u80FD\uFF0C\u529F\u80FD\u4F1A\u964D\u7EA7";
      }
      case "next": {
        if (rest.includes("--batch")) {
          const items = await s.nextBatch();
          if (!items.length) return "\u5168\u90E8\u5B8C\u6210";
          return formatBatch(items);
        }
        const result = await s.next();
        if (!result) return "\u5168\u90E8\u5B8C\u6210";
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
          const filePath = (0, import_path7.resolve)(rest[fileIdx + 1]);
          if ((0, import_path7.relative)(process.cwd(), filePath).startsWith("..")) throw new Error("--file \u8DEF\u5F84\u4E0D\u80FD\u8D85\u51FA\u9879\u76EE\u76EE\u5F55");
          detail = (0, import_fs3.readFileSync)(filePath, "utf-8");
        } else if (rest.length > 1 && fileIdx < 0 && filesIdx < 0) {
          detail = rest.slice(1).join(" ");
        } else {
          detail = await readStdinIfPiped();
        }
        return await s.checkpoint(id, detail.trim(), files);
      }
      case "skip": {
        const id = rest[0];
        if (!id) throw new Error("\u9700\u8981\u4EFB\u52A1ID");
        return await s.skip(id);
      }
      case "status": {
        const data = await s.status();
        if (!data) return "\u65E0\u6D3B\u8DC3\u5DE5\u4F5C\u6D41";
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
var USAGE = `\u7528\u6CD5: node flow.js [--verbose] <command>
  init [--force]       \u521D\u59CB\u5316\u5DE5\u4F5C\u6D41 (stdin\u4F20\u5165\u4EFB\u52A1markdown\uFF0C\u65E0stdin\u5219\u63A5\u7BA1\u9879\u76EE)
  next [--batch]       \u83B7\u53D6\u4E0B\u4E00\u4E2A\u5F85\u6267\u884C\u4EFB\u52A1 (--batch \u8FD4\u56DE\u6240\u6709\u53EF\u5E76\u884C\u4EFB\u52A1)
  checkpoint <id>      \u8BB0\u5F55\u4EFB\u52A1\u5B8C\u6210 [--file <path> | stdin | \u5185\u8054\u6587\u672C] [--files f1 f2 ...]
  skip <id>            \u624B\u52A8\u8DF3\u8FC7\u4EFB\u52A1
  review               \u6807\u8BB0code-review\u5DF2\u5B8C\u6210 (finish\u524D\u5FC5\u987B\u6267\u884C)
  finish               \u667A\u80FD\u6536\u5C3E (\u9A8C\u8BC1+\u603B\u7ED3+\u56DE\u5230\u5F85\u547D\uFF0C\u9700\u5148review)
  status               \u67E5\u770B\u5168\u5C40\u8FDB\u5EA6
  resume               \u4E2D\u65AD\u6062\u590D
  abort                \u4E2D\u6B62\u5DE5\u4F5C\u6D41\u5E76\u6E05\u7406 .workflow/ \u76EE\u5F55
  rollback <id>        \u56DE\u6EDA\u5230\u6307\u5B9A\u4EFB\u52A1\u7684\u5FEB\u7167 (git revert + \u91CD\u7F6E\u540E\u7EED\u4EFB\u52A1)
  add <\u63CF\u8FF0>           \u8FFD\u52A0\u4EFB\u52A1 [--type frontend|backend|general]

\u5168\u5C40\u9009\u9879:
  --verbose            \u8F93\u51FA\u8C03\u8BD5\u65E5\u5FD7 (\u7B49\u540C FLOWPILOT_VERBOSE=1)`;

// src/main.ts
configureLogger(process.cwd());
var repo = new FsWorkflowRepository(process.cwd());
var service = new WorkflowService(repo, parseTasksMarkdown);
var cli = new CLI(service);
cli.run(process.argv);
