# Workflow Engine

> ⚠️ **临时脚手架工具** — 本工具不是 Agent Habitat 正式项目的任何部分。
> 它的唯一目的是驱动项目的设计和实现过程。
> 等 Agent Habitat 自身具备自举能力后，本工具将退场。

agent-habitat 构建过程中的工作流控制工具，负责解析、执行和管理 Markdown 定义的工作流。

## Architecture

DDD 分层架构：

- `src/domain/` - 核心领域模型：WorkflowDefinition, WorkflowRuntime, TaskNode
- `src/application/` - 应用服务：WorkflowService, ContextService
- `src/infrastructure/` - 基础设施：文件系统仓储、Markdown 解析器
- `src/interfaces/` - 对外接口：CLI 工具、输出格式化

## Commands

```bash
npm run build    # 编译 TypeScript
npm run test     # 运行测试
npm run start    # 启动 CLI
```

## Conventions

- JSDoc 使用中文注释
- 严格 TypeScript（strict: true）
- 领域优先设计：业务逻辑只在 domain 层
- 依赖方向：interfaces -> application -> domain <- infrastructure

## Important

- 本工具是临时脚手架，不属于正式项目代码
- TaskTree 是只读的派生结构，不可直接修改
- 工作流状态只能通过 CLI 工具变更
- 除修改本工具自身外，所有操作必须在工作流控制下以原子任务执行
