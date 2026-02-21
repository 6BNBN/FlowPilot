# 

状态: finishing
当前: 无
开始: 2026-02-21T19:24:55.589Z

| ID | 标题 | 类型 | 依赖 | 状态 | 重试 | 摘要 | 描述 |
|----|------|------|------|------|------|------|------|
| 001 | BM25 稀疏向量升级：FNV-1a 20-bit hash | general | - | done | 0 | BM25稀疏向量升级：添加FNV-1a 20-bit termHash，区分query(raw TF)和doc(完整BM25)向量，所有向量函数改用Map<nu | 在 memory.ts 中引入 FNV-1a 20-bit hash 将 term 映射到 1M 固定维度空间（参考 Memoh-v2 indexer.go 的 termHash + sparseDimBits=20）。同时区分 query vector 和 doc vector 的权重计算（query 用 raw TF 无 IDF，doc 用完整 BM25 公式）。 |
| 002 | 多语言分词增强 + fastDetectLanguage | general | - | done | 0 | 增强tokenize支持完整CJK Unicode范围，添加isCJKRune+fastDetectLanguage，truncation.ts集成自动语言检测 | 增强 tokenize() 支持完整 CJK Unicode 范围（Unified Ideographs Extensions A-F、Hiragana/Katakana、Hangul Syllables）。添加 fastDetectLanguage() 函数（CJK ratio > 15% 判定为 CJK 语言）。参考 Memoh-v2 service.go 的 isCJKRune + fastDetectLanguage。 |
| 003 | 记忆系统加固：周期性 DF 刷盘 + TTL 缓存 | general | 001 | done | 0 | 记忆系统加固：添加 dfDirty flag + startPeriodicDfSave 30s刷盘，升级缓存为 TTL(24h)+LRU 混合策略（过期优先淘 | 添加 periodicSaveDfStats() 30秒定期持久化 DF 统计（参考 Memoh-v2 indexer.go 的 periodicSave）。升级 LRU 缓存为 TTL+LRU 混合策略（24h TTL，超过 maxEntries 时淘汰过期条目优先，再删最旧 25%，参考 Memoh-v2 embeddings/cache.go）。 |
| 004 | 心跳自检机制 | general | 001,002 | done | 0 | 心跳自检模块：新建 heartbeat.ts（runHeartbeat + startHeartbeat/stop），集成到 workflow-service | 在 workflow-service 中添加 heartbeat 自检：活跃任务超过 30 分钟发出警告，记忆条目超过 100 条自动触发 compaction，DF 统计文件完整性校验。参考 Memoh-v2 heartbeat/engine.go 的定时检查逻辑。轻量实现，不需要 CronPool。 |
| 005 | 进化引擎增强：预快照 + 安全回滚 | general | 003 | done | 0 | 进化引擎增强：预快照saveSnapshot+loadLatestSnapshot，review从快照精确回滚，ExperimentLog添加status字段( | 在 experiment() 执行前对 config.json 和 protocol.md 做完整快照（参考 Memoh-v2 evolution_log.go 的 files_snapshot）。增强 review() 的回滚逻辑：从快照精确恢复而非重新生成。添加进化日志的 status 字段（completed/failed/skipped）。 |
| 006 | 稀疏向量诊断 + checkpoint 智能截断 | general | 001,002 | done | 0 | sparseVectorStats() added to memory.ts + checkpoint智能截断集成到workflow-service.ts | 添加 sparseVectorStats() 输出 Top-K bucket 分布和 CDF 曲线（参考 Memoh-v2 service.go 的 computeSparseVectorStats）。在 checkpoint 时自动调用 truncateHeadTail() 对过长 summary 截断。集成 computeMaxChars() 到 checkpoint 流程。 |
| 007 | 构建验证 + 对比分析文档更新 | general | 001,002,003,004,005,006 | done | 0 | 构建验证通过(dist/flow.js 105KB, tsc --noEmit 0错误) + 对比分析.md 全面更新(记忆95%/进化85%/架构95%, 7 | 运行 npm run build 验证编译通过。更新对比分析.md 文档反映最新状态。确保 dist/flow.js 正常生成。 |
