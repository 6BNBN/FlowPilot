# OpenSpec 项目全面分析报告

## 1. 项目概览

**OpenSpec** 是一个 AI 原生的规范驱动开发系统，由 Fission AI 开发。它是一个轻量级 CLI 框架，帮助团队在编写代码前对齐规范，弥合 AI 编码助手与可预测开发工作流之间的鸿沟。

- **包名**: `@fission-ai/openspec`
- **许可证**: MIT
- **Node.js 要求**: ≥20.19.0
- **设计哲学**: 流动而非僵化、迭代而非瀑布、简单而非复杂、适用于存量项目

---

## 2. 技术栈

| 类别 | 技术 |
|------|------|
| 语言 | TypeScript (ES2022, strict mode) |
| CLI 框架 | Commander.js |
| 数据验证 | Zod |
| YAML 解析 | yaml |
| 交互提示 | @inquirer/prompts |
| 终端美化 | chalk + ora |
| 文件匹配 | fast-glob |
| 遥测 | posthog-node |
| 测试 | Vitest 3.2.4 |
| 代码检查 | typescript-eslint |
| 版本管理 | @changesets/cli |
| 构建 | Nix flake (可选) |

---

## 3. 目录结构

```
OpenSpec-main/
├── src/
│   ├── cli/                     # CLI 入口与命令注册
│   ├── commands/                # 命令实现
│   │   └── workflow/            # 工作流命令
│   ├── core/                    # 核心业务逻辑
│   │   ├── artifact-graph/      # 依赖图（拓扑排序）
│   │   ├── command-generation/  # 动态命令生成（20+ AI 工具适配器）
│   │   ├── validation/          # Zod 验证引擎
│   │   ├── parsers/             # Markdown/Change 解析器
│   │   ├── schemas/             # 数据模型定义
│   │   ├── completions/         # Shell 补全
│   │   ├── templates/           # 模板生成
│   │   └── converters/          # 格式转换
│   ├── utils/                   # 工具函数
│   ├── telemetry/               # 匿名遥测
│   ├── ui/                      # 终端 UI 组件
│   └── prompts/                 # 交互提示
├── test/                        # 60+ 测试文件
├── schemas/                     # JSON Schema 定义
├── docs/                        # 文档
├── bin/                         # CLI 可执行文件
├── scripts/                     # 构建脚本
├── .github/                     # CI/CD 工作流
└── .devcontainer/               # 开发容器配置
```

---

## 4. 架构模式

### 4.1 分层架构

```
┌─────────────────────────────────┐
│         CLI Layer               │  Commander.js 路由
├─────────────────────────────────┤
│      Command Handlers           │  命令实现
├─────────────────────────────────┤
│        Core Logic               │  业务逻辑
│  ┌──────┬──────┬──────┬──────┐  │
│  │Graph │Valid │Parse │CmdGen│  │
│  └──────┴──────┴──────┴──────┘  │
├─────────────────────────────────┤
│    Schema / Data Layer          │  Zod 验证
├─────────────────────────────────┤
│       Utilities                 │  文件系统、交互
└─────────────────────────────────┘
```

### 4.2 设计模式

| 模式 | 应用场景 |
|------|----------|
| 适配器模式 | 20+ AI 工具的命令生成适配器 |
| 工厂模式 | CommandAdapterRegistry 创建工具适配器 |
| 策略模式 | 严格/普通验证策略 |
| 模板方法 | MarkdownParser 基类 + 专用解析器 |
| 仓库模式 | 基于文件系统的数据访问 |
| 单例模式 | 全局配置、遥测 |
| 构建者模式 | 流式配置构建 |
| 依赖注入 | 验证器、解析器传递给命令 |

---

## 5. 核心数据模型

### 5.1 Change（变更提案）

```typescript
{
  name: string;                    // 变更标识符
  why: string;                     // 变更原因 (50-500字)
  whatChanges: string;             // 变更摘要
  deltas: Delta[];                 // 1-50 个增量
  metadata?: {
    version: string;               // 默认: "1.0.0"
    format: "openspec-change";
    sourcePath?: string;
  };
}
```

### 5.2 Delta（变更增量）

```typescript
{
  spec: string;                    // 目标规范名称
  operation: "ADDED" | "MODIFIED" | "REMOVED" | "RENAMED";
  description: string;             // 变更内容与原因
  requirement?: Requirement;       // 单个需求
  requirements?: Requirement[];    // 多个需求
  rename?: { from: string; to: string };
}
```

### 5.3 Spec（规范）

```typescript
{
  name: string;                    // 规范标识符
  overview: string;                // 用途/描述
  requirements: Requirement[];     // 至少 1 个需求
  metadata?: {
    version: string;               // 默认: "1.0.0"
    format: "openspec";
    sourcePath?: string;
  };
}
```

### 5.4 Requirement 与 Scenario

```typescript
Requirement {
  text: string;                    // 需求描述
  scenarios: Scenario[];           // 测试场景
}

Scenario {
  title: string;
  steps: string[];
  expectedResult: string;
}
```

### 5.5 项目配置 (config.yaml)

```yaml
schema: "spec-driven"              # 工作流 schema
context: |                         # 项目上下文 (最大 50KB)
  可选的项目特定指导
rules:                             # 每个制品的规则
  proposal:
    - "规则 1"
    - "规则 2"
```

---

## 6. 核心数据流

### 6.1 变更工作流

```
用户输入 (CLI)
    ↓
ChangeCommand.show/validate/list
    ↓
ChangeParser.parseChangeWithDeltas()
    ↓
Validator.validateChange()
    ↓
输出 (JSON/Markdown)
```

### 6.2 制品生成

```
Schema YAML
    ↓
ArtifactGraph.fromYaml()
    ↓
getBuildOrder() [Kahn 拓扑排序]
    ↓
instructionLoader.generateInstructions()
    ↓
CommandAdapterRegistry.get(toolId)
    ↓
generateCommand(content, adapter)
    ↓
写入磁盘
```

### 6.3 验证管线

```
文件/内容
    ↓
MarkdownParser.parseSections()
    ↓
SpecSchema/ChangeSchema.safeParse()
    ↓
applySpecRules() [自定义验证]
    ↓
ValidationReport
```

---

## 7. CLI 命令体系

### 7.1 核心命令

| 命令 | 功能 | 主要选项 |
|------|------|----------|
| `openspec init [path]` | 初始化项目 | `--tools`, `--force`, `--profile` |
| `openspec update [path]` | 更新指令文件 | `--force` |
| `openspec new change <name>` | 创建变更 | `--description`, `--schema` |
| `openspec show [item]` | 显示变更/规范 | `--json`, `--type`, `--deltas-only` |
| `openspec list` | 列出变更/规范 | `--specs`, `--changes`, `--sort`, `--json` |
| `openspec validate [item]` | 验证变更/规范 | `--all`, `--strict`, `--json`, `--concurrency` |
| `openspec archive [change]` | 归档已完成变更 | `-y`, `--skip-specs`, `--no-validate` |
| `openspec status` | 制品完成状态 | `--change`, `--schema`, `--json` |
| `openspec view` | 交互式仪表板 | — |
| `openspec instructions [artifact]` | 输出增强指令 | `--change`, `--schema`, `--json` |
| `openspec templates` | 显示模板路径 | `--schema`, `--json` |
| `openspec schemas` | 列出可用 schema | `--json` |
| `openspec config get/set` | 配置管理 | — |
| `openspec completion` | Shell 补全 | `generate`, `install`, `uninstall` |
| `openspec feedback <msg>` | 提交反馈 | `--body` |

### 7.2 Slash 命令（AI 工具内使用）

| 命令 | 功能 |
|------|------|
| `/opsx:new <name>` | 创建变更 |
| `/opsx:ff` | 快进（生成所有规划文档） |
| `/opsx:apply` | 实施任务 |
| `/opsx:archive` | 归档已完成变更 |
| `/opsx:explore` | 探索现有规范 |
| `/opsx:continue` | 继续变更工作 |
| `/opsx:sync` | 同步规范 |
| `/opsx:verify` | 验证变更 |
| `/opsx:onboard` | 入门工作流 |

---

## 8. AI 工具集成

支持 **24+ AI 工具**，每个工具通过适配器模式生成专属的 skills 和命令文件：

| 工具 | 适配器文件 |
|------|-----------|
| Amazon Q Developer | `amazon-q.ts` |
| Claude Code (Anthropic) | `claude.ts` |
| GitHub Copilot | `github-copilot.ts` |
| Cursor | `cursor.ts` |
| Windsurf | `windsurf.ts` |
| Continue | `continue.ts` |
| Cline | `cline.ts` |
| Kiro (AWS) | 适配器支持 |
| Gemini CLI | `gemini.ts` |
| Qwen Code | `qwen.ts` |
| RooCode | 适配器支持 |
| 其他 10+ 工具 | 通过 factory.ts 创建 |

### 命令生成数据流

```
CommandContent (工具无关)
    ↓
ToolCommandAdapter (工具特定)
    ↓
GeneratedCommand (路径 + 文件内容)
```

---

## 9. 核心模块详解

### 9.1 Artifact Graph 模块

**路径**: `src/core/artifact-graph/`

| 文件 | 职责 |
|------|------|
| `graph.ts` | ArtifactGraph 类 — 依赖图操作、Kahn 拓扑排序 |
| `schema.ts` | 加载和解析 YAML schema |
| `resolver.ts` | 解析 schema 路径（包/用户 schema） |
| `instruction-loader.ts` | 加载模板、生成指令 |
| `state.ts` | 检测已完成制品 |
| `types.ts` | Zod schema 类型定义 |

### 9.2 Command Generation 模块

**路径**: `src/core/command-generation/`

| 文件 | 职责 |
|------|------|
| `registry.ts` | CommandAdapterRegistry — 管理 20+ 适配器 |
| `generator.ts` | 通用命令生成 |
| `adapters/*.ts` | 各 AI 工具的适配器实现 |
| `factory.ts` | 适配器工厂 |

### 9.3 Validation 模块

**路径**: `src/core/validation/`

| 文件 | 职责 |
|------|------|
| `validator.ts` | Validator 类 — 验证规范/变更 |
| 验证级别 | ERROR / WARNING / INFO |
| 输出 | ValidationReport + ValidationIssue[] |

### 9.4 Parser 模块

**路径**: `src/core/parsers/`

| 文件 | 职责 |
|------|------|
| `markdown-parser.ts` | MarkdownParser 基类 — 提取 sections |
| `change-parser.ts` | ChangeParser — 解析变更提案 |
| `requirement-blocks.ts` | 解析 delta spec 格式 |

### 9.5 关键类与函数

| 类/函数 | 文件 | 职责 |
|---------|------|------|
| `ArtifactGraph` | artifact-graph/graph.ts | 依赖图操作 |
| `Validator` | validation/validator.ts | 验证规范/变更 |
| `MarkdownParser` | parsers/markdown-parser.ts | 解析 Markdown sections |
| `ChangeParser` | parsers/change-parser.ts | 解析变更提案 |
| `CommandAdapterRegistry` | command-generation/registry.ts | 管理工具适配器 |
| `ChangeCommand` | commands/change.ts | 处理变更操作 |
| `InitCommand` | core/init.ts | 初始化 OpenSpec |
| `UpdateCommand` | core/update.ts | 更新指令文件 |
| `ListCommand` | core/list.ts | 列出项目 |
| `generateCommand()` | command-generation/generator.ts | 生成工具命令 |

---

## 10. 执行入口与流程

**主入口**: `bin/openspec.js` → `src/cli/index.ts`

```
1. Commander.js 解析 CLI 参数
2. 执行 preAction 钩子（遥测、颜色设置）
3. 路由到对应的命令处理器
4. 命令加载配置、验证输入
5. 执行核心逻辑（解析、验证、生成）
6. 输出结果（控制台、JSON 或文件）
7. 执行 postAction 钩子（遥测关闭）
```

---

## 11. 测试与质量保障

### 11.1 测试基础设施

| 维度 | 详情 |
|------|------|
| 框架 | Vitest 3.2.4 |
| 测试文件 | 60+ |
| 隔离方式 | `pool: 'forks'` 进程隔离 |
| 并行度 | 最多 4 workers |
| 超时 | 10 秒 |
| 覆盖率报告 | HTML, JSON, text |

### 11.2 测试类型

| 类型 | 路径 | 覆盖范围 |
|------|------|----------|
| 单元测试 | `test/core/`, `test/commands/`, `test/utils/` | 核心逻辑、命令、工具函数 |
| 集成测试 | `test/core/artifact-graph/workflow.integration.test.ts` | 工作流集成 |
| E2E 测试 | `test/cli-e2e/basic.test.ts` | CLI 端到端 |
| 补全测试 | `test/core/completions/` | bash/zsh/fish/powershell |

### 11.3 CI/CD 管线

**GitHub Actions** (`.github/workflows/ci.yml`):

| 触发条件 | 内容 | 超时 |
|----------|------|------|
| PR | 单次 Ubuntu 测试 + 构建 + lint + 类型检查 | 10 分钟 |
| Main 分支 | 跨平台矩阵 (Linux/macOS/Windows) | 15 分钟 |
| Nix 验证 | 路径过滤（仅 flake.nix/package.json 变更时） | — |

**质量门禁**: lint + 类型检查 (tsc --noEmit) + 构建验证 + changeset 验证

### 11.4 代码审查

- **CodeRabbit** 集成 (`.coderabbit.yaml`)，"chill" 模式自动审查

---

## 12. 代码质量工具

### 12.1 ESLint 配置

- TypeScript ESLint + 推荐规则
- **关键规则**: 禁止静态导入 `@inquirer/*`（防止 pre-commit 挂起）
- **放宽规则**: `no-explicit-any` (off), `no-unused-vars` (off), `no-empty` (off), `prefer-const` (off)

### 12.2 TypeScript 配置

- Target: ES2022, Module: NodeNext (ESM)
- **Strict Mode**: 启用
- 声明映射 + 源码映射

---

## 13. 配置选项

### 13.1 CLI 选项

| 选项 | 功能 |
|------|------|
| `--no-color` | 禁用彩色输出 |
| `--tools <tools>` | 非交互式配置 AI 工具 |
| `--force` | 跳过确认提示 |
| `--profile <profile>` | 覆盖全局配置 profile |
| `--strict` | 启用严格验证 |
| `--json` | JSON 格式输出 |
| `--concurrency <n>` | 最大并发数 |

### 13.2 环境变量

| 变量 | 功能 |
|------|------|
| `OPENSPEC_TELEMETRY=0` | 禁用遥测 |
| `DO_NOT_TRACK=1` | 禁用遥测（标准） |
| `NO_COLOR=1` | 禁用彩色输出 |
| `OPENSPEC_CONCURRENCY=<n>` | 默认并发数 |
| `OPENSPEC_NO_AUTO_CONFIG` | 禁用自动配置 |

### 13.3 全局配置路径

| 平台 | 路径 |
|------|------|
| Linux/macOS | `~/.config/openspec/` 或 `~/.openspec/` |
| Windows | `%APPDATA%\openspec\` |

---

## 14. 安全评估

### 14.1 安全优势

- 无 `eval()` / `Function()` / 动态代码执行
- Zod schema 验证所有输入数据
- 遥测可通过环境变量完全关闭
- 无 `.env` 文件处理（避免意外提交）
- 依赖库成熟稳定（commander, chalk, zod, yaml）
- Shell 命令通过 Commander.js 正确转义
- 无 `innerHTML` / `dangerouslySetInnerHTML`（CLI 工具）

### 14.2 安全关注点

| 问题 | 风险等级 | 说明 |
|------|----------|------|
| PostHog API Key 硬编码 | 低 | 公开分析 key，非敏感信息 |
| 缺少 SECURITY.md | 中 | 无漏洞报告流程 |
| CI 无安全扫描 | 中 | 无 SAST/依赖审计 |
| 文件操作路径验证有限 | 低 | 无明显路径遍历风险 |
| 错误消息可能泄露路径 | 低 | 有限的错误消息清理 |

---

## 15. 文件系统数据存储

OpenSpec 不使用数据库，完全基于文件系统：

```
project/
├── openspec/
│   ├── config.yaml                 # 项目配置
│   ├── changes/
│   │   ├── add-dark-mode/
│   │   │   ├── proposal.md         # 变更提案
│   │   │   ├── design.md           # 技术设计
│   │   │   ├── tasks.md            # 实施任务
│   │   │   └── specs/              # 变更相关规范
│   │   │       ├── ui-components.md
│   │   │       └── styling.md
│   │   └── archive/                # 归档
│   │       └── 2025-01-23-add-dark-mode/
│   └── specs/                      # 全局规范
│       ├── core-features.md
│       └── api-design.md
├── .claude/skills/                 # Claude Code skills
├── .github/skills/                 # GitHub Copilot skills
└── ...
```

---

## 16. 扩展点

| 扩展方式 | 说明 |
|----------|------|
| 自定义 Schema | 定义项目特定的工作流 schema |
| AI 工具集成 | 通过 skills 目录添加新工具 |
| 验证规则 | 在 `config.yaml` 中配置每个制品的规则 |
| 项目上下文 | 注入自定义指导到指令中 |
| Profiles | 自定义交付配置 (core vs. custom) |

---

## 17. 问题与改进建议

### 17.1 高优先级

| 问题 | 建议 |
|------|------|
| CI 缺少覆盖率门槛 | 添加 80% 覆盖率门禁 |
| CI 无安全扫描 | 集成 SAST/依赖审计 (如 Snyk, CodeQL) |
| ESLint 多条重要规则被禁用 | 逐步启用 `no-explicit-any`, `no-unused-vars` |
| 缺少 CONTRIBUTING.md | 添加贡献指南 |
| 缺少 SECURITY.md | 添加安全策略和漏洞报告流程 |
| 无 pre-commit hooks | 添加 husky + lint-staged |

### 17.2 中优先级

| 问题 | 建议 |
|------|------|
| 无 Prettier 配置 | 添加 Prettier 确保格式一致性 |
| 缺少架构文档 | 添加 ARCHITECTURE.md |
| 缺少 API 文档 | 使用 TypeDoc 生成 API 文档 |
| 无性能测试 | 添加基准测试 |
| PostHog key 硬编码 | 移至环境变量或构建时注入 |

### 17.3 低优先级

| 问题 | 建议 |
|------|------|
| 无 Docker 支持 | 添加 Dockerfile 提升部署灵活性 |
| 主要贡献者单一 | 扩大贡献者基础，降低 bus factor |
| 提交信息中英混用 | 统一提交信息语言 |

---

## 18. 总结

OpenSpec 是一个**设计良好、架构清晰**的 AI 原生规范驱动开发 CLI 工具。

**核心亮点**:
- 分层架构 + 适配器模式，优雅支持 20+ AI 工具集成
- Zod 验证引擎确保数据完整性
- Kahn 拓扑排序管理制品依赖
- 跨平台 CI/CD 矩阵测试
- 60+ 测试文件覆盖核心功能

**主要改进空间**:
- CI 安全扫描与覆盖率门槛
- 文档完善（架构、API、贡献指南）
- 代码质量工具强化（Prettier、pre-commit hooks）

**整体评价**: 成熟的生产级项目，代码质量较高，架构设计合理，扩展性良好。

---

*报告生成日期: 2026-02-22*
