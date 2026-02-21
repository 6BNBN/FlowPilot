# 

状态: finishing
当前: 无
开始: 2026-02-21T15:15:03.644Z

| ID | 标题 | 类型 | 依赖 | 状态 | 重试 | 摘要 | 描述 |
|----|------|------|------|------|------|------|------|
| 001 | 文件级向量索引：激活 RRF 双源融合 | backend | - | done | 0 | 文件级向量索引完成：新增 VectorEntry 类型 + loadVectors/saveVectors/vectorSearch/rebuildVector | 在 memory.ts 新增文件级向量存储（.flowpilot/vectors.json），每次 appendMemory 时将 BM25 稀疏向量持久化，queryMemory 时同时执行 BM25 文本检索和向量余弦检索两路，通过已有的 rrfFuse 合并结果。实现 saveVector/loadVectors/vectorSearch 三个内部函数。参考 Memoh-v2 的 SearchWithVectors + fuseByRankFusion 逻辑。 |
| 002 | 可选 LLM 智能提取：Extract→Decide 优雅降级 | backend | 001 | done | 0 | LLM智能提取(Extract→Decide)优雅降级完成：callClaude/llmExtract/llmDecide + extractAll异步化 + | 在 extractor.ts 新增可选 LLM 提取路径：检测 ANTHROPIC_API_KEY 环境变量，有则调用 Claude API 执行 Extract（从文本提取事实）和 Decide（对比已有记忆决定 ADD/UPDATE/SKIP），无则降级到现有规则引擎。使用 Node.js 内置 https 模块直接调用 API（零外部依赖）。参考 Memoh-v2 的 LLM Extract→Decide 两步流程。 |
| 003 | 集成测试 + 构建验证 | general | 001,002 | done | 0 | 集成测试通过：memory.test.ts 新增3个向量索引测试，extractor.test.ts 新增2个LLM降级测试，全部138测试通过+tsc通过 | 为向量索引和 LLM 提取编写测试：向量存储/检索/RRF双源融合端到端、LLM降级到规则引擎、API调用mock。运行 npm test + tsc --noEmit 确保全部通过。 |
