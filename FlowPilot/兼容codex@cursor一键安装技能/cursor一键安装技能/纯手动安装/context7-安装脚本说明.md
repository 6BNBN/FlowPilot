# context7 三平台安装脚本说明

本说明仅适用于 `Cursor` 的 `mcp.json` 配置模型。

这个目录额外提供了只安装 `context7` MCP 的轻量脚本。

## Windows
- `一键安装context7-MCP.bat`
- `安装context7-MCP.ps1`

作用：
- 从发布包内置运行时复制到当前用户的 `~/.cursor/context7-local/`
- 生成 `~/.cursor/run-context7.cmd`
- 写入或合并 `~/.cursor/mcp.json`

## macOS / Linux
- `install_context7_mcp.sh`
- `repair_context7_mcp.sh`

作用：
- 安装或修复内置的本地 `context7` 运行时
- 生成 `~/.cursor/run-context7.sh`
- 写入或修复 `~/.cursor/mcp.json`

## 使用建议
- 如果你只想手动复制 `skills/`，但又希望 `context7` 可用，就直接运行这些脚本。
- 如果目标机器已经自行配置了 `context7`，可以不运行。
- 运行这些脚本时请保留整个发布包目录结构，因为它们会从上级目录的 `-Force/context7-local/` 复制内置运行时

## ui-ux-pro-max 备注
- 这个目录还附带 `ui-ux-pro-max` 技能
- 该技能运行搜索脚本需要 `python3` 或 `python`
- 如需单独安装/修复，请使用 `install-ui-ux-pro-max-skill.ps1`、`repair-ui-ux-pro-max-skill.ps1`、`一键安装ui-ux-pro-max技能.bat`、`一键修复ui-ux-pro-max技能.bat`、`install_ui_ux_pro_max_skill.sh`、`repair_ui_ux_pro_max_skill.sh`

如果你要配置的是 `Codex CLI` 的 `config.toml`，请改看 `../../codex一键安装技能/纯手动安装/context7-安装脚本说明.md`。
