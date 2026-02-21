1. [backend] 文件级向量索引：激活 RRF 双源融合
   在 memory.ts 新增文件级向量存储（.flowpilot/vectors.json），每次 appendMemory 时将 BM25 稀疏向量持久化，queryMemory 时同时执行 BM25 文本检索和向量余弦检索两路，通过已有的 rrfFuse 合并结果。实现 saveVector/loadVectors/vectorSearch 三个内部函数。参考 Memoh-v2 的 SearchWithVectors + fuseByRankFusion 逻辑。

2. [backend] 可选 LLM 智能提取：Extract→Decide 优雅降级 (deps: 1)
   在 extractor.ts 新增可选 LLM 提取路径：检测 ANTHROPIC_API_KEY 环境变量，有则调用 Claude API 执行 Extract（从文本提取事实）和 Decide（对比已有记忆决定 ADD/UPDATE/SKIP），无则降级到现有规则引擎。使用 Node.js 内置 https 模块直接调用 API（零外部依赖）。参考 Memoh-v2 的 LLM Extract→Decide 两步流程。

3. [general] 集成测试 + 构建验证 (deps: 1, 2)
   为向量索引和 LLM 提取编写测试：向量存储/检索/RRF双源融合端到端、LLM降级到规则引擎、API调用mock。运行 npm test + tsc --noEmit 确保全部通过。
