# 

## 任务进展

- [backend] BM25 替代 TF-IDF 检索算法: BM25替代TF-IDF：DfStats新增avgDocLen，rebuildDf计算平均文档长度，bm25Vector实现BM25公式(k1=1.2,b=0.
- [backend] 多语言分词增强：日韩文 bigram + 语言检测: 多语言分词增强：tokenize 扩展日韩文 CJK 范围(平假名/片假名/韩文) + bigram，新增 detectLanguage 导出函数
- [backend] CJK token 估算与智能截断工具: CJK token估算与智能截断工具：estimateCharsPerToken/truncateHeadTail/computeMaxChars 三函数实现，
- [backend] 记忆查询文件级缓存：SHA-256 + LRU: 记忆查询缓存层完成：SHA-256哈希+LRU淘汰，集成queryMemory/appendMemory/compactMemory
- [backend] BM25 统计增强持久化: BM25统计增强持久化已完善：DfStats含avgDocLen、rebuildDf正确计算、loadDf默认值、appendMemory/compactMem
- [backend] RRF 多源融合预留 + 智能截断集成: RRF多源融合函数+queryMemory双源预留+updateSummary智能截断集成
- [backend] 心跳式自检机制: 心跳自检机制：healthCheck()方法实现（超时/记忆膨胀/DF一致性），集成到next()
- [general] 全量测试验证: 全量测试通过：新增 truncation.test.ts (9 tests)，扩展 memory.test.ts 新增 detectLanguage/cache
