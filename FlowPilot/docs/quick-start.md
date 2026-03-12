# FlowPilot 快速上手

[English](quick-start.en.md)

> 不需要懂原理，照着做就行。

## 准备工作（只做一次）

1. 确保电脑装了 Node.js（版本 20 以上）
2. 按客户端开启并行 / 自动运行：
   - `Claude Code`：在 `~/.claude/settings.json` 中添加 `"env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }`
   - `Codex`：在 `~/.codex/config.toml` 中加入：
     ```toml
     [features]
     multi_agent = true
     ```
     全自动运行建议使用：`codex --yolo`
   - `Cursor`：在设置的 `Agents` 中开启 `Agents`，并把 `Auto-Run Mode` 调成 `Run Everything`
   - `其他客户端`：先按各自文档自测多代理 / 自动运行能力
3. 安装插件 / 技能（可选，不安装也只是功能降级）
4. （可选）配置环境变量，启用 LLM 智能提取和深度分析：
   在 `~/.claude/settings.json` 的 `env` 中添加：
   ```json
   {
     "env": {
       "ANTHROPIC_API_KEY": "sk-ant-...",
       "ANTHROPIC_BASE_URL": "https://api.anthropic.com"
     }
   }
   ```
   > `ANTHROPIC_API_KEY` 也可用 `ANTHROPIC_AUTH_TOKEN` 替代。`ANTHROPIC_BASE_URL` 可选，用于自定义 API 地址。
   > 不配置也能正常使用，记忆提取会降级为规则引擎模式。
5. 构建工具：
   ```bash
   cd FlowPilot目录
   npm install && npm run build
   npm run test:smoke
   ```
6. 常用自动化脚本：
   - `npm run test:run`：一次性跑完整 Vitest 测试集（CI / verify 友好）
   - `npm run test:smoke`：只跑工作流边界相关冒烟测试，适合改文档、脚本和发布前快速核对

## 开始一个新项目

```bash
# 1. 把 flow.js 复制到你的项目里
cp FlowPilot目录/dist/flow.js  你的项目/

# 2. 进入项目，初始化
cd 你的项目
node flow.js init
# 会确保 .workflow/、.flowpilot/、.claude/settings.json、.claude/worktrees/ 被写入 .gitignore（若缺失）
# 选择 Claude Code 时，首次默认生成 CLAUDE.md；Codex / Cursor / Other 默认生成 AGENTS.md

# 3. 启动你的客户端，直接描述需求
claude --dangerously-skip-permissions

# Codex 可直接用：
codex --yolo
```

> 这轮“更像 Claude 的输出风格”升级只改表达和排版，不改任务调度、协议优先级、命令语义或 checkpoint 规则。

> `--dangerously-skip-permissions` 会跳过所有权限确认弹窗，实现真正的全自动。不加的话每个操作都要你点确认。

然后直接告诉客户端你要做什么，比如：

```
帮我做一个博客系统，要有用户注册登录、文章发布、评论功能
```

CC 会自动拆解任务、写代码、提交 git，直到全部完成。你只需要等着看结果。

> 小技巧：子Agent在 checkpoint 时可以用知识标签记录关键信息，这些信息会被永久保存，跨工作流可检索：
> - `[REMEMBER]` 值得记住的事实（如：`[REMEMBER] 项目使用 PostgreSQL + Drizzle ORM`）
> - `[DECISION]` 技术决策（如：`[DECISION] 选择 JWT 而非 session，因为需要无状态认证`）
> - `[ARCHITECTURE]` 架构模式（如：`[ARCHITECTURE] 三层架构：Controller → Service → Repository`）

## 给已有项目加功能

```bash
# 1. 复制 flow.js 到项目里（如果还没有的话）
cp FlowPilot目录/dist/flow.js  你的项目/

# 2. 初始化
cd 你的项目
node flow.js init

# 3. 打开 CC，描述你的开发需求：
给现有系统加一个搜索功能，支持按标题和内容搜索
```

## 中断了怎么办

不管是电脑关了、CC 崩了、还是上下文满了，都一样：

```bash
# 接续最近一次对话，全自动继续
# Claude Code
claude --dangerously-skip-permissions --continue

# Codex
codex --yolo
```

进去后说「继续任务」，它会自动从断点继续，之前做的不会丢。

- `Claude Code`：推荐直接用 `--continue` / `--resume`
- `Codex`：重新进入项目目录后启动 `codex --yolo`，然后说「继续任务」
- `Cursor`：重新打开项目，在原会话或新会话中说「继续任务」
- `snow-cli` / 其他客户端：重新进入项目目录，恢复或新开会话后说「继续任务」

如果工作区里仍有未归档变更，`resume` 现在会如实说明它们属于哪一类：
- 工作流启动前就已经存在、恢复后仍保留的 baseline 未归档变更
- 由显式 ownership 支撑的 task-owned 变更
- 工作流期间新增但归属未明的变更（可能包含你的手动修改/删除，FlowPilot 不会自动恢复这些文件）
- 如果存在待处理变更，工作流会进入 `reconciling`，必须先 `adopt` 或在确认并处理列出的本任务变更后 `restart`
- 如果缺少 dirty baseline，则会明确提示“无法证明这是干净重启，也无法可靠区分用户操作与任务残留”

如果想从历史对话列表里挑一个恢复：
```bash
claude --dangerously-skip-permissions --resume
```

## 中途想加需求

直接跟 CC 说就行：

```
再加一个导出 PDF 的功能
```

CC 会自动追加任务继续执行。

## 想让它跑得更快

写需求的时候，把没有先后关系的事情分开说，CC 就会自动并行处理。

慢的写法：
```
先做数据库，然后做API，然后做页面
```

快的写法：
```
做一个电商系统：
- 后端：用户模块、商品模块、订单模块（都依赖数据库）
- 前端：首页、商品页、购物车页（各自依赖对应的后端API）
- 最后做集成测试
```

第二种写法，CC 会自动识别出哪些任务可以同时做，多个子 Agent 并行开发。

## 看进度

```bash
node flow.js status
```

或者直接问 CC："现在进度怎么样了？"

`status` 现在会更强调用户一眼想看懂的事情：
- 哪些已完成
- 哪些正在进行
- 哪些阻塞
- 下一步该做什么

如果子代理持续上报阶段，`status` 还会显示更直观的实时状态卡片，例如：
- `分析中 / 实现中 / 验证中 / 阻塞中`
- 最近活动时间
- 最近一句进展摘要

## finish 会在什么时候拒绝最终提交

`node flow.js finish` 只有在验证通过、已经执行过 `node flow.js review`，并且工作区边界可证明安全时才会做最终提交。

如果 finish 发现以下情况，会明确拒绝最终提交，而不是帮你“赌一把”：
- 存在不属于本轮 workflow checkpoint 的新增脏文件
- instruction file（`AGENTS.md` / 兼容旧 `CLAUDE.md`）、`.claude/settings.json`、`.gitignore` 在 cleanup 之后仍残留用户改动
- 缺少 dirty baseline，无法证明哪些脏文件是工作流之外的历史遗留

一句话理解：FlowPilot 只会最终提交“本轮任务明确声明归属的业务文件”，其余脏文件一律先停下来让你处理。

## 就这些

正常使用只需要记住三件事：
1. 项目里放一个 `flow.js`，执行 `node flow.js init`
2. 打开 CC，描述开发需求
3. 中断了就新开窗口说「继续任务」

## 可选：一键安装技能（Codex / Cursor）

> 不安装也可以正常使用，只是部分技能驱动能力会降级。

FlowPilot 仓库内置了兼容 `Codex` / `Cursor` 的一键安装包：

- 总目录：[`兼容codex@cursor一键安装技能/`](/work2026/tools/FlowPilot/兼容codex@cursor一键安装技能)
- Codex 包：[`兼容codex@cursor一键安装技能/codex一键安装技能/`](/work2026/tools/FlowPilot/兼容codex@cursor一键安装技能/codex一键安装技能)
- Cursor 包：[`兼容codex@cursor一键安装技能/cursor一键安装技能/`](/work2026/tools/FlowPilot/兼容codex@cursor一键安装技能/cursor一键安装技能)

如何选择：
- 你要给 `Codex CLI` 安装技能和 MCP：用 `codex一键安装技能/`
- 你要给 `Cursor` 安装技能和 MCP：用 `cursor一键安装技能/`

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

Windows 可直接使用目录中的 `.bat` / `.ps1` 脚本。

安装完成后：
- `Codex` 需要重启 `Codex CLI`
- `Cursor` 需要重启 `Cursor`

## 卸载 FlowPilot

如果你之后不想继续在项目里使用 FlowPilot，只需要删除它带入或运行时生成的文件：

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

如果 `.claude/` 目录因此变成空目录，也可以一起删除。
如果这些文件里后来有你手动补充的项目说明，请先保留需要的内容再删除。
