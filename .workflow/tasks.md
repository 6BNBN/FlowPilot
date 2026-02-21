1. [backend] BM25 替代 TF-IDF 检索算法
   将 memory.ts 的 TF-IDF 检索升级为 BM25 算法（k1=1.2, b=0.75），使用 FNV-1a 20-bit hash 做稀疏向量索引，参考 Memoh-v2 的 indexer.go 实现。保留现有 tokenize/cosineSimilarity/mmrRerank 函数，替换 tfidfVector 为 bm25Vector，新增 avgDocLen 统计到 DfStats。

2. [backend] 多语言分词增强：日韩文 bigram + 语言检测
   增强 memory.ts 的 tokenize 函数，新增日文平假名/片假名（\u3040-\u30ff）和韩文（\uac00-\ud7af）的单字+bigram 支持。新增 detectLanguage 辅助函数用于 CJK 比例检测。

3. [backend] CJK token 估算与智能截断工具 (deps: 2)
   新建 src/infrastructure/truncation.ts，实现：1) estimateCharsPerToken(text) 基于 CJK 比例估算（1.5*cjkRatio + 3.5*(1-cjkRatio)）；2) truncateHeadTail(text, maxChars) 保留 head 70% + tail 20%；3) computeMaxChars(contextWindow) 公式 contextWindow × 0.3 × charsPerToken。参考 Memoh-v2 agent/src 的截断逻辑。

4. [backend] 记忆查询文件级缓存：SHA-256 + LRU (deps: 1)
   在 memory.ts 新增查询缓存层：SHA-256 作为缓存键，LRU 淘汰策略（最大50条，超限裁剪10%最旧），缓存文件 .flowpilot/memory-cache.json。queryMemory 命中缓存直接返回，appendMemory/compactMemory 时清除缓存。

5. [backend] BM25 统计增强持久化 (deps: 1)
   增强 DfStats 结构新增 avgDocLen 字段，appendMemory 时更新平均文档长度。saveDf 在每次 appendMemory/compactMemory 后自动调用。确保 rebuildDf 也计算 avgDocLen。

6. [backend] RRF 多源融合预留 + 智能截断集成 (deps: 1, 3)
   在 memory.ts 新增 rrfFuse(sources: ScoredEntry[][]) 函数实现 Reciprocal Rank Fusion（k=60）。在 queryMemory 中预留双源融合入口（当前仅 BM25 单源，但架构支持扩展）。将 truncation.ts 的 truncateHeadTail 集成到 workflow-service.ts 的 updateSummary 方法中。

7. [backend] 心跳式自检机制 (deps: 1, 2)
   在 workflow-service.ts 新增 healthCheck() 方法：检查活跃任务超时（>30分钟无 checkpoint 告警）、记忆膨胀检测（>100条触发自动压缩）、DF 统计一致性校验。在 next 命令中自动调用。

8. [general] 全量测试验证 (deps: 1, 2, 3, 4, 5, 6, 7)
   为所有新增功能编写测试：BM25 评分正确性、多语言分词覆盖、CJK 估算精度、LRU 缓存命中/淘汰、RRF 融合排序、心跳自检触发条件。运行 npm test 确保全部通过。
