# FlowPilot - 使用说明

## 这是什么

一个 30KB 的单文件工具，让 Claude Code 变成全自动开发机器。
复制一个文件到项目里，说一句"开始"，它就会自动拆解需求、分配任务、写代码、提交 git、跑测试，直到全部完成。

## 前置条件

- Node.js >= 20
- Claude Code (CC) 已安装
- 推荐安装以下 CC 插件（非必须）：
  - superpowers（任务拆解）
  - frontend-design（前端任务）
  - feature-dev（后端任务）
  - code-review（代码审查）

## 快速开始

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
- `.workflow/protocol.md` — 调度协议（告诉CC怎么工作）
- `CLAUDE.md` — 添加协议引用（CC启动时自动读取）

### 第三步：开始

打开 CC 窗口，输入：

```
开始
```

CC 会自动：
1. 检测是否有未完成的工作流
2. 没有 → 等你提供需求
3. 有 → 从断点继续

### 第四步：提供需求

直接用自然语言描述，或者贴一份需求文档。CC 会自动：
1. 头脑风暴拆解任务
2. 标注任务类型和依赖关系
3. 展示任务树让你确认
4. 确认后全自动执行

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
# 开CC，说"开始"
你：给现有系统加一个搜索功能
```

### 场景三：中断恢复

电脑关了、CC崩了、上下文满了，都没关系：

```
# 新开一个CC窗口
你：开始
CC：恢复工作流: 博客系统 | 进度: 7/12 | 继续执行
```

## 命令参考

| 命令 | 用途 |
|------|------|
| `node flow.js init` | 初始化/接管项目 |
| `node flow.js init --force` | 强制重新初始化（覆盖已有工作流） |
| `node flow.js status` | 查看当前进度 |
| `node flow.js next` | 获取下一个任务 |
| `node flow.js next --batch` | 获取所有可并行任务 |
| `node flow.js checkpoint <id>` | 标记任务完成 |
| `node flow.js skip <id>` | 跳过某个任务 |
| `node flow.js resume` | 中断恢复 |
| `node flow.js finish` | 智能收尾（验证+提交） |
| `node flow.js add <描述>` | 追加新任务 |

> 注意：正常使用时你不需要手动执行这些命令，CC 会按协议自动调用。

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
├── CLAUDE.md                  # CC 配置（自动添加协议引用）
└── .workflow/
    ├── protocol.md            # 调度协议（CC读这个文件工作）
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
用户说"开始"
    ↓
CC 读 CLAUDE.md → 发现 protocol.md → 进入调度模式
    ↓
flow next → 返回下一个任务 + 依赖上下文
    ↓
CC 派子Agent执行任务（自动选择插件）
    ↓
flow checkpoint → 记录产出 + 自动git提交
    ↓
循环直到全部完成
    ↓
flow finish → 自动跑 build/test/lint → 最终提交
    ↓
回到待命，等待下一个需求
```

## 支持的项目类型

收尾阶段 `flow finish` 会自动检测并执行验证：

| 项目类型 | 检测文件 | 执行命令 |
|---------|---------|---------|
| Node.js | package.json | npm run build/test/lint |
| Rust | Cargo.toml | cargo build/test |
| Go | go.mod | go build/test |
| Python | pyproject.toml | pytest/ruff/mypy |
| Java (Maven) | pom.xml | mvn compile/test |
| Java (Gradle) | build.gradle | gradle build |
| C/C++ | CMakeLists.txt | cmake --build/ctest |
| 通用 | Makefile | make build/test/lint |

## 常见问题

**Q: 上下文满了怎么办？**
CC 自动 compact 后，说"开始"即可恢复。所有状态都在文件里，不依赖对话历史。

**Q: 任务失败了怎么办？**
自动重试 3 次。3 次都失败则跳过，继续下一个。全部完成后汇报失败项。

**Q: 可以中途加需求吗？**
可以。直接告诉 CC 新需求，它会执行 `flow add` 追加任务。

**Q: 不想用某个插件怎么办？**
插件是可选的。没有 frontend-design 插件时，前端任务会以 general 模式执行。

**Q: .workflow 目录要提交到 git 吗？**
建议提交。这样团队成员也能看到任务进度和历史决策。
