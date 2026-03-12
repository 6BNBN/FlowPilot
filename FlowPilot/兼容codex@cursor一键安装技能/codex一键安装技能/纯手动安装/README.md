# Codex 纯手动安装包

本目录仅面向 `Codex CLI`。

如果你要安装 `Cursor` 版本，请使用 `../../cursor一键安装技能/纯手动安装/`，不要把这里的说明直接套用到 `~/.cursor` 或 `mcp.json`。

这个目录用于 **不运行整包安装脚本** 的情况下，手动把 Codex CLI 技能和 `context7` MCP 配到目标机器上。

## 适用场景
- 你只想手动复制 `skills`
- 你不想直接运行整包 `.bat`、`.ps1`、`.sh` 安装脚本
- 你希望手动控制 `CODEX_HOME/skills/` 和 `config.toml`
- 你希望只额外安装 `context7`，不跑整套自动安装包

## 包含内容
- `skills/`：可直接手动复制到 Codex 技能目录
- `context7-config-templates/`：`context7` 的手动配置模板
- `安装说明.md`：简短手动安装说明
- `安装context7-MCP.ps1` / `一键安装context7-MCP.bat`：Windows 专用 `context7` 安装脚本
- `install_context7_mcp.sh` / `repair_context7_mcp.sh`：macOS/Linux 专用 `context7` 安装与修复脚本
- `install-ui-ux-pro-max-skill.ps1` / `repair-ui-ux-pro-max-skill.ps1`：Windows 专用 `ui-ux-pro-max` 安装与修复脚本
- `一键安装ui-ux-pro-max技能.bat` / `一键修复ui-ux-pro-max技能.bat`：Windows 一键入口
- `install_ui_ux_pro_max_skill.sh` / `repair_ui_ux_pro_max_skill.sh`：macOS/Linux 专用 `ui-ux-pro-max` 安装与修复脚本
- `context7-安装脚本说明.md`：`context7` 脚本用法说明

## 结论先说
- 大部分技能：只要把 `skills/` 手动复制到 `CODEX_HOME/skills/` 就能被 Codex 识别
- `context7`：除了复制技能，还必须安装本地 `context7-local` 运行时并配置 `config.toml`，或者直接运行这里提供的 `context7` 专用脚本
- `playwright`：技能复制后会被识别，但目标机器仍需要 `node`、`npm`、`npx`
- `ui-ux-pro-max`：已包含在 bundled skills 中，运行搜索脚本还需要 `python3` 或 `python`

## 手动安装位置
- 优先：`$CODEX_HOME/skills/`
- Windows 默认：`%USERPROFILE%\.codex\skills\`
- macOS/Linux 默认：`~/.codex/skills/`
- MCP 配置文件：`$CODEX_HOME/config.toml` 或 `~/.codex/config.toml`

## context7 两种方式
### 方式一：纯手动配置
参考 `context7-config-templates/` 里的模板，手动修改 `config.toml`。

- 本地 launcher 方式：`config.local.windows.toml`、`config.local.unix.toml`
- 远程 MCP 方式：`config.remote.toml`

如果使用本地 launcher 方式，你还需要把本目录内的 `context7-local-bundled/` 安装到目标机器的 `CODEX_HOME/context7-local/`，并准备对应平台的 launcher：

- Windows：`run-context7.cmd`
- macOS/Linux：`run-context7.sh`

### 方式二：只运行 context7 专用脚本
如果你不想手改 `config.toml`，可以只运行本目录提供的 `context7` 脚本。

- Windows：`一键安装context7-MCP.bat`
- macOS/Linux：`./install_context7_mcp.sh`
- 指定目录时可用：`./install_context7_mcp.sh --target-codex-home /path/to/.codex`

`context7` 脚本会自动：

- 检查 `codex` 和 `node` 是否可用
- 复制 bundled `context7-local` 到 `CODEX_HOME/context7-local`
- 生成 launcher
- 写入或修复 `config.toml`

这样仍然属于“手动安装技能 + 单独装 context7”的轻量方式，不需要跑整包安装器。

## ui-ux-pro-max 更新

如果你想刷新 bundled `ui-ux-pro-max` 技能，或者只更新自己 `CODEX_HOME/skills/ui-ux-pro-max` 里的已安装版本，可以使用仓库根目录的公开更新脚本：

- Windows 一键更新：`一键更新ui-ux-pro-max技能.bat`
- Windows：`update-ui-ux-pro-max-skill.ps1`
- macOS/Linux：`update-ui-ux-pro-max-skill.sh`

这些脚本不会联网；它们只是把仓库里内置的 `ui-ux-pro-max` 重新复制到你的 `CODEX_HOME/skills/ui-ux-pro-max`。

如果你只使用 `纯手动安装/` 目录，也可以直接运行本目录里的独立安装/修复脚本：

- Windows 安装：`一键安装ui-ux-pro-max技能.bat`
- Windows 修复：`一键修复ui-ux-pro-max技能.bat`
- macOS/Linux 安装：`./install_ui_ux_pro_max_skill.sh`
- macOS/Linux 修复：`./repair_ui_ux_pro_max_skill.sh`

## 目标产品边界

- 本目录所有脚本默认写入 `CODEX_HOME` / `~/.codex`
- 本目录的 `context7` 模板和脚本面向 `config.toml`
- 安装完成后应重启的是 `Codex CLI`
