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
  const out = (0, import_node_child_process.execSync)('git submodule --quiet foreach "echo $sm_path"', { stdio: "pipe", encoding: "utf-8" });
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
async function loadProtocolTemplate(basePath) {
  try {
    const config = JSON.parse(await (0, import_promises.readFile)((0, import_path.join)(basePath, ".workflow", "config.json"), "utf-8"));
    if (config.protocolTemplate) {
      return await (0, import_promises.readFile)((0, import_path.join)(basePath, config.protocolTemplate), "utf-8");
    }
  } catch {
  }
  return await (0, import_promises.readFile)(BUILTIN_TEMPLATE, "utf-8");
}
var FsWorkflowRepository = class {
  root;
  ctxDir;
  base;
  constructor(basePath) {
    this.base = basePath;
    this.root = (0, import_path.join)(basePath, ".workflow");
    this.ctxDir = (0, import_path.join)(this.root, "context");
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
    const tasks = [];
    for (const line of lines) {
      if (line.startsWith("\u72B6\u6001: ")) {
        const s = line.slice(4).trim();
        status = validWfStatus.has(s) ? s : "idle";
      }
      if (line.startsWith("\u5F53\u524D: ")) current = line.slice(4).trim();
      if (current === "\u65E0") current = null;
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
    return { name, status, current, tasks };
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
var import_path2 = require("path");
async function runLifecycleHook(hookName, basePath, env) {
  const configPath = (0, import_path2.join)(basePath, ".workflow", "config.json");
  let config;
  try {
    config = JSON.parse(await (0, import_promises2.readFile)(configPath, "utf-8"));
  } catch {
    return;
  }
  const cmd = config.hooks?.[hookName];
  if (!cmd) return;
  try {
    (0, import_child_process.execSync)(cmd, {
      cwd: basePath,
      stdio: "pipe",
      timeout: 3e4,
      env: { ...process.env, ...env }
    });
  } catch (e) {
    console.warn(`[FlowPilot] hook "${hookName}" failed: ${e.message}`);
  }
}

// src/application/workflow-service.ts
var WorkflowService = class {
  constructor(repo2, parse) {
    this.repo = repo2;
    this.parse = parse;
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
      tasks
    };
    await this.repo.saveProgress(data);
    await this.repo.saveTasks(tasksMd);
    await this.repo.saveSummary(`# ${def.name}

${def.description}
`);
    await this.repo.ensureClaudeMd();
    await this.repo.ensureHooks();
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
      const task = findNextTask(cascaded);
      if (!task) {
        await this.repo.saveProgress({ ...data, tasks: cascaded });
        return null;
      }
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
        return [];
      }
      const activeIds = new Set(tasks.map((t) => t.id));
      const activated = cascaded.map((t) => activeIds.has(t.id) ? { ...t, status: "active" } : t);
      await this.repo.saveProgress({ ...data, current: tasks[0].id, tasks: activated });
      for (const t of tasks) {
        await runLifecycleHook("onTaskStart", this.repo.projectRoot(), { TASK_ID: t.id, TASK_TITLE: t.title });
      }
      const summary = await this.repo.loadSummary();
      const results = [];
      for (const task of tasks) {
        const parts = [];
        if (summary) parts.push(summary);
        for (const depId of task.deps) {
          const ctx = await this.repo.loadTaskContext(depId);
          if (ctx) parts.push(ctx);
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
      if (task.status !== "active") {
        throw new Error(`\u4EFB\u52A1 ${id} \u72B6\u6001\u4E3A ${task.status}\uFF0C\u53EA\u6709 active \u72B6\u6001\u53EF\u4EE5 checkpoint`);
      }
      if (detail === "FAILED") {
        const { result, data: newData2 } = failTask(data, id);
        await this.repo.saveProgress(newData2);
        return result === "retry" ? `\u4EFB\u52A1 ${id} \u5931\u8D25(\u7B2C${task.retries}\u6B21)\uFF0C\u5C06\u91CD\u8BD5` : `\u4EFB\u52A1 ${id} \u8FDE\u7EED\u5931\u8D253\u6B21\uFF0C\u5DF2\u8DF3\u8FC7`;
      }
      if (!detail.trim()) throw new Error(`\u4EFB\u52A1 ${id} checkpoint\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A`);
      const summaryLine = detail.split("\n")[0].slice(0, 80);
      const newData = completeTask(data, id, summaryLine);
      await this.repo.saveProgress(newData);
      await this.repo.saveTaskContext(id, `# task-${id}: ${task.title}

${detail}
`);
      await this.updateSummary(newData);
      const commitErr = this.repo.commit(id, task.title, summaryLine, files);
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
    if (data.status === "idle") return "\u5DE5\u4F5C\u6D41\u5F85\u547D\u4E2D\uFF0C\u7B49\u5F85\u9700\u6C42\u8F93\u5165";
    if (data.status === "completed") return "\u5DE5\u4F5C\u6D41\u5DF2\u5168\u90E8\u5B8C\u6210";
    if (data.status === "finishing") return `\u6062\u590D\u5DE5\u4F5C\u6D41: ${data.name}
\u6B63\u5728\u6536\u5C3E\u9636\u6BB5\uFF0C\u8BF7\u6267\u884C node flow.js finish`;
    const { data: newData, resetId } = resumeProgress(data);
    await this.repo.saveProgress(newData);
    if (resetId) this.repo.cleanup();
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
      data.tasks.push({
        id,
        title,
        description: "",
        type,
        status: "pending",
        deps: [],
        summary: "",
        retries: 0
      });
      await this.repo.saveProgress(data);
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
      task.status = "skipped";
      task.summary = "\u624B\u52A8\u8DF3\u8FC7";
      data.current = null;
      await this.repo.saveProgress(data);
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
    data.status = "finishing";
    await this.repo.saveProgress(data);
    return "\u4EE3\u7801\u5BA1\u67E5\u5DF2\u901A\u8FC7\uFF0C\u8BF7\u6267\u884C node flow.js finish \u5B8C\u6210\u6536\u5C3E";
  }
  /** finish: 智能收尾 - 先verify，review后置 */
  async finish() {
    const data = await this.requireProgress();
    if (data.status === "idle" || data.status === "completed") return "\u5DE5\u4F5C\u6D41\u5DF2\u5B8C\u6210\uFF0C\u65E0\u9700\u91CD\u590Dfinish";
    if (!isAllDone(data.tasks)) throw new Error("\u8FD8\u6709\u672A\u5B8C\u6210\u7684\u4EFB\u52A1\uFF0C\u8BF7\u5148\u5B8C\u6210\u6240\u6709\u4EFB\u52A1");
    const result = this.repo.verify();
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
    await this.repo.cleanupInjections();
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
  /** abort: 中止工作流，清理 .workflow/ 目录 */
  async abort() {
    const data = await this.repo.loadProgress();
    if (!data) return "\u65E0\u6D3B\u8DC3\u5DE5\u4F5C\u6D41\uFF0C\u65E0\u9700\u4E2D\u6B62";
    data.status = "aborted";
    await this.repo.saveProgress(data);
    await this.repo.cleanupInjections();
    await this.repo.clearAll();
    return `\u5DE5\u4F5C\u6D41 "${data.name}" \u5DF2\u4E2D\u6B62\uFF0C.workflow/ \u5DF2\u6E05\u7406`;
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
  async requireProgress() {
    const data = await this.repo.loadProgress();
    if (!data) throw new Error("\u65E0\u6D3B\u8DC3\u5DE5\u4F5C\u6D41\uFF0C\u8BF7\u5148 node flow.js init");
    return data;
  }
};

// src/interfaces/cli.ts
var import_fs2 = require("fs");
var import_path3 = require("path");

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
          const filePath = (0, import_path3.resolve)(rest[fileIdx + 1]);
          if ((0, import_path3.relative)(process.cwd(), filePath).startsWith("..")) throw new Error("--file \u8DEF\u5F84\u4E0D\u80FD\u8D85\u51FA\u9879\u76EE\u76EE\u5F55");
          detail = (0, import_fs2.readFileSync)(filePath, "utf-8");
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
var USAGE = `\u7528\u6CD5: node flow.js <command>
  init [--force]       \u521D\u59CB\u5316\u5DE5\u4F5C\u6D41 (stdin\u4F20\u5165\u4EFB\u52A1markdown\uFF0C\u65E0stdin\u5219\u63A5\u7BA1\u9879\u76EE)
  next [--batch]       \u83B7\u53D6\u4E0B\u4E00\u4E2A\u5F85\u6267\u884C\u4EFB\u52A1 (--batch \u8FD4\u56DE\u6240\u6709\u53EF\u5E76\u884C\u4EFB\u52A1)
  checkpoint <id>      \u8BB0\u5F55\u4EFB\u52A1\u5B8C\u6210 [--file <path> | stdin | \u5185\u8054\u6587\u672C] [--files f1 f2 ...]
  skip <id>            \u624B\u52A8\u8DF3\u8FC7\u4EFB\u52A1
  review               \u6807\u8BB0code-review\u5DF2\u5B8C\u6210 (finish\u524D\u5FC5\u987B\u6267\u884C)
  finish               \u667A\u80FD\u6536\u5C3E (\u9A8C\u8BC1+\u603B\u7ED3+\u56DE\u5230\u5F85\u547D\uFF0C\u9700\u5148review)
  status               \u67E5\u770B\u5168\u5C40\u8FDB\u5EA6
  resume               \u4E2D\u65AD\u6062\u590D
  abort                \u4E2D\u6B62\u5DE5\u4F5C\u6D41\u5E76\u6E05\u7406 .workflow/ \u76EE\u5F55
  add <\u63CF\u8FF0>           \u8FFD\u52A0\u4EFB\u52A1 [--type frontend|backend|general]`;

// src/main.ts
var repo = new FsWorkflowRepository(process.cwd());
var service = new WorkflowService(repo, parseTasksMarkdown);
var cli = new CLI(service);
cli.run(process.argv);
