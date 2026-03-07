# FlowPilot

[English](README.en.md)

**一个文件，一句开发需求，全自动开发。**

把 `flow.js` 丢进任何项目，打开 Claude Code 描述你要做什么，然后去喝杯咖啡。
回来的时候，代码写好了，测试跑完了，git 也提交了。

## 最近更新

🔥 **OpenSpec 集成** — 任务解析器兼容 OpenSpec checkbox 格式，双路径协议自动选择标准/OpenSpec 规划流程，支持 `tasks.md` 自动发现与用户确认

🧠 **长期记忆系统** — checkpoint 自动提取知识存入 `.flowpilot/memory.json`，BM25 + Dense 双路检索，MMR 重排序 + 时间衰减，`next` 时自动注入相关记忆到子Agent上下文

🔄 **自我进化引擎（完整闭环）** — Reflect → Experiment → Review 三阶段循环，成功/失败均触发进化，参数写入 config 被工作流真正消费，退化自动回滚

| 模块 | 评分 | 借鉴内容 |
|------|------|----------|
| 记忆系统 | 100% | BM25 稀疏向量（FNV-1a 20-bit）、Dense Vector 检索、RRF 三源融合、Multimodal 嵌入、10语言分词、TTL+LRU 缓存 |
| 循环检测 | 100% | 重复失败/乒乓/全局熔断三策略 + FNV-1a 哈希 + 警告注入（独创） |
| 历史进化 | 100% | 三阶段循环（Reflect→Experiment→Review）、心跳自检、预快照回滚、协议自修改、活跃时间窗口 |
| 知识提取 | 95% | LLM + 规则引擎双路径、标签提取、决策模式匹配、30+ 技术栈检测 |

---

## 为什么用 FlowPilot

传统 CC 开发：你是项目经理——拆任务、分配、跟进、验收，全程盯着。
FlowPilot：你是甲方——只说要什么，剩下的全自动。

| 传统 CC 开发 | FlowPilot 开发 |
|-------------|---------------|
| 手动拆任务、一个个跟 CC 说 | 说一句需求，自动拆解 10+ 个任务 |
| 上下文满了要从头来 | 新窗口一句话，从断点继续，零丢失 |
| 一次只能做一件事 | 多个子Agent并行开发，速度翻倍 |
| 做到一半忘了之前的决策 | 四层记忆 + 跨工作流长期记忆，100个任务也不迷路 |
| 每次手动 git commit | 每完成一个任务自动提交，收尾自动跑测试 |
| 换个项目要重新配置 | 99KB 单文件复制即用，Node/Rust/Go/Python/Java/C++/Makefile 通吃 |
| 每次都犯同样的错 | 自我进化引擎，每轮自动反思优化，越跑越聪明 |

### 和主流方案的区别

**vs Claude Code 原生子Agent（Task 工具）**

CC 自带 Task 工具能派子Agent，但它是**无状态**的——上下文绑定在当前对话，关窗口就没了。FlowPilot 在此之上解决了三个原生做不到的事：

1. **不怕中断**：所有状态持久化在磁盘，compact、崩溃、关窗口都无所谓，`resume` 一键继续
2. **不怕膨胀**：主Agent 永远只读 progress.md（< 100 行），100 个任务也不会变慢
3. **自动并行**：依赖图分析 + 批量派发，不用手动决定谁先谁后

| | 原生 Task | FlowPilot |
|---|-----------|-----------|
| 状态持久化 | 对话内，compact 即丢 | 磁盘文件，永不丢失 |
| 中断恢复 | 依赖对话历史，compact 后状态易丢 | 磁盘恢复，`resume` 一键继续 |
| 并行调度 | 手动安排 | 自动依赖分析，批量派发 |
| 上下文膨胀 | 主Agent越做越慢 | 四层记忆，主Agent < 100 行 |
| git 提交 | 手动 | 每个任务自动 commit |
| 收尾验证 | 无 | 自动 build/test/lint |
| 跨会话记忆 | 无，每次从零开始 | 长期记忆库，自动检索注入 |
| 自我优化 | 无 | 三阶段进化，越跑越聪明 |

**vs OpenSpec（规格驱动框架）**

[OpenSpec](https://github.com/Fission-AI/OpenSpec) 解决的是「写代码之前怎么把需求想清楚」，产出是 proposal/spec/design 文档。FlowPilot 解决的是「需求清楚之后怎么全自动执行」，产出是可运行的代码和 git 历史。

| | OpenSpec | FlowPilot |
|---|---------|-----------|
| 定位 | 规划层：需求 → 规格文档 | 执行层：任务 → 代码 → 提交 |
| 产出 | Markdown 文档 | 可运行代码 + git 历史 |
| 执行 | 文档写完仍需人工/AI 逐个实现 | 全自动派发、并行执行、自动提交 |
| 适用范围 | 工具无关，20+ AI 助手 | Claude Code 专用，深度集成 |

FlowPilot 的核心优势是**端到端自动化**——从需求到代码到提交到验证，中间不需要人。OpenSpec 在规划阶段更强，两者已实现集成：

**OpenSpec + FlowPilot 集成**：FlowPilot 的任务解析器自动兼容 OpenSpec 的 checkbox 格式（`- [ ] 1.1 Task`），无需格式转换。工作流协议内置双路径：

| 路径 | 触发条件 | 流程 |
|------|---------|------|
| Path A（标准） | 默认 | brainstorming → 生成任务 → `flow.js init` |
| Path B（OpenSpec） | 项目有 `openspec/` + CLI 可用 | `/opsx:new` → `/opsx:ff` → `cat tasks.md \| flow.js init` |

此外，协议会自动检测项目根目录的 `tasks.md` 文件并询问用户确认，也支持用户在消息中直接提供任务列表。

## 30 秒体验

```bash
cp dist/flow.js 你的项目/
cd 你的项目
node flow.js init
```

打开 Claude Code，直接描述需求：

```
你：帮我做一个电商系统，用户注册、商品管理、购物车、订单支付

（然后就不用管了）
```

CC 会自动：拆解任务 → 识别依赖 → 并行派发子Agent → 写代码 → checkpoint → git commit → 跑 build/test/lint → 全部完成。

## 核心优势

### 无限上下文 — 做 100 个任务也不会 compact 丢失

四层记忆架构，主Agent 上下文永远 < 100 行：

| 层级 | 谁读 | 内容 |
|------|------|------|
| progress.md | 主Agent | 极简状态表（一行一个任务） |
| task-xxx.md | 子Agent | 每个任务的详细产出和决策 |
| summary.md | 子Agent | 滚动摘要（超10个任务自动压缩） |
| memory.json | 子Agent | 跨工作流长期记忆（自动检索注入） |

子Agent 自行记录产出，主Agent 不膨胀。就算 compact 了，文件还在，恢复即继续。长期记忆跨工作流持久化，上一轮学到的经验自动注入下一轮。

### 并行开发 — 不是一个个做，是一起做

```
串行：数据库 → 用户API → 商品API → 用户页 → 商品页    （5轮）
并行：数据库 → [用户API, 商品API] → [用户页, 商品页]   （3轮）
```

`flow next --batch` 自动找出所有可并行的任务，主Agent 在同一条消息中派发多个子Agent 同时执行。

### 万步零偏移 — 中断恢复不丢一步

关窗口、断网、compact、CC 崩溃，随便来：

```
新窗口 → 说：继续任务 → flow resume → 检测到中断 → 重置未完成任务 → 继续
```

所有状态持久化在文件里，不依赖对话历史。哪怕并行执行中 3 个子Agent 同时中断，恢复后全部重新派发。

### 迭代审查 — 跑完一轮再来一轮，越改越好

一轮工作流全自动跑完后，可以再起一轮新的工作流审查上一轮的产出：检查实现是否偏离需求、补漏洞、提升代码质量。全程耗时极短，多迭代几轮也不费事。对比原生使用 CC Agent Teams 手动调度，效率提升显著，性价比极高——省下来的时间，陪陪家人不好吗？

```
第一轮：需求 → 全自动实现 → 代码产出
第二轮：审查 → 发现偏离/缺陷 → 自动修补
第三轮：精修 → 代码质量提升 → 收尾验证
```

### 自我进化 — 每跑一轮，下一轮更聪明

FlowPilot 内置三阶段有机进化循环，成功和失败均触发进化，结果写入 `.flowpilot/config.json`，被 maxRetries / parallelLimit / hints / verify / hooks 真正消费：

```
finish() 触发：
  Reflect（反思）→ 分析本轮成败模式（失败链、重试热点、类型集中度）
  Experiment（实验）→ 自动调整 config 参数和协议模板，保存完整快照

review() 触发：
  Review（自愈）→ 对比进化前后指标，退化则自动回滚

Finalization 阶段（可选）：
  CC sub-agent + brainstorming 技能深度反思 → node flow.js evolve 应用结果
```

| 阶段 | 触发时机 | 做什么 |
|------|---------|--------|
| Reflect | finish 末尾 | LLM 或规则分析工作流统计，输出 findings + experiments |
| Experiment | finish 末尾 | 自动调整 config 参数和协议模板，保存完整快照 |
| Review | review 时 | 对比进化前后指标，恶化自动回滚，检查配置完整性 |

进化结果直接影响工作流行为：

| 参数 | 作用 |
|------|------|
| `maxRetries` | checkpoint 失败时决定重试次数 |
| `parallelLimit` | `nextBatch` 限制并行任务数 |
| `hints` | 注入到子Agent上下文作为"进化建议" |

- 成功时：提升并行度，优化参数
- 失败时：增加前置检查建议，降低并行度
- 有 `ANTHROPIC_API_KEY` 时用 LLM 深度分析，没有则用规则引擎——零依赖约束下的优雅降级

### 99KB 通吃一切 — 零依赖，复制即用

- 单文件 `dist/flow.js`，99KB
- 零运行时依赖，只需 Node.js
- 自动识别 8 种项目类型，收尾时自动跑对应的验证命令，并区分通过 / 跳过 / 未发现命令

## 文档

- [快速上手](docs/quick-start.md) — 不懂原理也能用，3 步开始全自动开发
- [详细使用指南](docs/usage-guide.md) — 完整命令说明、并行开发技巧、任务设计实战示例

## 前置准备

建议先安装插件，否则子Agent功能会降级。在 CC 中执行 `/plugin` 打开插件商店，选择安装：

- `superpowers` — 需求拆解头脑风暴
- `frontend-design` — 前端任务
- `feature-dev` — 后端任务
- `code-review` — 收尾代码审查
- `context7` — 实时查阅第三方库文档

另外确保开启 **Agent Teams**，在 `~/.claude/settings.json` 中添加：

```json
"env": {
  "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
}
```

`node flow.js init` 会自动生成协议和 Hooks，缺失插件会在输出中提醒。

setup/init 写入的 `CLAUDE.md`、`.claude/settings.json`、`.gitignore` 遵循 ownership-based cleanup：FlowPilot 只清理自己创建或注入的部分，cleanup 后若仍有用户残留改动，`flow finish` 会拒绝最终提交。

默认情况下，FlowPilot 还会在项目 `.gitignore` 中确保以下本地状态被忽略：`.workflow/`（本地临时运行态）、`.flowpilot/`（本地持久化产品状态）、`.claude/settings.json`（本地集成配置）、`.claude/worktrees/`（本地工作树目录）。不会忽略整个 `.claude/` 目录。

## 快速开始

```bash
# 构建单文件
cd FlowPilot && npm install && npm run build

# 自动化验证脚本
npm run test:smoke
npm run test:run

# 复制到任意项目
cp dist/flow.js /your/project/
cd /your/project

# 初始化（协议嵌入CLAUDE.md + Hooks注入）
node flow.js init

# 全自动模式启动 CC，直接描述需求，剩下的全自动
claude --dangerously-skip-permissions
```

> `--dangerously-skip-permissions` 跳过所有权限确认，实现真正的无人值守。

中断恢复：
```bash
claude --dangerously-skip-permissions --continue   # 接续最近一次对话
claude --dangerously-skip-permissions --resume     # 从历史对话列表选择
```

如果恢复时工作区仍然有脏业务文件，`resume` 会明确告诉你哪些是启动前就存在的 baseline 脏文件，哪些是中断任务残留的新脏文件；如果 dirty baseline 缺失，也会直接说明“无法证明这是干净重启”。

## 架构概览

```
主Agent（调度器，< 100行上下文）
  │
  ├─ node flow.js next ──→ 返回任务 + 依赖上下文 + 相关记忆
  │
  ├─ 子Agent（Task工具派发）
  │   ├─ frontend → /frontend-design 插件 + 其他匹配的 Skill/MCP
  │   ├─ backend  → /feature-dev 插件 + 其他匹配的 Skill/MCP
  │   └─ general  → 直接执行 + 其他匹配的 Skill/MCP
  │
  ├─ node flow.js checkpoint ──→ 记录产出 + 知识提取 + git commit
  │
  ├─ .workflow/（本地临时运行态）
  │   ├─ progress.md        # 任务状态表（主Agent读）
  │   ├─ tasks.md           # 完整任务定义
  │   ├─ config.json        # 运行态文件（兼容旧路径，推荐迁移）
  │   └─ context/
  │       ├─ summary.md     # 滚动摘要
  │       └─ task-xxx.md    # 各任务详细产出
  │
  └─ .flowpilot/（本地持久化产品状态）
      ├─ config.json        # 持久配置（maxRetries/parallelLimit/hints/verify/hooks）
      ├─ memory.json        # 长期记忆库（知识条目 + 标签 + 时间戳）
      └─ evolution/         # 进化历史（reflect/experiment/review 记录）
```

## 四层记忆机制

| 层级 | 文件 | 读者 | 内容 |
|------|------|------|------|
| 第一层 | progress.md | 主Agent | 极简状态表（ID/标题/状态/摘要） |
| 第二层 | context/task-xxx.md | 子Agent | 每个任务的详细产出和决策记录 |
| 第三层 | context/summary.md | 子Agent | 滚动摘要（技术栈/架构决策/已完成模块） |
| 第四层 | .flowpilot/memory.json | 子Agent | 跨工作流长期记忆（标签化知识条目） |

`flow next` 自动拼装：summary + 依赖任务的 context → 注入子Agent prompt。
主Agent 永远只读 progress.md，上下文占用极小。

## 长期记忆系统

跨工作流的持久化知识库，存储在 `.flowpilot/memory.json`。

### 写入 → 存储 → 检索 → 注入

```
checkpoint（成功/失败）
    ↓
知识提取（LLM 智能提取 或 规则引擎降级）
    ↓
存储到 .flowpilot/memory.json（带标签、时间戳、来源）
    ↓
next/nextBatch 时语义检索相关记忆
    ↓
带 [source] 标签注入子Agent上下文
```

### 知识提取

子Agent 在 checkpoint 摘要中使用标签标记关键知识：

| 标签 | 用途 | 示例 |
|------|------|------|
| `[REMEMBER]` | 通用经验 | `[REMEMBER] Vite 需要配置 resolve.alias 才能用 @ 路径` |
| `[DECISION]` | 架构/技术决策 | `[DECISION] 选用 Zustand 而非 Redux，因为项目规模小` |
| `[ARCHITECTURE]` | 系统架构 | `[ARCHITECTURE] 采用 monorepo + turborepo 结构` |

提取路径：
- 有 `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN` → LLM 智能提取 + 去重（Claude Haiku）
- 无 API key → 规则引擎匹配标签（零依赖降级）

### 检索引擎

- BM25 稀疏向量 + 前向最大匹配中文分词 + 技术词表
- 有 `EMBEDDING_API_KEY` 时额外启用 Dense embedding 双路融合
- MMR 重排序去冗余 + 时间衰减（半衰期 30 天）
- 架构类和决策类记忆不衰减，永久保留

### 使用方式

- 自动注入：`next`/`next --batch` 时自动检索并注入相关记忆
- 手动查询：`node flow.js recall <关键词>`

## 命令参考

```bash
node flow.js init [--force]       # 初始化/接管项目
node flow.js next [--batch]       # 获取下一个/所有可并行任务
node flow.js checkpoint <id>      # 记录任务完成（stdin/--file/内联）[--files f1 f2 ...]
node flow.js skip <id>            # 手动跳过任务
node flow.js review               # 标记code-review已完成 + 进化自愈检查
node flow.js finish               # 智能收尾（验证+总结+边界安全时才最终提交，需先review）
node flow.js status               # 查看全局进度
node flow.js resume               # 中断恢复
node flow.js add <描述> [--type]  # 追加任务（frontend/backend/general）
node flow.js recall <关键词>      # 检索历史记忆（BM25 + Dense 双路）
node flow.js evolve               # 接收 CC sub-agent 反思结果并应用进化
```

配套 npm 脚本：
- `npm run test:run`：一次性执行完整 Vitest 测试集
- `npm run test:smoke`：执行工作流边界相关冒烟测试，适合改命令/文档后快速验证

## 执行流程（全自动）

```
node flow.js init
       ↓
  协议嵌入 CLAUDE.md + Hooks 注入
       ↓
  用户描述需求 / 丢入开发文档
       ↓                          ← 以下全自动，无需人工介入
  ┌─→ flow next (--batch) ──→ 获取任务+上下文+相关记忆
  │        ↓
  │   子Agent执行（自动选插件）
  │        ↓
  │   flow checkpoint ──→ 知识提取 → 记录产出 + git commit
  │        ↓
  └── 还有任务？──→ 是 → 循环
                   否 ↓
              flow finish ──→ build/test/lint + Reflect + Experiment
                   ↓
              code-review ──→ flow review（进化自愈检查）
                   ↓
              flow evolve（可选，CC 深度反思）
                   ↓
              flow finish ──→ 验证通过 → 最终提交 → idle
```

## 错误处理

- **任务失败** — 自动重试 3 次，3 次仍失败则标记 `failed` 并跳过
- **级联跳过** — 依赖了失败任务的后续任务自动标记 `skipped`
- **中断恢复** — `active` 状态的任务重置为 `pending`，从头重做；若工作区仍脏，`resume` 会明确区分 baseline 脏文件、任务残留脏文件、以及缺失 baseline 的保守警告
- **验证失败** — `flow finish` 报错后可派子Agent修复，再次 finish
- **最终提交拒绝** — `flow finish` 在 verify/review 之后还会检查 dirty baseline、checkpoint owned files、以及 `CLAUDE.md` / `.claude/settings.json` / `.gitignore` 的 cleanup 结果；只要边界不安全，就拒绝最终提交并列出文件
- **循环检测** — 三策略防护（重复失败/乒乓/全局熔断），自动注入警告到下一任务
- **心跳自检** — 活跃任务超时（>30分钟）告警，记忆膨胀（>100条）自动压缩
- **进化回滚** — 实验导致指标恶化时，`review` 自动回滚到实验前快照

## 环境变量

所有环境变量均为可选，无 API key 也能完整运行。

| 变量 | 用途 | 说明 |
|------|------|------|
| `ANTHROPIC_API_KEY` | LLM 智能提取 + 进化反思 | 启用 Claude Haiku 进行知识提取和去重 |
| `ANTHROPIC_AUTH_TOKEN` | 同上（二选一） | 与 `ANTHROPIC_API_KEY` 等效，优先使用 |
| `ANTHROPIC_BASE_URL` | API 中转地址 | 自定义 API endpoint，适用于代理/镜像场景 |
| `EMBEDDING_API_KEY` | Dense embedding 双路融合 | 启用向量嵌入，与 BM25 融合提升检索精度 |

降级策略：
- 无 `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` → 知识提取降级到规则引擎匹配标签
- 无 `EMBEDDING_API_KEY` → 检索仅用 BM25 稀疏向量（仍然有效）

## 开发

```bash
cd FlowPilot
npm install
npm run build        # 构建 → dist/flow.js
npm run dev          # 开发模式
npm test             # 运行测试
```

### 源码结构

```
src/
├── main.ts                          # 入口，依赖注入
├── domain/
│   ├── types.ts                     # TaskEntry, ProgressData 等类型
│   ├── task-store.ts                # 任务状态管理（纯函数）
│   ├── workflow.ts                  # WorkflowDefinition 定义
│   └── repository.ts               # 仓储接口
├── application/
│   └── workflow-service.ts          # 核心用例（16个）
├── infrastructure/
│   ├── fs-repository.ts             # 文件系统 + 协议嵌入 + Hooks注入
│   ├── markdown-parser.ts           # 任务Markdown解析（兼容FlowPilot/OpenSpec双格式）
│   ├── memory.ts                    # 智能记忆引擎（BM25 + 向量索引 + RRF + MMR + LRU缓存）
│   ├── extractor.ts                 # 知识提取（LLM + 规则引擎降级）
│   ├── truncation.ts                # CJK感知智能截断
│   ├── loop-detector.ts             # 三策略循环检测
│   ├── history.ts                   # 历史分析 + 三阶段自我进化（Reflect/Experiment/Review）
│   ├── git.ts                       # 自动git提交（子模块感知）
│   ├── verify.ts                    # 多语言项目验证（8种）
│   ├── hooks.ts                     # 生命周期钩子
│   ├── protocol-template.ts         # 工作流协议模板（双路径：标准/OpenSpec）
│   └── logger.ts                    # 结构化日志（JSONL）
└── interfaces/
    ├── cli.ts                       # 命令路由
    ├── formatter.ts                 # 输出格式化
    └── stdin.ts                     # stdin读取
```

### 依赖方向

```
interfaces → application → domain ← infrastructure
```

运行时零外部依赖，只用 Node.js 内置模块（fs, path, child_process, crypto, https）。LLM 智能提取、长期记忆双路检索、自我进化反思均为可选增强，通过环境变量（`ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`/`EMBEDDING_API_KEY`）按需启用，无 API key 时自动降级到规则引擎。

## 开源许可

本项目基于 [MIT License](LICENSE) 开源。

Copyright (c) 2025-2026 FlowPilot Contributors
