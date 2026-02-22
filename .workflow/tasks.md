1. [general] Dense Vector 检索：Claude Embedding + 文件向量库
   新建 infrastructure/embedding.ts：callClaudeEmbedding() 复用 ANTHROPIC_API_KEY 调用 Claude embedding API 获取 dense vector。新建 infrastructure/vector-store.ts：文件级向量存储（.flowpilot/vectors.json），brute-force cosine search。修改 memory.ts 的 queryMemory()：双路检索（BM25 sparse + dense vector）→ 已有 rrfFuse 融合。无 API key 时自动降级为纯 BM25。appendMemory() 时异步获取 embedding 并存储。

2. [general] 多语言分析器：停用词 + 词干提取 + 按语言 BM25 统计
   新建 infrastructure/lang-analyzers.ts：10+ 语言停用词表（en/zh/ja/ko/fr/de/es/pt/ru/ar/it/nl），英语 Porter Stemmer 轻量实现，扩展 fastDetectLanguage 支持日韩文独立检测。修改 memory.ts：tokenize() 集成停用词过滤和词干提取，DfStats 按语言分离（参考 Memoh-v2 的 per-language stats map），bm25Vector/bm25QueryVector 使用对应语言的 DF 统计。

3. [general] 协议自进化：CLAUDE.md 自修改 + EXPERIMENTS.md 日志 (deps: 1)
   增强 history.ts 的 experiment() 支持 protocol-self-modify 目标：分析工作流历史中的模式（高频失败类型、重试热点、成功模式），生成针对 CLAUDE.md 协议的改进建议并自动应用。新建 .flowpilot/EXPERIMENTS.md 记录每次进化（日期、触发原因、观察、行动、预期效果）。reflect() 增加对 checkpoint summary 的模式挖掘（friction/delight/patterns/gaps 四维分析）。所有修改前做快照，支持回滚。

4. [general] Multimodal 记忆支持：图片/文件元数据 + 内容类型路由 (deps: 1)
   扩展 MemoryEntry 添加 contentType 字段（text/image/file/mixed）和 metadata（imageUrl/filePath/mimeType）。embedding.ts 添加 multimodal 内容描述生成（用 Claude vision API 对图片生成文本描述后再 embed）。queryMemory() 支持按 contentType 过滤。appendMemory() 根据内容类型选择处理管线（纯文本→直接 embed，图片→描述+embed，文件→摘要+embed）。

5. [general] 构建验证 + 对比分析文档最终更新 (deps: 1, 2, 3, 4)
   npm run build 验证编译通过。更新对比分析.md：记忆系统 95%→100%，历史进化 85%→95%，知识提取 75%→85%。标记所有未借鉴功能为已实现。
