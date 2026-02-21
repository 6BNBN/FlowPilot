# 

## 已完成
- [general] 记忆检索升级：TF-IDF + 余弦相似度替代 Jaccard: TF-IDF+余弦相似度+MMR重排序替代Jaccard，DF持久化到memory-df.json，改进tokenize支持CJK双字gram，7个测试全通过
- [general] 记忆自动提取：从 checkpoint summary 智能提取知识（无需 LLM）: 记忆自动提取：新建 extractor.ts 知识提取引擎（标记/决策/技术栈），替换 workflow-service.ts 中旧的 [REMEMBER] 提
- [general] 记忆压缩与合并机制: 记忆压缩与合并机制：新增 compactMemory(合并相似>0.7条目+目标数量压缩)、rollbackMemory(快照回滚)，init 时超50条自动触
- [general] 时间衰减升级：指数衰减 + 常青豁免: 时间衰减升级完成：指数衰减函数temporalDecayScore + evergreen豁免 + queryMemory排序权重集成 + decayMemor
- [general] 历史进化引擎：自动应用建议 + startTime 修复: 历史进化引擎完成：修复startTime、config自动写入闭环、evolution log保存/回滚
- [general] 结构化日志系统：step 类型 + trace 导出: 结构化日志系统完成：扩展logger支持StepType+LogEntry+JSONL持久化+trace导出，保留stderr兼容
- [general] 工具级循环检测：三策略防护: 工具级循环检测：新建 loop-detector.ts（三策略：repeatedNoProgress/pingPong/globalCircuitBreaker
- [general] 测试补全 + 集成验证: 测试补全完成: 新增44个测试(67→111), 覆盖memory/extractor/logger/loop-detector/history/workflo
