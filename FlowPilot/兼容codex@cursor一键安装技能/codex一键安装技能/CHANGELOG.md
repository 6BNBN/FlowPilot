# Changelog

## v1.0.1
- 明确声明本发布包仅面向 `Codex CLI`，并在 README 中补充与 `Cursor` 包的兼容边界说明。
- 新增从 `Codex` 包跳转到 `Cursor` 包的入口提示，避免误把本包用于 `~/.cursor` 或 `mcp.json`。
- 统一安装/修复脚本的终端输出，显式标注 `[Codex package]`，降低用户误判当前执行目标的风险。

## v1.0.0
- 打包发布 `Codex CLI` 技能与 `context7` MCP 本地运行时。
- 提供 Windows、macOS、Linux 的安装与修复入口。
- 使用 `config.toml` 方式写入 `context7` MCP 配置。
