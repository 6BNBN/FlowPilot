# Cursor 纯手动安装包

本目录仅面向 `Cursor`。

如果你要安装 `Codex CLI` 版本，请使用 `../../codex一键安装技能/纯手动安装/`，不要把这里的说明直接套用到 `~/.codex` 或 `config.toml`。

这个目录用于 **不运行整包安装脚本** 的情况下，手动把 Cursor 技能和 `context7` MCP 配到目标机器上。

## 适用场景
- 你只想手动复制 `skills`
- 你不想直接运行整包 `.bat`、`.ps1`、`.sh` 安装脚本
- 你希望手动控制 `~/.cursor/skills/` 和 `~/.cursor/mcp.json`
- 你希望只额外安装 `context7`，不跑整套自动安装包

## 包含内容
- `skills/`：可直接手动复制到 Cursor 技能目录
- `context7-mcp-templates/`：`context7` 的手动 MCP 配置模板
- `安装说明.md`：简短手动安装说明
- `安装context7-MCP.ps1` / `一键安装context7-MCP.bat`：Windows 专用 `context7` 安装脚本
- `install_context7_mcp.sh` / `repair_context7_mcp.sh`：macOS/Linux 专用 `context7` 安装与修复脚本
- `install-ui-ux-pro-max-skill.ps1` / `repair-ui-ux-pro-max-skill.ps1`：Windows 专用 `ui-ux-pro-max` 安装与修复脚本
- `一键安装ui-ux-pro-max技能.bat` / `一键修复ui-ux-pro-max技能.bat`：Windows 一键入口
- `install_ui_ux_pro_max_skill.sh` / `repair_ui_ux_pro_max_skill.sh`：macOS/Linux 专用 `ui-ux-pro-max` 安装与修复脚本
- `context7-安装脚本说明.md`：`context7` 脚本用法说明

## 结论先说
- 大部分技能：只要把 `skills/` 手动复制到 `~/.cursor/skills/` 就能被 Cursor 识别
- `context7`：除了复制技能，还必须单独配置 `mcp.json`，或者直接运行这里提供的 `context7` 专用脚本
- `playwright`：技能复制后会被识别，但目标机器仍需要 `node`、`npm`、`npx`
- `ui-ux-pro-max`：技能复制后会被识别，但运行搜索脚本仍需要 `python3` 或 `python`
- `context7` 专用脚本会复制发布包内置的本地运行时，不会在目标机器上执行在线安装

## 手动安装位置
- Windows：`%USERPROFILE%\.cursor\skills\`
- macOS/Linux：`~/.cursor/skills/`
- MCP 配置文件：`~/.cursor/mcp.json`

## context7 两种方式
### 方式一：纯手动配置
参考 `context7-mcp-templates/` 里的模板，手动修改 `~/.cursor/mcp.json`。

### 方式二：只运行 context7 专用脚本
如果你不想手改 `mcp.json`，可以只运行本目录提供的 `context7` 脚本。

- Windows：`一键安装context7-MCP.bat`
- macOS/Linux：`./install_context7_mcp.sh`

这样仍然属于“手动安装技能 + 单独装 context7”的轻量方式，不需要跑整包安装器。

注意：
- 这些 `context7` 专用脚本会使用发布包上级目录里内置的 `-Force/context7-local/` 作为运行时来源
- 如果你只单独拷贝 `纯手动安装/` 子目录而没有保留整个发布包结构，`context7` 脚本将找不到内置运行时

## ui-ux-pro-max

如果你只想单独安装或修复 `ui-ux-pro-max`，可以直接运行本目录里的脚本：

- Windows 安装：`一键安装ui-ux-pro-max技能.bat`
- Windows 修复：`一键修复ui-ux-pro-max技能.bat`
- macOS/Linux 安装：`./install_ui_ux_pro_max_skill.sh`
- macOS/Linux 修复：`./repair_ui_ux_pro_max_skill.sh`

## 目标产品边界

- 本目录所有脚本默认写入 `~/.cursor`
- 本目录的 `context7` 模板和脚本面向 `mcp.json`
- 安装完成后应重启的是 `Cursor`
