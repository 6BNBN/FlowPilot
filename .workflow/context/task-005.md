# task-005: BM25 统计增强持久化

BM25统计增强持久化已完善：DfStats含avgDocLen、rebuildDf正确计算、loadDf默认值、appendMemory/compactMemory均调用saveDf、bm25Vector正确使用avgDocLen，编译通过
