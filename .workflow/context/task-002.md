# task-002: 记忆自动提取：从 checkpoint summary 智能提取知识（无需 LLM）

记忆自动提取：新建 extractor.ts 知识提取引擎（标记/决策/技术栈），替换 workflow-service.ts 中旧的 [REMEMBER] 提取逻辑，修复 memory.ts queryMemory 的 similarity 未定义 bug
