# context7 三平台安装脚本说明

本说明仅适用于 `Codex CLI` 的 `config.toml` 配置模型。

这个目录额外提供了只安装 `context7` MCP 的轻量脚本。

## Windows
- `一键安装context7-MCP.bat`
- `安装context7-MCP.ps1`

作用：
- 写入或修复 `CODEX_HOME/config.toml`
- 配置 `context7` 到 Codex CLI 的 `[mcp_servers.context7]`
- 把 bundled `context7-local` 安装到 `CODEX_HOME/context7-local`
- 生成 `run-context7.cmd`

## macOS / Linux
- `install_context7_mcp.sh`
- `repair_context7_mcp.sh`

作用：
- 安装或修复 `context7` MCP 配置
- 写入或修复 `CODEX_HOME/config.toml`
- 把 bundled `context7-local` 安装到 `CODEX_HOME/context7-local`
- 生成 `run-context7.sh`
- 支持 `--target-codex-home /path/to/.codex`

前置条件：
- `codex`
- `node`

## 使用建议
- 如果你只想手动复制 `skills/`，但又希望 `context7` 可用，就直接运行这些脚本。
- 如果目标机器已经自行配置了 `context7`，可以不运行。
- 默认推荐本地 bundled runtime 路线；`config.remote.toml` 只作为高级手动选项保留。

## ui-ux-pro-max 备注

这个目录配合仓库根目录一起使用时，还会附带 bundled `ui-ux-pro-max` 技能。

- 该技能运行搜索脚本需要 `python3` 或 `python`
- Windows 可直接双击 `一键更新ui-ux-pro-max技能.bat`
- 如需刷新技能内容，请使用仓库根目录的 `update-ui-ux-pro-max-skill.ps1` 或 `update-ui-ux-pro-max-skill.sh`
- 这些脚本不会联网
- 本目录也提供独立安装/修复脚本：`install-ui-ux-pro-max-skill.ps1`、`repair-ui-ux-pro-max-skill.ps1`、`一键安装ui-ux-pro-max技能.bat`、`一键修复ui-ux-pro-max技能.bat`、`install_ui_ux_pro_max_skill.sh`、`repair_ui_ux_pro_max_skill.sh`

如果你要配置的是 `Cursor` 的 `mcp.json`，请改看 `../../cursor一键安装技能/纯手动安装/context7-安装脚本说明.md`。
