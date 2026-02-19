# 架构概述

## DDD 分层架构

```
interfaces → application → domain ← infrastructure
```

## 各层职责

### Domain（领域层）
- 核心业务模型：Workflow、Step、Task、ExecutionState
- 值对象：StepId、TaskStatus、ControlFlowMarker
- 领域规则：步骤推进逻辑、并行/串行约束、循环终止条件
- 不依赖任何外部层

### Application（应用层）
- 用例编排：创建流程、推进步骤、分支选择、子流程派生
- 调用 Domain 层执行业务逻辑
- 通过接口调用 Infrastructure 层进行持久化
- 任务树的只读派生计算

### Infrastructure（基础设施层）
- 目录式存储：每个流程实例一个目录
- Markdown 工作流定义文件的解析与读取
- 执行状态的 JSON 序列化/反序列化
- 实现 Domain 层定义的仓储接口

### Interfaces（接口层）
- CLI 命令解析与路由
- 输入验证与错误提示
- 输出格式化（文本/JSON）

## 依赖方向

```
interfaces ──→ application ──→ domain
                                 ↑
infrastructure ──────────────────┘
```

- Domain 层零依赖，是架构核心
- Infrastructure 依赖 Domain 的接口定义，实现具体存储
- Application 编排 Domain 逻辑，声明 Infrastructure 接口
- Interfaces 仅调用 Application 层

## 关键设计决策

| 决策 | 理由 |
|------|------|
| 目录式存储 | 无需数据库，便于版本控制和人工检查 |
| Markdown 工作流定义 | 可读性强，易于编写和维护 |
| 只读任务树派生 | 任务树由执行状态实时计算，不单独存储，保证一致性 |
| 步骤编号约定 | 数字表串行，字母后缀表并行，直观映射执行语义 |
