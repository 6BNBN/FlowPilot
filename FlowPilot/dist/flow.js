#!/usr/bin/env node
"use strict";

// src/infrastructure/fs-repository.ts
var import_promises = require("fs/promises");
var import_path = require("path");
var import_fs = require("fs");
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
  // --- protocol.md / tasks.md ---
  async saveProtocol(content) {
    await this.ensure(this.root);
    await (0, import_promises.writeFile)((0, import_path.join)(this.root, "protocol.md"), content, "utf-8");
  }
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
    const ref = "\u9075\u5FAA .workflow/protocol.md \u5DE5\u4F5C\u6D41\u8C03\u5EA6\u534F\u8BAE";
    try {
      const content = await (0, import_promises.readFile)(path, "utf-8");
      if (content.includes(ref)) return false;
      await (0, import_promises.writeFile)(path, content.trimEnd() + "\n\n" + ref + "\n", "utf-8");
    } catch {
      await (0, import_promises.writeFile)(path, "# Project\n\n" + ref + "\n", "utf-8");
    }
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

// src/application/protocol-generator.ts
function generateProtocol(projectName) {
  return `# \u5DE5\u4F5C\u6D41\u8C03\u5EA6\u534F\u8BAE

\u4F60\u662F\u8C03\u5EA6\u5668\uFF0C\u4E25\u683C\u9075\u5FAA\u4EE5\u4E0B\u89C4\u5219\u3002\u4E0D\u8981\u81EA\u5DF1\u5199\u4EE3\u7801\uFF0C\u5168\u90E8\u4EA4\u7ED9\u5B50Agent\u3002

## \u524D\u7F6E\u6761\u4EF6\uFF08\u9996\u6B21\u542F\u52A8\u65F6\u68C0\u67E5\uFF09

### 1. Agent Teams \u529F\u80FD\uFF08\u5FC5\u987B\uFF09

\u672C\u5DE5\u4F5C\u6D41\u4F9D\u8D56 Agent Teams\uFF08\u5B50Agent\u5E76\u884C\u6D3E\u53D1\uFF09\u529F\u80FD\u3002\u8BF7\u786E\u8BA4\u5DF2\u5F00\u542F\uFF1A
- \u8BBE\u7F6E\u8DEF\u5F84\uFF1AClaude Code \u2192 Settings \u2192 Feature Flags \u2192 Agent Teams \u2192 \u5F00\u542F
- \u5982\u679C\u672A\u5F00\u542F\uFF0C**\u7ACB\u5373\u505C\u6B62**\u5E76\u63D0\u793A\u7528\u6237\uFF1A
  "\u8BF7\u5148\u5F00\u542F Agent Teams \u529F\u80FD\uFF1ASettings \u2192 Feature Flags \u2192 Agent Teams\uFF0C\u7136\u540E\u91CD\u65B0\u8BF4'\u5F00\u59CB'"

### 2. \u63D2\u4EF6\u68C0\u6D4B

\u786E\u8BA4\u4EE5\u4E0B\u63D2\u4EF6\u5DF2\u5B89\u88C5\uFF1A
- superpowers\uFF08\u5934\u8111\u98CE\u66B4\u62C6\u89E3\u4EFB\u52A1\uFF09
- frontend-design\uFF08\u524D\u7AEF\u4EFB\u52A1\uFF09
- feature-dev\uFF08\u540E\u7AEF\u4EFB\u52A1\uFF09
- code-review:code-review\uFF08\u6536\u5C3E\u5BA1\u67E5\uFF09

\u5982\u679C\u7F3A\u5C11\u63D2\u4EF6\uFF0C\u63D0\u793A\u7528\u6237\u5B89\u88C5\u540E\u518D\u7EE7\u7EED\u3002

## \u542F\u52A8\u89C4\u5219

\u5F53\u7528\u6237\u8BF4"\u5F00\u59CB"\u65F6\uFF1A
1. \u6267\u884C \`node flow.js resume\` \u68C0\u67E5\u662F\u5426\u6709\u672A\u5B8C\u6210\u5DE5\u4F5C\u6D41
2. \u5982\u679C\u6709 \u2192 \u4ECE\u4E2D\u65AD\u70B9\u7EE7\u7EED\u6267\u884C\u5FAA\u73AF
3. \u5982\u679C\u6CA1\u6709 \u2192 \u8BE2\u95EE\u7528\u6237\u63D0\u4F9B\u9700\u6C42\u6587\u6863\u6216\u63CF\u8FF0\u9700\u6C42

## \u9700\u6C42\u62C6\u89E3\u89C4\u5219

\u6536\u5230\u9700\u6C42\u540E\uFF1A
1. \u8C03\u7528 /superpowers:brainstorming \u8FDB\u884C\u5934\u8111\u98CE\u66B4
2. \u5C06\u7ED3\u679C\u6574\u7406\u4E3A\u4EFB\u52A1\u5217\u8868\uFF0C\u6BCF\u4E2A\u4EFB\u52A1\u6807\u6CE8\u7C7B\u578B(frontend/backend/general)\u548C\u4F9D\u8D56
3. \u7528 \`node flow.js init\` \u5199\u5165\u4EFB\u52A1\u6811\uFF08\u901A\u8FC7stdin\u4F20\u5165markdown\uFF09
4. \u5C55\u793A\u4EFB\u52A1\u6811\u7ED9\u7528\u6237\u786E\u8BA4

## \u6267\u884C\u5FAA\u73AF

\u91CD\u590D\u4EE5\u4E0B\u6B65\u9AA4\u76F4\u5230 node flow.js next \u8FD4\u56DE"\u5168\u90E8\u5B8C\u6210"\uFF1A

### \u5E76\u884C\u6A21\u5F0F\uFF08\u4F18\u5148\uFF09
1. \u6267\u884C \`node flow.js next --batch\` \u83B7\u53D6\u6240\u6709\u53EF\u5E76\u884C\u7684\u4EFB\u52A1
2. \u5BF9\u6BCF\u4E2A\u4EFB\u52A1\uFF0C\u7528 Task \u5DE5\u5177\u5728\u540C\u4E00\u6761\u6D88\u606F\u4E2D\u5E76\u884C\u6D3E\u53D1\u5B50Agent
3. \u5B50Agent\u81EA\u884C\u6267\u884C checkpoint\uFF08\u89C1\u6D3E\u53D1\u89C4\u5219\uFF09\uFF0C\u4E3BAgent\u65E0\u9700\u4EE3\u52B3
4. \u6240\u6709\u5B50Agent\u8FD4\u56DE\u540E\uFF0C\u6267\u884C \`node flow.js status\` \u786E\u8BA4\u8FDB\u5EA6\uFF0C\u7EE7\u7EED\u5FAA\u73AF

### \u4E32\u884C\u6A21\u5F0F\uFF08\u56DE\u9000\uFF09
1. \u6267\u884C \`node flow.js next\` \u83B7\u53D6\u5355\u4E2A\u4EFB\u52A1
2. \u540C\u6837\u5FC5\u987B\u7528 Task \u5DE5\u5177\u6D3E\u53D1\u5B50Agent\u6267\u884C\uFF0C**\u7981\u6B62\u4E3BAgent\u81EA\u5DF1\u6267\u884C\u4EFB\u52A1**
3. \u5B50Agent\u81EA\u884Ccheckpoint\uFF0C\u4E3BAgent\u7B49\u5F85\u8FD4\u56DE\u540E\u7EE7\u7EED\u5FAA\u73AF

### \u5B50Agent\u6D3E\u53D1\u89C4\u5219
\u5B50Agent\u7684prompt\u5FC5\u987B\u5305\u542B\u4EE5\u4E0B\u5185\u5BB9\uFF1A
1. flow next \u8F93\u51FA\u7684\u300C\u4E0A\u4E0B\u6587\u300D\u90E8\u5206\uFF08\u5B50Agent\u7684\u8BB0\u5FC6\u6765\u6E90\uFF09
2. \u4EFB\u52A1\u63CF\u8FF0
3. \u63D2\u4EF6\u6307\u4EE4\uFF1A
   - type=frontend \u2192 "\u8C03\u7528 /frontend-design \u63D2\u4EF6"
   - type=backend \u2192 "\u8C03\u7528 /feature-dev \u63D2\u4EF6"
   - type=general \u2192 \u76F4\u63A5\u6267\u884C
4. **\u81EA\u884Ccheckpoint\u6307\u4EE4**\uFF1A
   "\u4EFB\u52A1\u5B8C\u6210\u540E\uFF0C\u6267\u884C\u4EE5\u4E0B\u547D\u4EE4\u8BB0\u5F55\u6210\u679C\uFF08\u5C06\u6458\u8981\u901A\u8FC7stdin\u4F20\u5165\uFF09\uFF1A
   echo '\u4F60\u7684\u4EA7\u51FA\u6458\u8981\uFF08\u4FEE\u6539\u4E86\u54EA\u4E9B\u6587\u4EF6\u3001\u5173\u952E\u51B3\u7B56\uFF09' | node flow.js checkpoint <id>
   \u5982\u679C\u5931\u8D25\u5219\u6267\u884C\uFF1Anode flow.js checkpoint <id> FAILED"

\u91CD\u8981\uFF1A\u5B50Agent\u81EA\u884Ccheckpoint\u540E\uFF0C\u8FD4\u56DE\u7ED9\u4E3BAgent\u7684\u6D88\u606F\u53EA\u9700\u4E00\u53E5\u8BDD\u786E\u8BA4\u5373\u53EF\u3002
\u8FD9\u6837\u4E3BAgent\u4E0A\u4E0B\u6587\u4E0D\u4F1A\u56E0\u5B50Agent\u4EA7\u51FA\u800C\u81A8\u80C0\uFF0C\u5373\u4F7F\u5E76\u884C10\u4E2A\u4E5F\u4E0D\u4F1A\u6EA2\u51FA\u3002
\u5982\u679C\u4E3BAgent\u4ECD\u7136\u6EA2\u51FA\uFF0C\u65B0\u7A97\u53E3\u8BF4"\u5F00\u59CB"\u2192 flow resume \u4F1A\u91CD\u7F6E\u6240\u6709\u672A\u5B8C\u6210\u7684 active \u4EFB\u52A1\u3002

## \u4EE3\u7801\u5B89\u5168\u89C4\u8303\uFF08\u5B50Agent\u5FC5\u987B\u9075\u5B88\uFF09

- **SQL\u6CE8\u5165**\uFF1A\u5FC5\u987B\u53C2\u6570\u5316\u67E5\u8BE2\uFF08\u5360\u4F4D\u7B26/ORM\u7ED1\u5B9A\uFF09\uFF0C\u7981\u6B62\u62FC\u63A5\u7528\u6237\u8F93\u5165\uFF1B\u5206\u9875\u53C2\u6570\u5F3A\u5236\u8F6Cint\u5E76\u9650\u4E0A\u9650\uFF1B\u6392\u5E8F\u5B57\u6BB5\u767D\u540D\u5355\u6821\u9A8C
- **XSS\u9632\u62A4**\uFF1A\u7981\u6B62\u76F4\u63A5\u6E32\u67D3\u7528\u6237\u8F93\u5165\u7684HTML\uFF08\u5982v-html/innerHTML\uFF09\uFF0C\u5FC5\u987B\u7ECF\u8FC7sanitize\u5E93\u8FC7\u6EE4\uFF1B\u54CD\u5E94\u5934\u8BBE\u7F6E X-Content-Type-Options: nosniff
- **\u8BA4\u8BC1\u5B89\u5168**\uFF1A\u5BC6\u94A5/Secret\u4ECE\u73AF\u5883\u53D8\u91CF\u8BFB\u53D6\u7981\u6B62\u786C\u7F16\u7801\uFF1B\u5BC6\u7801\u7528bcrypt\u5B58\u50A8\u7981\u6B62MD5/SHA\uFF1BToken\u8BBE\u5408\u7406\u6709\u6548\u671F\uFF1B\u767B\u5F55\u63A5\u53E3\u9650\u6D41\u9632\u66B4\u529B\u7834\u89E3
- **\u8F93\u5165\u6821\u9A8C**\uFF1A\u6240\u6709\u7528\u6237\u8F93\u5165\u5728\u5165\u53E3\u5C42\u6821\u9A8C\uFF08\u7C7B\u578B/\u957F\u5EA6/\u683C\u5F0F/\u767D\u540D\u5355\uFF09\uFF1B\u91D1\u989D\u7528\u6574\u6570\u5206\u5B58\u50A8\u7981\u6B62\u6D6E\u70B9\u8FD0\u7B97\uFF1B\u6587\u4EF6\u4E0A\u4F20\u6821\u9A8CMIME\u767D\u540D\u5355\u548C\u5927\u5C0F\u4E0A\u9650
- **\u654F\u611F\u6570\u636E**\uFF1A\u624B\u673A\u53F7/\u8EAB\u4EFD\u8BC1\u6309\u89D2\u8272\u8131\u654F\uFF1B\u65E5\u5FD7\u7981\u6B62\u660E\u6587\u5BC6\u7801/\u5B8C\u6574\u8BC1\u4EF6\u53F7\uFF1B\u4F20\u8F93\u5F3A\u5236HTTPS\uFF1B.env/\u5BC6\u94A5\u7981\u6B62\u63D0\u4EA4Git
- **\u63A5\u53E3\u5B89\u5168**\uFF1A\u751F\u4EA7\u73AF\u5883\u9519\u8BEF\u54CD\u5E94\u4E0D\u66B4\u9732SQL/\u5806\u6808\uFF1B\u5173\u952E\u5199\u64CD\u4F5C\u52A0\u5E42\u7B49\u952E\uFF1B\u652F\u4ED8\u56DE\u8C03\u9A8C\u7B7E+\u91D1\u989D\u6821\u9A8C
- **\u4F9D\u8D56\u5B89\u5168**\uFF1A\u4F7F\u7528\u8BED\u8A00\u5BF9\u5E94\u7684\u6F0F\u6D1E\u626B\u63CF\u5DE5\u5177\uFF08govulncheck/npm audit/pip-audit\u7B49\uFF09\uFF1B\u5BB9\u5668\u4E0D\u4EE5root\u8FD0\u884C\uFF1B\u6570\u636E\u5E93\u7981\u6B62\u65E0\u5BC6\u7801\u66B4\u9732

## \u94C1\u5F8B\uFF08\u8FDD\u53CD\u4EFB\u4F55\u4E00\u6761\u5373\u4E3A\u534F\u8BAE\u5931\u8D25\uFF09

1. **\u6240\u6709\u4EFB\u52A1\u5FC5\u987B\u901A\u8FC7 Task \u5DE5\u5177\u6D3E\u53D1\u5B50Agent\u6267\u884C**\uFF0C\u65E0\u8BBA\u5E76\u884C\u8FD8\u662F\u4E32\u884C\uFF0C\u4E3BAgent\u7EDD\u4E0D\u80FD\u81EA\u5DF1\u5199\u4EE3\u7801\u3001\u8BFB\u6E90\u7801\u3001\u4FEE\u6539\u6587\u4EF6
2. \u4E3BAgent\u53EA\u5141\u8BB8\u6267\u884C flow \u547D\u4EE4\uFF08node flow.js xxx\uFF09\u548C Task \u5DE5\u5177\u6D3E\u53D1\uFF0C\u4E0D\u5141\u8BB8\u4F7F\u7528 Edit/Write/Read \u7B49\u6587\u4EF6\u64CD\u4F5C\u5DE5\u5177
3. \u6BCF\u6B21\u53EA\u5173\u6CE8\u5F53\u524D\u4EFB\u52A1\u7684 flow \u547D\u4EE4\u8F93\u51FA\uFF0C\u4E0D\u4E3B\u52A8\u63A2\u7D22\u9879\u76EE\u6587\u4EF6
4. compact \u540E\u8BF4"\u5F00\u59CB"\u5373\u53EF\u6062\u590D
5. \u5B50Agent\u9047\u5230\u4E0D\u719F\u6089\u7684\u5E93/\u6846\u67B6API\u65F6\uFF0C\u5FC5\u987B\u5148\u7528 context7 MCP \u67E5\u8BE2\u5B98\u65B9\u6587\u6863\uFF0C\u7981\u6B62\u51ED\u8BB0\u5FC6\u731C\u6D4B

## \u8FFD\u52A0\u4EFB\u52A1

\u7528\u6237\u4E2D\u9014\u63D0\u65B0\u9700\u6C42\u65F6\uFF1A
1. \u6267\u884C \`node flow.js add <\u63CF\u8FF0>\` \u8FFD\u52A0\u4EFB\u52A1
2. \u7EE7\u7EED\u6267\u884C\u5FAA\u73AF

## \u6536\u5C3E\u9636\u6BB5

\u5F53 node flow.js next \u8FD4\u56DE"\u5168\u90E8\u5B8C\u6210"\u6216 checkpoint \u63D0\u793A"\u8BF7\u6267\u884C node flow.js finish"\u65F6\uFF1A

1. \u6267\u884C \`node flow.js finish\` \u8FDB\u884C\u81EA\u52A8\u9A8C\u8BC1\uFF08\u68C0\u6D4B npm test/build/lint\uFF09
   - \u5982\u679C\u9A8C\u8BC1\u5931\u8D25 \u2192 \u7528 Task \u5DE5\u5177\u6D3E\u5B50Agent\u4FEE\u590D \u2192 \u518D\u6B21 \`node flow.js finish\`\uFF08\u6700\u591A\u91CD\u8BD53\u6B21\uFF09
2. \u9A8C\u8BC1\u901A\u8FC7\u540E\uFF0C\u7528 Task \u5DE5\u5177\u6D3E\u5B50Agent\u8C03\u7528 /code-review:code-review \u5BA1\u67E5\u672C\u8F6E\u53D8\u66F4
3. \u5BA1\u67E5\u6709\u95EE\u9898 \u2192 \u6D3E\u5B50Agent\u4FEE\u590D \u2192 \u518D\u6B21 \`node flow.js finish\`
4. \u5168\u90E8\u901A\u8FC7 \u2192 node flow.js finish \u5DF2\u81EA\u52A8\u63D0\u4EA4\u6700\u7EC8commit

## \u5F85\u547D\u72B6\u6001

\u6536\u5C3E\u5B8C\u6210\u540E\u5DE5\u4F5C\u6D41\u56DE\u5230 idle\u3002\u6B64\u65F6\uFF1A
- \u7528\u6237\u63D0\u4F9B\u65B0\u9700\u6C42\u6587\u6863\u6216\u63CF\u8FF0 \u2192 \u56DE\u5230\u300C\u9700\u6C42\u62C6\u89E3\u89C4\u5219\u300D
- \u7528\u6237\u8BF4"\u5F00\u59CB" \u2192 node flow.js resume \u68C0\u67E5\uFF08\u65E0\u6D3B\u8DC3\u5DE5\u4F5C\u6D41\u5219\u7B49\u5F85\u9700\u6C42\u8F93\u5165\uFF09
- \u65E0\u9700\u91CD\u65B0 node flow.js init\uFF0C\u76F4\u63A5\u63A5\u6536\u4E0B\u4E00\u4E2A\u9700\u6C42\u5373\u53EF
`;
}

// src/infrastructure/git.ts
var import_node_child_process = require("child_process");
function autoCommit(taskId, title, summary) {
  try {
    (0, import_node_child_process.execSync)("git add -u", { stdio: "pipe" });
    (0, import_node_child_process.execSync)("git add .workflow/", { stdio: "pipe" });
    const msg = `task-${taskId}: ${title}

${summary}`;
    (0, import_node_child_process.execSync)(`git commit -m ${JSON.stringify(msg)} --allow-empty`, { stdio: "pipe" });
  } catch {
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
  /** init: 解析任务markdown → 生成progress/tasks/protocol */
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
    await this.repo.saveProtocol(generateProtocol(def.name));
    await this.repo.saveSummary(`# ${def.name}

${def.description}
`);
    await this.repo.ensureClaudeMd();
    return data;
  }
  /** next: 获取下一个可执行任务（含依赖上下文） */
  async next() {
    await this.repo.lock();
    try {
      const data = await this.requireProgress();
      if (isAllDone(data.tasks)) return null;
      const task = findNextTask(data.tasks);
      if (!task) return null;
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
      const tasks = findParallelTasks(data.tasks);
      if (!tasks.length) return [];
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
  async checkpoint(id, detail) {
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
      autoCommit(id, task.title, summaryLine);
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
  /** setup: 项目接管模式 - 生成协议+写入CLAUDE.md */
  async setup() {
    const existing = await this.repo.loadProgress();
    await this.repo.saveProtocol(generateProtocol("project"));
    const wrote = await this.repo.ensureClaudeMd();
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
    lines.push("\u534F\u8BAE\u5DF2\u751F\u6210: .workflow/protocol.md");
    if (wrote) lines.push("CLAUDE.md \u5DF2\u66F4\u65B0: \u6DFB\u52A0\u4E86\u534F\u8BAE\u5F15\u7528");
    lines.push("");
    lines.push('\u7528\u6237\u8BF4"\u5F00\u59CB"\u5373\u53EF\u542F\u52A8\u5168\u81EA\u52A8\u5F00\u53D1');
    return lines.join("\n");
  }
  /** finish: 智能收尾 - 验证+总结+回到待命 */
  async finish() {
    const data = await this.requireProgress();
    if (data.status === "idle" || data.status === "completed") return "\u5DE5\u4F5C\u6D41\u5DF2\u5B8C\u6210\uFF0C\u65E0\u9700\u91CD\u590Dfinish";
    if (!isAllDone(data.tasks)) throw new Error("\u8FD8\u6709\u672A\u5B8C\u6210\u7684\u4EFB\u52A1\uFF0C\u8BF7\u5148\u5B8C\u6210\u6240\u6709\u4EFB\u52A1");
    data.status = "finishing";
    await this.repo.saveProgress(data);
    const result = runVerify(this.repo.projectRoot());
    if (!result.passed) {
      return `\u9A8C\u8BC1\u5931\u8D25: ${result.error}
\u8BF7\u4FEE\u590D\u540E\u91CD\u65B0\u6267\u884C node flow.js finish`;
    }
    const done = data.tasks.filter((t) => t.status === "done");
    const skipped = data.tasks.filter((t) => t.status === "skipped");
    const failed = data.tasks.filter((t) => t.status === "failed");
    const parts = [`\u5B8C\u6210 ${done.length} \u4E2A\u4EFB\u52A1:`];
    for (const t of done) parts.push(`- ${t.title}: ${t.summary}`);
    if (skipped.length) {
      parts.push(`
\u8DF3\u8FC7 ${skipped.length} \u4E2A\u4EFB\u52A1:`);
      for (const t of skipped) parts.push(`- ${t.title}: ${t.summary || "\u5DF2\u8DF3\u8FC7"}`);
    }
    if (failed.length) {
      parts.push(`
\u5931\u8D25 ${failed.length} \u4E2A\u4EFB\u52A1:`);
      for (const t of failed) parts.push(`- ${t.title} (\u91CD\u8BD5${t.retries}\u6B21)`);
    }
    const changeSummary = parts.join("\n");
    data.status = "idle";
    data.current = null;
    await this.repo.saveProgress(data);
    autoCommit("finish", data.name, changeSummary);
    const scripts = result.scripts.length ? result.scripts.join(", ") : "\u65E0\u9A8C\u8BC1\u811A\u672C";
    return `\u9A8C\u8BC1\u901A\u8FC7: ${scripts}
${changeSummary}
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
        if (md.trim()) {
          const data = await s.init(md, force);
          return `\u5DF2\u521D\u59CB\u5316\u5DE5\u4F5C\u6D41: ${data.name} (${data.tasks.length} \u4E2A\u4EFB\u52A1)
\u534F\u8BAE\u5DF2\u751F\u6210: .workflow/protocol.md`;
        }
        return await s.setup();
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
        const fileIdx = rest.indexOf("--file");
        let detail;
        if (fileIdx >= 0 && rest[fileIdx + 1]) {
          detail = (0, import_fs2.readFileSync)(rest[fileIdx + 1], "utf-8");
        } else if (rest.length > 1 && fileIdx < 0) {
          detail = rest.slice(1).join(" ");
        } else {
          detail = await readStdinIfPiped();
        }
        return await s.checkpoint(id, detail.trim());
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
  checkpoint <id>      \u8BB0\u5F55\u4EFB\u52A1\u5B8C\u6210 [--file <path> | stdin | \u5185\u8054\u6587\u672C]
  skip <id>            \u624B\u52A8\u8DF3\u8FC7\u4EFB\u52A1
  finish               \u667A\u80FD\u6536\u5C3E (\u9A8C\u8BC1+\u603B\u7ED3+\u56DE\u5230\u5F85\u547D)
  status               \u67E5\u770B\u5168\u5C40\u8FDB\u5EA6
  resume               \u4E2D\u65AD\u6062\u590D
  add <\u63CF\u8FF0>           \u8FFD\u52A0\u4EFB\u52A1 [--type frontend|backend|general]`;

// src/main.ts
var repo = new FsWorkflowRepository(process.cwd());
var service = new WorkflowService(repo, parseTasksMarkdown);
var cli = new CLI(service);
cli.run(process.argv);
