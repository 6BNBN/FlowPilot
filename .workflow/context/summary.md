# 

## 已完成
- [general] 修复不可变性 + 依赖查找性能优化: 不可变性重构完成：cascadeSkip/completeTask/failTask/resumeProgress 均返回新对象；findNextTask/fi
- [general] 清理机制：finish 后清理 CLAUDE.md 协议块和 hooks: 实现 cleanupInjections() 方法：移除 CLAUDE.md 协议块和 settings.json hooks，在 finish/abort 成
- [general] 智能 summary 压缩：保留关键决策 + 时间衰减: 智能summary压缩完成：updateSummary重写为三段式（关键决策提取+时间衰减+语义去重），新增extractTaggedLines/tokeniz
- [general] 快照回滚系统：git tag + rollback 命令: 快照回滚系统完成：git.ts 新增 tagTask/rollbackToTask/cleanTags，workflow-service checkpoint
- [general] Verify 可配置化 + abort 命令: Verify可配置化(config.json覆盖自动检测+timeout可配) + abort命令(标记aborted并清理.workflow/) + CLI路
- [general] Protocol 模板外置 + 插件钩子: Protocol模板外置+生命周期钩子完成，37测试全通过
- [general] 自我进化引擎：历史统计 + 参数自调整: 自我进化引擎完成：新增 WorkflowStats 类型、history.ts 分析模块、.flowpilot/history/ 永久存储，finish() 保
- [general] 永久记忆系统：跨工作流知识积累: 上次中断，需重新执行
- [general] 循环检测与防护机制: 循环检测与防护机制完成：新增logger模块、CLI --verbose标志、checkpoint失败模式检测、失败原因写入context、关键操作点debug

## 待完成
- [general] 测试补全 + 集成验证
