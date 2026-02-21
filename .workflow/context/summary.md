# 

## 任务进展

- [backend] 文件级向量索引：激活 RRF 双源融合: 文件级向量索引完成：新增 VectorEntry 类型 + loadVectors/saveVectors/vectorSearch/rebuildVector
- [backend] 可选 LLM 智能提取：Extract→Decide 优雅降级: LLM智能提取(Extract→Decide)优雅降级完成：callClaude/llmExtract/llmDecide + extractAll异步化 +
- [general] 集成测试 + 构建验证: 集成测试通过：memory.test.ts 新增3个向量索引测试，extractor.test.ts 新增2个LLM降级测试，全部138测试通过+tsc通过
