# task-007: 工具级循环检测：三策略防护

工具级循环检测：新建 loop-detector.ts（三策略：repeatedNoProgress/pingPong/globalCircuitBreaker），集成到 workflow-service.ts checkpoint，检测到循环时 log.step + 注入下次任务 context
