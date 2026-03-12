# Cursor 技能与 MCP 安装包

这是 **仅面向 Cursor** 的发布包。

如果你要安装到 `Codex CLI`，请改用 [`../codex一键安装技能/`](../codex一键安装技能/)。不要用这个 Cursor 包去写入 `~/.codex` 或 `config.toml`。

这是一个用于 **Cursor 个人全局安装** 的发布包。

安装后会把技能安装到当前用户的 `~/.cursor/skills/`，并配置 `context7` MCP 到 `~/.cursor/mcp.json`。

## 与 Codex 版的区别

| 项目 | Cursor 版 | Codex 版 |
|---|---|---|
| 技能目录 | `~/.cursor/skills/` | `~/.codex/skills/` |
| MCP 配置 | `~/.cursor/mcp.json` | `~/.codex/config.toml` |
| Context7 启动器 | `~/.cursor/run-context7.*` | `~/.codex/run-context7.*` |
| 安装后重启 | `Cursor` | `Codex CLI` |

本目录所有脚本、说明和自检都只面向 Cursor。

## 支持平台
- Windows
- macOS
- Linux

## 包含内容
- 一组常用 Cursor 自定义技能
- `playwright` 技能
- `ui-ux-pro-max` 技能
- `context7` MCP 安装与修复脚本
- `ui-ux-pro-max` 独立重装脚本
- 安装后自检脚本

## 环境要求
- 已安装 Cursor
- 已安装 Node.js，且 `node` 可用
- `ui-ux-pro-max` 运行需要 `python3` 或 `python`
- Windows 需要 PowerShell
- macOS/Linux 需要 bash 与 `python3` 或 `python`

说明：
- `context7` 现在使用发布包内置的本地运行时，不依赖首次安装时联网下载 npm 包
- `npm`、`npx` 仍建议保留，因为部分技能如 `playwright` 可能会在目标机器上用到

## 快速安装
### Windows
1. 双击 `一键安装最新版Cursor技能和MCP.bat`
2. 安装后重启 Cursor
3. 如需检查，双击 `一键自检Cursor技能和MCP.bat`

### macOS / Linux
1. 在终端进入当前目录
2. 执行 `chmod +x install_cursor_skills.sh repair_cursor_skills.sh self_check_cursor_skills.sh`
3. 执行 `./install_cursor_skills.sh`
4. 安装后重启 Cursor
5. 如需检查，执行 `./self_check_cursor_skills.sh`

## 修复
- Windows：`一键修复最新版Cursor技能和MCP.bat`
- macOS/Linux：`./repair_cursor_skills.sh`

## Context7 安装模型
- 三个平台默认都安装为本地独立运行时：`~/.cursor/context7-local/`
- Windows 生成 `~/.cursor/run-context7.cmd`
- macOS/Linux 生成 `~/.cursor/run-context7.sh`
- `~/.cursor/mcp.json` 中的 `mcpServers.context7.command` 会指向对应 launcher
- 安装与修复都不会在目标机器上执行 `npm install @upstash/context7-mcp`

## UI UX Pro Max
- 主安装脚本会自动把 `ui-ux-pro-max` 安装到 `~/.cursor/skills/ui-ux-pro-max/`
- 单独重装：
  - Windows：`一键更新ui-ux-pro-max技能.bat`
  - Windows PowerShell：`powershell.exe -ExecutionPolicy Bypass -File .\update-ui-ux-pro-max-skill.ps1`
  - macOS/Linux：`./update-ui-ux-pro-max-skill.sh`

## 自检会检查
- 依赖是否存在：`node`
- 技能目录是否存在
- `playwright` 是否已安装
- `ui-ux-pro-max` 是否已安装
- `context7` 本地运行时是否存在
- `mcp.json` 中 `mcpServers.context7.command` 是否指向本地 launcher
- `context7` 本地入口是否能成功启动

## 安装后自检
### 先跑脚本自检
- Windows：双击 `一键自检Cursor技能和MCP.bat`
- Windows PowerShell：`powershell.exe -ExecutionPolicy Bypass -File .\自检Cursor技能和MCP.ps1`
- macOS/Linux：`./self_check_cursor_skills.sh`

通过时，至少应看到这些结果为 `[OK]`：
- `context7 local runtime`
- `context7 entry`
- `context7 launcher`
- `mcpServers.context7.command` 指向本地 launcher
- `context7 local entry starts successfully`

### 再在 Cursor 里实测
- 重启 Cursor
- 在聊天里输入：`Use context7 to resolve the official React library ID.`
- 如果能返回类似 `/reactjs/react.dev` 这样的库 ID，说明 `context7` MCP 已经真正可用

### 常见失败点
- 安装后没有重启 Cursor
- 目标机器缺少 `node`
- 只单独复制了某个子目录，没有保留完整发布包结构
- 手动修改过 `~/.cursor/mcp.json`，把 `mcpServers.context7.command` 改离了本地 launcher

## 当前验证范围
- Windows：已做实际安装与自检验证
- macOS/Linux：已补齐安装、修复、自检脚本，并做静态校对，尚未实机验证
