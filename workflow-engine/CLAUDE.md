# FlowPilot

全自动工作流调度工具，配合 Claude Code 实现万步0偏移的全自动开发。

## 前置条件

- Node.js >= 20
- Claude Code 已开启 **Agent Teams** 功能（Settings → Feature Flags → Agent Teams）
- 推荐插件：superpowers、frontend-design、feature-dev、code-review

## Architecture

DDD 分层架构：

- `src/domain/` - 核心模型：TaskEntry, ProgressData, task-store
- `src/application/` - 应用服务：WorkflowService (8个用例), ProtocolGenerator
- `src/infrastructure/` - 文件系统仓储、Markdown解析器、Git自动提交、多语言验证
- `src/interfaces/` - CLI命令路由、输出格式化、stdin处理

## Build

```bash
npm run build    # 编译 TypeScript → dist/flow.js
npm run dev      # 开发模式运行
```

## CLI (8个命令)

```bash
flow init [--force]          # 初始化工作流(stdin传入任务md) / 接管项目(无stdin)
flow next [--batch]          # 获取下一个/所有可并行任务（含依赖上下文）
flow checkpoint <id>         # 记录任务完成 [stdin | --file | 内联文本]
flow skip <id>               # 手动跳过任务
flow finish                  # 智能收尾（验证+总结跳过/失败项+回到待命）
flow status                  # 查看全局进度
flow resume                  # 中断恢复（重置active→pending）
flow add <描述> [--type T]   # 追加任务（参数顺序任意）
```

## 核心机制

- 分层记忆：progress.md + context/task-xxx.md + context/summary.md（超10任务自动压缩）
- 上下文注入：flow next 自动拼装 summary + 依赖任务产出
- 协议驱动：flow init 生成 protocol.md + 写入CLAUDE.md引用
- Agent Teams：所有任务强制通过 Task 工具派发子Agent，主Agent只做调度
- 插件映射：frontend→/frontend-design, backend→/feature-dev, 拆解→/superpowers:brainstorming
- 容错：3次重试+级联跳过+中断恢复+finish汇报失败项
- 多语言验证：Node/Rust/Go/Python/Java/C++/Makefile 自动检测

## Conventions

- JSDoc 使用中文注释
- 严格 TypeScript（strict: true）
- 依赖方向：interfaces → application → domain ← infrastructure

## Important

- 工作流状态只能通过 flow CLI 变更
- progress.md 是记忆本体，compact/重启后读它恢复
- 如有 .workflow/protocol.md，遵循其中的调度协议
- 主Agent禁止直接读源码/写代码，全部交给子Agent

遵循 .workflow/protocol.md 工作流调度协议
