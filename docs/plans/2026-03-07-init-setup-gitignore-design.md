# init/setup `.gitignore` 自动补齐设计

> **实现状态：未开始**
> **范围限定：仅在 `init` / `setup` 阶段确保目标项目 `.gitignore` 包含 `.claude/worktrees/`，不引入配置系统，不扩展到其他忽略规则，也不修改其他运行阶段行为。**

## 目标

在 FlowPilot 执行 `init` 和 `setup` 时，自动确保目标项目根目录的 `.gitignore` 含有一条规则：

```gitignore
.claude/worktrees/
```

该行为必须满足以下要求：

- `.gitignore` 不存在时自动创建。
- `.gitignore` 已存在时只追加缺失规则，不覆盖原内容。
- 同一条规则只保留一份，不重复追加。
- `init` / `setup` 以外的运行阶段不得触碰 `.gitignore`。
- 实现方式必须是一个被 `WorkflowService.init()` 和 `WorkflowService.setup()` 共同调用的仓储层 helper。

## 已批准约束

- 只处理一条固定规则：`.claude/worktrees/`。
- 不新增配置项，不做“可配置忽略规则列表”。
- 不顺带补 `.claude/`、`.workflow/`、`.flowpilot/` 等其他规则。
- 不修改 `next`、`nextBatch`、`resume`、`checkpoint`、`finish`、`abort`、`review` 等阶段的职责。
- 不改动自动提交、hooks 注入、CLAUDE 协议块注入的现有边界。

## 当前代码上下文

### 1. 应用层已有两个明确入口

- `src/application/workflow-service.ts`
  - `init()` 已负责接管期写入：`saveProgress()`、`saveTasks()`、`saveSummary()`、`ensureClaudeMd()`、`ensureHooks()`。
  - `setup()` 已负责轻量接管：`ensureClaudeMd()`、`ensureHooks()`，然后返回面向用户的文案。

这两个方法正是本次需求允许触碰 `.gitignore` 的唯一入口。

### 2. 仓储层已经承接“向目标项目写文件”的责任

- `src/infrastructure/fs-repository.ts`
  - 已负责写 `CLAUDE.md`。
  - 已负责写 `.claude/settings.json`。
  - 已掌握目标项目根目录 `this.base`。

因此，把 `.gitignore` 规则补齐逻辑继续放在仓储层，最符合当前分层边界，也能避免把文件系统细节泄漏到 `WorkflowService`。

### 3. 现有接口尚无 `.gitignore` helper

- `src/domain/repository.ts`
  - 当前 `WorkflowRepository` 还没有 “ensure gitignore rule” 的契约。

如果要让 `WorkflowService` 通过抽象接口复用该能力，就需要在接口层补一个明确且收敛的方法。

### 4. 现有测试覆盖点合适

- `src/infrastructure/fs-repository.test.ts`
  - 适合补充 “创建 `.gitignore` / 追加规则 / 幂等不重复” 的文件系统级测试。
- `src/application/workflow-service.test.ts`
  - 适合补充 `init()` / `setup()` 接线测试，以及“其他运行阶段不触碰 `.gitignore`”的边界测试。

## 方案设计

## 一、在仓储接口中新增一个专用 helper

建议在 `src/domain/repository.ts` 中新增一个**专用**方法，而不是做成泛化的 ignore 管理器：

```ts
ensureClaudeWorktreesIgnored(): Promise<boolean>;
```

返回值语义：

- `true`：本次创建了 `.gitignore` 或追加了新规则。
- `false`：目标规则已存在，本次无需改动。

### 为什么用专用 helper，而不是泛化配置

- 本次需求只针对一条固定规则，做泛化会超出批准范围。
- `WorkflowService` 只需要表达“确保 worktree 目录被忽略”，不需要知道 `.gitignore` 的读写细节。
- 与现有 `ensureClaudeMd()` / `ensureHooks()` 风格一致，认知负担最低。

## 二、在 `FsWorkflowRepository` 中实现最小且幂等的文件写入

建议在 `src/infrastructure/fs-repository.ts` 中实现如下逻辑：

1. 计算目标路径：`<projectRoot>/.gitignore`
2. 目标文件不存在时：
   - 创建 `.gitignore`
   - 写入：`.claude/worktrees/\n`
   - 返回 `true`
3. 目标文件已存在时：
   - 读取原内容
   - 以“按行检查、去掉行尾空白后精确匹配 `.claude/worktrees/`”的方式判断规则是否已存在
   - 已存在则返回 `false`
   - 不存在则在原内容末尾追加一行 `.claude/worktrees/`
   - 绝不覆盖原文件已有内容
   - 返回 `true`

### 推荐实现细节

- 只把**精确的目标规则** `.claude/worktrees/` 视为“已存在”。
- 不把 `.claude/`、`.claude/worktrees`、注释行、空白行当作等价替代。
- 如果原文件末尾没有换行，追加前先补一个换行；如果已有换行，则直接追加。
- 若读取失败且错误不是 `ENOENT`，应直接抛出，避免把权限错误等问题误当成“文件不存在”。

## 三、仅在 `init()` 和 `setup()` 调用该 helper

### `WorkflowService.init()` 数据流

建议调用顺序保持接管期聚合，不引入新的阶段：

1. 解析任务 markdown
2. 写 `progress.md`
3. 写 `tasks.md`
4. 写 `summary.md`
5. `ensureClaudeMd()`
6. `ensureHooks()`
7. `ensureClaudeWorktreesIgnored()`
8. 继续原有历史经验、记忆、心跳逻辑

重点：`.gitignore` 补齐发生在接管期，且只执行一次，不影响任务执行循环。

### `WorkflowService.setup()` 数据流

建议顺序与 `init()` 保持一致：

1. 读取现有进度
2. `ensureClaudeMd()`
3. `ensureHooks()`
4. `ensureClaudeWorktreesIgnored()`
5. 继续拼接已有的 setup 输出文案

重点：`setup()` 是另一条明确接管入口，也必须执行同一 helper，不能复制一份 `.gitignore` 写入逻辑。

### 非 `init` / `setup` 阶段的数据流边界

以下方法必须保持对 `.gitignore` 的“零接触”：

- `next()`
- `nextBatch()`
- `checkpoint()`
- `resume()`
- `add()`
- `skip()`
- `review()`
- `finish()`
- `rollback()`
- `abort()`
- `rollbackEvolution()`
- `recall()`
- `evolve()`
- `status()`
- `cleanupInjections()`

也就是说：**`.gitignore` 不是运行时状态文件，而是接管期的一次性环境准备。**

## 行为边界

## 必须做

- 若 `.gitignore` 缺失，创建它。
- 若规则缺失，保留原内容并在末尾补 `.claude/worktrees/`。
- 若规则已存在，不重复追加。
- `init` / `setup` 共用同一个仓储层 helper。

## 明确不做

- 不覆盖 `.gitignore` 的现有内容。
- 不整理或重排 `.gitignore`。
- 不删除重复的历史脏数据，只保证“这次实现不新增重复行”。
- 不写 `.git/info/exclude`、全局 gitignore、或任何 git 配置。
- 不把 `.claude/` 整体加入忽略。
- 不新增 CLI 参数、环境变量或配置项。
- 不让 `finish()` / `abort()` 在收尾阶段回写 `.gitignore`。

## 受影响文件

本次最可能改动的文件应严格收敛在以下范围：

- `src/domain/repository.ts`
- `src/infrastructure/fs-repository.ts`
- `src/application/workflow-service.ts`
- `src/infrastructure/fs-repository.test.ts`
- `src/application/workflow-service.test.ts`

若实现过程中需要改动其他文件，应先证明这些文件是本需求不可避免的直接依赖；否则视为超范围。

## 测试设计

## 一、仓储层测试

在 `src/infrastructure/fs-repository.test.ts` 中补以下场景：

1. **文件不存在时创建**
   - 初始状态无 `.gitignore`
   - 调用 helper 后应生成 `.gitignore`
   - 文件内容应为 `.claude/worktrees/\n`

2. **文件存在但缺少规则时追加**
   - 初始内容例如：`node_modules/\n`
   - 调用 helper 后内容应变为：
     - `node_modules/\n.claude/worktrees/\n`
   - 原内容必须完整保留

3. **规则已存在时幂等**
   - 初始内容已含 `.claude/worktrees/`
   - 再次调用 helper：
     - 返回 `false`
     - 文件内容不变
     - 规则不重复

4. **无尾换行时追加格式正确**
   - 初始内容例如：`node_modules/`
   - 调用后应得到：`node_modules/\n.claude/worktrees/\n`

## 二、应用层测试

在 `src/application/workflow-service.test.ts` 中补以下场景：

1. **`init()` 会补齐规则**
   - 预先写入已有 `.gitignore`
   - 调用 `svc.init(...)`
   - 断言规则被追加且原内容保留

2. **`setup()` 会创建 `.gitignore`**
   - 初始状态无 `.gitignore`
   - 调用 `svc.setup()`
   - 断言文件被创建且内容正确

3. **运行阶段不调用 helper**
   - 对仓储 helper 做 spy
   - `init()` 完成后清空 spy 计数
   - 调用若干运行阶段方法（例如 `next()`、`checkpoint()`、`resume()`）
   - 断言 helper 未再被调用

## 推荐验证命令

在仓库根目录 `/home/zzz/桌面/2026开发/tools/FlowPilot` 下执行：

```bash
npm test -- --run src/infrastructure/fs-repository.test.ts
npm test -- --run src/application/workflow-service.test.ts
npm test -- --run
```

## 验收标准

满足以下条件即可认为需求设计被正确实现：

- `init()` 和 `setup()` 都会确保目标项目 `.gitignore` 含有 `.claude/worktrees/`。
- `.gitignore` 缺失时会被创建。
- `.gitignore` 已存在时不会被覆盖。
- `.claude/worktrees/` 不会被重复追加。
- `init()` / `setup()` 以外的运行阶段不会写 `.gitignore`。
- 实现通过一个共享的仓储层 helper 完成，而不是在 `WorkflowService` 中复制文件处理逻辑。
- 相关 Vitest 测试覆盖创建、追加、幂等、无换行追加，以及应用层接线边界。
