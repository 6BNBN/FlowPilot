# task-001: 修复不可变性 + 依赖查找性能优化

不可变性重构完成：cascadeSkip/completeTask/failTask/resumeProgress 均返回新对象；findNextTask/findParallelTasks 移除内部 cascadeSkip 副作用；全部查找改用 Map 索引 O(1)；workflow-service 适配新 API；17 个单元测试全部通过，TypeScript 编译无错误
