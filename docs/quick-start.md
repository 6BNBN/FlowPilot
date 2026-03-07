# FlowPilot 快速上手

[English](quick-start.en.md)

> 不需要懂原理，照着做就行。

## 准备工作（只做一次）

1. 确保电脑装了 Node.js（版本 20 以上）
2. 开启 Agent Teams：在 `~/.claude/settings.json` 中添加 `"env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }`
3. 安装插件：在 CC 中执行 `/plugin`，选择安装 `superpowers`、`frontend-design`、`feature-dev`、`code-review`、`context7`
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

# 3. 用全自动模式启动 Claude Code，直接描述需求
claude --dangerously-skip-permissions
```

> `--dangerously-skip-permissions` 会跳过所有权限确认弹窗，实现真正的全自动。不加的话每个操作都要你点确认。

然后直接告诉 CC 你要做什么，比如：

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
claude --dangerously-skip-permissions --continue
```

进去后说「继续任务」，它会自动从断点继续，之前做的不会丢。

如果工作区里仍有脏业务文件，`resume` 现在会如实说明它们属于哪一类：
- 工作流启动前就已经存在、恢复后仍保留的 baseline 脏文件
- 中断任务留下、被保守保留的新增脏文件
- 如果缺少 dirty baseline，则会明确提示“无法证明这是干净重启”，而不会误报一切干净

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

## finish 会在什么时候拒绝最终提交

`node flow.js finish` 只有在验证通过、已经执行过 `node flow.js review`，并且工作区边界可证明安全时才会做最终提交。

如果 finish 发现以下情况，会明确拒绝最终提交，而不是帮你“赌一把”：
- 存在不属于本轮 workflow checkpoint 的新增脏文件
- `CLAUDE.md`、`.claude/settings.json`、`.gitignore` 在 cleanup 之后仍残留用户改动
- 缺少 dirty baseline，无法证明哪些脏文件是工作流之外的历史遗留

一句话理解：FlowPilot 只会最终提交“本轮任务明确声明归属的业务文件”，其余脏文件一律先停下来让你处理。

## 就这些

正常使用只需要记住三件事：
1. 项目里放一个 `flow.js`，执行 `node flow.js init`
2. 打开 CC，描述开发需求
3. 中断了就新开窗口说「继续任务」
