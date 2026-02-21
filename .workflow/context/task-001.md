# task-001: BM25 稀疏向量升级：FNV-1a 20-bit hash

BM25稀疏向量升级：添加FNV-1a 20-bit termHash，区分query(raw TF)和doc(完整BM25)向量，所有向量函数改用Map<number,number>
