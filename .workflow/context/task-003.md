# task-003: 记忆系统加固：周期性 DF 刷盘 + TTL 缓存

记忆系统加固：添加 dfDirty flag + startPeriodicDfSave 30s刷盘，升级缓存为 TTL(24h)+LRU 混合策略（过期优先淘汰，再删最旧25%）
