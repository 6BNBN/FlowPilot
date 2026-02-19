#!/usr/bin/env node

// src/main.ts
import { join as join4, dirname } from "path";
import { fileURLToPath } from "url";

// src/infrastructure/fs-repository.ts
import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";

// src/domain/runtime.ts
var WorkflowRuntime = class _WorkflowRuntime {
  id;
  definition;
  status = "draft";
  currentStepId = null;
  stepStates = /* @__PURE__ */ new Map();
  history = [];
  /** 步骤 → 子工作流名称的映射（分子节点必须 spawn 子工作流） */
  subWorkflows = /* @__PURE__ */ new Map();
  constructor(id, definition) {
    this.id = id;
    this.definition = definition;
    for (const step of definition.steps) {
      this.stepStates.set(step.id, { status: "pending", artifacts: [], notes: "" });
    }
  }
  /** 从序列化数据恢复运行时实例 */
  static fromJSON(data, definition) {
    const rt = new _WorkflowRuntime(data.id, definition);
    rt.status = data.status;
    rt.currentStepId = data.currentStepId ?? null;
    const states = data.stepStates;
    if (states) {
      for (const [k, v] of Object.entries(states)) {
        rt.stepStates.set(k, { ...v, artifacts: v.artifacts ?? [], notes: v.notes ?? "" });
      }
    }
    const subs = data.subWorkflows;
    if (subs) {
      for (const [k, v] of Object.entries(subs)) rt.subWorkflows.set(k, v);
    }
    return rt;
  }
  /** 获取当前步骤状态 */
  getCurrentStep() {
    return this.currentStepId ? this.stepStates.get(this.currentStepId) ?? null : null;
  }
  /** 判断是否可以推进到下一步 */
  canAdvance() {
    if (this.status !== "running") return false;
    const current = this.getCurrentStep();
    return !current || current.status === "done" || current.status === "skipped";
  }
  /** 推进到指定步骤 */
  advance(nextStepId) {
    if (!this.canAdvance()) throw new Error("\u5F53\u524D\u72B6\u6001\u4E0D\u5141\u8BB8\u63A8\u8FDB");
    const next = this.stepStates.get(nextStepId);
    if (!next) throw new Error(`\u6B65\u9AA4 ${nextStepId} \u4E0D\u5B58\u5728`);
    this.currentStepId = nextStepId;
    next.status = "active";
    next.startedAt = /* @__PURE__ */ new Date();
    this.history.push({ stepId: nextStepId, action: "advance", timestamp: /* @__PURE__ */ new Date() });
  }
  /** 分支选择 - 激活指定子步骤，跳过其余 */
  branch(selectedId, skippedIds) {
    for (const id of skippedIds) {
      const s = this.stepStates.get(id);
      if (s) s.status = "skipped";
    }
    this.advance(selectedId);
  }
  /** 获取从当前位置可见的步骤 ID 列表（到下一个 loop/branch 为止） */
  getVisibleSteps() {
    const visible = [];
    let found = !this.currentStepId;
    for (const step of this.definition.steps) {
      if (step.id === this.currentStepId) found = true;
      if (!found) continue;
      if ((step.type === "loop" || step.type === "branch") && step.id !== this.currentStepId) break;
      visible.push(step.id);
    }
    return visible;
  }
};

// src/domain/types.ts
var StepId = (id) => id;
var WorkflowId = (id) => id;

// src/infrastructure/markdown-parser.ts
function extractType(text) {
  const match = text.match(/\[(loop|branch|factory)\]\s*/i);
  if (match) {
    const type = match[1].toLowerCase();
    return { type, title: text.replace(match[0], "").trim() };
  }
  return { type: "sequence", title: text.trim() };
}
function extractCapability(title) {
  const m = title.match(/\{([a-z-]+)\}\s*/);
  if (m) return { clean: title.replace(m[0], "").trim(), capability: m[1] };
  return { clean: title };
}
function extractCondition(title) {
  const m = title.match(/(?:when|until):\s*(.+)$/i);
  if (m) return { clean: title.replace(m[0], "").trim(), condition: m[1].trim() };
  return { clean: title };
}
var MAIN_RE = /^(\d+)\.\s+(.+)$/;
var SUB_RE = /^\s+(\d+)([a-z])\.\s+(.+)$/;
function parseWorkflowMarkdown(markdown) {
  const lines = markdown.split("\n");
  let name = "";
  let description = "";
  const steps = [];
  let pendingParallel = null;
  const flushParallel = () => {
    if (!pendingParallel) return;
    const id = StepId(pendingParallel.parentNum);
    steps.push({ id, type: "parallel", title: `\u5E76\u884C\u7EC4 ${id}`, description: "", children: pendingParallel.children });
    pendingParallel = null;
  };
  for (const line of lines) {
    if (!name && line.startsWith("# ")) {
      name = line.slice(2).trim();
      continue;
    }
    if (name && !description && !line.startsWith("#") && line.trim() && !MAIN_RE.test(line)) {
      description = line.trim();
      continue;
    }
    const sub = line.match(SUB_RE);
    if (sub) {
      const [, num, letter, text] = sub;
      if (!pendingParallel || pendingParallel.parentNum !== num) {
        flushParallel();
        pendingParallel = { parentNum: num, children: [] };
      }
      const { type, title } = extractType(text);
      const { clean, condition } = extractCondition(title);
      const { clean: final, capability } = extractCapability(clean);
      pendingParallel.children.push({
        id: StepId(`${num}${letter}`),
        type,
        title: final,
        description: "",
        condition,
        capability
      });
      continue;
    }
    const main = line.match(MAIN_RE);
    if (main) {
      flushParallel();
      const [, num, text] = main;
      const { type, title } = extractType(text);
      const { clean, condition } = extractCondition(title);
      const { clean: final, capability } = extractCapability(clean);
      steps.push({ id: StepId(num), type, title: final, description: "", condition, capability });
    }
  }
  flushParallel();
  return { name, description, steps };
}

// src/infrastructure/fs-repository.ts
var FsWorkflowRepository = class {
  root;
  constructor(basePath2) {
    this.root = join(basePath2, ".workflow");
  }
  /** 确保目录存在 */
  async ensureDir(dir) {
    await mkdir(dir, { recursive: true });
  }
  /** 获取工作流目录路径 */
  flowDir(name) {
    return join(this.root, "flows", name);
  }
  async saveDefinition(name, markdown) {
    const dir = this.flowDir(name);
    await this.ensureDir(dir);
    await this.ensureDir(join(dir, "artifacts"));
    await this.ensureDir(join(dir, "children"));
    await writeFile(join(dir, "definition.md"), markdown, "utf-8");
  }
  async loadDefinitionRaw(name) {
    return readFile(join(this.flowDir(name), "definition.md"), "utf-8");
  }
  async deleteWorkflow(name) {
    await rm(this.flowDir(name), { recursive: true, force: true });
  }
  async listWorkflows() {
    const dir = join(this.root, "flows");
    await this.ensureDir(dir);
    return readdir(dir);
  }
  async saveRuntime(name, runtime) {
    await this.ensureDir(this.flowDir(name));
    const serializable = {
      id: runtime.id,
      status: runtime.status,
      currentStepId: runtime.currentStepId,
      stepStates: Object.fromEntries(runtime.stepStates),
      history: runtime.history,
      subWorkflows: Object.fromEntries(runtime.subWorkflows)
    };
    await writeFile(
      join(this.flowDir(name), "runtime.json"),
      JSON.stringify(serializable, null, 2),
      "utf-8"
    );
  }
  async loadRuntime(name) {
    try {
      const raw = await readFile(join(this.flowDir(name), "runtime.json"), "utf-8");
      const data = JSON.parse(raw);
      const md = await readFile(join(this.flowDir(name), "definition.md"), "utf-8");
      const def = parseWorkflowMarkdown(md);
      return WorkflowRuntime.fromJSON(data, def);
    } catch {
      return null;
    }
  }
  async deleteRuntime(name) {
    await rm(join(this.flowDir(name), "runtime.json"), { force: true });
  }
  async saveTaskTree(name, tree) {
    await this.ensureDir(this.flowDir(name));
    await writeFile(
      join(this.flowDir(name), "tasks.json"),
      JSON.stringify(tree, null, 2),
      "utf-8"
    );
  }
  async getActive() {
    try {
      const raw = await readFile(join(this.root, "active.json"), "utf-8");
      return JSON.parse(raw);
    } catch {
      return { workflow: null };
    }
  }
  async setActive(name) {
    await this.ensureDir(this.root);
    const pointer = { workflow: name };
    await writeFile(
      join(this.root, "active.json"),
      JSON.stringify(pointer, null, 2),
      "utf-8"
    );
  }
};

// src/domain/capabilities.ts
var CAPABILITIES = [
  {
    name: "read-file",
    description: "\u8BFB\u53D6\u6587\u4EF6\u5185\u5BB9",
    hasSideEffect: false,
    params: ["path"]
  },
  {
    name: "write-file",
    description: "\u521B\u5EFA\u6216\u8986\u76D6\u6587\u4EF6",
    hasSideEffect: true,
    params: ["path", "content"]
  },
  {
    name: "edit-file",
    description: "\u7F16\u8F91\u6587\u4EF6\u5C40\u90E8\u5185\u5BB9",
    hasSideEffect: true,
    params: ["path", "old", "new"]
  },
  {
    name: "delete-file",
    description: "\u5220\u9664\u6587\u4EF6",
    hasSideEffect: true,
    params: ["path"]
  },
  {
    name: "run-command",
    description: "\u6267\u884C shell \u547D\u4EE4",
    hasSideEffect: true,
    params: ["command"]
  },
  {
    name: "search-code",
    description: "\u641C\u7D22\u4EE3\u7801\u6216\u6587\u4EF6",
    hasSideEffect: false,
    params: ["pattern", "scope"]
  },
  {
    name: "search-web",
    description: "\u641C\u7D22\u7F51\u7EDC\u4FE1\u606F",
    hasSideEffect: false,
    params: ["query"]
  },
  {
    name: "ask-user",
    description: "\u5411\u7528\u6237\u63D0\u95EE\u5E76\u7B49\u5F85\u56DE\u7B54",
    hasSideEffect: false,
    params: ["question"]
  },
  {
    name: "think",
    description: "\u7EAF\u601D\u8003\u4E0E\u5206\u6790\uFF08\u65E0\u526F\u4F5C\u7528\uFF09",
    hasSideEffect: false,
    params: ["topic"]
  }
];
var CAPABILITY_NAMES = new Set(CAPABILITIES.map((c) => c.name));
function isValidCapability(name) {
  return CAPABILITY_NAMES.has(name);
}

// src/domain/workflow.ts
function validateStep(step) {
  const errors = [];
  if (!step.id) errors.push(`\u6B65\u9AA4\u7F3A\u5C11 id`);
  if (!step.title) errors.push(`\u6B65\u9AA4 ${step.id} \u7F3A\u5C11 title`);
  if ((step.type === "loop" || step.type === "branch") && !step.condition) {
    errors.push(`\u6B65\u9AA4 ${step.id} \u7C7B\u578B\u4E3A ${step.type}\uFF0C\u9700\u8981 condition`);
  }
  if (step.type === "factory" && !step.factoryHint) {
    errors.push(`\u6B65\u9AA4 ${step.id} \u7C7B\u578B\u4E3A factory\uFF0C\u9700\u8981 factoryHint`);
  }
  if (step.type === "parallel" && (!step.children || step.children.length < 2)) {
    errors.push(`\u6B65\u9AA4 ${step.id} \u7C7B\u578B\u4E3A parallel\uFF0C\u81F3\u5C11\u9700\u8981 2 \u4E2A\u5B50\u6B65\u9AA4`);
  }
  const isLeaf = !step.children || step.children.length === 0;
  if (isLeaf && step.type === "sequence" && !step.capability) {
    errors.push(`\u6B65\u9AA4 ${step.id} \u662F\u53F6\u5B50\u8282\u70B9\uFF0C\u5FC5\u987B\u6807\u8BB0 {capability}\uFF08\u5982 {write-file}\uFF09\u6216\u58F0\u660E\u4E3A\u5206\u5B50\u8282\u70B9`);
  }
  if (step.capability && !isValidCapability(step.capability)) {
    errors.push(`\u6B65\u9AA4 ${step.id} \u5F15\u7528\u4E86\u672A\u77E5\u80FD\u529B: ${step.capability}`);
  }
  if (step.children) {
    for (const child of step.children) {
      errors.push(...validateStep(child));
    }
  }
  return errors;
}
function validateWorkflow(def) {
  const errors = [];
  if (!def.name) errors.push("\u5DE5\u4F5C\u6D41\u7F3A\u5C11 name");
  if (def.steps.length === 0) errors.push("\u5DE5\u4F5C\u6D41\u81F3\u5C11\u9700\u8981\u4E00\u4E2A\u6B65\u9AA4");
  const ids = /* @__PURE__ */ new Set();
  const collectIds = (steps) => {
    for (const s of steps) {
      if (ids.has(s.id)) errors.push(`\u6B65\u9AA4 id \u91CD\u590D: ${s.id}`);
      ids.add(s.id);
      if (s.children) collectIds(s.children);
    }
  };
  collectIds(def.steps);
  for (const step of def.steps) {
    errors.push(...validateStep(step));
  }
  return errors;
}

// src/domain/task-tree.ts
function buildNode(step, runtime) {
  const state = runtime.stepStates.get(step.id);
  const status = state?.status ?? "pending";
  const children = step.children ? step.children.map((c) => buildNode(c, runtime)) : [];
  const subWorkflow = runtime.subWorkflows.get(step.id);
  return { stepId: step.id, title: step.title, status, children, subWorkflow };
}
function deriveTaskTree(runtime) {
  const visibleIds = new Set(runtime.getVisibleSteps());
  const nodes = [];
  for (const step of runtime.definition.steps) {
    const state = runtime.stepStates.get(step.id);
    const isDone = state && (state.status === "done" || state.status === "skipped" || state.status === "failed");
    if (isDone || visibleIds.has(step.id)) {
      nodes.push(buildNode(step, runtime));
    }
  }
  return nodes;
}

// src/application/workflow-service.ts
var WorkflowService = class {
  constructor(repo2, parse) {
    this.repo = repo2;
    this.parse = parse;
  }
  /** 创建工作流：解析 Markdown 定义，校验后持久化 */
  async createWorkflow(name, content) {
    const def = this.parse(content);
    const errors = validateWorkflow(def);
    if (errors.length > 0) {
      throw new Error(`\u5DE5\u4F5C\u6D41\u6821\u9A8C\u5931\u8D25:
${errors.map((e) => `  - ${e}`).join("\n")}`);
    }
    await this.repo.saveDefinition(name, content);
    return name;
  }
  /** 启动工作流：从定义创建运行时实例 */
  async startWorkflow(name) {
    const md = await this.repo.loadDefinitionRaw(name);
    const definition = this.parse(md);
    const runtime = new WorkflowRuntime(WorkflowId(name), definition);
    runtime.status = "running";
    if (definition.steps.length > 0) {
      runtime.advance(definition.steps[0].id);
    }
    await this.repo.saveRuntime(name, runtime);
    await this.repo.setActive(name);
    return runtime;
  }
  /** 推进步骤：完成当前步骤并前进到下一步 */
  async advanceStep(name, notes, artifacts) {
    const runtime = await this.loadRuntime(name);
    const curDef = runtime.definition.steps.find((s) => s.id === runtime.currentStepId);
    const isMolecular = curDef?.children && curDef.children.length > 0;
    if (isMolecular) {
      const subName = runtime.subWorkflows.get(curDef.id);
      if (!subName) throw new Error(`\u5206\u5B50\u8282\u70B9 ${curDef.id} \u5FC5\u987B\u5148 spawn \u5B50\u5DE5\u4F5C\u6D41`);
      const subRt = await this.repo.loadRuntime(subName);
      if (!subRt || subRt.status !== "completed") {
        throw new Error(`\u5206\u5B50\u8282\u70B9 ${curDef.id} \u7684\u5B50\u5DE5\u4F5C\u6D41 ${subName} \u5C1A\u672A\u5B8C\u6210`);
      }
    }
    const cur = runtime.getCurrentStep();
    if (cur) {
      cur.status = "done";
      cur.completedAt = /* @__PURE__ */ new Date();
      if (notes) cur.notes = notes;
      if (artifacts) cur.artifacts.push(...artifacts);
    }
    const nextId = this.findNextStep(runtime);
    if (nextId) {
      runtime.advance(nextId);
    } else {
      runtime.status = "completed";
    }
    await this.saveWithTree(name, runtime);
    return runtime;
  }
  /** 分支选择：在分支节点选择路径 */
  async branchStep(name, choice) {
    const runtime = await this.loadRuntime(name);
    const curStep = runtime.definition.steps.find((s) => s.id === runtime.currentStepId);
    if (!curStep?.children) throw new Error("\u5F53\u524D\u6B65\u9AA4\u4E0D\u662F\u5206\u652F\u8282\u70B9");
    const selected = curStep.children.find((c) => c.id === StepId(choice));
    if (!selected) throw new Error(`\u5206\u652F ${choice} \u4E0D\u5B58\u5728`);
    const skipped = curStep.children.filter((c) => c.id !== selected.id).map((c) => c.id);
    runtime.branch(selected.id, skipped);
    await this.saveWithTree(name, runtime);
    return runtime;
  }
  /** 工厂派生：在当前步骤生成子工作流并进入 */
  async spawnFactory(name, content) {
    const runtime = await this.loadRuntime(name);
    const subName = `${name}-sub-${Date.now()}`;
    if (runtime.currentStepId) {
      runtime.subWorkflows.set(runtime.currentStepId, subName);
      await this.repo.saveRuntime(name, runtime);
    }
    await this.repo.saveDefinition(subName, content);
    await this.repo.setActive(subName);
  }
  /** 返回父流程：完成子工作流并回到父级 */
  async returnFromSub(parentName) {
    await this.repo.setActive(parentName);
  }
  /** 获取状态：返回当前运行时状态与派生任务树 */
  async getStatus(name) {
    const md = await this.repo.loadDefinitionRaw(name);
    const definition = this.parse(md);
    const runtime = await this.loadRuntime(name);
    const taskTree = deriveTaskTree(runtime);
    return { definition, runtime, taskTree };
  }
  /** 列出所有工作流及其状态摘要 */
  async listWorkflows() {
    const names = await this.repo.listWorkflows();
    const summaries = [];
    for (const n of names) {
      const rt = await this.repo.loadRuntime(n);
      summaries.push({ name: n, status: rt?.status ?? "draft" });
    }
    return summaries;
  }
  /** 获取当前活跃工作流名称 */
  async getActiveName() {
    const ptr = await this.repo.getActive();
    return ptr.workflow;
  }
  /** 加载运行时，不存在则抛错 */
  async loadRuntime(name) {
    const rt = await this.repo.loadRuntime(name);
    if (!rt) throw new Error(`\u5DE5\u4F5C\u6D41 ${name} \u672A\u542F\u52A8`);
    return rt;
  }
  /** 查找下一个步骤 ID */
  findNextStep(runtime) {
    const steps = runtime.definition.steps;
    const curIdx = steps.findIndex((s) => s.id === runtime.currentStepId);
    return curIdx >= 0 && curIdx + 1 < steps.length ? steps[curIdx + 1].id : null;
  }
  /** 保存运行时并同步派生任务树 */
  async saveWithTree(name, runtime) {
    await this.repo.saveRuntime(name, runtime);
    const tree = deriveTaskTree(runtime);
    await this.repo.saveTaskTree(name, tree);
  }
};

// src/application/context-service.ts
import { readFile as readFile2 } from "fs/promises";
import { join as join2 } from "path";

// src/interfaces/formatter.ts
var STATUS_ICON = {
  pending: "[ ]",
  active: "[>]",
  done: "[x]",
  skipped: "[-]",
  failed: "[!]"
};
function formatNode(node, indent) {
  const prefix = "  ".repeat(indent);
  const icon = STATUS_ICON[node.status] ?? "[ ]";
  const sub = node.subWorkflow ? ` \u2192 [${node.subWorkflow}]` : "";
  const line = `${prefix}${icon} ${node.title}${sub}`;
  const childLines = node.children.map((c) => formatNode(c, indent + 1));
  return [line, ...childLines].join("\n");
}
function formatTaskTree(tree) {
  if (tree.length === 0) return "(\u65E0\u4EFB\u52A1)";
  return tree.map((n) => formatNode(n, 0)).join("\n");
}
function formatStatus(state) {
  const { definition, runtime, taskTree } = state;
  return [
    `=== \u5DE5\u4F5C\u6D41: ${definition.name} ===`,
    `\u72B6\u6001: ${runtime.status}`,
    `\u5F53\u524D\u6B65\u9AA4: ${runtime.currentStepId ?? "(\u65E0)"}`,
    "",
    "--- \u4EFB\u52A1\u6811 ---",
    formatTaskTree(taskTree)
  ].join("\n");
}
function formatCapabilities() {
  const header = `\u539F\u5B50\u80FD\u529B\u6E05\u5355 (\u5171 ${CAPABILITIES.length} \u9879):
`;
  const lines = CAPABILITIES.map((c) => {
    const se = c.hasSideEffect ? "\u26A1" : "\u{1F441}";
    return `  ${se} {${c.name}} - ${c.description}  [${c.params.join(", ")}]`;
  });
  return header + lines.join("\n") + "\n\n\u5DE5\u4F5C\u6D41\u4E2D\u4F7F\u7528 {\u80FD\u529B\u540D} \u6807\u8BB0\u539F\u5B50\u6B65\u9AA4";
}
function formatList(workflows) {
  if (workflows.length === 0) return "(\u65E0\u5DE5\u4F5C\u6D41)";
  const header = `\u5171 ${workflows.length} \u4E2A\u5DE5\u4F5C\u6D41:
`;
  const lines = workflows.map((w) => `  ${w.name} [${w.status}]`);
  return header + lines.join("\n");
}

// src/application/context-service.ts
var ContextService = class {
  constructor(workflowService2, promptsDir2, basePath2, config2) {
    this.workflowService = workflowService2;
    this.promptsDir = promptsDir2;
    this.basePath = basePath2;
    this.config = config2;
  }
  /** 构建完整上下文：纪律 + 配置文档 + 工作流状态 + 活跃步骤 + 制品 */
  async buildContext(name) {
    const [protocol, ...docs] = await Promise.all([
      this.loadFile(join2(this.promptsDir, "iteration-protocol.md")),
      ...this.config.docs.map((p) => this.loadFile(join2(this.basePath, p)))
    ]);
    const state = await this.workflowService.getStatus(name);
    const { definition, runtime, taskTree } = state;
    const sections = [];
    sections.push("## \u8FED\u4EE3\u7EAA\u5F8B\uFF08\u5F3A\u5236\uFF09\n" + protocol);
    for (let i = 0; i < this.config.docs.length; i++) {
      sections.push(`## ${this.config.docs[i]}
` + docs[i]);
    }
    const doneCount = [...runtime.stepStates.values()].filter((s) => s.status === "done").length;
    sections.push(
      `## \u5DE5\u4F5C\u6D41\u72B6\u6001
- \u540D\u79F0: ${definition.name}
- \u72B6\u6001: ${runtime.status}
- \u8FDB\u5EA6: ${doneCount}/${definition.steps.length}`
    );
    const cur = runtime.getCurrentStep();
    if (runtime.currentStepId && cur) {
      const stepDef = definition.steps.find((s) => s.id === runtime.currentStepId);
      sections.push(
        `## \u5F53\u524D\u6D3B\u8DC3\u6B65\u9AA4
- ID: ${runtime.currentStepId}
- \u540D\u79F0: ${stepDef?.title ?? "(\u672A\u77E5)"}
- \u7C7B\u578B: ${stepDef?.type ?? "sequence"}`
      );
    }
    const allArtifacts = [...runtime.stepStates.values()].flatMap((s) => s.artifacts);
    if (allArtifacts.length > 0) {
      const list = allArtifacts.map((a) => `- ${a.path}: ${a.description}`).join("\n");
      sections.push("## \u8FD1\u671F\u5236\u54C1\n" + list);
    }
    sections.push("## \u4EFB\u52A1\u6811\n" + formatTaskTree(taskTree));
    return sections.join("\n\n");
  }
  /** 加载文件，找不到时返回占位文本 */
  async loadFile(path) {
    try {
      return await readFile2(path, "utf-8");
    } catch {
      return `\uFF08\u672A\u627E\u5230 ${path}\uFF09`;
    }
  }
};

// src/application/context-config.ts
import { readFile as readFile3, writeFile as writeFile2, readdir as readdir2 } from "fs/promises";
import { join as join3 } from "path";
var CONFIG_PATH = ".workflow/context.json";
async function loadContextConfig(basePath2) {
  try {
    const raw = await readFile3(join3(basePath2, CONFIG_PATH), "utf-8");
    return JSON.parse(raw);
  } catch {
    return { docs: [] };
  }
}
async function generateContextConfig(basePath2) {
  const docsDir = join3(basePath2, "docs");
  const files = [];
  try {
    await scanMd(docsDir, "docs", files);
  } catch {
  }
  files.sort();
  const config2 = { docs: files };
  await writeFile2(
    join3(basePath2, CONFIG_PATH),
    JSON.stringify(config2, null, 2) + "\n",
    "utf-8"
  );
  return config2;
}
async function scanMd(dir, rel, out) {
  const entries = await readdir2(dir, { withFileTypes: true });
  for (const e of entries) {
    const path = `${rel}/${e.name}`;
    if (e.isDirectory()) await scanMd(join3(dir, e.name), path, out);
    else if (e.name.endsWith(".md")) out.push(path);
  }
}

// src/interfaces/cli.ts
function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    process.stdin.on("error", reject);
  });
}
function parseOption(args, key) {
  const i = args.indexOf(key);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : void 0;
}
var CLI = class {
  constructor(service, context, initContext) {
    this.service = service;
    this.context = context;
    this.initContext = initContext;
  }
  async run(argv) {
    const args = argv.slice(2);
    try {
      const output = await this.dispatch(args);
      const cmd = args[0];
      const needsReminder = cmd && cmd !== "status" && cmd !== "caps";
      process.stdout.write(output + "\n");
      if (needsReminder) process.stdout.write("\n" + REMINDER + "\n");
    } catch (error) {
      process.stderr.write(`\u9519\u8BEF: ${error instanceof Error ? error.message : error}
`);
      process.exitCode = 1;
    }
  }
  async dispatch(args) {
    const [cmd, sub] = args;
    const s = this.service;
    switch (cmd) {
      case "create": {
        if (!sub) throw new Error("\u9700\u8981\u5DE5\u4F5C\u6D41\u540D\u79F0");
        await s.createWorkflow(sub, await readStdin());
        return `\u5DF2\u521B\u5EFA\u5DE5\u4F5C\u6D41: ${sub}`;
      }
      case "start": {
        if (!sub) throw new Error("\u9700\u8981\u5DE5\u4F5C\u6D41\u540D\u79F0");
        const rt = await s.startWorkflow(sub);
        return `\u5DF2\u542F\u52A8: ${sub}
\u5F53\u524D\u6B65\u9AA4: ${rt.currentStepId}`;
      }
      case "advance": {
        const name = await this.requireActive();
        const note = parseOption(args, "--note");
        const path = parseOption(args, "--artifact");
        const artifacts = path ? [{ path, description: "" }] : void 0;
        const rt = await s.advanceStep(name, note, artifacts);
        return `\u5DF2\u63A8\u8FDB\u5230: ${rt.currentStepId ?? "(\u5B8C\u6210)"}`;
      }
      case "branch": {
        if (!sub) throw new Error("\u9700\u8981\u5206\u652F\u9009\u62E9");
        const name = await this.requireActive();
        const rt = await s.branchStep(name, sub);
        return `\u5DF2\u9009\u62E9\u5206\u652F: ${sub}
\u5F53\u524D\u6B65\u9AA4: ${rt.currentStepId}`;
      }
      case "spawn": {
        const name = await this.requireActive();
        await s.spawnFactory(name, await readStdin());
        return "\u5DF2\u6D3E\u751F\u5B50\u5DE5\u4F5C\u6D41";
      }
      case "return": {
        if (!sub) throw new Error("\u9700\u8981\u7236\u5DE5\u4F5C\u6D41\u540D\u79F0");
        await s.returnFromSub(sub);
        return `\u5DF2\u8FD4\u56DE: ${sub}`;
      }
      case "status": {
        const name = sub ?? await this.requireActive();
        const state = await s.getStatus(name);
        const ctx = await this.context.buildContext(name);
        return formatStatus(state) + "\n\n" + ctx;
      }
      case "list":
        return formatList(await s.listWorkflows());
      case "caps":
        return formatCapabilities();
      case "edit": {
        if (!sub) throw new Error("\u9700\u8981\u5DE5\u4F5C\u6D41\u540D\u79F0");
        await s.createWorkflow(sub, await readStdin());
        return `\u5DF2\u66F4\u65B0\u5DE5\u4F5C\u6D41: ${sub}`;
      }
      case "init-context": {
        if (!this.initContext) throw new Error("init-context \u672A\u914D\u7F6E");
        const cfg = await this.initContext();
        return `\u5DF2\u751F\u6210 .workflow/context.json\uFF08${cfg.docs.length} \u4E2A\u6587\u6863\uFF09:
${cfg.docs.map((d) => `  - ${d}`).join("\n")}`;
      }
      default:
        return USAGE;
    }
  }
  /** 获取当前活跃工作流，不存在则报错 */
  async requireActive() {
    const name = await this.service.getActiveName();
    if (!name) throw new Error("\u65E0\u6D3B\u8DC3\u5DE5\u4F5C\u6D41\uFF0C\u8BF7\u5148 flow start <name>");
    return name;
  }
};
var REMINDER = `>>> \u63D0\u9192: flow status \u83B7\u53D6\u4E0A\u4E0B\u6587 | flow advance --note "..." \u8BB0\u5F55\u4EA7\u7269 | \u7981\u6B62\u8DF3\u6B65`;
var USAGE = `\u7528\u6CD5: flow <command>
  create <name>    \u521B\u5EFA\u5DE5\u4F5C\u6D41 (stdin \u8BFB\u53D6 markdown)
  start <name>     \u542F\u52A8\u5DE5\u4F5C\u6D41
  advance          \u63A8\u8FDB\u5F53\u524D\u6B65\u9AA4 [--note "..."] [--artifact path]
  branch <choice>  \u9009\u62E9\u5206\u652F\u8DEF\u5F84
  spawn            \u6D3E\u751F\u5B50\u5DE5\u4F5C\u6D41 (stdin \u8BFB\u53D6 markdown)
  return <parent>  \u8FD4\u56DE\u7236\u5DE5\u4F5C\u6D41
  status [name]    \u67E5\u770B\u5F53\u524D\u72B6\u6001\u4E0E\u4E0A\u4E0B\u6587\u6CE8\u5165
  list             \u5217\u51FA\u6240\u6709\u5DE5\u4F5C\u6D41
  caps             \u5217\u51FA\u539F\u5B50\u80FD\u529B\u6E05\u5355
  edit <name>      \u66F4\u65B0\u5DE5\u4F5C\u6D41 (stdin \u8BFB\u53D6 markdown)
  init-context     \u626B\u63CF docs/ \u751F\u6210 .workflow/context.json`;

// src/main.ts
var basePath = process.cwd();
var __dirname = dirname(fileURLToPath(import.meta.url));
var promptsDir = join4(__dirname, "..", "prompts");
var config = await loadContextConfig(basePath);
var repo = new FsWorkflowRepository(basePath);
var workflowService = new WorkflowService(repo, parseWorkflowMarkdown);
var contextService = new ContextService(workflowService, promptsDir, basePath, config);
var cli = new CLI(workflowService, contextService, () => generateContextConfig(basePath));
cli.run(process.argv);
