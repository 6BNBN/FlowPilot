1. [general] BM25 稀疏向量升级：FNV-1a 20-bit hash
   在 memory.ts 中引入 FNV-1a 20-bit hash 将 term 映射到 1M 固定维度空间（参考 Memoh-v2 indexer.go 的 termHash + sparseDimBits=20）。同时区分 query vector 和 doc vector 的权重计算（query 用 raw TF 无 IDF，doc 用完整 BM25 公式）。

2. [general] 多语言分词增强 + fastDetectLanguage
   增强 tokenize() 支持完整 CJK Unicode 范围（Unified Ideographs Extensions A-F、Hiragana/Katakana、Hangul Syllables）。添加 fastDetectLanguage() 函数（CJK ratio > 15% 判定为 CJK 语言）。参考 Memoh-v2 service.go 的 isCJKRune + fastDetectLanguage。

3. [general] 记忆系统加固：周期性 DF 刷盘 + TTL 缓存 (deps: 1)
   添加 periodicSaveDfStats() 30秒定期持久化 DF 统计（参考 Memoh-v2 indexer.go 的 periodicSave）。升级 LRU 缓存为 TTL+LRU 混合策略（24h TTL，超过 maxEntries 时淘汰过期条目优先，再删最旧 25%，参考 Memoh-v2 embeddings/cache.go）。

4. [general] 心跳自检机制 (deps: 1, 2)
   在 workflow-service 中添加 heartbeat 自检：活跃任务超过 30 分钟发出警告，记忆条目超过 100 条自动触发 compaction，DF 统计文件完整性校验。参考 Memoh-v2 heartbeat/engine.go 的定时检查逻辑。轻量实现，不需要 CronPool。

5. [general] 进化引擎增强：预快照 + 安全回滚 (deps: 3)
   在 experiment() 执行前对 config.json 和 protocol.md 做完整快照（参考 Memoh-v2 evolution_log.go 的 files_snapshot）。增强 review() 的回滚逻辑：从快照精确恢复而非重新生成。添加进化日志的 status 字段（completed/failed/skipped）。

6. [general] 稀疏向量诊断 + checkpoint 智能截断 (deps: 1, 2)
   添加 sparseVectorStats() 输出 Top-K bucket 分布和 CDF 曲线（参考 Memoh-v2 service.go 的 computeSparseVectorStats）。在 checkpoint 时自动调用 truncateHeadTail() 对过长 summary 截断。集成 computeMaxChars() 到 checkpoint 流程。

7. [general] 构建验证 + 对比分析文档更新 (deps: 1, 2, 3, 4, 5, 6)
   运行 npm run build 验证编译通过。更新对比分析.md 文档反映最新状态。确保 dist/flow.js 正常生成。
