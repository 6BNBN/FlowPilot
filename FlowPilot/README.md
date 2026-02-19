# FlowPilot - 全自动工作流引擎

CC (Claude Code) Agent Teams 环境下的全自动开发调度引擎。单文件 30KB，复制即用，让 AI 自动拆解需求、分配任务、写代码、跑测试、提交代码。

## 核心特性

- **单文件部署** — 复制 `dist/flow.js` 到任意项目，`node flow.js init` 即可接管
- **无限上下文** — 三层记忆架构，主Agent上下文永远 < 100 行
- **跨会话恢复** — 关窗口/compact/崩溃后，新窗口说"开始"从断点继续
- **并行派发** — 无依赖任务同时派多个子Agent执行
- **语言无关** — 自动检测 Node/Rust/Go/Python/Java/C++ 项目并验证
- **自动 git** — 每个任务一个 commit，收尾时最终提交

## 快速开始

```bash
# 构建单文件
cd FlowPilot && npm install && npm run build

# 复制到任意项目
cp dist/flow.js /your/project/
cd /your/project

# 初始化（生成协议 + 写入CLAUDE.md）
node flow.js init

# 打开 CC，输入"开始"，然后描述你的需求，剩下的全自动
```

## 架构概览

```
主Agent（调度器，< 100行上下文）
  │
  ├─ node flow.js next ──→ 返回任务 + 依赖上下文
  │
  ├─ 子Agent（Task工具派发）
  │   ├─ frontend → /frontend-design 插件
  │   ├─ backend  → /feature-dev 插件
  │   └─ general  → 直接执行
  │
  ├─ node flow.js checkpoint ──→ 记录产出 + git commit
  │
  └─ .workflow/（持久化层）
      ├─ protocol.md        # 调度协议
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
node flow.js checkpoint <id>      # 记录任务完成（stdin/--file/内联）
node flow.js skip <id>            # 手动跳过任务
node flow.js finish               # 智能收尾（验证+总结+提交）
node flow.js status               # 查看全局进度
node flow.js resume               # 中断恢复
node flow.js add <描述> [--type]  # 追加任务（frontend/backend/general）
```

## 执行流程

```
node flow.js init
       ↓
  生成 protocol.md + 写入 CLAUDE.md
       ↓
  用户开CC说"开始"
       ↓
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
              回到 idle，等下一个需求
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
│   └── workflow.ts                  # WorkflowDefinition 定义
├── application/
│   ├── workflow-service.ts          # 核心用例（8个命令）
│   └── protocol-generator.ts        # 生成 protocol.md
├── infrastructure/
│   ├── repository.ts                # 仓储接口
│   ├── fs-repository.ts             # 文件系统实现
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
