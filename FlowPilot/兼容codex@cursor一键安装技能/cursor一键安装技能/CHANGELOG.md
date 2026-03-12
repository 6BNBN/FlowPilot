# Changelog

## v1.0.1
- 明确区分 `Codex CLI` 发布包与 `Cursor` 发布包的使用边界。
- 为顶层新增兼容矩阵入口说明，避免误把 `Codex` 包安装到 `~/.cursor` 或误把 `Cursor` 包安装到 `~/.codex`。
- 更新 `Cursor` 包的 README 与安装说明，明确其只面向 `Cursor`。
- 修复 `Cursor` 包中 `playwright` NOTICE 的错误来源标注，将 `Codex skill collection` 改为 `Cursor skill collection`。
- 统一安装/修复脚本的终端输出，显式标注 `[Cursor package]`，降低用户误判当前执行目标的风险。

## v1.0.0
- 整理 `cursor一键安装技能` 目录为可分发的发布版结构。
- 删除旧的兼容模式入口 `一键安装最新版Cursor技能和MCP_兼容模式.bat`。
- 保留 Windows 安装、修复、自检入口。
- 新增 macOS/Linux 安装脚本：`install_cursor_skills.sh`。
- 新增 macOS/Linux 修复脚本：`repair_cursor_skills.sh`。
- 新增 macOS/Linux 自检脚本：`self_check_cursor_skills.sh`。
- 将 `context7` MCP 改为本地运行时安装方案，降低不同机器上的 `npx` 直接启动问题。
- 更新 `playwright` 技能，使其更适配 Cursor IDE 与 Windows/PowerShell 使用方式。
- 精简 `README.md`，补充发布版说明。
- 新增 `安装说明.md` 作为简短安装指引。
- 新增 `VERSION.txt` 与本变更记录文件，方便后续发布与维护。

## 验证状态
- Windows：已做实际安装与自检验证。
- macOS/Linux：已补齐安装、修复、自检脚本，并做静态校对，尚未实机验证。
