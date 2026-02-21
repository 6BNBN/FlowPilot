# 

## 任务进展

- [general] BM25 稀疏向量升级：FNV-1a 20-bit hash: BM25稀疏向量升级：添加FNV-1a 20-bit termHash，区分query(raw TF)和doc(完整BM25)向量，所有向量函数改用Map<nu
- [general] 多语言分词增强 + fastDetectLanguage: 增强tokenize支持完整CJK Unicode范围，添加isCJKRune+fastDetectLanguage，truncation.ts集成自动语言检测
- [general] 记忆系统加固：周期性 DF 刷盘 + TTL 缓存: 记忆系统加固：添加 dfDirty flag + startPeriodicDfSave 30s刷盘，升级缓存为 TTL(24h)+LRU 混合策略（过期优先淘
- [general] 心跳自检机制: 心跳自检模块：新建 heartbeat.ts（runHeartbeat + startHeartbeat/stop），集成到 workflow-service
- [general] 进化引擎增强：预快照 + 安全回滚: 进化引擎增强：预快照saveSnapshot+loadLatestSnapshot，review从快照精确回滚，ExperimentLog添加status字段(
- [general] 稀疏向量诊断 + checkpoint 智能截断: sparseVectorStats() added to memory.ts + checkpoint智能截断集成到workflow-service.ts
- [general] 构建验证 + 对比分析文档更新: 构建验证通过(dist/flow.js 105KB, tsc --noEmit 0错误) + 对比分析.md 全面更新(记忆95%/进化85%/架构95%, 7
