1. [general] 记忆检索升级：TF-IDF + 余弦相似度替代 Jaccard
   重写 memory.ts 的检索引擎：1) 实现 TF-IDF 向量化（维护文档频率统计）2) 用余弦相似度替代 Jaccard 3) 改进 tokenize 支持多语言分词（参考 Memoh-v2 的 CJK+拉丁混合分词）4) 查询结果加 MMR 重排序保证多样性。保持零外部依赖。

2. [general] 记忆自动提取：从 checkpoint summary 智能提取知识（无需 LLM）
   参考 Memoh-v2 的 fact extraction，用规则引擎替代 LLM：1) 除 [REMEMBER] 外，自动识别 [DECISION]/[ARCHITECTURE]/[IMPORTANT] 标记内容写入永久记忆 2) 自动提取"选择了X而非Y"、"因为X所以Y"等决策模式 3) 提取技术栈关键词（框架名、库名、配置项）作为记忆条目

3. [general] 记忆压缩与合并机制 (deps: 1)
   参考 Memoh-v2 的 Compact：1) 新增 compactMemory 函数，合并语义相似(>0.7)的条目 2) 支持目标数量压缩（如从100条压缩到50条）3) 在 init 时当条目超过阈值自动触发压缩 4) 压缩前保存快照支持回滚

4. [general] 时间衰减升级：指数衰减 + 常青豁免 (deps: 1)
   参考 Memoh-v2 的 applyTemporalDecay：1) 将简单30天阈值改为指数衰减评分（可配半衰期，默认30天）2) 查询时将衰减分数纳入排序权重 3) 标记为 evergreen 的来源（如 architecture、identity）豁免衰减 4) 修复 decayMemory 中的 mutation 问题

5. [general] 历史进化引擎：自动应用建议 + startTime 修复 (deps: 1,2,3,4)
   对齐 Memoh-v2 的 Heartbeat 自我进化：1) 修复 collectStats 的 startTime 为空问题 2) analyzeHistory 的建议自动写入 config.json（闭环）3) 新增 evolution-log：每次 finish 保存进化快照（config 变更前后对比）4) 支持回滚到历史进化点

6. [general] 结构化日志系统：step 类型 + trace 导出
   参考 Memoh-v2 的 ProcessLog：1) 扩展 logger 支持结构化日志（step 类型：memory_searched/checkpoint_saved/task_started 等）2) 日志持久化到 .flowpilot/logs/ 3) 新增 trace 导出功能（按工作流/任务导出完整日志链）4) 保留 stderr 输出兼容现有 --verbose

7. [general] 工具级循环检测：三策略防护 (deps: 6)
   对齐 Memoh-v2 的 loop-detection.ts 三策略：1) 在 checkpoint 中解析子Agent行为模式（从 summary 提取工具调用信息）2) 重复无进展检测：连续相似 summary 判定卡住 3) 乒乓检测：任务间交替失败模式 4) 全局熔断：滑动窗口内失败率超阈值暂停工作流 5) 检测到循环时注入提示到下次任务 context

8. [general] 测试补全 + 集成验证 (deps: 1,2,3,4,5,6,7)
   为所有新增功能编写测试：1) TF-IDF 检索测试 2) 自动提取测试 3) 压缩合并测试 4) 指数衰减测试 5) 进化引擎测试 6) 结构化日志测试 7) 循环检测测试 8) 全量回归测试
