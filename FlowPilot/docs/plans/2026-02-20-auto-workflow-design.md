# 全自动工作流引擎改造设计

> **实现状态：已完成** (2026-02-20)
> 所有核心目标已达成，额外实现了并行任务批处理、多语言验证、Hooks强制拦截等增强功能。

## 目标

将 workflow-engine 改造为 CC (Claude Code) 环境下的全自动开发调度工具：
- ✅ 主Agent极简调度，所有任务派发子Agent（协议铁律强制）
- ✅ 分层记忆实现无限上下文（超10任务自动压缩摘要）
- ✅ 跨会话无缝恢复（万步0偏移）
- ✅ 插件驱动的专业化子Agent分工
- ✅ **新增** Hooks 强制拦截（禁用 TaskCreate/TaskUpdate/TaskList）

## 核心架构

```
主Agent（调度器）
  │  只做：flow next → 派发子Agent → flow checkpoint
  │  上下文占用：< 100行（协议+当前任务）
  │
  ├── CLAUDE.md（协议嵌入层）
  │     <!-- flowpilot:start/end --> 标记包裹完整调度协议
  │     CC 启动时自动读取，无需额外引用
  │
  ├── flow CLI（状态管理层）
  │     管理任务树、进度、记忆文件
  │
  └── .workflow/（持久化层）
        ├── progress.md          # 任务状态列表（主Agent读）
        ├── tasks.md             # 完整任务树+依赖+类型
        └── context/
            ├── summary.md       # 滚动摘要（关键决策）
            ├── task-001.md      # 任务详细产出
            ├── task-002.md
            └── ...
```

## 命令设计

### 已实现命令（8个）

| 命令 | 用途 | 状态 |
|------|------|------|
| `flow init [--force]` | 解析文档→任务树+CLAUDE.md协议嵌入+Hooks注入 / 无stdin则接管项目 | ✅ |
| `flow next [--batch]` | 返回下一个/所有可并行任务（含依赖上下文） | ✅ |
| `flow checkpoint <id>` | 记录任务完成（stdin/--file/内联文本）+ FAILED重试 | ✅ |
| `flow skip <id>` | 手动跳过任务 | ✅ 新增 |
| `flow finish` | 智能收尾（多语言验证+汇报跳过失败项+回到idle） | ✅ 新增 |
| `flow status` | 全局进度概览 | ✅ |
| `flow resume` | 中断恢复，重置active→pending（支持并行中断） | ✅ |
| `flow add <描述> [--type T]` | 运行中追加任务（参数顺序任意） | ✅ |

### 已移除命令

- `flow list` / `flow caps` — 不再需要
- `create/start/advance/branch/spawn/return` → 合并进 `init/next/checkpoint`

## 分层记忆机制

### 第一层：progress.md（主Agent读）

极简状态列表，主Agent只需读这个文件就知道全局进度：

```markdown
# 项目进度

## 状态: running
## 当前: task-007

| ID | 标题 | 类型 | 状态 | 摘要 |
|----|------|------|------|------|
| 001 | 数据库设计 | backend | done | PostgreSQL 5张表 |
| 002 | API路由 | backend | done | RESTful 12个端点 |
| ... | ... | ... | ... | ... |
| 007 | 用户列表页 | frontend | active | - |
| 008 | 搜索功能 | frontend | pending | - |
```

### 第二层：context/task-xxx.md（子Agent读）

每个任务完成后的详细产出记录：

```markdown
# task-003: 数据库设计

## 产出
- 创建了 prisma/schema.prisma
- 5张表: users, posts, comments, tags, post_tags

## 关键决策
- 使用 PostgreSQL + Prisma ORM
- 用户表包含 role 字段支持 RBAC

## 修改的文件
- prisma/schema.prisma (新建)
- .env (添加 DATABASE_URL)
```

### 第三层：context/summary.md（滚动摘要）

每完成10个任务自动压缩一次，保持精炼：

```markdown
# 项目摘要

## 技术栈
- 后端: Node.js + Express + Prisma + PostgreSQL
- 前端: React + TailwindCSS

## 架构决策
- RESTful API，12个端点
- JWT 认证，RBAC 权限

## 已完成模块
- 数据库层 (task 001-003)
- API层 (task 004-006)
```

### 上下文注入规则

`flow next` 返回任务时自动拼装上下文：
1. 读 summary.md（全局背景）
2. 读该任务声明的依赖任务的 task-xxx.md
3. 拼装成子Agent的完整输入

## 插件集成

### 任务类型与插件映射

| 任务类型 | 调用插件 | 触发方式 |
|---------|---------|---------|
| frontend | frontend-design | 子Agent执行 `/frontend-design` |
| backend | feature-dev | 子Agent执行 `/feature-dev` |
| general | 无 | 子Agent直接执行 |

### 任务拆解阶段

使用 `superpowers:brainstorming` 插件进行头脑风暴后自动拆解：
- CLAUDE.md 嵌入协议中明确要求主Agent调用该技能
- 头脑风暴完成后，结果写入 tasks.md

### 环境依赖

以下环境依赖需用户手动安装，`flow init` 输出中会提醒：
- Agent Teams（Settings → Feature Flags → Agent Teams）
- 插件：superpowers、frontend-design、feature-dev、code-review（通过 `/plugin` 安装）
- context7 MCP（`~/.claude/mcp.json` 配置）

### Hooks 强制拦截

`flow init` 自动在目标项目 `.claude/settings.json` 中注入 PreToolUse hook：
- 拦截 TaskCreate/TaskUpdate/TaskList 调用，强制使用 `node flow.js` 命令
- 幂等写入：已有相同 matcher 则跳过
- 与现有 settings.json 合并，不覆盖

## 协议嵌入（CLAUDE.md 直接注入）

> 已废弃独立的 protocol.md 文件。协议直接嵌入 CLAUDE.md，CC 合规性最高。

`flow init` / `flow init`（无stdin接管模式）通过 `ensureClaudeMd()` 将完整协议块注入项目 CLAUDE.md：
- 使用 `<!-- flowpilot:start -->` / `<!-- flowpilot:end -->` 标记包裹
- 幂等写入：已存在标记则跳过
- 协议使用英文祈使句风格（NEVER / MUST / ALWAYS），CC 合规性最佳
- 包含：触发规则、铁律、执行循环、子Agent规则、安全规则、收尾流程、崩溃恢复

## 错误处理与恢复

### 任务失败
- 子Agent失败 → 自动重试（最多3次）
- 3次仍失败 → 标记 `failed`，跳到下一个可执行任务
- 所有任务完成后汇报失败项，让用户决定

### 中断恢复（flow resume）
1. 读 progress.md 找到状态为 `active` 的任务
2. 将其重置为 `pending`（重做策略）
3. 返回恢复点信息，主Agent从该任务继续循环

### CLAUDE.md 自引导
`flow init` 将完整协议块直接嵌入项目 CLAUDE.md（`<!-- flowpilot:start/end -->` 标记）。
新窗口打开CC → 自动读CLAUDE.md → 发现嵌入协议 → 用户说"开始" → flow resume → 无缝继续

## 实现计划

> 全部4个阶段已完成，额外新增 git.ts、verify.ts、stdin.ts。

### 阶段1：领域层 ✅

- `types.ts` — TaskType、TaskEntry、ProgressData、WorkflowStatus ✅
- `task-store.ts` — findNextTask/findParallelTasks/completeTask/failTask/resumeProgress ✅
- `workflow.ts` — 简化为 TaskDefinition + WorkflowDefinition ✅
- runtime.ts、task-tree.ts — 已移除 ✅

### 阶段2：应用层 ✅

- `workflow-service.ts` — 8个用例（init/next/nextBatch/checkpoint/skip/resume/add/finish/setup/status） ✅
- 上下文注入直接内置于 next/nextBatch，无需独立 context-service ✅
- ~~`protocol-generator.ts`~~ — 已删除，协议直接嵌入 CLAUDE.md（generateClaudeMdBlock）

### 阶段3：接口层 ✅

- `cli.ts` — 8个命令路由 ✅
- `formatter.ts` — formatStatus/formatTask/formatBatch ✅
- `stdin.ts` — 新增，管道输入检测 ✅

### 阶段4：基础设施层 ✅

- `fs-repository.ts` — progress.md读写+context/+summary+CLAUDE.md协议嵌入 ✅
- `markdown-parser.ts` — 支持类型+依赖+缩进描述 ✅
- `git.ts` — 新增，每任务自动commit ✅
- `verify.ts` — 新增，7种语言自动检测验证 ✅

### 最终文件清单

| 文件 | 操作 | 状态 |
|------|------|------|
| src/domain/types.ts | 修改 | ✅ |
| src/domain/task-store.ts | 新建 | ✅ |
| src/domain/workflow.ts | 简化 | ✅ |
| src/domain/runtime.ts | 删除 | ✅ |
| src/domain/task-tree.ts | 删除 | ✅ |
| src/application/workflow-service.ts | 重写(8用例) | ✅ |
| src/application/protocol-generator.ts | 已删除（协议嵌入CLAUDE.md） | ✅ |
| src/infrastructure/fs-repository.ts | 重写 | ✅ |
| src/infrastructure/markdown-parser.ts | 重写 | ✅ |
| src/infrastructure/git.ts | 新建(计划外) | ✅ |
| src/infrastructure/verify.ts | 新建(计划外) | ✅ |
| src/infrastructure/repository.ts | 新建(接口) | ✅ |
| src/interfaces/cli.ts | 重写(8命令) | ✅ |
| src/interfaces/formatter.ts | 简化 | ✅ |
| src/interfaces/stdin.ts | 新建(计划外) | ✅ |
| src/main.ts | 适配 | ✅ |
