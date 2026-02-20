# FlowPilot

全自动工作流调度引擎，基于 CC Agent Teams。

## Conventions

- JSDoc 使用中文注释
- 严格 TypeScript（strict: true）
- 依赖方向：interfaces → application → domain ← infrastructure
- 运行时零外部依赖，只用 Node.js 内置模块

## Important

- 工作流状态只能通过 flow CLI 变更
- progress.md 是记忆本体，compact/重启后读它恢复
- 协议直接嵌入目标项目 CLAUDE.md（<!-- flowpilot:start/end --> 标记）
- Hooks 自动注入目标项目 .claude/settings.json（拦截 TaskCreate/TaskUpdate/TaskList）
- 主Agent只能用 Bash、Task、Skill 工具，禁止直接读源码/写代码
- 本工具必须在 Agent Teams 开启的环境下使用
