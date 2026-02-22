# task-001: Dense Vector 检索：Claude Embedding + 文件向量库

Dense vector 检索完成：embedding.ts（通用 OpenAI-compatible embedding 客户端 + SHA-256 缓存）、vector-store.ts（brute-force 余弦相似度 dense 检索）、memory.ts 集成三源 RRF 融合（BM25 sparse + BM25 向量 + Dense embedding），无 API key 时自动降级为纯 BM25
