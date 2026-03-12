# Codex / Cursor 一键安装技能包

这个仓库同时维护两套发布包：

- [codex一键安装技能](./codex一键安装技能/): 面向 `Codex CLI`
- [cursor一键安装技能](./cursor一键安装技能/): 面向 `Cursor`

它们共享一部分技能内容，但**安装目录、MCP 配置文件、启动方式和重启目标都不同**，不要混用。

## 兼容矩阵

| 目标产品 | 发布目录 | 技能目录 | MCP 配置 | Context7 启动器 | 安装后重启 |
|---|---|---|---|---|---|
| Codex CLI | `codex一键安装技能/` | `~/.codex/skills/` | `~/.codex/config.toml` | `~/.codex/run-context7.sh` / `.cmd` | `Codex CLI` |
| Cursor | `cursor一键安装技能/` | `~/.cursor/skills/` | `~/.cursor/mcp.json` | `~/.cursor/run-context7.sh` / `.cmd` | `Cursor` |

## 如何选择

- 你要给 `codex` 命令行环境安装技能和 MCP：进入 [codex一键安装技能](./codex一键安装技能/)
- 你要给 `Cursor` 个人环境安装技能和 MCP：进入 [cursor一键安装技能](./cursor一键安装技能/)

## 边界说明

- `Codex` 包会写入 `CODEX_HOME` / `~/.codex`
- `Cursor` 包会写入 `~/.cursor`
- `Codex` 包维护的是 `config.toml` 风格 MCP 配置
- `Cursor` 包维护的是 `mcp.json` 风格 MCP 配置
- 即使技能内容看起来相似，也应优先使用对应产品目录里的发布包和说明文档

## 当前维护约定

- 包层文档和脚本输出必须明确标注 `Codex` 或 `Cursor`
- 共享技能内容可以复用，但发布说明必须按目标产品区分
- 如果发现 `Codex` 包里出现 Cursor 安装路径，或 `Cursor` 包里出现 Codex 安装路径，应视为兼容性文案问题并修复
