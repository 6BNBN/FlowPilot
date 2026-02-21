# task-001: 文件级向量索引：激活 RRF 双源融合

文件级向量索引完成：新增 VectorEntry 类型 + loadVectors/saveVectors/vectorSearch/rebuildVectorIndex 函数，集成到 appendMemory（追加向量）和 compactMemory（重建向量），激活 queryMemory 的 RRF 双源融合（BM25 文本检索 + 向量余弦检索）
