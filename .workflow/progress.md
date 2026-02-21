# 

状态: finishing
当前: 无
开始: 2026-02-21T14:34:40.085Z

| ID | 标题 | 类型 | 依赖 | 状态 | 重试 | 摘要 | 描述 |
|----|------|------|------|------|------|------|------|
| 001 | BM25 替代 TF-IDF 检索算法 | backend | - | done | 0 | BM25替代TF-IDF：DfStats新增avgDocLen，rebuildDf计算平均文档长度，bm25Vector实现BM25公式(k1=1.2,b=0. | 将 memory.ts 的 TF-IDF 检索升级为 BM25 算法（k1=1.2, b=0.75），使用 FNV-1a 20-bit hash 做稀疏向量索引，参考 Memoh-v2 的 indexer.go 实现。保留现有 tokenize/cosineSimilarity/mmrRerank 函数，替换 tfidfVector 为 bm25Vector，新增 avgDocLen 统计到 DfStats。 |
| 002 | 多语言分词增强：日韩文 bigram + 语言检测 | backend | - | done | 0 | 多语言分词增强：tokenize 扩展日韩文 CJK 范围(平假名/片假名/韩文) + bigram，新增 detectLanguage 导出函数 | 增强 memory.ts 的 tokenize 函数，新增日文平假名/片假名（\u3040-\u30ff）和韩文（\uac00-\ud7af）的单字+bigram 支持。新增 detectLanguage 辅助函数用于 CJK 比例检测。 |
| 003 | CJK token 估算与智能截断工具 | backend | 002 | done | 0 | CJK token估算与智能截断工具：estimateCharsPerToken/truncateHeadTail/computeMaxChars 三函数实现， | 新建 src/infrastructure/truncation.ts，实现：1) estimateCharsPerToken(text) 基于 CJK 比例估算（1.5*cjkRatio + 3.5*(1-cjkRatio)）；2) truncateHeadTail(text, maxChars) 保留 head 70% + tail 20%；3) computeMaxChars(contextWindow) 公式 contextWindow × 0.3 × charsPerToken。参考 Memoh-v2 agent/src 的截断逻辑。 |
| 004 | 记忆查询文件级缓存：SHA-256 + LRU | backend | 001 | done | 0 | 记忆查询缓存层完成：SHA-256哈希+LRU淘汰，集成queryMemory/appendMemory/compactMemory | 在 memory.ts 新增查询缓存层：SHA-256 作为缓存键，LRU 淘汰策略（最大50条，超限裁剪10%最旧），缓存文件 .flowpilot/memory-cache.json。queryMemory 命中缓存直接返回，appendMemory/compactMemory 时清除缓存。 |
| 005 | BM25 统计增强持久化 | backend | 001 | done | 0 | BM25统计增强持久化已完善：DfStats含avgDocLen、rebuildDf正确计算、loadDf默认值、appendMemory/compactMem | 增强 DfStats 结构新增 avgDocLen 字段，appendMemory 时更新平均文档长度。saveDf 在每次 appendMemory/compactMemory 后自动调用。确保 rebuildDf 也计算 avgDocLen。 |
| 006 | RRF 多源融合预留 + 智能截断集成 | backend | 001,003 | done | 0 | RRF多源融合函数+queryMemory双源预留+updateSummary智能截断集成 | 在 memory.ts 新增 rrfFuse(sources: ScoredEntry[][]) 函数实现 Reciprocal Rank Fusion（k=60）。在 queryMemory 中预留双源融合入口（当前仅 BM25 单源，但架构支持扩展）。将 truncation.ts 的 truncateHeadTail 集成到 workflow-service.ts 的 updateSummary 方法中。 |
| 007 | 心跳式自检机制 | backend | 001,002 | done | 0 | 心跳自检机制：healthCheck()方法实现（超时/记忆膨胀/DF一致性），集成到next() | 在 workflow-service.ts 新增 healthCheck() 方法：检查活跃任务超时（>30分钟无 checkpoint 告警）、记忆膨胀检测（>100条触发自动压缩）、DF 统计一致性校验。在 next 命令中自动调用。 |
| 008 | 全量测试验证 | general | 001,002,003,004,005,006,007 | done | 0 | 全量测试通过：新增 truncation.test.ts (9 tests)，扩展 memory.test.ts 新增 detectLanguage/cache | 为所有新增功能编写测试：BM25 评分正确性、多语言分词覆盖、CJK 估算精度、LRU 缓存命中/淘汰、RRF 融合排序、心跳自检触发条件。运行 npm test 确保全部通过。 |
