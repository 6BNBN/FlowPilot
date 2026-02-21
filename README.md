# FlowPilot

**一个文件，一句开发需求，全自动开发。**

把 `flow.js` 丢进任何项目，打开 Claude Code 描述你要做什么，然后去喝杯咖啡。
回来的时候，代码写好了，测试跑完了，git 也提交了。

---

## 为什么用 FlowPilot

传统 CC 开发：你是项目经理——拆任务、分配、跟进、验收，全程盯着。
FlowPilot：你是甲方——只说要什么，剩下的全自动。

| 传统 CC 开发 | FlowPilot 开发 |
|-------------|---------------|
| 手动拆任务、一个个跟 CC 说 | 说一句需求，自动拆解 10+ 个任务 |
| 上下文满了要从头来 | 新窗口一句话，从断点继续，零丢失 |
| 一次只能做一件事 | 多个子Agent并行开发，速度翻倍 |
| 做到一半忘了之前的决策 | 三层记忆自动记录，100个任务也不迷路 |
| 每次手动 git commit | 每完成一个任务自动提交，收尾自动跑测试 |
| 换个项目要重新配置 | 44KB 单文件复制即用，Node/Rust/Go/Python/Java/C++/Makefile 通吃 |

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
| 上下文膨胀 | 主Agent越做越慢 | 三层记忆，主Agent < 100 行 |
| git 提交 | 手动 | 每个任务自动 commit |
| 收尾验证 | 无 | 自动 build/test/lint |

**vs OpenSpec（规格驱动框架）**

[OpenSpec](https://github.com/Fission-AI/OpenSpec) 解决的是「写代码之前怎么把需求想清楚」，产出是 proposal/spec/design 文档。FlowPilot 解决的是「需求清楚之后怎么全自动执行」，产出是可运行的代码和 git 历史。

| | OpenSpec | FlowPilot |
|---|---------|-----------|
| 定位 | 规划层：需求 → 规格文档 | 执行层：任务 → 代码 → 提交 |
| 产出 | Markdown 文档 | 可运行代码 + git 历史 |
| 执行 | 文档写完仍需人工/AI 逐个实现 | 全自动派发、并行执行、自动提交 |
| 适用范围 | 工具无关，20+ AI 助手 | Claude Code 专用，深度集成 |

FlowPilot 的核心优势是**端到端自动化**——从需求到代码到提交到验证，中间不需要人。OpenSpec 在规划阶段更强，两者可以互补：用 OpenSpec 做需求规划，再用 FlowPilot 执行实现。

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

三层记忆架构，主Agent 上下文永远 < 100 行：

| 层级 | 谁读 | 内容 |
|------|------|------|
| progress.md | 主Agent | 极简状态表（一行一个任务） |
| task-xxx.md | 子Agent | 每个任务的详细产出和决策 |
| summary.md | 子Agent | 滚动摘要（超10个任务自动压缩） |

子Agent 自行记录产出，主Agent 不膨胀。就算 compact 了，文件还在，恢复即继续。

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

### 44KB 通吃一切 — 零依赖，复制即用

- 单文件 `dist/flow.js`，44KB
- 零运行时依赖，只需 Node.js
- 自动识别 8 种项目类型，收尾时自动跑对应的 build/test/lint

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

## 快速开始

```bash
# 构建单文件
cd FlowPilot && npm install && npm run build

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

## 架构概览

```
主Agent（调度器，< 100行上下文）
  │
  ├─ node flow.js next ──→ 返回任务 + 依赖上下文
  │
  ├─ 子Agent（Task工具派发）
  │   ├─ frontend → /frontend-design 插件 + 其他匹配的 Skill/MCP
  │   ├─ backend  → /feature-dev 插件 + 其他匹配的 Skill/MCP
  │   └─ general  → 直接执行 + 其他匹配的 Skill/MCP
  │
  ├─ node flow.js checkpoint ──→ 记录产出 + git commit
  │
  └─ .workflow/（持久化层）
      ├─ progress.md        # 任务状态表（主Agent读）
      ├─ tasks.md           # 完整任务定义
      └─ context/
          ├─ summary.md     # 滚动摘要
          └─ task-xxx.md    # 各任务详细产出
```

## 三层记忆机制

| 层级 | 文件 | 读者 | 内容 |
|------|------|------|------|
| 第一层 | progress.md | 主Agent | 极简状态表（ID/标题/状态/摘要） |
| 第二层 | context/task-xxx.md | 子Agent | 每个任务的详细产出和决策记录 |
| 第三层 | context/summary.md | 子Agent | 滚动摘要（技术栈/架构决策/已完成模块） |

`flow next` 自动拼装：summary + 依赖任务的 context → 注入子Agent prompt。
主Agent 永远只读 progress.md，上下文占用极小。

## 命令参考

```bash
node flow.js init [--force]       # 初始化/接管项目
node flow.js next [--batch]       # 获取下一个/所有可并行任务
node flow.js checkpoint <id>      # 记录任务完成（stdin/--file/内联）[--files f1 f2 ...]
node flow.js skip <id>            # 手动跳过任务
node flow.js review               # 标记code-review已完成（finish前必须执行）
node flow.js finish               # 智能收尾（验证+总结+提交，需先review）
node flow.js status               # 查看全局进度
node flow.js resume               # 中断恢复
node flow.js add <描述> [--type]  # 追加任务（frontend/backend/general）
```

## 执行流程（全自动）

```
node flow.js init
       ↓
  协议嵌入 CLAUDE.md + Hooks 注入
       ↓
  用户描述需求 / 丢入开发文档
       ↓                          ← 以下全自动，无需人工介入
  ┌─→ flow next (--batch) ──→ 获取任务+上下文
  │        ↓
  │   子Agent执行（自动选插件）
  │        ↓
  │   flow checkpoint ──→ 记录产出 + git commit
  │        ↓
  └── 还有任务？──→ 是 → 循环
                   否 ↓
              flow finish ──→ build/test/lint
                   ↓
              code-review ──→ flow review
                   ↓
              flow finish ──→ 最终提交 → 清理 .workflow/ → idle
```

## 错误处理

- **任务失败** — 自动重试 3 次，3 次仍失败则标记 `failed` 并跳过
- **级联跳过** — 依赖了失败任务的后续任务自动标记 `skipped`
- **中断恢复** — `active` 状态的任务重置为 `pending`，从头重做
- **验证失败** — `flow finish` 报错后可派子Agent修复，再次 finish

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
│   └── workflow-service.ts          # 核心用例（11个）
├── infrastructure/
│   ├── fs-repository.ts             # 文件系统实现 + CLAUDE.md协议嵌入 + Hooks注入
│   ├── markdown-parser.ts           # 任务Markdown解析
│   ├── git.ts                       # 自动git提交
│   └── verify.ts                    # 多语言项目验证
└── interfaces/
    ├── cli.ts                       # 命令路由
    ├── formatter.ts                 # 输出格式化
    └── stdin.ts                     # stdin读取
```

### 依赖方向

```
interfaces → application → domain ← infrastructure
```

运行时零外部依赖，只用 Node.js 内置模块（fs, path, child_process）。
