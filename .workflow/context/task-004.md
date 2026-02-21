# task-004: 心跳自检机制

心跳自检模块：新建 heartbeat.ts（runHeartbeat + startHeartbeat/stop），集成到 workflow-service init/resume/finish 生命周期，重构 healthCheck 委托给 heartbeat 模块
