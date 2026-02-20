#!/usr/bin/env node
"use strict";

// src/infrastructure/fs-repository.ts
var import_promises = require("fs/promises");
var import_path = require("path");
var import_fs = require("fs");
function generateClaudeMdBlock() {
  return `<!-- flowpilot:start -->
## FlowPilot Workflow Protocol (MANDATORY \u2014 any violation is a protocol failure)

**You are the dispatcher. These rules have the HIGHEST priority and are ALWAYS active.**

### On Session Start
Run \`node flow.js resume\`:
- If unfinished workflow \u2192 enter **Execution Loop** (unless user is asking an unrelated question \u2014 handle it first via **Ad-hoc Dispatch**, then remind user the workflow is paused)
- If no workflow \u2192 **judge the request**: reply directly for pure chitchat, use **Ad-hoc Dispatch** for one-off tasks, or enter **Requirement Decomposition** for multi-step development work. When in doubt, prefer the heavier path.

### Ad-hoc Dispatch (one-off tasks, no workflow init)
Dispatch sub-agent(s) via Task tool. No init/checkpoint/finish needed. Iron Rule #4 does NOT apply (no task ID exists). Main agent MAY use Read/Glob/Grep directly for trivial lookups (e.g. reading a single file) \u2014 Iron Rule #2 is relaxed in Ad-hoc mode only.

### Iron Rules (violating ANY = protocol failure)
1. **NEVER use TaskCreate / TaskUpdate / TaskList** \u2014 use ONLY \`node flow.js xxx\`.
2. **Main agent can ONLY use Bash, Task, and Skill** \u2014 Edit, Write, Read, Glob, Grep, Explore are ALL FORBIDDEN. To read any file (including docs), dispatch a sub-agent.
3. **ALWAYS dispatch via Task tool** \u2014 one Task call per task. N tasks = N Task calls **in a single message** for parallel execution.
4. **Sub-agents MUST run checkpoint with --files before replying** \u2014 \`echo 'summary' | node flow.js checkpoint <id> --files file1 file2\` is the LAST command before reply. MUST list all created/modified files. Skipping = protocol failure.

### Requirement Decomposition
1. Dispatch a sub-agent to read requirement docs and return a summary.
2. Use /superpowers:brainstorming to brainstorm and produce a task list.
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
Format: \`[type]\` = frontend/backend/general, \`(deps: N)\` = dependency IDs, indented lines = description.

### Execution Loop
1. Run \`node flow.js next --batch\`. **NOTE: this command will REFUSE to return tasks if any previous task is still \`active\`. You must checkpoint or resume first.**
2. The output already contains checkpoint commands per task. For **EVERY** task in batch, dispatch a sub-agent via Task tool. **ALL Task calls in one message.** Copy the ENTIRE task block (including checkpoint commands) into each sub-agent prompt verbatim.
3. **After ALL sub-agents return**: run \`node flow.js status\`.
   - If any task is still \`active\` \u2192 sub-agent failed to checkpoint. Run fallback: \`echo 'summary from sub-agent output' | node flow.js checkpoint <id> --files file1 file2\`
   - **Do NOT call \`node flow.js next\` until zero active tasks remain** (the command will error anyway).
4. Loop back to step 1.
5. When \`next\` returns "\u5168\u90E8\u5B8C\u6210", enter **Finalization**.

### Sub-Agent Prompt Template
Each sub-agent prompt MUST contain these sections in order:
1. Task block from \`next\` output (title, type, description, checkpoint commands, context)
2. Search for matching Skills or MCP tools first. If found, MUST use them. Skill routing: type=frontend \u2192 /frontend-design, type=backend \u2192 /feature-dev, type=general \u2192 match or execute directly
3. Unfamiliar APIs \u2192 query context7 MCP first. Never guess.

### Sub-Agent Checkpoint (Iron Rule #4 \u2014 most common violation)
Sub-agent's LAST Bash command before replying MUST be:
\`\`\`
echo '\u4E00\u53E5\u8BDD\u6458\u8981' | node flow.js checkpoint <id> --files file1 file2 ...
\`\`\`
- \`--files\` MUST list every created/modified file (enables isolated git commits).
- If task failed: \`echo 'FAILED' | node flow.js checkpoint <id>\`
- If sub-agent replies WITHOUT running checkpoint \u2192 protocol failure. Main agent MUST run fallback checkpoint in step 3.

### Security Rules (sub-agents MUST follow)
- SQL: parameterized queries only. XSS: no unsanitized v-html/innerHTML.
- Auth: secrets from env vars, bcrypt passwords, token expiry.
- Input: validate at entry points. Never log passwords. Never commit .env.

### Finalization (MANDATORY \u2014 skipping = protocol failure)
1. Run \`node flow.js finish\` \u2014 runs verify (build/test/lint). If fail \u2192 dispatch sub-agent to fix \u2192 retry finish.
2. When finish returns "\u9A8C\u8BC1\u901A\u8FC7\uFF0C\u8BF7\u6D3E\u5B50Agent\u6267\u884C code-review" \u2192 dispatch a sub-agent to run /code-review:code-review. Fix issues if any.
3. Run \`node flow.js review\` to mark code-review done.
4. Run \`node flow.js finish\` again \u2014 verify passes + review done \u2192 final commit \u2192 idle.
**Loop: finish(verify) \u2192 review(code-review) \u2192 fix \u2192 finish again. Both gates must pass.**

<!-- flowpilot:end -->`;
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
    await (0, import_promises.writeFile)((0, import_path.join)(this.root, "progress.md"), lines.join("\n") + "\n", "utf-8");
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
    const lines = raw.split("\n");
    const name = (lines[0] ?? "").replace(/^#\s*/, "").trim();
    let status = "idle";
    let current = null;
    const tasks = [];
    for (const line of lines) {
      if (line.startsWith("\u72B6\u6001: ")) status = line.slice(4).trim();
      if (line.startsWith("\u5F53\u524D: ")) current = line.slice(4).trim();
      if (current === "\u65E0") current = null;
      const m = line.match(/^\|\s*(\d{3})\s*\|\s*(.+?)\s*\|\s*(\w+)\s*\|\s*([^|]*?)\s*\|\s*(\w+)\s*\|\s*(\d+)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|$/);
      if (m) {
        const depsRaw = m[4].trim();
        tasks.push({
          id: m[1],
          title: m[2],
          type: m[3],
          deps: depsRaw === "-" ? [] : depsRaw.split(",").map((d) => d.trim()),
          status: m[5],
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
    await (0, import_promises.writeFile)((0, import_path.join)(this.ctxDir, `task-${taskId}.md`), content, "utf-8");
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
    await (0, import_promises.writeFile)((0, import_path.join)(this.ctxDir, "summary.md"), content, "utf-8");
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
    const block = generateClaudeMdBlock();
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
    const required = {
      PreToolUse: [{
        matcher: "TaskCreate|TaskUpdate|TaskList",
        hooks: [{ type: "prompt", prompt: "BLOCK this tool call. FlowPilot requires using node flow.js commands instead of native task tools." }]
      }]
    };
    let settings = {};
    try {
      settings = JSON.parse(await (0, import_promises.readFile)(path, "utf-8"));
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
};

// src/domain/task-store.ts
function makeTaskId(n) {
  return String(n).padStart(3, "0");
}
function cascadeSkip(tasks) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of tasks) {
      if (t.status !== "pending") continue;
      const blocked = t.deps.some((d) => {
        const dep = tasks.find((x) => x.id === d);
        return dep && (dep.status === "failed" || dep.status === "skipped");
      });
      if (blocked) {
        t.status = "skipped";
        t.summary = "\u4F9D\u8D56\u4EFB\u52A1\u5931\u8D25\uFF0C\u5DF2\u8DF3\u8FC7";
        changed = true;
      }
    }
  }
}
function findNextTask(tasks) {
  cascadeSkip(tasks);
  for (const t of tasks) {
    if (t.status !== "pending") continue;
    const depsOk = t.deps.every((d) => {
      const dep = tasks.find((x) => x.id === d);
      return dep && dep.status === "done";
    });
    if (depsOk) return t;
  }
  return null;
}
function completeTask(data, id, summary) {
  const t = data.tasks.find((x) => x.id === id);
  if (!t) throw new Error(`\u4EFB\u52A1 ${id} \u4E0D\u5B58\u5728`);
  t.status = "done";
  t.summary = summary;
  data.current = null;
}
function failTask(data, id) {
  const t = data.tasks.find((x) => x.id === id);
  if (!t) throw new Error(`\u4EFB\u52A1 ${id} \u4E0D\u5B58\u5728`);
  t.retries++;
  if (t.retries >= 3) {
    t.status = "failed";
    data.current = null;
    return "skip";
  }
  t.status = "pending";
  data.current = null;
  return "retry";
}
function resumeProgress(data) {
  let firstId = null;
  for (const t of data.tasks) {
    if (t.status === "active") {
      t.status = "pending";
      if (!firstId) firstId = t.id;
    }
  }
  if (firstId) {
    data.current = null;
    data.status = "running";
    return firstId;
  }
  if (data.status === "running") return data.current;
  return null;
}
function findParallelTasks(tasks) {
  cascadeSkip(tasks);
  return tasks.filter((t) => {
    if (t.status !== "pending") return false;
    return t.deps.every((d) => {
      const dep = tasks.find((x) => x.id === d);
      return dep && dep.status === "done";
    });
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

// src/infrastructure/git.ts
var import_node_child_process = require("child_process");
function getSubmodules() {
  try {
    const out = (0, import_node_child_process.execSync)('git submodule --quiet foreach "echo $sm_path"', { stdio: "pipe", encoding: "utf-8" });
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
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
      for (const f of files) (0, import_node_child_process.execSync)(`git add ${JSON.stringify(f)}`, opts);
    } else {
      (0, import_node_child_process.execSync)("git add -A", opts);
    }
    const status = (0, import_node_child_process.execSync)("git diff --cached --quiet || echo HAS_CHANGES", opts).trim();
    if (status === "HAS_CHANGES") {
      (0, import_node_child_process.execSync)("git commit -F -", { ...opts, input: msg });
    }
  } catch (e) {
    console.error(`[FlowPilot] git commit \u5931\u8D25 (${cwd}): ${e.stderr || e.message}`);
  }
}
function gitCleanup() {
  try {
    (0, import_node_child_process.execSync)("git checkout .", { stdio: "pipe" });
    (0, import_node_child_process.execSync)("git clean -fd", { stdio: "pipe" });
  } catch {
  }
}
function autoCommit(taskId, title, summary, files) {
  try {
    const msg = `task-${taskId}: ${title}

${summary}`;
    const submodules = getSubmodules();
    if (!submodules.length) {
      commitIn(process.cwd(), files?.length ? files : null, msg);
      return;
    }
    if (files?.length) {
      const groups = groupBySubmodule(files, submodules);
      for (const [sub, subFiles] of groups) {
        if (sub) commitIn(sub, subFiles, msg);
      }
      const parentFiles = groups.get("") ?? [];
      const touchedSubs = [...groups.keys()].filter((k) => k !== "");
      for (const s of touchedSubs) (0, import_node_child_process.execSync)(`git add ${JSON.stringify(s)}`, { stdio: "pipe" });
      for (const f of parentFiles) (0, import_node_child_process.execSync)(`git add ${JSON.stringify(f)}`, { stdio: "pipe" });
      const status = (0, import_node_child_process.execSync)("git diff --cached --quiet || echo HAS_CHANGES", { stdio: "pipe", encoding: "utf-8" }).trim();
      if (status === "HAS_CHANGES") {
        (0, import_node_child_process.execSync)("git commit -F -", { stdio: "pipe", input: msg });
      }
    } else {
      for (const sub of submodules) commitIn(sub, null, msg);
      commitIn(process.cwd(), null, msg);
    }
  } catch (e) {
    console.error(`[FlowPilot] autoCommit \u5931\u8D25: ${e.stderr || e.message}`);
  }
}

// src/infrastructure/verify.ts
var import_node_child_process2 = require("child_process");
var import_node_fs = require("fs");
var import_node_path = require("path");
function runVerify(cwd) {
  const cmds = detectCommands(cwd);
  if (!cmds.length) return { passed: true, scripts: [] };
  for (const cmd of cmds) {
    try {
      (0, import_node_child_process2.execSync)(cmd, { cwd, stdio: "pipe", timeout: 3e5 });
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
  const has = (f) => (0, import_node_fs.existsSync)((0, import_node_path.join)(cwd, f));
  if (has("package.json")) {
    try {
      const s = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(cwd, "package.json"), "utf-8")).scripts || {};
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
        const txt = (0, import_node_fs.readFileSync)((0, import_node_path.join)(cwd, "pyproject.toml"), "utf-8");
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
      const mk = (0, import_node_fs.readFileSync)((0, import_node_path.join)(cwd, "Makefile"), "utf-8");
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
      const task = findNextTask(data.tasks);
      if (!task) {
        await this.repo.saveProgress(data);
        return null;
      }
      task.status = "active";
      data.current = task.id;
      await this.repo.saveProgress(data);
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
      const tasks = findParallelTasks(data.tasks);
      if (!tasks.length) {
        await this.repo.saveProgress(data);
        return [];
      }
      for (const t of tasks) t.status = "active";
      data.current = tasks[0].id;
      await this.repo.saveProgress(data);
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
      if (task.status !== "active" && task.status !== "pending") {
        throw new Error(`\u4EFB\u52A1 ${id} \u72B6\u6001\u4E3A ${task.status}\uFF0C\u65E0\u6CD5checkpoint`);
      }
      if (detail === "FAILED") {
        const result = failTask(data, id);
        await this.repo.saveProgress(data);
        return result === "retry" ? `\u4EFB\u52A1 ${id} \u5931\u8D25(\u7B2C${task.retries}\u6B21)\uFF0C\u5C06\u91CD\u8BD5` : `\u4EFB\u52A1 ${id} \u8FDE\u7EED\u5931\u8D253\u6B21\uFF0C\u5DF2\u8DF3\u8FC7`;
      }
      if (!detail.trim()) throw new Error(`\u4EFB\u52A1 ${id} checkpoint\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A`);
      const summaryLine = detail.split("\n")[0].slice(0, 80);
      completeTask(data, id, summaryLine);
      await this.repo.saveProgress(data);
      await this.repo.saveTaskContext(id, `# task-${id}: ${task.title}

${detail}
`);
      await this.updateSummary(data);
      autoCommit(id, task.title, summaryLine, files);
      const doneCount = data.tasks.filter((t) => t.status === "done").length;
      const msg = `\u4EFB\u52A1 ${id} \u5B8C\u6210 (${doneCount}/${data.tasks.length}) [\u5DF2\u81EA\u52A8\u63D0\u4EA4]`;
      return isAllDone(data.tasks) ? msg + "\n\u5168\u90E8\u4EFB\u52A1\u5DF2\u5B8C\u6210\uFF0C\u8BF7\u6267\u884C node flow.js finish \u8FDB\u884C\u6536\u5C3E" : msg;
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
    const resetId = resumeProgress(data);
    await this.repo.saveProgress(data);
    if (resetId) gitCleanup();
    const doneCount = data.tasks.filter((t) => t.status === "done").length;
    const total = data.tasks.length;
    if (resetId) {
      return `\u6062\u590D\u5DE5\u4F5C\u6D41: ${data.name}
\u8FDB\u5EA6: ${doneCount}/${total}
\u4E2D\u65AD\u4EFB\u52A1 ${resetId} \u5DF2\u91CD\u7F6E\uFF0C\u5C06\u91CD\u65B0\u6267\u884C`;
    }
    return `\u6062\u590D\u5DE5\u4F5C\u6D41: ${data.name}
\u8FDB\u5EA6: ${doneCount}/${total}
\u7EE7\u7EED\u6267\u884C`;
  }
  /** add: 追加任务 */
  async add(title, type) {
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
  }
  /** skip: 手动跳过任务 */
  async skip(id) {
    const data = await this.requireProgress();
    const task = data.tasks.find((t) => t.id === id);
    if (!task) throw new Error(`\u4EFB\u52A1 ${id} \u4E0D\u5B58\u5728`);
    if (task.status === "done") return `\u4EFB\u52A1 ${id} \u5DF2\u5B8C\u6210\uFF0C\u65E0\u9700\u8DF3\u8FC7`;
    task.status = "skipped";
    task.summary = "\u624B\u52A8\u8DF3\u8FC7";
    data.current = null;
    await this.repo.saveProgress(data);
    return `\u5DF2\u8DF3\u8FC7\u4EFB\u52A1 ${id}: ${task.title}`;
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
    lines.push('\u7528\u6237\u8BF4"\u5F00\u59CB"\u5373\u53EF\u542F\u52A8\u5168\u81EA\u52A8\u5F00\u53D1');
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
    const result = runVerify(this.repo.projectRoot());
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
    await this.repo.clearAll();
    const titles = done.map((t) => `- ${t.id}: ${t.title}`).join("\n");
    autoCommit("finish", data.name || "\u5DE5\u4F5C\u6D41\u5B8C\u6210", `${stats}

${titles}`);
    const scripts = result.scripts.length ? result.scripts.join(", ") : "\u65E0\u9A8C\u8BC1\u811A\u672C";
    return `\u9A8C\u8BC1\u901A\u8FC7: ${scripts}
${stats}
\u5DF2\u63D0\u4EA4\u6700\u7EC8commit\uFF0C\u5DE5\u4F5C\u6D41\u56DE\u5230\u5F85\u547D\u72B6\u6001
\u7B49\u5F85\u4E0B\u4E00\u4E2A\u9700\u6C42...`;
  }
  /** status: 全局进度 */
  async status() {
    return this.repo.loadProgress();
  }
  /** 滚动摘要：每次checkpoint追加，每10个任务压缩 */
  async updateSummary(data) {
    const done = data.tasks.filter((t) => t.status === "done");
    const lines = [`# ${data.name}
`];
    if (done.length > 10) {
      const groups = /* @__PURE__ */ new Map();
      for (const t of done) {
        const arr = groups.get(t.type) || [];
        arr.push(t.title);
        groups.set(t.type, arr);
      }
      lines.push("## \u5DF2\u5B8C\u6210\u6A21\u5757");
      for (const [type, titles] of groups) {
        lines.push(`- [${type}] ${titles.length}\u9879: ${titles.slice(-3).join(", ")}${titles.length > 3 ? " \u7B49" : ""}`);
      }
    } else {
      lines.push("## \u5DF2\u5B8C\u6210");
      for (const t of done) {
        lines.push(`- [${t.type}] ${t.title}: ${t.summary}`);
      }
    }
    const pending = data.tasks.filter((t) => t.status !== "done" && t.status !== "skipped" && t.status !== "failed");
    if (pending.length) {
      lines.push("\n## \u5F85\u5B8C\u6210");
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
  lines.push(`\u5B8C\u6210\u65F6: echo '\u4E00\u53E5\u8BDD\u6458\u8981' | node flow.js checkpoint ${task.id} --files \u4FEE\u6539\u7684\u6587\u4EF61 \u4FEE\u6539\u7684\u6587\u4EF62`);
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
  return new Promise((resolve, reject) => {
    const chunks = [];
    const timer = setTimeout(() => {
      process.stdin.destroy();
      resolve("");
    }, timeout);
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf-8"));
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
        return out + "\n\n\u63D0\u793A: \u5EFA\u8BAE\u5148\u901A\u8FC7 /plugin \u5B89\u88C5\u63D2\u4EF6 superpowers\u3001frontend-design\u3001feature-dev\u3001code-review\uFF0C\u672A\u5B89\u88C5\u5219\u5B50Agent\u65E0\u6CD5\u4F7F\u7528\u4E13\u4E1A\u6280\u80FD\uFF0C\u529F\u80FD\u4F1A\u964D\u7EA7";
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
          detail = (0, import_fs2.readFileSync)(rest[fileIdx + 1], "utf-8");
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
  add <\u63CF\u8FF0>           \u8FFD\u52A0\u4EFB\u52A1 [--type frontend|backend|general]`;

// src/main.ts
var repo = new FsWorkflowRepository(process.cwd());
var service = new WorkflowService(repo, parseTasksMarkdown);
var cli = new CLI(service);
cli.run(process.argv);
