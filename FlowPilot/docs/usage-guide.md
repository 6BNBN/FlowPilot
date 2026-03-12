# FlowPilot - 使用说明

[English](usage-guide.en.md)

## 这是什么

一个单文件工具，让 Claude Code / Codex / Cursor / snow-cli 等客户端进入全自动开发模式。
复制一个文件到项目里，一句开发需求，它就会自动拆解需求、分配任务、写代码、提交 git、跑测试，直到全部完成。

## 快速开始

```bash
# 1. 复制 flow.js 到你的项目
cp /path/to/workflow-engine/dist/flow.js  你的项目目录/

# 2. 初始化（会显示客户端选项）
cd 你的项目目录
node flow.js init

# 3. 打开客户端，直接描述需求
claude --dangerously-skip-permissions
```

初始化时会直接显示客户端选项：
- `Claude Code`：生成 `CLAUDE.md` + `.claude/settings.json`
- `Codex`：生成 `AGENTS.md`，并附加 Codex 平台增强规则（并行调度 + 子任务契约）
- `Cursor` / `Other`：生成通用版 `AGENTS.md`
- `snow-cli`：生成 `AGENTS.md` + `ROLE.md`

中断恢复：

```bash
claude --dangerously-skip-permissions --continue
```

下面的「前置条件」「详细初始化步骤」会解释每一步为什么这样做。

## 前置条件

- Node.js >= 20
- 已安装一个受支持的客户端：`Claude Code`、`Codex`、`Cursor`、`snow-cli` 或其他可运行 instruction file 的客户端
- 按客户端开启并行 / 自动运行：
  - `Claude Code`：在 `~/.claude/settings.json` 中添加 `"env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }`
  - `Codex`：在 `~/.codex/config.toml` 中加入
    ```toml
    [features]
    multi_agent = true
    ```
    建议全自动运行时使用：`codex --yolo`
  - `Cursor`：在设置的 `Agents` 中开启 `Agents`，并将 `Auto-Run Mode` 调成 `Run Everything`
  - `其他客户端`：请先自测多代理 / 自动运行能力
- **建议先安装插件 / 技能**（未安装则功能降级）：
  - Claude Code 可通过 `/plugin` 安装 `superpowers`、`frontend-design`、`feature-dev`、`code-review`、`context7`
  - Codex / Cursor 可用文末的一键安装包

## 详细初始化步骤

### 第一步：复制 flow.js 到你的项目

```bash
cp /path/to/workflow-engine/dist/flow.js  你的项目目录/
```

### 第二步：初始化

```bash
cd 你的项目目录
node flow.js init
```

这会自动生成：
- 会先显示客户端选项，并按选择生成：
  - `CLAUDE.md` — `Claude Code` 模式默认 instruction file（旧项目也继续兼容）
  - `AGENTS.md` — `Codex / Cursor / Other` 模式默认 instruction file
  - `ROLE.md` — 仅在选择 `snow-cli` 时额外生成，内容与 `AGENTS.md` 一致
  - `.claude/settings.json` — 仅在选择 `Claude Code` 时生成
- 生成的 instruction file 会将终端输出风格作为硬约束，并默认强化依赖分析、并行调度与危险操作确认；其中 `Codex` 额外补强子任务下发契约（代理名称 / 任务定义 / 执行动作 / 预期结果）
- `status / next / finish / review / init` 也会使用更友好的终端风格：强分组标题、状态图标、下一步提示，以及更直观的实时状态卡片
- `Codex` 的增强规则还会显式要求按“任务分析 → 并行调度与子任务下发 → 结果汇总 → 递归迭代”推进复杂任务
- 上述风格升级只作用于**表现层**：不会改变工作流调度、协议流程优先级、命令参数格式、checkpoint 规则或状态机语义
- `.workflow/` 目录 — 本地临时运行态
- `.gitignore` 本地状态忽略规则（若缺失）— 默认忽略 `.workflow/`、`.flowpilot/`、`.claude/settings.json`、`.claude/worktrees/`

### 第三步：描述需求

打开 CC 窗口，直接描述你要做什么：

```
帮我做一个博客系统，要有用户注册登录、文章发布、评论功能
```

CC 会自动：
1. 检测是否有未完成的工作流（有则从断点继续）
2. 没有 → 拆解你的需求，开始全自动执行

## 使用场景

### 场景一：新项目从零开始

```
你：帮我做一个博客系统，要有用户注册登录、文章发布、评论功能
CC：（自动拆解为 10+ 个任务，按依赖顺序逐个执行）
```

### 场景二：已有项目增量开发

```bash
cd 已有项目
node flow.js init    # 接管项目
# 开CC，描述开发需求
你：给现有系统加一个搜索功能
```

### 场景三：中断恢复

电脑关了、CC崩了、上下文满了，都没关系：

```
# 新开一个CC窗口
你：继续任务
CC：恢复工作流: 博客系统 | 进度: 7/12 | 检测到中断任务 008 的待接管变更，已暂停继续调度
```

客户端建议：
- `Claude Code`：优先使用 `claude --dangerously-skip-permissions --continue`
- `Codex`：重新进入项目目录，运行 `codex --yolo` 后说「继续任务」
- `Cursor`：重新打开项目，在原会话或新会话中说「继续任务」
- `snow-cli` / 其他客户端：重新进入项目目录，恢复或新开会话后说「继续任务」

如果工作区仍然有未归档变更，`resume` 会继续补充真实边界信息，而不是笼统地说“已恢复”：
- 启动前就存在、现在仍保留的 baseline 未归档变更
- 由显式 ownership 支撑、可接管的 task-owned 变更
- 工作流期间新增但归属未明的变更（可能包含用户手动修改/删除；FlowPilot 不会自动恢复这些文件）
- dirty baseline 缺失时的保守警告（会明确说无法证明这是干净重启，也无法区分用户手动操作）
- 若存在待处理变更，工作流进入 `reconciling`，必须先 `adopt`，或在确认并处理列出的 task-owned 变更后 `restart`

## 命令参考

| 命令 | 用途 |
|------|------|
| `node flow.js init` | 初始化/接管项目 |
| `node flow.js init --force` | 强制重新初始化（覆盖已有工作流） |
| `node flow.js status` | 查看当前进度 |
| `node flow.js next` | 获取下一个任务（含依赖上下文） |
| `node flow.js next --batch` | 获取所有依赖上可并行且适合批量派发的任务 |
| `node flow.js checkpoint <id>` | 标记任务完成（stdin/--file/内联文本）[--files f1 f2 ...] |
| `node flow.js adopt <id>` | 接管中断后待接管变更并补 checkpoint |
| `node flow.js restart <id>` | 在处理完列出的本任务变更后允许任务从头重做；归属未明变更需人工确认 |
| `node flow.js skip <id>` | 跳过某个任务 |
| `node flow.js resume` | 中断恢复（必要时进入 reconciling） |
| `node flow.js review` | 标记code-review已完成（finish前必须执行） |
| `node flow.js finish` | 智能收尾（执行自动验证、输出最终任务总结；未review或最终commit未成功时不会结束工作流） |
| `node flow.js add <描述> [--type T]` | 追加新任务（参数顺序任意） |
| `node flow.js recall <关键词>` | 检索历史记忆（BM25 + MMR + 时间衰减） |
| `node flow.js evolve` | 接收 AI 反思结果并执行进化（stdin 传入） |

> 注意：正常使用时你不需要手动执行这些命令，CC 会按协议自动调用。

### `status` 现在会显示什么

`node flow.js status` 不再只是“任务标题 + 状态码”，而会优先把用户最关心的信息前置出来：

```text
**当前状态**
完成 2/4 | 1 进行中 | 1 阻塞

**任务进度**
[x] 001 修复入口
[>] 002 实现中 | 8s 前更新 | 正在跑测试
[!] 003 阻塞中 | 等待人工确认
[ ] 004 待执行

**下一步**
- 先处理 003 的阻塞
- 然后继续 finish
```

如果子代理持续上报阶段，FlowPilot 会进一步展示：
- `分析中 / 实现中 / 验证中 / 阻塞中`
- 最近活动时间
- 最近一句进展摘要
- 基于 heartbeat 的疑似卡住提示

### `finish` 现在具体会做什么

`node flow.js finish` 的收尾顺序现在更明确：

1. 先执行自动验证  
   优先使用 `.flowpilot/config.json` / `.workflow/config.json` 中的 `verify.commands`；若当前目录没有可检测脚本，但只有一个可识别子项目，也会自动进入该子项目执行验证。`vitest` 会自动改成 `--run`，避免 watch 卡住。
2. 再输出本轮工作流最终总结  
   终端会打印完整任务列表，并用 `[x] / [-] / [!] / [ ]` 标记完成、跳过、失败、未完成。
3. 在删除 `.workflow/` 前先写出 `.workflow/final-summary.md`  
   这样流程内可以验证“先总结、后清理”，用户也能在目录清理前拿到 summary 文件。
4. 只有在 `review` 已完成且最终 commit 真正成功后，才会执行清理并切回 idle；若没有待提交文件，会补一个显式最终收尾提交来保持严格语义

如果验证失败，`finish` 会中断收尾并要求先修复。即使验证通过，只要还没执行 `review`，或者最终 commit 因边界不安全等原因没有成功，FlowPilot 也会保留工作流并明确提示下一步，而不是提前清理 `.workflow/`。只有在 `review` 已通过且边界安全、但工作区没有待提交文件时，才会自动补一个显式最终收尾提交。

## 任务输入格式

`node flow.js init` 通过 stdin 接收任务列表：

```markdown
# 博客系统

全栈博客应用

1. [backend] 数据库设计
   PostgreSQL + Prisma，用户表、文章表、评论表
2. [backend] API 路由 (deps: 1)
   RESTful API，CRUD 接口
3. [frontend] 首页 (deps: 2)
   文章列表、分页
4. [general] 部署配置 (deps: 2,3)
   Docker + nginx 配置
```

格式规则：
- `[类型]` — frontend / backend / general
- `(deps: 编号)` — 依赖的前置任务（可选）
- 缩进行 — 任务描述（可选）

## 生成的文件结构

```
你的项目/
├── flow.js                    # 工具本体（你复制过来的）
├── CLAUDE.md / AGENTS.md      # 按客户端选择生成的 instruction file
├── ROLE.md                    # 仅 snow-cli 模式额外生成
└── .workflow/
    ├── progress.md            # 任务状态表（核心记忆）
    ├── tasks.md               # 原始任务定义
    └── context/
        ├── summary.md         # 滚动摘要（全局背景）
        ├── task-001.md        # 任务1的详细产出
        ├── task-002.md        # 任务2的详细产出
        └── ...
```

## 工作原理

```
用户描述开发需求
    ↓
客户端读取 instruction file（`Claude Code` 默认 `CLAUDE.md`，`Codex / Cursor / Other` 默认 `AGENTS.md`，旧项目兼容原有文件）→ 发现嵌入协议 → 进入调度模式
    ↓
flow resume → 检查是否有未完成工作流
    ↓
flow next --batch → 返回所有依赖上可并行任务 + 依赖上下文
    ↓
CC 用 Task 工具并行派发子Agent（Agent Teams）
    ↓
子Agent自行 checkpoint → 记录产出 + 自动git提交
    ↓
主Agent确认进度 → 循环直到全部完成
    ↓
code-review → flow review → 解锁finish
    ↓
flow finish → 自动跑 build/test/lint → 汇报完成/跳过/失败项 → 清除.workflow/ → 最终提交
    ↓
回到待命，等待下一个需求
```

## Agent Teams 并行开发详解

这是 FlowPilot 最强大的能力。理解并行机制能让你的开发效率翻倍。

### 并行是怎么工作的

```
主Agent（调度器）
  │
  ├── flow next --batch
  │   返回所有依赖已满足的任务（比如3个）
  │
  ├── 同时派发3个子Agent（一条消息，3个Task工具调用）
  │   ├── 子Agent-A → 执行任务001 → 自行checkpoint
  │   ├── 子Agent-B → 执行任务002 → 自行checkpoint
  │   └── 子Agent-C → 执行任务003 → 自行checkpoint
  │
  └── 3个子Agent全部返回后
      主Agent执行 flow status 确认 → 继续下一轮
```

关键点：
- 主Agent 优先用 `flow next --batch` 一次性获取所有依赖上可并行任务；若写入边界仍不清晰，可暂时用 `flow next` 串行推进
- 在**同一条消息**中用多个 Task 工具调用并行派发
- 每个子Agent**独立工作、独立checkpoint、独立git提交**
- 主Agent上下文不会因为子Agent的产出而膨胀（子Agent自行记录）

### 如何设计任务依赖以最大化并行

核心原则：**没有依赖关系的任务会被自动并行执行**。

差的设计（全串行，一个接一个）：
```markdown
1. [backend] 数据库设计
2. [backend] 用户API (deps: 1)
3. [backend] 文章API (deps: 2)      ← 其实不依赖用户API
4. [frontend] 用户页面 (deps: 3)     ← 其实只依赖用户API
5. [frontend] 文章页面 (deps: 4)     ← 其实只依赖文章API
```

好的设计（充分并行）：
```markdown
1. [backend] 数据库设计
2. [backend] 用户API (deps: 1)
3. [backend] 文章API (deps: 1)       ← 只依赖数据库，和2并行
4. [frontend] 用户页面 (deps: 2)     ← 只依赖用户API
5. [frontend] 文章页面 (deps: 3)     ← 只依赖文章API，和4并行
6. [general] 集成测试 (deps: 4,5)
```

执行时间线对比：
```
差的设计: 1 → 2 → 3 → 4 → 5          （5轮）
好的设计: 1 → [2,3] → [4,5] → 6      （4轮，任务2和3并行，4和5并行）
```

### 实战示例：电商系统

```markdown
# 电商平台

全栈电商应用

1. [backend] 数据库设计
   PostgreSQL: users, products, orders, payments, cart
2. [backend] 认证模块 (deps: 1)
   JWT + bcrypt，注册/登录/刷新token
3. [backend] 商品API (deps: 1)
   CRUD + 分页搜索 + 图片上传
4. [backend] 订单API (deps: 1)
   下单/支付/退款流程
5. [frontend] 公共组件库
   Header/Footer/Card/Modal/Form组件
6. [frontend] 商品列表页 (deps: 3,5)
   商品卡片、筛选、分页
7. [frontend] 购物车页 (deps: 3,5)
   增删改查、数量调整
8. [frontend] 登录注册页 (deps: 2,5)
   表单验证、错误提示
9. [frontend] 订单页 (deps: 4,8)
   下单流程、订单历史
10. [general] E2E测试 (deps: 6,7,8,9)
    Playwright 核心流程测试
```

执行时间线：
```
第1轮: [1, 5]           ← 数据库和前端组件库并行
第2轮: [2, 3, 4]        ← 三个API模块并行
第3轮: [6, 7, 8]        ← 三个前端页面并行
第4轮: [9]              ← 订单页（依赖登录和订单API）
第5轮: [10]             ← E2E测试
```

10个任务只需5轮，如果串行需要10轮。

### 并行中断与恢复

并行执行中如果中断（CC崩溃、compact、关窗口），所有正在执行的子Agent任务都会停留在 `active` 状态。

恢复流程：
```
新窗口 → 说：继续任务 → flow resume
  ↓
检测到3个active任务 → 全部重置为pending
  ↓
flow next --batch → 重新并行派发这3个任务（前提是写边界清晰）
```

`flow resume` 会把**所有** active 任务重置为 pending，不管有几个。这意味着并行中断后恢复时，那一批任务会被完整重做。已经 checkpoint 的任务不受影响。

同时，resume 会如实说明 dirty worktree 的状态：
- `当前工作区无待接管变更，本次恢复是干净重启`
- `工作流启动前已有 N 个未归档变更仍然保留`
- `已保留 N 个由显式 ownership 支撑的待接管变更`
- `发现 N 个工作流期间新增但归属未明的变更（可能包含用户手动修改/删除，FlowPilot 不会自动恢复这些文件）`
- `未找到 dirty baseline；无法可靠区分启动前变更、中断任务残留与用户手动修改/删除`

这段提示是边界说明，不是报错；它的目的就是防止把脏工作区误说成“完全干净”。

### 并行开发注意事项

1. **文件冲突**：并行的子Agent可能修改同一个文件。设计任务时尽量让并行任务操作不同的文件
2. **依赖宁多勿少**：如果不确定两个任务是否有依赖，加上依赖更安全。错误的并行比串行更危险
3. **粒度适中**：任务太大并行收益低，太小则调度开销大。建议每个任务对应一个独立模块或功能点

## 支持的项目类型

收尾阶段 `flow finish` 会自动检测并执行验证：

| 项目类型 | 检测文件 | 执行命令 |
|---------|---------|---------|
| Node.js | package.json | 存在哪些 script 就按顺序执行哪些；例如本仓库会执行 `npm run build`、`npm run test` |
| Rust | Cargo.toml | cargo build/test |
| Go | go.mod | go build/test |
| Python | pyproject.toml | pytest/ruff/mypy |
| Java (Maven) | pom.xml | mvn compile/test |
| Java (Gradle) | build.gradle | gradle build |
| C/C++ | CMakeLists.txt | cmake --build/ctest |
| 通用 | Makefile | make build/test/lint |

验证语义是“逐步可解释”的：
- **通过（passed）**：命令成功执行，例如 `- 通过: npm run build`
- **跳过（skipped）**：命令执行后确认没有可跑内容，例如 Vitest 的 `No test files found` 会显示为 `- 跳过: ...（未找到测试文件）`
- **未发现命令（not-found）**：仓库里根本没有可执行的验证脚本，finish 会显示 `验证结果: 未发现可执行的验证命令`

也就是说，finish 不会把“没找到命令”和“命令失败”混为一谈。

## 长期记忆系统

FlowPilot 内置跨工作流的永久记忆系统，让 AI 在多轮开发中积累项目知识，避免重复犯错。

### 知识标签

子Agent 在 checkpoint 时可以用标签标记关键信息，这些信息会被自动提取并永久保存：

| 标签 | 用途 | 示例 |
|------|------|------|
| `[REMEMBER]` | 值得记住的事实、发现、解决方案 | `[REMEMBER] 项目使用 PostgreSQL + Drizzle ORM` |
| `[DECISION]` | 技术决策及原因 | `[DECISION] 选择 JWT 而非 session，因为需要无状态认证` |
| `[ARCHITECTURE]` | 架构模式、数据流 | `[ARCHITECTURE] 三层架构：Controller → Service → Repository` |

checkpoint 示例：
```bash
echo '完成用户模块 [REMEMBER] 密码用bcrypt加密 [DECISION] 选择JWT认证' | node flow.js checkpoint 001 --files src/auth.ts
```

### 知识提取路径

记忆提取支持双路径，自动选择最优方式：

| 路径 | 条件 | 能力 |
|------|------|------|
| LLM 智能提取 | 有 `ANTHROPIC_API_KEY` | Extract→Decide 两阶段：先提取关键事实，再与已有记忆去重决策（ADD/UPDATE/SKIP） |
| 规则引擎 | 无 API Key 或 LLM 调用失败 | 标签行提取 + 中英文决策模式匹配 + 技术栈/配置项识别 |

两条路径都会处理 `[REMEMBER]`/`[DECISION]`/`[ARCHITECTURE]` 标签。LLM 路径额外能从自然语言中提取隐含知识。

### 检索引擎

查询记忆时使用三源融合检索：

1. **BM25 稀疏检索** — 多语言分词（CJK 前向最大匹配 + 拉丁词干提取）+ BM25 余弦相似度 + 时间衰减
2. **BM25 向量检索** — FNV-1a 20-bit 稀疏向量索引，余弦相似度 top-k
3. **Dense embedding 检索** — 调用 embedding API 生成稠密向量（需 API Key）

三源结果通过 **RRF（Reciprocal Rank Fusion）** 融合，再经 **MMR（Maximal Marginal Relevance）** 重排序，平衡相关性与多样性。

时间衰减：`score = exp(-ln2/halfLife * ageDays)`，半衰期 30 天。标记为 `architecture`/`decision`/`identity` 来源的条目不衰减（evergreen）。

### recall 命令

手动检索历史记忆：

```bash
node flow.js recall "数据库设计"
node flow.js recall "authentication strategy"
```

返回最相关的 5 条记忆，按融合得分排序。正常工作流中 `next` 命令会自动查询相关记忆并注入任务上下文，无需手动 recall。

## 自我进化系统

FlowPilot 内置三阶段自我进化循环，灵感来自 [Memoh-v2](https://github.com/Kxiandaoyan/Memoh-v2) 的有机进化架构。每轮工作流结束后自动反思和优化，无需手动触发。**成功和失败的工作流都会触发进化**——成功时提炼最佳实践，失败时分析根因并调整策略。

### 三阶段循环

**Phase 1: Reflect（反思）** — `finish()` 末尾自动触发

分析本轮工作流的成败模式：
- 连续失败链检测（≥2 个连续失败任务）
- 类型失败集中度（某类型失败率 > 30%）
- 重试热点（重试次数 > 2 的任务）
- 跳过率过高（> 20%）

有 `ANTHROPIC_API_KEY` 时用 Claude Haiku 深度分析，无则用规则引擎。

**Phase 2: Experiment（实验）** — `finish()` 末尾自动触发

基于反思报告自动调整：
- **config 参数**：`maxRetries`、`timeout`、`verifyTimeout`
- **协议模板**：在 protocol.md 末尾追加经验规则

每次修改前保存完整快照，支持回滚。

**Phase 3: Review（自愈）** — `init()` 开头自动触发

验证上轮实验效果：
- 对比最近两轮工作流的 failRate、skipRate、retryRate
- 任一指标恶化超过 10 个百分点 → 自动回滚到实验前快照
- 检查 config.json 合法性、protocol.md 完整性

### 完整进化闭环

进化不是独立步骤，而是嵌入在收尾流程中的完整闭环：

```
finish(verify) → review(code-review) → evolve → finish(再次verify)
```

具体流程：
1. `flow finish` — 运行验证，并用 `验证结果:` 列出每个命令的通过/跳过情况
2. 验证通过后提示执行 code-review → `flow review` 标记完成
3. `flow finish` 再次执行 → 检查 dirty baseline / owned files 边界，并尝试最终 commit；只有最终 commit 真正成功才会 cleanup、触发 reflect + experiment，并结束工作流
4. 如果验证失败，或存在未归属脏文件 / setup-owned 文件残留用户改动，或最终 commit 被跳过 / 降级，finish 都会拒绝结束工作流；修复后重新 finish，循环直到 verify + review + ownership boundary + final commit 全部通过

### 进化结果消费

Experiment 阶段自动调整的参数会在下一轮工作流中生效：

| 参数 | 说明 | 调整场景 |
|------|------|---------|
| `maxRetries` | 任务最大重试次数 | 重试热点多时增大，全部成功时减小 |
| `hints` | 协议模板追加的经验规则 | 从失败模式中提炼的具体建议 |
| `verifyTimeout` | 验证超时时间 | 验证超时时增大 |

### evolve 命令

手动触发进化（通常由协议自动调用）：

```bash
echo '反思结果JSON' | node flow.js evolve
```

接收 AI 反思结果（JSON 格式）并执行 experiment 阶段的参数调整。正常工作流中 `finish` 会自动触发，无需手动执行。

### 进化数据存储

```
.flowpilot/
├── evolution/
│   ├── reflect-2025-01-15T10-30-00.json   # 反思报告
│   ├── experiments.json                     # 实验日志（追加模式）
│   └── review-2025-01-16T09-00-00.json    # 审查结果
├── history/
│   ├── workflow-1.json                      # 工作流统计
│   └── workflow-2.json                      # 跨轮对比数据
└── config.json                              # 自动调优的配置
```

### 手动回滚

如果自动进化导致问题，可以手动回滚：

```bash
# 查看进化历史
cat .flowpilot/evolution/experiments.json

# 通过 workflow-service 回滚（在代码中调用）
rollbackEvolution(index)  # index 为进化日志索引
```

### 优雅降级

| 环境 | 行为 |
|------|------|
| 有 ANTHROPIC_API_KEY | LLM 深度分析 + 规则引擎双路径 |
| 无 API Key | 纯规则引擎（连续失败/类型集中/重试热点/跳过率） |
| API 调用失败 | 静默降级到规则引擎，不中断工作流 |
| 无历史数据 | 所有检查直接 pass，不做回滚 |

## 环境变量配置

| 变量 | 必需 | 说明 |
|------|------|------|
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | 是 | 设为 `1` 启用 Agent Teams（在 `~/.claude/settings.json` 的 `env` 中配置） |
| `ANTHROPIC_API_KEY` | 否 | Anthropic API Key，启用 LLM 智能提取和深度反思分析 |
| `ANTHROPIC_AUTH_TOKEN` | 否 | 替代 `ANTHROPIC_API_KEY` 的认证令牌（二选一即可） |
| `ANTHROPIC_BASE_URL` | 否 | 自定义 API 地址，默认 `https://api.anthropic.com` |

配置方式（在 `~/.claude/settings.json` 中）：

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1",
    "ANTHROPIC_API_KEY": "sk-ant-...",
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com"
  }
}
```

> 不配置 API Key 时，记忆提取和进化反思都会降级为纯规则引擎模式，核心功能不受影响。

## 常见问题

**Q: Agent Teams 没开启会怎样？**
协议会要求 CC 立即停止并提示你开启。在 `~/.claude/settings.json` 中添加 `"env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }`。

**Q: 上下文满了怎么办？**
CC 自动 compact 后，说"继续任务"即可恢复。所有状态都在文件里，不依赖对话历史。

**Q: 任务失败了怎么办？**
自动重试 3 次。3 次都失败则跳过，继续下一个。finish 收尾时会汇报所有跳过和失败的任务。

**Q: 可以中途加需求吗？**
可以。直接告诉 CC 新需求，它会执行 `flow add` 追加任务。参数顺序任意：`flow add 搜索功能 --type frontend` 或 `flow add --type frontend 搜索功能` 都行。

**Q: 不想用某个插件怎么办？**
插件是可选的。没有 frontend-design 插件时，前端任务会以 general 模式执行。

**Q: `flow finish` 为什么会拒绝最终提交？**
最常见原因有三类：
1. 有新增脏文件没有被任何 checkpoint 的 `--files` 声明归属
2. instruction file（`AGENTS.md` / 兼容旧 `CLAUDE.md`）、`.claude/settings.json`、`.gitignore` 在 cleanup 后仍残留用户改动
3. 缺少 dirty baseline，无法证明工作流边界安全

这时 FlowPilot 会停在 `finishing` 状态，并把可疑文件列出来，让你先处理，而不是替你误提交。只要最终 commit 没真正成功，工作流就不会被清掉。这里列出的 instruction file / `.claude/settings.json` / `.gitignore` 改动，应优先按“用户手动改动 / baseline 改动”理解；FlowPilot 不会自动恢复这些用户内容，也不应把它们误判成可自动清理的 workflow residue。

**Q: `.workflow` 目录要提交到 git 吗？**
通常不需要，也不建议提交。`.workflow/` 是本地临时运行态，`flow finish` 收尾成功后会自动清除；默认 `.gitignore` 也会忽略它。

**Q: `AGENTS.md` / `CLAUDE.md`、`.claude/settings.json`、`.gitignore` 收尾时会怎么处理？**
它们遵循“谁创建/注入，谁负责 cleanup”的对称规则：
- 如果是 FlowPilot 在 setup/init 阶段创建、且内容仍与注入内容完全一致，finish 会自动删除或精确回退
- 如果这些文件原本就存在，finish 只会移除 FlowPilot 注入的那部分，保留你原来的内容
- `.gitignore` 中由 FlowPilot 注入的本地状态规则默认包括 `.workflow/`、`.flowpilot/`、`.claude/settings.json`、`.claude/worktrees/`，但不会忽略整个 `.claude/` 目录
- 如果 cleanup 之后仍有用户残留改动，finish 会拒绝最终提交并把文件列出来；这些改动默认视为 user-owned，需要你自己决定保留、提交或手动整理，FlowPilot 不会自动恢复

**Q: 任务很多时摘要会不会太长？**
不会。超过 10 个已完成任务后，摘要会自动按类型压缩，只保留每组最近 3 个任务名。

## 可选：兼容 Codex / Cursor 一键安装技能

> 这是可选增强项。不安装也能正常使用 FlowPilot，只是 Skills / MCP 相关能力会降级。

仓库内置了兼容 `Codex CLI` 与 `Cursor` 的一键安装包：

- 总目录：[`兼容codex@cursor一键安装技能/`](/work2026/tools/FlowPilot/兼容codex@cursor一键安装技能)
- Codex 包：[`兼容codex@cursor一键安装技能/codex一键安装技能/`](/work2026/tools/FlowPilot/兼容codex@cursor一键安装技能/codex一键安装技能)
- Cursor 包：[`兼容codex@cursor一键安装技能/cursor一键安装技能/`](/work2026/tools/FlowPilot/兼容codex@cursor一键安装技能/cursor一键安装技能)

选择规则：
- 给 `Codex CLI` 安装技能 / MCP：使用 `codex一键安装技能/`
- 给 `Cursor` 安装技能 / MCP：使用 `cursor一键安装技能/`

常用入口：

```bash
# Codex（macOS / Linux）
cd "兼容codex@cursor一键安装技能/codex一键安装技能"
chmod +x install.sh repair.sh
./install.sh --force

# Cursor（macOS / Linux）
cd "兼容codex@cursor一键安装技能/cursor一键安装技能"
chmod +x install_cursor_skills.sh repair_cursor_skills.sh self_check_cursor_skills.sh
./install_cursor_skills.sh
```

Windows 直接运行对应目录里的 `.bat` / `.ps1` 脚本即可。

安装后要点：
- `Codex`：重启 `Codex CLI`
- `Cursor`：重启 `Cursor`
- 如果只想先用 FlowPilot 主流程，可以完全跳过这一步

## 卸载 FlowPilot

如果你之后不想继续在某个项目里使用 FlowPilot，只需要删除它带入或运行时生成的文件：

- `flow.js`（你复制进项目的单文件工具）
- instruction file：
  - `Claude Code` 模式通常是 `CLAUDE.md`
  - `Codex / Cursor / Other` 模式通常是 `AGENTS.md`
  - 兼容旧项目时会继续复用原有 instruction file
  - `snow-cli` 模式下还可能有 `ROLE.md`
- `.claude/settings.json`（如果是 FlowPilot 在 `Claude Code` 模式下生成的）
- `.workflow/`（本地临时运行态）
- `.flowpilot/`（本地持久状态）

常见做法：

```bash
rm -rf flow.js AGENTS.md CLAUDE.md ROLE.md .claude/settings.json .workflow .flowpilot
```

注意：
- 如果 `AGENTS.md` / `CLAUDE.md` / `ROLE.md` 里已经被你手动加入了项目自己的长期说明，请先保留需要的内容
- 如果 `.claude/` 目录因为删掉 `settings.json` 变成空目录，也可以一起删除
- 如果你只想停用工作流而保留 instruction file，也可以只删 `flow.js`、`.claude/settings.json`、`.workflow/`、`.flowpilot/`
