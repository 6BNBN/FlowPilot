# task-003: 智能 summary 压缩：保留关键决策 + 时间衰减

智能summary压缩完成：updateSummary重写为三段式（关键决策提取+时间衰减+语义去重），新增extractTaggedLines/tokenize/similarity/dedup四个私有方法
