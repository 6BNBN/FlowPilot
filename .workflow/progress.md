# 

状态: running
当前: 008

| ID | 标题 | 类型 | 依赖 | 状态 | 重试 | 摘要 | 描述 |
|----|------|------|------|------|------|------|------|
| 001 | 修复不可变性 + 依赖查找性能优化 | general | - | done | 0 | 不可变性重构完成：cascadeSkip/completeTask/failTask/resumeProgress 均返回新对象；findNextTask/fi | 修复 task-store.ts 中的可变性问题：cascadeSkip() 和 completeTask() 必须返回新对象而非原地修改。findNextTask/findParallelTasks 用 Map<id, TaskEntry> 索引替代 O(n²) 的 tasks.find()。修复 findNextTask 的副作用（不应内部调用 cascadeSkip）。 |
| 002 | 清理机制：finish 后清理 CLAUDE.md 协议块和 hooks | general | - | done | 0 | 实现 cleanupInjections() 方法：移除 CLAUDE.md 协议块和 settings.json hooks，在 finish/abort 成 | 在 fs-repository.ts 中新增 cleanup() 方法：1) 移除 CLAUDE.md 中 flowpilot:start/end 之间的内容 2) 移除 .claude/settings.json 中注入的 PreToolUse hooks。在 workflow-service.ts 的 finish() 成功后调用 cleanup()。 |
| 003 | 智能 summary 压缩：保留关键决策 + 时间衰减 | general | - | done | 0 | 智能summary压缩完成：updateSummary重写为三段式（关键决策提取+时间衰减+语义去重），新增extractTaggedLines/tokeniz | 改进 workflow-service.ts 的 updateSummary()：1) 识别并保留 [DECISION]/[ARCHITECTURE]/[IMPORTANT] 标记的内容不压缩 2) 实现时间衰减权重——最近完成的任务保留完整摘要，早期任务只保留标题 3) 语义去重——相似摘要合并 |
| 004 | 快照回滚系统：git tag + rollback 命令 | general | 001 | done | 0 | 快照回滚系统完成：git.ts 新增 tagTask/rollbackToTask/cleanTags，workflow-service checkpoint | 1) checkpoint 成功后在 autoCommit 之后打轻量 tag flowpilot/task-{id} 2) 新增 rollback <id> 命令：git revert 到指定任务的 tag 3) resume 时基于 --files 记录精确处理而非 stash 全部。需要修改 git.ts、workflow-service.ts、cli.ts。 |
| 005 | Verify 可配置化 + abort 命令 | general | - | done | 0 | Verify可配置化(config.json覆盖自动检测+timeout可配) + abort命令(标记aborted并清理.workflow/) + CLI路 | 1) 支持 .workflow/config.json 自定义 verify 命令（覆盖自动检测）2) 新增 abort 命令：将工作流标记为 aborted，清理 .workflow/ 目录 3) verify timeout 可配置（默认仍为 300s）。修改 verify.ts、workflow-service.ts、cli.ts。 |
| 006 | Protocol 模板外置 + 插件钩子 | general | - | done | 0 | Protocol模板外置+生命周期钩子完成，37测试全通过 | 1) 将 fs-repository.ts 中硬编码的 CLAUDE.md 协议块提取为 templates/protocol.md 模板文件 2) 支持用户自定义协议模板路径 3) 在任务生命周期中暴露 onTaskStart/onTaskComplete/onWorkflowFinish 钩子点（通过 .workflow/config.json 配置 shell 命令） |
| 007 | 自我进化引擎：历史统计 + 参数自调整 | general | 001,003,005 | done | 0 | 自我进化引擎完成：新增 WorkflowStats 类型、history.ts 分析模块、.flowpilot/history/ 永久存储，finish() 保 | 1) 新增 .flowpilot/history/ 永久目录（不随 .workflow/ 清理），每次 finish 保存工作流统计（任务数、retry率、skip率、失败率、耗时分布、类型分布）2) init 时读取历史经验，输出建议（如"backend 类型任务历史失败率 30%，建议拆分更细"）3) 基于历史自动调整默认参数（retry次数、verify timeout） |
| 008 | 永久记忆系统：跨工作流知识积累 | general | 007 | active | 0 | - | 借鉴 Memoh-v2 三层记忆架构，实现 FlowPilot 永久记忆：1) .flowpilot/memory.md 存储跨工作流的关键知识（架构决策、技术选型、踩坑记录）2) checkpoint 时自动提取 [REMEMBER] 标记的内容写入永久记忆 3) init/next 时将相关永久记忆注入子 Agent context 4) 记忆条目带时间戳和引用计数，长期未引用的自动衰减归档 |
| 009 | 循环检测与防护机制 | general | 001 | done | 0 | 循环检测与防护机制完成：新增logger模块、CLI --verbose标志、checkpoint失败模式检测、失败原因写入context、关键操作点debug | 借鉴 Memoh-v2 的三策略防护：1) 在 checkpoint 中检测连续 FAILED 模式（当前已有 retry 3 次，增加模式识别日志）2) 新增 --verbose 模式输出调试日志 3) 任务失败时记录失败原因到 context/task-xxx.md，供后续任务参考 |
| 010 | 测试补全 + 集成验证 | general | 001,002,003,004,005,006,007,008,009 | pending | 0 | - | 为所有新增功能编写测试：1) 不可变性测试 2) cleanup 测试 3) 智能 summary 测试 4) rollback 测试 5) config 测试 6) 历史统计测试 7) 永久记忆测试 8) 运行全量测试确保无回归 |
