# Workflow Engine

全自动工作流调度工具，配合 Claude Code 实现万步0偏移的全自动开发。

## Architecture

DDD 分层架构：

- `src/domain/` - 核心模型：TaskEntry, ProgressData, task-store
- `src/application/` - 应用服务：WorkflowService (6个用例), ProtocolGenerator
- `src/infrastructure/` - 文件系统仓储、Markdown 任务解析器
- `src/interfaces/` - CLI 工具、输出格式化

## Commands

```bash
npm run build    # 编译 TypeScript
npm run dev      # 开发模式运行
```

## CLI Usage

```bash
flow init             # 初始化工作流 (stdin传入任务markdown)
flow next             # 获取下一个待执行任务（含依赖上下文）
flow checkpoint <id>  # 记录任务完成 (stdin传入详细内容)
flow status           # 查看全局进度
flow resume           # 中断恢复
flow add <描述>       # 追加任务 [--type frontend|backend|general]
```

## 核心机制

- 分层记忆：progress.md(状态) + context/task-xxx.md(详细产出) + context/summary.md(滚动摘要)
- 依赖注入：flow next 自动拼装依赖任务的上下文给子Agent
- 协议驱动：flow init 生成 protocol.md，主Agent读协议做调度
- 插件集成：frontend→/frontend-design, backend→/feature-dev, 拆解→/superpowers:brainstorming

## Conventions

- JSDoc 使用中文注释
- 严格 TypeScript（strict: true）
- 依赖方向：interfaces -> application -> domain <- infrastructure

## Important

- 工作流状态只能通过 flow CLI 变更
- progress.md 是记忆本体，compact/重启后读它恢复
- 如有 .workflow/protocol.md，遵循其中的调度协议

遵循 .workflow/protocol.md 工作流调度协议
