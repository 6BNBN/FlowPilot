# Memoh-v2 源码深度分析

> 本文档是对 Memoh-v2 项目的全面源码分析，涵盖架构设计、核心系统实现、API 端点、数据库设计、代码质量评估及改进建议。

---

## 1. 项目概览

- **项目定位**：单用户结构化长记忆 AI Agent 平台
- **核心理念**：真隔离 · 真记忆 · 真进化
  - **真隔离**：每个 Bot 拥有独立的 containerd 容器沙箱，进程级隔离，非 Docker-in-Docker
  - **真记忆**：三层检索系统（Dense Vector + Sparse BM25 + Multimodal），支持 Reciprocal Rank Fusion、时间衰减、MMR 重排序
  - **真进化**：心跳驱动的三阶段自我进化循环（Reflect → Experiment → Review），Bot 可自主修改自身人格文件
- **GitHub**: https://github.com/Kxiandaoyan/Memoh-v2

---

## 2. 项目规模与结构

### 2.1 目录树

```
Memoh-v2/
├── cmd/                          # 3 个入口点
│   ├── agent/main.go             # Go 后端主入口（Uber FX DI 容器）
│   ├── cli/main.go               # CLI 工具入口
│   └── mcp/main.go               # MCP stdio 入口
├── internal/                     # Go 后端核心（71 个子目录）
│   ├── accounts/                 # 账户服务
│   ├── auth/                     # JWT 认证
│   ├── automation/               # CronPool 定时任务
│   ├── bind/                     # 绑定服务
│   ├── boot/                     # 运行时配置
│   ├── bots/                     # Bot 管理
│   ├── channel/                  # 多渠道适配（飞书/Telegram/Local）
│   │   ├── adapters/feishu/
│   │   ├── adapters/telegram/
│   │   ├── adapters/local/
│   │   ├── identities/
│   │   ├── inbound/
│   │   └── route/
│   ├── config/                   # TOML 配置
│   ├── containerd/               # 容器沙箱（containerd v2）
│   ├── conversation/             # 会话管理
│   │   └── flow/                 # 对话流解析器
│   ├── db/sqlc/                  # sqlc 生成代码（~7093 行）
│   ├── embeddings/               # 嵌入向量管理
│   ├── handlers/                 # HTTP Handler（40+ 文件）
│   ├── heartbeat/                # 心跳与进化引擎
│   ├── identity/                 # 身份管理
│   ├── logger/                   # 日志
│   ├── mcp/                      # MCP 工具网关
│   │   ├── providers/            # 12 个内置 MCP Provider
│   │   └── sources/federation/   # MCP 联邦
│   ├── memory/                   # 三层记忆系统核心
│   ├── message/                  # 消息服务 + 事件总线
│   ├── models/                   # LLM 模型管理
│   ├── policy/                   # 权限策略
│   ├── preauth/                  # 预认证
│   ├── processlog/               # 过程日志
│   ├── providers/                # LLM Provider 管理
│   ├── schedule/                 # 定时任务
│   ├── searchproviders/          # 搜索引擎集成
│   ├── server/                   # Echo HTTP 服务器
│   ├── settings/                 # 设置服务
│   ├── subagent/                 # 子 Agent 管理
│   ├── templates/                # 13 个 Bot 模板
│   └── version/                  # 版本信息
├── agent/                        # Agent 网关（TypeScript, ~38 个文件）
│   └── src/
│       ├── agent.ts              # 核心 Agent 工厂
│       ├── model.ts              # 多供应商模型创建
│       ├── models.ts             # Zod 校验模型
│       ├── registry.ts           # 子 Agent 注册表
│       ├── tools/                # 工具系统（MCP/内置/循环检测）
│       ├── prompts/              # 系统提示词
│       ├── modules/              # 聊天/图像模块
│       ├── middlewares/          # Bearer/CORS/Error
│       └── utils/                # SSE/附件/重试
├── packages/                     # 前端 Vue 3 Monorepo
│   └── web/                      # Web 前端
│       └── src/
│           ├── components/       # UI 组件
│           ├── composables/      # Vue Composables
│           ├── pages/            # 页面
│           ├── store/            # Pinia 状态管理
│           └── lib/              # API 客户端
├── db/                           # 数据库
│   ├── migrations/               # PostgreSQL 迁移
│   └── queries/                  # sqlc 查询定义（25 个 .sql 文件）
├── docker/                       # Docker 构建
├── scripts/                      # 构建脚本
└── spec/                         # OpenAPI 规范
```

### 2.2 关键大文件

| 文件 | 行数 | 说明 |
|------|------|------|
| `internal/memory/service.go` | 1555 | 记忆系统核心服务，含 Add/Search/Compact/MMR/BM25 全流程 |
| `internal/handlers/containerd.go` | 1367 | 容器沙箱 HTTP Handler，含生命周期管理、快照、MCP 会话 |
| `internal/handlers/users.go` | 1056 | 用户/Bot CRUD，28 个端点注册 |
| `internal/memory/qdrant_store.go` | 894 | Qdrant 向量数据库存储层，支持 Named Vectors + Sparse Vectors |
| `cmd/agent/main.go` | 865 | 主入口，40+ FX Provider，全局 DI 容器 |
| `agent/src/agent.ts` | 668 | Agent 网关核心，工厂模式 + Generator 流式处理 |
| `internal/db/sqlc/` (总计) | 7093 | sqlc 自动生成的类型安全 SQL 代码 |

---

## 3. 技术栈

| 层级 | 技术 | 端口 |
|------|------|------|
| **后端** | Go 1.25 + Echo v4 + Uber FX + pgx/v5 + sqlc | 8080 |
| **Agent 网关** | Bun + Elysia + Vercel AI SDK + Zod | 8081 |
| **前端** | Vue 3 + Vite 7 + Tailwind CSS 4 + Pinia + Reka UI | 8082 |
| **关系数据库** | PostgreSQL 18 | 5432 |
| **向量数据库** | Qdrant（gRPC + REST） | 6333/6334 |
| **容器运行时** | Containerd v2（Unix Socket） | /run/containerd/containerd.sock |
| **Monorepo** | pnpm 10 + Go modules | - |
| **配置格式** | TOML (config.toml) | - |
| **API 规范** | OpenAPI → openapi-ts 自动生成 SDK | - |

---

## 4. 架构设计模式

### 4.1 后端（Go）

#### 依赖注入：Uber FX 全局 DI

`cmd/agent/main.go` 使用 Uber FX 构建全局依赖注入容器，40+ Provider 通过 `fx.Provide` 注册，Handler 通过 `group:"server_handlers"` 标签自动收集并注册到 Echo 路由：

```go
fx.New(
    fx.Provide(
        provideConfig,
        boot.ProvideRuntimeConfig,
        provideLogger,
        provideContainerdClient,
        provideDBConn,
        provideDBQueries,
        // containerd & mcp infrastructure
        fx.Annotate(ctr.NewDefaultService, fx.As(new(ctr.Service))),
        provideMCPManager,
        // memory pipeline
        provideMemoryLLM,
        provideEmbeddingsResolver,
        provideEmbeddingSetup,
        provideTextEmbedderForMemory,
        provideQdrantStore,
        memory.NewBM25Indexer,
        provideMemoryService,
        // domain services (auto-wired)
        models.NewService,
        bots.NewService,
        accounts.NewService,
        // ... 40+ more providers
    ),
)
```

#### Repository 模式：sqlc 生成类型安全 SQL

所有数据库操作通过 sqlc 从 25 个 `.sql` 查询文件生成类型安全的 Go 代码（共 7093 行）。参数化查询天然防 SQL 注入：

```sql
-- db/queries/users.sql → internal/db/sqlc/users.sql.go
-- name: GetUser :one
SELECT * FROM users WHERE id = $1;
```

#### Service 层

每个领域模块遵循统一结构：
- `types.go` — 领域类型定义
- `service.go` — 业务逻辑
- `interfaces.go` — 接口抽象（如 `conversation/interfaces.go`）

#### 中间件链

```
请求 → Recover → RequestLogger → JWT（带 Skipper）→ Handler
```

JWT Skipper 跳过公开路径：`/ping`, `/health`, `/api/swagger.json`, `/auth/login`, `/api/docs`。

#### 懒初始化

`provideMemoryLLM` 使用 `lazyLLMClient` 模式，延迟到运行时根据配置选择模型，避免启动时硬依赖特定 LLM Provider。

#### 生命周期管理

通过 `fx.Hook` 的 `OnStart`/`OnStop` 管理服务生命周期：心跳引擎 Bootstrap、BM25 Warmup、CronPool 启停等。

### 4.2 Agent 网关（TypeScript）

#### 工厂模式

`createAgent()` 是核心工厂函数，接收 `AgentParams` 返回四个方法：

```typescript
export const createAgent = (params: AgentParams, fetch: AuthFetcher) => {
  // ... 初始化
  return {
    stream,           // SSE 流式对话
    ask,              // 同步对话
    askAsSubagent,    // 子 Agent 对话
    triggerSchedule,  // 触发定时任务
  }
}
```

#### Generator 流式处理

使用 `async function*` 产出类型化事件，支持 SSE 流式传输：

```typescript
async function* stream(input: AgentInput) {
  // yield 类型化事件: agent_start, text_delta, tool_call, agent_end
}
```

#### 组合模式：统一 ToolSet

MCP 工具（来自容器内 MCP Server）与内置工具（web/skill/subagent）合并为统一 `ToolSet`，再包装循环检测：

```typescript
const mcpTools = await getMCPTools(mcpConnections, fetch)
const builtinTools = getTools(...)
const allTools = { ...mcpTools, ...builtinTools }
const safeTools = wrapToolsWithLoopDetection(allTools, sessionId)
```

#### 循环检测：三策略防护

```typescript
const REPEAT_NO_PROGRESS = 8    // 同工具+同参数+同结果 8 次 → 卡死
const PING_PONG_PAIRS   = 5    // 两工具交替 5 对无变化 → 卡死
const GLOBAL_BREAKER    = 25   // 窗口内同(工具+参数) 25 次 → 熔断
```

使用 FNV-1a 哈希对参数和结果进行指纹化，滑动窗口大小 40。

### 4.3 前端（Vue 3）

#### Block-Based 消息模型

消息内容使用 `ContentBlock` 联合类型：

```
ContentBlock = Text | Thinking | ToolCall | Image | Attachment
```

每条消息可包含多个 Block，支持流式渲染 thinking 过程和工具调用。

#### Pinia + Colada 状态管理

- `store/settings.ts` — 全局设置
- `store/chat-list.ts` — 聊天列表
- `store/user.ts` — 用户状态

#### 自动生成 SDK

通过 `openapi-ts.config.ts` 从 OpenAPI 规范自动生成 TypeScript API 客户端，确保前后端类型一致。

#### SSE 流解析

`composables/api/useChat.ts` 实现 SSE 流解析，实时更新消息 Block。

---

## 5. 核心系统实现

### 5.1 三层记忆系统

#### 检索流程图

```
Query
  │
  ├──────────────────────────────────────────────┐
  │                                              │
  ▼                                              ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Dense Vector   │  │  Sparse Vector  │  │   Multimodal    │
│  (Qdrant Named  │  │  (BM25 + FNV    │  │  (Resolver →    │
│   Vectors, MMR) │  │   20-bit Hash)  │  │   Named Vector) │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                     │
         └────────────┬───────┘─────────────────────┘
                      ▼
         ┌────────────────────────┐
         │  Reciprocal Rank      │
         │  Fusion (k=60)        │
         └───────────┬───────────┘
                     ▼
         ┌────────────────────────┐
         │  Temporal Decay        │
         │  (指数衰减, 半衰期     │
         │   30 天, evergreen     │
         │   豁免)                │
         └───────────┬───────────┘
                     ▼
         ┌────────────────────────┐
         │  Dedup                 │
         │  (cosine > 0.92 去重)  │
         └───────────┬───────────┘
                     ▼
         ┌────────────────────────┐
         │  Top-K 返回            │
         └────────────────────────┘
```

#### 关键算法

**MMR (Maximal Marginal Relevance) 重排序**

源码位置：`internal/conversation/flow/resolver.go` 和 `internal/memory/service.go`

```go
// MMR 公式: score = λ × relevance − (1−λ) × max_cosine_to_selected
// 默认 λ = 0.7, overfetch = 3x
func applyMMR(items []memoryContextItem, lambda float64) []memoryContextItem {
    selected := []memoryContextItem{items[0]}
    remaining := items[1:]
    for len(remaining) > 0 {
        bestIdx, bestMMR := -1, -math.MaxFloat64
        for i, cand := range remaining {
            maxSim := 0.0
            for _, sel := range selected {
                sim := textJaccardSimilarity(cand.Item.Memory, sel.Item.Memory)
                if sim > maxSim { maxSim = sim }
            }
            mmr := lambda*cand.Item.Score - (1-lambda)*maxSim
            if mmr > bestMMR { bestMMR = mmr; bestIdx = i }
        }
        selected = append(selected, remaining[bestIdx])
        remaining = append(remaining[:bestIdx], remaining[bestIdx+1:]...)
    }
    return selected
}
```

向量级 MMR 在 `service.go` 中实现，使用 Qdrant 返回的实际 dense vector 计算余弦相似度，3x overfetch 后重排序到目标数量。

**BM25 稀疏向量**

源码位置：`internal/memory/indexer.go`

```go
const (
    defaultBM25K1 = 1.2
    defaultBM25B  = 0.75
    sparseDimBits = 20              // 20-bit hash → 1M 维度空间
    sparseDimSize = 1 << sparseDimBits  // 1,048,576
)

// BM25 TF-IDF 公式
idf := math.Log(1 + (N - df + 0.5) / (df + 0.5))
tfNorm := (tf * (k1 + 1)) / (tf + k1*(1 - b + b*docLen/avgDocLen))
weight := tfNorm * idf

// 词项哈希：FNV-1a 32-bit → 20-bit mask
func termHash(term string) uint32 {
    hasher := fnv.New32a()
    hasher.Write([]byte(term))
    return hasher.Sum32() & sparseDimMask  // & 0xFFFFF
}
```

支持 30+ Bleve 语言分析器（ar, bg, ca, cjk, da, de, el, en, es, eu, fa, fi, fr, ga, gl, hi, hr, hu, hy, id, it, nl, no, pl, pt, ro, ru, sv, tr 等），CJK 自动检测。

**Embedding 缓存**

源码位置：`internal/memory/embedding_cache.go`

```go
const (
    embeddingCacheMaxEntries = 50_000
    embeddingCachePruneRatio = 0.10  // 超限时裁剪 10%
)
// 缓存键：SHA-256(text)
// 存储：PostgreSQL embedding_cache 表
// 淘汰策略：LRU（按 updated_at 排序，删除最旧的 10%）
// 命中时更新 updated_at 以延长生存期
```

**BM25 统计持久化**

```go
// 每 30 秒将脏语言的统计数据刷入 PostgreSQL bm25_stats 表
func (b *BM25Indexer) periodicSave(stop <-chan struct{}) {
    ticker := time.NewTicker(30 * time.Second)
    for {
        select {
        case <-ticker.C: b.flushDirty(ctx)
        case <-stop: return
        }
    }
}
```

**时间衰减**

源码位置：`internal/conversation/flow/resolver.go`

```go
const memoryDecayHalfLifeDays = 30.0

func applyTemporalDecay(items []memoryContextItem) {
    for i := range items {
        ageDays := now.Sub(updatedAt).Hours() / 24.0
        decay := math.Exp(-math.Ln2 / memoryDecayHalfLifeDays * ageDays)
        items[i].Item.Score *= decay
    }
}
```

指数衰减，半衰期 30 天。Evergreen 记忆（标记为常青的）豁免衰减。

### 5.2 容器沙箱系统

源码位置：`internal/containerd/` + `internal/handlers/containerd.go`

#### 生命周期

```
PullImage → CreateContainer → StartTask → ExecTask → StopTask → DeleteTask
```

每个 Bot 拥有独立的 containerd 容器，使用 OCI 标准规范创建。容器内运行 MCP Server，提供文件读写、命令执行等工具。

#### CNI 网络

- **Linux**：直接使用 CNI 插件配置网络命名空间
- **macOS**：通过 `limactl` 桥接到 Lima VM 中的 containerd

#### 快照系统

```
Prepare → Commit → Rollback
```

- `CreateSnapshotRequest` 创建命名快照
- 支持快照回滚，用于进化失败时恢复 Bot 状态
- Snapshotter 可配置（默认 overlayfs）

#### 命名空间隔离

每个 Bot 在独立的 containerd namespace 中运行，通过 `namespaces.WithNamespace(ctx, namespace)` 实现进程级隔离。

#### 重复分配恢复

Handler 检测到容器已存在时，不会重复创建，而是尝试恢复已有容器的 Task 状态。

### 5.3 Agent 网关流式处理

源码位置：`agent/src/agent.ts` + `agent/src/utils/sse.ts`

#### Token 预算

```typescript
const CHAR_BUDGETS: Record<SystemMode, { soul: number; tools: number }> = {
  full:    { soul: 3000, tools: 3000 },   // 完整模式
  minimal: { soul: 800,  tools: 800  },   // 精简模式
  micro:   { soul: 0,    tools: 0    },   // 微型模式（无系统文件）
}
```

#### 大文件截断

```typescript
const HEAD_RATIO = 0.7   // 保留头部 70%
const TAIL_RATIO = 0.2   // 保留尾部 20%
const FILE_SIZE_WARN_THRESHOLD = 8000  // 超过 8000 字符触发警告

function truncateHeadTail(content: string, maxChars: number): string {
  const headChars = Math.floor(maxChars * HEAD_RATIO)
  const tailChars = Math.floor(maxChars * TAIL_RATIO)
  return `${head}\n\n[...truncated...]\n\n${tail}`
}
```

#### SSE Payload 截断公式

```typescript
const DEFAULT_CONTEXT_WINDOW = 128_000
const TOOL_RESULT_CONTEXT_SHARE = 0.3
const CHARS_PER_TOKEN = 3.5

// maxChars = floor(contextWindow × 0.3 × charsPerToken)
export function computeMaxToolResultChars(contextWindow?: number, contentSample?: string): number {
  const cw = contextWindow || DEFAULT_CONTEXT_WINDOW
  const cpt = contentSample ? estimateCharsPerToken(contentSample) : CHARS_PER_TOKEN
  return Math.floor(cw * TOOL_RESULT_CONTEXT_SHARE * cpt)
}
```

#### CJK 感知估算

```typescript
function estimateCharsPerToken(text: string): number {
  const sample = text.slice(0, 300)
  let cjk = 0
  for (const ch of sample) {
    const cp = ch.codePointAt(0) ?? 0
    if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7af)) cjk++
  }
  const ratio = cjk / sample.length
  return 1.5 * ratio + 3.5 * (1 - ratio)  // CJK ~1.5 chars/token, Latin ~3.5
}
```

#### 系统文件缓存

```typescript
const SYSTEM_FILE_CACHE_TTL_MS = 60_000  // 60 秒 TTL
// 缓存键: `${botId}:${botIdentity}:${botSoul}`
// 自愈机制: 如果 DB 有人格内容但容器文件为空，异步恢复文件
```

### 5.4 子 Agent 系统

源码位置：`agent/src/registry.ts` + `agent/src/tools/subagent.ts`

#### 核心限制

```typescript
const DEFAULT_MAX_SPAWN_DEPTH = 1   // 最大嵌套深度：1（子 Agent 不能再生子 Agent）
const DEFAULT_MAX_CHILDREN = 5      // 每个父 Agent 最多 5 个并发子 Agent
const SWEEP_INTERVAL_MS = 5 * 60 * 1000  // 自动清扫间隔：5 分钟
```

#### SubagentRegistry

```typescript
export class SubagentRegistry {
  register(run)    // 注册新运行，超限抛异常
  complete(runId)  // 标记完成
  fail(runId)      // 标记失败
  abort(runId)     // 级联终止（含所有子代）
  sweep(maxAgeMs = 10 * 60 * 1000)  // 清理 10 分钟前结束的运行
}
```

#### 持久化

子 Agent 运行记录通过 Go 后端 REST API 持久化到 PostgreSQL `subagent_runs` 表，支持查询历史运行状态。

### 5.5 心跳与进化系统

源码位置：`internal/heartbeat/engine.go` + `internal/heartbeat/types.go`

#### 引擎架构

```
Engine
  ├── CronPool          # 定时任务池
  ├── EventTriggers     # 事件触发器（message_created, schedule_completed）
  ├── Triggerer         # 通过会话流触发心跳执行
  └── MemoryCompactor   # 记忆压缩器
```

#### 配置类型

| 类型 | 标记 | 默认间隔 | 说明 |
|------|------|----------|------|
| Heartbeat | 无特殊标记 | 用户自定义 | 普通心跳，执行用户定义的 Prompt |
| Evolution | `[evolution-reflection]` | 86400s (24h) | 自我进化心跳 |
| Memory Compact | `[memory-compact]` | 604800s (7天) | 记忆压缩，最少 50 条，保留 80% |

#### 三阶段进化循环

```
Phase 1: REFLECT — 挖掘对话信号
  ├── 重读人格文件: IDENTITY.md, SOUL.md, TOOLS.md, EXPERIMENTS.md, NOTES.md
  ├── 回顾近期对话历史
  ├── 寻找: 摩擦点、愉悦时刻、重复模式、能力缺口
  └── 无发现 → 报告 "No evolution needed" → 停止

Phase 2: EXPERIMENT — 小幅改进
  ├── 记录到 EXPERIMENTS.md（触发/观察/行动/预期）
  ├── 修改对应文件（IDENTITY.md / SOUL.md / TOOLS.md）
  └── 保持变更小且可逆

Phase 3: REVIEW — 自愈与维护
  ├── 检查定时任务运行状态
  ├── 整理 NOTES.md
  └── 验证协作文件
```

#### 活跃时间窗口

```go
type Config struct {
    ActiveHoursStart int   `json:"active_hours_start"` // 0-23
    ActiveHoursEnd   int   `json:"active_hours_end"`   // 0-23
    ActiveDays       []int `json:"active_days"`        // 0=周日...6=周六
}
```

心跳在活跃时间窗口外静默跳过，避免深夜打扰用户。

---

## 6. API 端点统计

| Handler 文件 | 端点数 | 认证模式 | 输入校验 | 错误处理 |
|-------------|--------|---------|---------|---------|
| `users.go` | 28 | JWT + Channel Identity + Bot Access + Admin Bypass | Echo Bind + 手动校验 | context wrapping + HTTP Error |
| `heartbeat.go` | 10 | JWT + Bot Owner/Member | 手动字段校验 | slog + HTTP Error |
| `memory.go` | 8 | JWT + Conversation Scope | Struct Bind + 必填校验 | 全链路 error wrapping |
| `mcp.go` | 8 | JWT + Bot Access | Echo Bind | HTTP Error |
| `subagent.go` | 10 | JWT + Bot Access | Echo Bind + 手动校验 | slog + HTTP Error |
| `message.go` | 5 | JWT + Channel Identity + Bot Access | Echo Bind + 必填校验 | SSE error event |
| `containerd.go` | 15+ | JWT + Bot Access + Policy | 手动校验 + 正则 | 详细 error wrapping |
| `skills.go` | 2 | JWT + Bot Access | 路径校验 | HTTP Error |
| `mcp_tools.go` | 1 | JWT + MCP Headers | JSON-RPC 校验 | JSON-RPC Error |
| `schedule.go` | 6+ | JWT + Bot Access | Echo Bind | HTTP Error |
| `models.go` | 5+ | JWT | Echo Bind | HTTP Error |
| `providers.go` | 5+ | JWT | Echo Bind | HTTP Error |

#### 授权分层

```
请求 → Channel Identity 提取 → Bot Access 校验 → Participant Check → Admin Bypass
         (JWT claims)         (owner/member)      (参与者权限)      (管理员跳过)
```

具体实现：
1. **Channel Identity**：从 JWT claims 或 `X-Memoh-Channel-Identity-Id` Header 提取
2. **Bot Access**：`authorizeBotAccess(ctx, userID, botID)` 检查用户是否为 Bot 的 owner 或 member
3. **Participant Check**：部分端点额外检查用户是否为对话参与者
4. **Admin Bypass**：管理员账户可跳过 Bot Access 检查

---

## 7. 多供应商 LLM 支持

源码位置：`agent/src/model.ts` + `agent/src/models.ts`

通过 Vercel AI SDK 统一接入 20+ LLM 供应商：

| 供应商 | ClientType | SDK 适配器 |
|--------|-----------|-----------|
| OpenAI | `openai` | `@ai-sdk/openai` |
| Anthropic | `anthropic` | `@ai-sdk/anthropic` |
| Google Gemini | `google` | `@ai-sdk/google` |
| Azure OpenAI | `azure` | `@ai-sdk/azure` |
| AWS Bedrock | `bedrock` | `@ai-sdk/amazon-bedrock` |
| Mistral | `mistral` | `@ai-sdk/mistral` |
| XAI (Grok) | `xai` | `@ai-sdk/xai` |
| Ollama | `ollama` | `@ai-sdk/openai` (兼容) |
| Dashscope (通义) | `dashscope` | `@ai-sdk/openai` (兼容) |
| DeepSeek | `deepseek` | `@ai-sdk/openai` (兼容) |
| Groq | `groq` | `@ai-sdk/openai` (兼容) |
| OpenRouter | `openrouter` | `@ai-sdk/openai` (兼容) |
| Together | `together` | `@ai-sdk/openai` (兼容) |
| Fireworks | `fireworks` | `@ai-sdk/openai` (兼容) |
| Perplexity | `perplexity` | `@ai-sdk/openai` (兼容) |
| Minimax | `minimax-global/cn` | `@ai-sdk/openai` (兼容) |
| Moonshot | `moonshot-global/cn` | `@ai-sdk/openai` (兼容) |
| 火山引擎 | `volcengine` | `@ai-sdk/openai` (兼容) |
| 千帆 | `qianfan` | `@ai-sdk/openai` (兼容) |
| ZAI | `zai-global/cn/coding` | `@ai-sdk/openai` (兼容) |

关键设计决策：

```typescript
// 强制使用 .chat() API（Chat Completions），避免 Responses API
// 产生 item_reference 导致后续轮次报错
const provider = createOpenAI({ apiKey, baseURL })
return provider.chat(modelId)
```

Token 用量通过 Vercel AI SDK 的 `LanguageModelUsage` 统一归一化，不同供应商的用量格式差异由 SDK 内部处理。

---

## 8. 数据库设计

### 核心表（25 个 sqlc 查询文件对应）

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| `users` | 用户账户 | id, username, password_hash, role, display_name |
| `bots` | Bot 实体 | id, owner_id, name, identity, soul, task, image |
| `models` | LLM 模型配置 | id, bot_id, provider, model_id, api_key |
| `providers` | LLM 供应商 | id, name, base_url, api_key |
| `channels` | 渠道配置 | id, platform, config_json |
| `channel_identities` | 渠道身份 | id, user_id, platform, external_id |
| `channel_routes` | 渠道路由 | id, bot_id, platform, config |
| `conversations` | 会话 | id, bot_id, user_id, title |
| `conversation_summaries` | 会话摘要 | id, conversation_id, summary |
| `messages` | 消息 | id, conversation_id, role, content, metadata |
| `memories` | 记忆（逻辑层） | 存储在 Qdrant，元数据在 payload |
| `embedding_cache` | 嵌入缓存 | provider, model, hash(SHA-256), embedding, dims, updated_at |
| `bm25_stats` | BM25 统计 | lang, doc_count, avg_doc_len, updated_at |
| `schedule` | 定时任务 | id, bot_id, name, pattern, command, enabled |
| `events` | 事件日志 | id, bot_id, type, payload, created_at |
| `heartbeat_configs` | 心跳配置 | id, bot_id, enabled, interval_seconds, prompt, event_triggers |
| `evolution_logs` | 进化日志 | id, bot_id, heartbeat_id, status, files_snapshot |
| `snapshots` | 容器快照 | id, bot_id, container_id, snapshot_name |
| `versions` | 版本管理 | id, bot_id, version, metadata |
| `bind` | 绑定关系 | id, bot_id, user_id, role |
| `process_logs` | 过程日志 | id, bot_id, trace_id, type, content |
| `subagent_runs` | 子Agent运行 | id, bot_id, parent_run_id, name, task, status |
| `containers` | 容器记录 | id, bot_id, container_id, image, status |
| `preauth` | 预认证令牌 | id, token, bot_id, expires_at |
| `search_providers` | 搜索引擎 | id, bot_id, type, config |
| `global_settings` | 全局设置 | key, value |
| `token_usage` | Token 用量 | id, bot_id, model, input_tokens, output_tokens |
| `mcp` | MCP 连接 | id, bot_id, name, type, url, config |

### sqlc 代码生成模式

```yaml
# sqlc.yaml
version: "2"
sql:
  - engine: "postgresql"
    queries: "db/queries/"
    schema: "db/migrations/"
    gen:
      go:
        package: "sqlc"
        out: "internal/db/sqlc"
```

查询定义 → sqlc 编译 → 类型安全 Go 代码（7093 行），所有 SQL 均为参数化查询。

---

## 9. 代码质量评估

### 9.1 优势

| 维度 | 评价 | 具体表现 |
|------|------|---------|
| 类型安全 | 优秀 | Go 端 sqlc 生成类型安全 SQL；TS 端 Zod schema 校验所有外部输入（ModelConfigModel, AgentSkillModel 等） |
| 错误处理 | 优秀 | 全链路 context wrapping（`fmt.Errorf("compact llm call failed: %w", err)`），错误不会被静默吞掉 |
| 不可变性 | 良好 | 消息清洗函数（`stripReasoningFromMessages`, `truncateMessagesForTransport`）返回新数组，不修改原始对象 |
| 并发安全 | 优秀 | BM25Indexer 使用 `sync.RWMutex`；Qdrant SearchBySources 使用 goroutine 并行搜索多 source |
| 安全意识 | 良好 | 错误消息脱敏（不暴露内部细节给用户）；sqlc 参数化查询防注入；JWT 认证全覆盖 |
| 优雅降级 | 优秀 | 非关键失败不阻塞主流程（embedding cache set 失败仅 warn；BM25 warmup 单条失败 continue） |
| 缓存策略 | 优秀 | 系统文件 60s TTL；嵌入向量 PostgreSQL LRU（50K 上限，裁剪 10%）；BM25 统计 30s 持久化 |

### 9.2 问题与风险

| 严重度 | 问题 | 位置 | 影响 |
|--------|------|------|------|
| HIGH | admin 密码明文存储在 config.toml | `internal/config/config.go` AdminConfig | 配置文件泄露即密码泄露 |
| HIGH | 无速率限制 | `internal/server/server.go` 中间件链 | 所有端点暴露于暴力破解和 DDoS |
| MEDIUM | 无 CORS 配置 | Go 后端 Echo 服务器 | 浏览器跨域请求不受控 |
| MEDIUM | JWT 无撤销机制 | `internal/auth/` | Token 泄露后无法立即失效 |
| MEDIUM | 无查询超时 | 大部分 DB 操作无 context timeout | 慢查询可能阻塞 goroutine |
| MEDIUM | main.go 过大 (865行) | `cmd/agent/main.go` | 40+ provider 函数堆积，可读性差 |
| MEDIUM | BM25 warmup 全量加载 | `memory/service.go` WarmupBM25 | 大数据量时启动慢，无分页限制 |
| LOW | HS256 对称签名 | JWT 使用 HMAC-SHA256 | 单密钥泄露影响所有 token |
| LOW | 去重阈值硬编码 0.92 | `memory/service.go` applyAdd | 不同场景可能需要不同阈值 |
| LOW | 子 Agent 深度硬编码 1 | `agent/src/registry.ts` | 无法通过配置调整嵌套深度 |
| LOW | 忽略 bind 错误 | 部分 bind 操作错误被静默忽略 | 可能导致权限状态不一致 |
| LOW | SSE 假设标准格式 | `agent/src/utils/sse.ts` | 非标准 SSE 格式可能解析失败 |

---

## 10. 安全分析

### 优势

| 维度 | 实现 |
|------|------|
| 授权分层 | Channel Identity → Bot Access → Participant Check → Admin Bypass，四层递进 |
| 输入校验 | Go 端 Echo Bind + 手动校验；TS 端 Zod schema 全覆盖 |
| 错误消息脱敏 | Handler 层返回通用错误（如 "failed to get user profile"），不暴露内部堆栈 |
| Token 作用域 | JWT claims 包含 channel_identity_id，限定 token 作用范围 |
| Admin Bypass 检查 | 管理员操作有独立的权限校验路径，非简单跳过 |
| 参数化查询 | sqlc 生成的所有 SQL 均为参数化查询，天然防 SQL 注入 |
| 密码哈希 | 使用 `golang.org/x/crypto/bcrypt` 哈希存储密码 |

### 弱点

| 维度 | 问题 | 风险等级 |
|------|------|---------|
| 无速率限制 | 所有 API 端点无请求频率限制 | HIGH |
| 无 CORS | Go 后端未配置 CORS 中间件（Agent 网关有） | MEDIUM |
| 密码在配置文件 | admin 密码明文写在 config.toml | HIGH |
| 无 Token 撤销 | JWT 签发后无法主动失效 | MEDIUM |
| 无 Refresh Token | 单一 JWT，过期后需重新登录 | LOW |
| HS256 对称签名 | 密钥泄露影响所有 token | LOW |

---

## 11. 性能分析

| 维度 | 实现 | 参数 |
|------|------|------|
| SSE 心跳 | 定期发送空事件保持连接 | 20 秒间隔 |
| 异步记忆持久化 | 对话结束后异步写入记忆 | 30 秒超时 |
| 分页 | 所有列表端点支持分页 | limit [1, 100]，默认 30 |
| Embedding 缓存命中路径 | SHA-256 查 PostgreSQL，命中直接返回 | 50K 上限，LRU 淘汰 |
| BM25 稀疏向量 | FNV-1a 20-bit hash 映射到 1M 维度 | 哈希碰撞概率可控 |
| MMR Overfetch | 先取 3x 候选再重排序 | 默认 overfetch ratio = 3 |
| BM25 统计持久化 | 脏数据 30s 批量刷盘 | 避免每次写入都触发 DB |
| 系统文件缓存 | Bot 人格文件 60s TTL 内存缓存 | 减少 MCP 读取开销 |
| 并行搜索 | SearchBySources 对多 source 并行 goroutine | 每个 source 独立搜索 |
| 循环检测窗口 | 滑动窗口 40 条记录 | 内存开销极小 |

---

## 12. 改进建议

### 12.1 安全加固（优先级：高）

1. **速率限制**：在 Echo 中间件链中添加 `middleware.RateLimiter`，按 IP 和用户 ID 双维度限流
2. **CORS 配置**：Go 后端添加 `middleware.CORSWithConfig`，限定允许的 Origin
3. **JWT Refresh/Revocation**：引入 refresh token 机制 + Redis 黑名单实现 token 撤销
4. **密码环境变量化**：admin 密码从 config.toml 迁移到环境变量 `MEMOH_ADMIN_PASSWORD`

### 12.2 代码组织（优先级：中）

5. **拆分 main.go**：将 40+ provider 函数按领域拆分到 `cmd/agent/providers_*.go`（memory、channel、handler 等）
6. **拆分大 Handler**：`containerd.go`（1367 行）拆分为 `containerd_lifecycle.go` + `containerd_snapshot.go` + `containerd_mcp.go`；`users.go`（1056 行）拆分为 `users.go` + `bots.go`

### 12.3 配置校验（优先级：中）

7. **结构体标签校验**：为 Config 结构体添加 `validate:"required"` 标签，启动时校验必填字段，避免运行时空指针

### 12.4 查询超时（优先级：中）

8. **Context Timeout**：所有 DB 操作添加 `context.WithTimeout`，建议默认 10s，防止慢查询阻塞 goroutine

### 12.5 可观测性（优先级：低）

9. **BM25 Warmup 分页**：当前 `WarmupBM25` 使用 Scroll 全量加载，建议添加进度日志和批次大小限制
10. **缓存命中率指标**：为 embedding cache 添加 hit/miss 计数器，暴露为 Prometheus metrics

### 12.6 可配置化（优先级：低）

11. **去重阈值可配置**：将硬编码的 `0.92` cosine 阈值移入 config.toml
12. **子 Agent 深度可配置**：将 `DEFAULT_MAX_SPAWN_DEPTH = 1` 移入 Agent 网关配置
13. **MMR Lambda 可配置**：将 MMR 的 λ 参数从代码常量移入 Bot 级别设置

---

## 13. 总体评价

Memoh-v2 是一个**生产级**的 AI Agent 平台项目，在三个核心维度上展现了深厚的工程功底：

**记忆系统（核心亮点）**：三层检索架构（Dense Vector + BM25 Sparse + Multimodal）配合 MMR 重排序、时间衰减（指数半衰期 30 天）、Reciprocal Rank Fusion 融合，是目前开源 Agent 项目中最完善的长记忆实现之一。BM25 使用 FNV 20-bit hash 映射到 1M 维稀疏向量空间，支持 30+ 语言分析器，统计数据 30s 持久化到 PostgreSQL，设计成熟。Embedding 缓存（SHA-256 键、LRU 淘汰、50K 上限）有效降低了重复嵌入的 API 开销。

**容器隔离（真隔离）**：直接使用 containerd v2 API 而非 Docker，实现了进程级命名空间隔离。每个 Bot 拥有独立容器、独立文件系统、独立 MCP Server，快照支持 Prepare/Commit/Rollback，为进化失败提供了安全回滚机制。

**Agent 网关（深度 LLM 理解）**：流式处理（async generator）、循环检测（三策略防护）、Token 预算管理（full/minimal/micro 三档）、CJK 感知的 chars-per-token 估算、大文件 70%头+20%尾截断策略，展现了对 LLM 应用层的深入理解。20+ 供应商统一接入，强制 `.chat()` API 避免 Responses API 兼容性问题，是实战经验的体现。

**主要短板**：安全基础设施（无速率限制、无 CORS、密码管理）和代码组织（大文件、硬编码值）是典型的"功能优先"技术债务。这些问题修复成本低，不影响核心架构的健壮性。建议优先补齐速率限制和 CORS，其次拆分大文件提升可维护性。

**综合评分**：★★★★☆（4/5）— 架构设计和核心系统实现达到生产级水准，安全和代码组织有改进空间。
