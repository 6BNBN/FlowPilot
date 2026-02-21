# FlowPilot 快速上手

[English](quick-start.en.md)

> 不需要懂原理，照着做就行。

## 准备工作（只做一次）

1. 确保电脑装了 Node.js（版本 20 以上）
2. 开启 Agent Teams：在 `~/.claude/settings.json` 中添加 `"env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }`
3. 安装插件：在 CC 中执行 `/plugin`，选择安装 `superpowers`、`frontend-design`、`feature-dev`、`code-review`、`context7`
4. 构建工具：
   ```bash
   cd FlowPilot目录
   npm install && npm run build
   ```

## 开始一个新项目

```bash
# 1. 把 flow.js 复制到你的项目里
cp FlowPilot目录/dist/flow.js  你的项目/

# 2. 进入项目，初始化
cd 你的项目
node flow.js init

# 3. 用全自动模式启动 Claude Code，直接描述需求
claude --dangerously-skip-permissions
```

> `--dangerously-skip-permissions` 会跳过所有权限确认弹窗，实现真正的全自动。不加的话每个操作都要你点确认。

然后直接告诉 CC 你要做什么，比如：

```
帮我做一个博客系统，要有用户注册登录、文章发布、评论功能
```

CC 会自动拆解任务、写代码、提交 git，直到全部完成。你只需要等着看结果。

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

## 就这些

正常使用只需要记住三件事：
1. 项目里放一个 `flow.js`，执行 `node flow.js init`
2. 打开 CC，描述开发需求
3. 中断了就新开窗口说「继续任务」
