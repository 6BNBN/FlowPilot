#!/usr/bin/env node

// src/infrastructure/fs-repository.ts
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
var FsWorkflowRepository = class {
  root;
  ctxDir;
  constructor(basePath) {
    this.root = join(basePath, ".workflow");
    this.ctxDir = join(this.root, "context");
  }
  async ensure(dir) {
    await mkdir(dir, { recursive: true });
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
      "| ID | \u6807\u9898 | \u7C7B\u578B | \u4F9D\u8D56 | \u72B6\u6001 | \u6458\u8981 |",
      "|----|------|------|------|------|------|"
    ];
    for (const t of data.tasks) {
      const deps = t.deps.length ? t.deps.join(",") : "-";
      lines.push(`| ${t.id} | ${t.title} | ${t.type} | ${deps} | ${t.status} | ${t.summary || "-"} |`);
    }
    await writeFile(join(this.root, "progress.md"), lines.join("\n") + "\n", "utf-8");
  }
  async loadProgress() {
    try {
      const raw = await readFile(join(this.root, "progress.md"), "utf-8");
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
      const m = line.match(/^\|\s*(\d{3})\s*\|\s*(.+?)\s*\|\s*(\w+)\s*\|\s*([^|]*?)\s*\|\s*(\w+)\s*\|\s*(.*?)\s*\|$/);
      if (m) {
        const depsRaw = m[4].trim();
        tasks.push({
          id: m[1],
          title: m[2],
          type: m[3],
          status: m[5],
          summary: m[6] === "-" ? "" : m[6],
          deps: depsRaw === "-" ? [] : depsRaw.split(",").map((d) => d.trim()),
          retries: 0
        });
      }
    }
    return { name, status, current, tasks };
  }
  // --- context/ 任务详细产出 ---
  async saveTaskContext(taskId, content) {
    await this.ensure(this.ctxDir);
    await writeFile(join(this.ctxDir, `task-${taskId}.md`), content, "utf-8");
  }
  async loadTaskContext(taskId) {
    try {
      return await readFile(join(this.ctxDir, `task-${taskId}.md`), "utf-8");
    } catch {
      return null;
    }
  }
  // --- summary.md ---
  async saveSummary(content) {
    await this.ensure(this.ctxDir);
    await writeFile(join(this.ctxDir, "summary.md"), content, "utf-8");
  }
  async loadSummary() {
    try {
      return await readFile(join(this.ctxDir, "summary.md"), "utf-8");
    } catch {
      return "";
    }
  }
  // --- protocol.md / tasks.md ---
  async saveProtocol(content) {
    await this.ensure(this.root);
    await writeFile(join(this.root, "protocol.md"), content, "utf-8");
  }
  async saveTasks(content) {
    await this.ensure(this.root);
    await writeFile(join(this.root, "tasks.md"), content, "utf-8");
  }
  async loadTasks() {
    try {
      return await readFile(join(this.root, "tasks.md"), "utf-8");
    } catch {
      return null;
    }
  }
  async ensureClaudeMd() {
    const base = join(this.root, "..");
    const path = join(base, "CLAUDE.md");
    const ref = "\u9075\u5FAA .workflow/protocol.md \u5DE5\u4F5C\u6D41\u8C03\u5EA6\u534F\u8BAE";
    try {
      const content = await readFile(path, "utf-8");
      if (content.includes(ref)) return false;
      await writeFile(path, content.trimEnd() + "\n\n" + ref + "\n", "utf-8");
    } catch {
      await writeFile(path, "# Project\n\n" + ref + "\n", "utf-8");
    }
    return true;
  }
};

// src/infrastructure/markdown-parser.ts
var TASK_RE = /^(\d+)\.\s+\[(\w+)\]\s+(.+?)(?:\s*\(deps?:\s*([^)]*)\))?$/;
var DESC_RE = /^\s{2,}(.+)$/;
function parseTasksMarkdown(markdown) {
  const lines = markdown.split("\n");
  let name = "";
  let description = "";
  const tasks = [];
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
      const type = m[2];
      const title = m[3].trim();
      const deps = m[4] ? m[4].split(",").map((d) => d.trim().padStart(3, "0")).filter(Boolean) : [];
      let desc = "";
      while (i + 1 < lines.length && DESC_RE.test(lines[i + 1])) {
        i++;
        desc += (desc ? "\n" : "") + lines[i].trim();
      }
      tasks.push({ title, type, deps, description: desc });
    }
  }
  return { name, description, tasks };
}

// src/domain/task-store.ts
function makeTaskId(n) {
  return String(n).padStart(3, "0");
}
function findNextTask(tasks) {
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
  for (const t of data.tasks) {
    if (t.status === "active") {
      t.status = "pending";
      data.current = null;
      data.status = "running";
      return t.id;
    }
  }
  if (data.status === "running") return data.current;
  return null;
}
function isAllDone(tasks) {
  return tasks.every((t) => t.status === "done" || t.status === "skipped" || t.status === "failed");
}

// src/application/protocol-generator.ts
function generateProtocol(projectName) {
  return `# \u5DE5\u4F5C\u6D41\u8C03\u5EA6\u534F\u8BAE

\u4F60\u662F\u8C03\u5EA6\u5668\uFF0C\u4E25\u683C\u9075\u5FAA\u4EE5\u4E0B\u89C4\u5219\u3002\u4E0D\u8981\u81EA\u5DF1\u5199\u4EE3\u7801\uFF0C\u5168\u90E8\u4EA4\u7ED9\u5B50Agent\u3002

## \u542F\u52A8\u89C4\u5219

\u5F53\u7528\u6237\u8BF4"\u5F00\u59CB"\u65F6\uFF1A
1. \u6267\u884C \`flow resume\` \u68C0\u67E5\u662F\u5426\u6709\u672A\u5B8C\u6210\u5DE5\u4F5C\u6D41
2. \u5982\u679C\u6709 \u2192 \u4ECE\u4E2D\u65AD\u70B9\u7EE7\u7EED\u6267\u884C\u5FAA\u73AF
3. \u5982\u679C\u6CA1\u6709 \u2192 \u8BE2\u95EE\u7528\u6237\u63D0\u4F9B\u9700\u6C42\u6587\u6863\u6216\u63CF\u8FF0\u9700\u6C42

## \u9700\u6C42\u62C6\u89E3\u89C4\u5219

\u6536\u5230\u9700\u6C42\u540E\uFF1A
1. \u8C03\u7528 /superpowers:brainstorming \u8FDB\u884C\u5934\u8111\u98CE\u66B4
2. \u5C06\u7ED3\u679C\u6574\u7406\u4E3A\u4EFB\u52A1\u5217\u8868\uFF0C\u6BCF\u4E2A\u4EFB\u52A1\u6807\u6CE8\u7C7B\u578B(frontend/backend/general)\u548C\u4F9D\u8D56
3. \u7528 \`flow init\` \u5199\u5165\u4EFB\u52A1\u6811\uFF08\u901A\u8FC7stdin\u4F20\u5165markdown\uFF09
4. \u5C55\u793A\u4EFB\u52A1\u6811\u7ED9\u7528\u6237\u786E\u8BA4

## \u6267\u884C\u5FAA\u73AF

\u91CD\u590D\u4EE5\u4E0B\u6B65\u9AA4\u76F4\u5230 flow next \u8FD4\u56DE"\u5168\u90E8\u5B8C\u6210"\uFF1A

1. \u6267\u884C \`flow next\` \u83B7\u53D6\u4E0B\u4E00\u4E2A\u4EFB\u52A1
2. \u6839\u636E\u4EFB\u52A1\u7C7B\u578B\uFF0C\u7528 Task \u5DE5\u5177\u6D3E\u53D1\u5B50Agent\uFF1A
   - type=frontend \u2192 \u5B50Agent\u5FC5\u987B\u8C03\u7528 /frontend-design \u63D2\u4EF6
   - type=backend \u2192 \u5B50Agent\u5FC5\u987B\u8C03\u7528 /feature-dev \u63D2\u4EF6
   - type=general \u2192 \u5B50Agent\u76F4\u63A5\u6267\u884C
3. \u5B50Agent\u8FD4\u56DE\u7ED3\u679C\u540E\uFF0C\u6267\u884C \`flow checkpoint <id> <\u6458\u8981>\`
   - \u6458\u8981\u901A\u8FC7stdin\u4F20\u5165\u8BE6\u7EC6\u5185\u5BB9
4. \u5982\u679C\u5B50Agent\u5931\u8D25\uFF0C\u91CD\u8BD5\u3002\u8FDE\u7EED\u5931\u8D253\u6B21\u5219 \`flow checkpoint <id> FAILED\`

## \u4E0A\u4E0B\u6587\u89C4\u5219

- \u4F60\u53EA\u8BFB flow \u547D\u4EE4\u7684\u8F93\u51FA\uFF0C\u4E0D\u8981\u8BFB\u6E90\u4EE3\u7801\u6587\u4EF6
- \u4E0D\u8981\u81EA\u5DF1\u5199\u4EE3\u7801\uFF0C\u5168\u90E8\u4EA4\u7ED9\u5B50Agent
- \u6BCF\u6B21\u53EA\u5904\u7406\u4E00\u4E2A\u4EFB\u52A1\uFF0C\u4FDD\u6301\u4E0A\u4E0B\u6587\u6700\u5C0F
- compact \u540E\u8BF4"\u5F00\u59CB"\u5373\u53EF\u6062\u590D

## \u8FFD\u52A0\u4EFB\u52A1

\u7528\u6237\u4E2D\u9014\u63D0\u65B0\u9700\u6C42\u65F6\uFF1A
1. \u6267\u884C \`flow add <\u63CF\u8FF0>\` \u8FFD\u52A0\u4EFB\u52A1
2. \u7EE7\u7EED\u6267\u884C\u5FAA\u73AF

## \u6536\u5C3E\u9636\u6BB5

\u5F53 flow next \u8FD4\u56DE"\u5168\u90E8\u5B8C\u6210"\u6216 checkpoint \u63D0\u793A"\u8BF7\u6267\u884C flow finish"\u65F6\uFF1A

1. \u6267\u884C \`flow finish\` \u8FDB\u884C\u81EA\u52A8\u9A8C\u8BC1\uFF08\u68C0\u6D4B npm test/build/lint\uFF09
   - \u5982\u679C\u9A8C\u8BC1\u5931\u8D25 \u2192 \u7528 Task \u5DE5\u5177\u6D3E\u5B50Agent\u4FEE\u590D \u2192 \u518D\u6B21 \`flow finish\`\uFF08\u6700\u591A\u91CD\u8BD53\u6B21\uFF09
2. \u9A8C\u8BC1\u901A\u8FC7\u540E\uFF0C\u7528 Task \u5DE5\u5177\u6D3E\u5B50Agent\u8C03\u7528 /code-review:code-review \u5BA1\u67E5\u672C\u8F6E\u53D8\u66F4
3. \u5BA1\u67E5\u6709\u95EE\u9898 \u2192 \u6D3E\u5B50Agent\u4FEE\u590D \u2192 \u518D\u6B21 \`flow finish\`
4. \u5168\u90E8\u901A\u8FC7 \u2192 flow finish \u5DF2\u81EA\u52A8\u63D0\u4EA4\u6700\u7EC8commit

## \u5F85\u547D\u72B6\u6001

\u6536\u5C3E\u5B8C\u6210\u540E\u5DE5\u4F5C\u6D41\u56DE\u5230 idle\u3002\u6B64\u65F6\uFF1A
- \u7528\u6237\u63D0\u4F9B\u65B0\u9700\u6C42\u6587\u6863\u6216\u63CF\u8FF0 \u2192 \u56DE\u5230\u300C\u9700\u6C42\u62C6\u89E3\u89C4\u5219\u300D
- \u7528\u6237\u8BF4"\u5F00\u59CB" \u2192 flow resume \u68C0\u67E5\uFF08\u65E0\u6D3B\u8DC3\u5DE5\u4F5C\u6D41\u5219\u7B49\u5F85\u9700\u6C42\u8F93\u5165\uFF09
- \u65E0\u9700\u91CD\u65B0 flow init\uFF0C\u76F4\u63A5\u63A5\u6536\u4E0B\u4E00\u4E2A\u9700\u6C42\u5373\u53EF
`;
}

// src/infrastructure/git.ts
import { execSync } from "child_process";
function autoCommit(taskId, title, summary) {
  try {
    execSync("git add -A", { stdio: "pipe" });
    const msg = `task-${taskId}: ${title}

${summary}`;
    execSync(`git commit -m ${JSON.stringify(msg)} --allow-empty`, { stdio: "pipe" });
  } catch {
  }
}

// src/infrastructure/verify.ts
import { execSync as execSync2 } from "child_process";
import { readFileSync } from "fs";
import { join as join2 } from "path";
function runVerify(cwd) {
  const scripts = detectScripts(cwd);
  if (!scripts.length) return { passed: true, scripts: [] };
  for (const s of scripts) {
    try {
      execSync2(`npm run ${s}`, { cwd, stdio: "pipe", timeout: 12e4 });
    } catch (e) {
      return { passed: false, scripts, error: `npm run ${s} \u5931\u8D25:
${(e.stderr || e.stdout || "").toString().slice(0, 500)}` };
    }
  }
  return { passed: true, scripts };
}
function detectScripts(cwd) {
  try {
    const pkg = JSON.parse(readFileSync(join2(cwd, "package.json"), "utf-8"));
    const s = pkg.scripts || {};
    return ["build", "test", "lint"].filter((k) => k in s);
  } catch {
    return [];
  }
}

// src/application/workflow-service.ts
var WorkflowService = class {
  constructor(repo2, parse) {
    this.repo = repo2;
    this.parse = parse;
  }
  /** init: 解析任务markdown → 生成progress/tasks/protocol */
  async init(tasksMd) {
    const def = this.parse(tasksMd);
    const tasks = def.tasks.map((t, i) => ({
      id: makeTaskId(i + 1),
      title: t.title,
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
    return data;
  }
  /** next: 获取下一个可执行任务（含依赖上下文） */
  async next() {
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
  }
  /** checkpoint: 记录任务完成 */
  async checkpoint(id, detail) {
    const data = await this.requireProgress();
    const task = data.tasks.find((t) => t.id === id);
    if (!task) throw new Error(`\u4EFB\u52A1 ${id} \u4E0D\u5B58\u5728`);
    if (detail === "FAILED") {
      const result = failTask(data, id);
      await this.repo.saveProgress(data);
      return result === "retry" ? `\u4EFB\u52A1 ${id} \u5931\u8D25(\u7B2C${task.retries}\u6B21)\uFF0C\u5C06\u91CD\u8BD5` : `\u4EFB\u52A1 ${id} \u8FDE\u7EED\u5931\u8D253\u6B21\uFF0C\u5DF2\u8DF3\u8FC7`;
    }
    const summaryLine = detail.split("\n")[0].slice(0, 80);
    completeTask(data, id, summaryLine);
    await this.repo.saveProgress(data);
    await this.repo.saveTaskContext(id, `# task-${id}: ${task.title}

${detail}
`);
    autoCommit(id, task.title, summaryLine);
    const doneCount = data.tasks.filter((t) => t.status === "done").length;
    const msg = `\u4EFB\u52A1 ${id} \u5B8C\u6210 (${doneCount}/${data.tasks.length}) [\u5DF2\u81EA\u52A8\u63D0\u4EA4]`;
    return isAllDone(data.tasks) ? msg + "\n\u5168\u90E8\u4EFB\u52A1\u5DF2\u5B8C\u6210\uFF0C\u8BF7\u6267\u884C flow finish \u8FDB\u884C\u6536\u5C3E" : msg;
  }
  /** resume: 中断恢复 */
  async resume() {
    const data = await this.repo.loadProgress();
    if (!data) return "\u65E0\u6D3B\u8DC3\u5DE5\u4F5C\u6D41\uFF0C\u7B49\u5F85\u9700\u6C42\u8F93\u5165";
    if (data.status === "idle") return "\u5DE5\u4F5C\u6D41\u5F85\u547D\u4E2D\uFF0C\u7B49\u5F85\u9700\u6C42\u8F93\u5165";
    if (data.status === "completed") return "\u5DE5\u4F5C\u6D41\u5DF2\u5168\u90E8\u5B8C\u6210";
    if (data.status === "finishing") return `\u6062\u590D\u5DE5\u4F5C\u6D41: ${data.name}
\u6B63\u5728\u6536\u5C3E\u9636\u6BB5\uFF0C\u8BF7\u6267\u884C flow finish`;
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
    const id = makeTaskId(data.tasks.length + 1);
    data.tasks.push({
      id,
      title,
      type,
      status: "pending",
      deps: [],
      summary: "",
      retries: 0
    });
    await this.repo.saveProgress(data);
    return `\u5DF2\u8FFD\u52A0\u4EFB\u52A1 ${id}: ${title} [${type}]`;
  }
  /** setup: 项目接管模式 - 生成协议+写入CLAUDE.md */
  async setup() {
    const existing = await this.repo.loadProgress();
    await this.repo.saveProtocol(generateProtocol("project"));
    const wrote = await this.repo.ensureClaudeMd();
    const lines = [];
    if (existing && existing.status === "running") {
      const done = existing.tasks.filter((t) => t.status === "done").length;
      lines.push(`\u68C0\u6D4B\u5230\u8FDB\u884C\u4E2D\u7684\u5DE5\u4F5C\u6D41: ${existing.name}`);
      lines.push(`\u8FDB\u5EA6: ${done}/${existing.tasks.length}`);
      lines.push("\u6267\u884C flow resume \u7EE7\u7EED");
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
    if (!isAllDone(data.tasks)) throw new Error("\u8FD8\u6709\u672A\u5B8C\u6210\u7684\u4EFB\u52A1\uFF0C\u8BF7\u5148\u5B8C\u6210\u6240\u6709\u4EFB\u52A1");
    data.status = "finishing";
    await this.repo.saveProgress(data);
    const result = runVerify(process.cwd());
    if (!result.passed) {
      return `\u9A8C\u8BC1\u5931\u8D25: ${result.error}
\u8BF7\u4FEE\u590D\u540E\u91CD\u65B0\u6267\u884C flow finish`;
    }
    const summaries = data.tasks.filter((t) => t.status === "done").map((t) => `- ${t.title}: ${t.summary}`);
    const changeSummary = `\u5B8C\u6210 ${summaries.length} \u4E2A\u4EFB\u52A1:
${summaries.join("\n")}`;
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
  async requireProgress() {
    const data = await this.repo.loadProgress();
    if (!data) throw new Error("\u65E0\u6D3B\u8DC3\u5DE5\u4F5C\u6D41\uFF0C\u8BF7\u5148 flow init");
    return data;
  }
};

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
  if (context) {
    lines.push("", "--- \u4E0A\u4E0B\u6587 ---", context);
  }
  return lines.join("\n");
}

// src/interfaces/stdin.ts
function isTTY() {
  return process.stdin.isTTY === true;
}
function readStdinIfPiped() {
  if (isTTY()) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", reject);
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
        const md = await readStdinIfPiped();
        if (md.trim()) {
          const data = await s.init(md);
          return `\u5DF2\u521D\u59CB\u5316\u5DE5\u4F5C\u6D41: ${data.name} (${data.tasks.length} \u4E2A\u4EFB\u52A1)
\u534F\u8BAE\u5DF2\u751F\u6210: .workflow/protocol.md`;
        }
        return await s.setup();
      }
      case "next": {
        const result = await s.next();
        if (!result) return "\u5168\u90E8\u5B8C\u6210";
        return formatTask(result.task, result.context);
      }
      case "checkpoint": {
        const id = rest[0];
        if (!id) throw new Error("\u9700\u8981\u4EFB\u52A1ID");
        const detail = rest.length > 1 ? rest.slice(1).join(" ") : await readStdinIfPiped();
        return await s.checkpoint(id, detail.trim());
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
        const title = rest.filter((r) => r !== "--type")[0];
        if (!title) throw new Error("\u9700\u8981\u4EFB\u52A1\u63CF\u8FF0");
        const typeIdx = rest.indexOf("--type");
        const type = typeIdx >= 0 && rest[typeIdx + 1] || "general";
        return await s.add(title, type);
      }
      default:
        return USAGE;
    }
  }
};
var USAGE = `\u7528\u6CD5: flow <command>
  init             \u521D\u59CB\u5316\u5DE5\u4F5C\u6D41 (stdin\u4F20\u5165\u4EFB\u52A1markdown)
  next             \u83B7\u53D6\u4E0B\u4E00\u4E2A\u5F85\u6267\u884C\u4EFB\u52A1
  checkpoint <id>  \u8BB0\u5F55\u4EFB\u52A1\u5B8C\u6210 (stdin\u4F20\u5165\u8BE6\u7EC6\u5185\u5BB9)
  finish           \u667A\u80FD\u6536\u5C3E (\u9A8C\u8BC1+\u603B\u7ED3+\u56DE\u5230\u5F85\u547D)
  status           \u67E5\u770B\u5168\u5C40\u8FDB\u5EA6
  resume           \u4E2D\u65AD\u6062\u590D
  add <\u63CF\u8FF0>       \u8FFD\u52A0\u4EFB\u52A1 [--type frontend|backend|general]`;

// src/main.ts
var repo = new FsWorkflowRepository(process.cwd());
var service = new WorkflowService(repo, parseTasksMarkdown);
var cli = new CLI(service);
cli.run(process.argv);
