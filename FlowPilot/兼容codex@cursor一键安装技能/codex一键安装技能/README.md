# Codex portable installer

This package targets **Codex CLI only**.

If you need a Cursor-compatible installer, use [`../cursor一键安装技能/`](../cursor一键安装技能/) instead. Do not use this Codex package to write into `~/.cursor`.

This package installs the bundled Codex CLI skills plus a bundled standalone local `context7` MCP runtime on different machines without depending on this workstation.

## What is included

- Bundled skills in `.codex-home-claude-parity/skills`
- Bundled `ui-ux-pro-max` skill with local `data/` and `scripts/`
- Bundled standalone `context7` runtime snapshot under `纯手动安装/context7-local-bundled/`
- Windows install launcher: `一键安装最新版Codex技能和MCP.bat`
- Windows compatibility launcher: `一键安装最新版Codex技能和MCP_兼容模式.bat`
- Windows repair launcher: `一键修复最新版Codex技能和MCP.bat`
- Windows `ui-ux-pro-max` one-click updater: `一键更新ui-ux-pro-max技能.bat`
- PowerShell entry scripts: `install-latest-skills-and-mcp.ps1`, `repair-latest-skills-and-mcp.ps1`
- macOS/Linux entry scripts: `install.sh`, `repair.sh`
- Public update scripts for `ui-ux-pro-max`: `update-ui-ux-pro-max-skill.ps1`, `update-ui-ux-pro-max-skill.sh`

## Supported platforms

- Windows
- macOS
- Linux

## Prerequisites

Install these before running the package:

- `Codex CLI` available as `codex`
- `node`

To use the bundled `ui-ux-pro-max` skill after installation, the target machine also needs:

- `python3` or `python`

Some skills still use Node toolchains at runtime, but the `context7` installer path in this package no longer fetches from npm during install.

## Install location

The installer resolves the target in this order:

1. Explicit script argument
2. `CODEX_HOME`
3. Default home directory

Platform defaults:

- Windows: `%USERPROFILE%\.codex`
- macOS/Linux: `$HOME/.codex`

This package does **not** manage Cursor paths such as `~/.cursor/skills/` or `~/.cursor/mcp.json`.

## Windows usage

- Double-click `一键安装最新版Codex技能和MCP.bat`
- The Windows installer copies the bundled `context7` runtime into `%USERPROFILE%\.codex\context7-local` and writes `run-context7.cmd`.
- To force a full refresh, use `一键修复最新版Codex技能和MCP.bat`

PowerShell examples:

- `powershell.exe -ExecutionPolicy Bypass -File .\install-latest-skills-and-mcp.ps1 -Force`
- `powershell.exe -ExecutionPolicy Bypass -File .\install-latest-skills-and-mcp.ps1 -TargetCodexHome D:\portable\.codex -Force`
- `powershell.exe -ExecutionPolicy Bypass -File .\repair-latest-skills-and-mcp.ps1`

## macOS and Linux usage

Make the scripts executable once:

- `chmod +x ./install.sh ./repair.sh`

Run install:

- `./install.sh --force`
- `CODEX_HOME="$HOME/.codex" ./install.sh --force`
- `./install.sh --target-codex-home /opt/codex-home --force`

Run repair:

- `./repair.sh`

## What the installer does

- Copies all packaged skills into `skills/`
- Copies the bundled `context7` runtime into `CODEX_HOME/context7-local`
- Creates `run-context7.cmd` or `run-context7.sh`
- Backs up `config.toml`
- Rewrites the `context7` MCP block in Codex CLI format with a launcher-based local command

## UI UX Pro Max

The package now ships with a bundled `ui-ux-pro-max` skill snapshot under `skills/ui-ux-pro-max/`.

If you want to refresh it later, use the public update scripts:

- Windows one-click: `一键更新ui-ux-pro-max技能.bat`
- Windows: `powershell.exe -ExecutionPolicy Bypass -File .\update-ui-ux-pro-max-skill.ps1`
- macOS/Linux: `./update-ui-ux-pro-max-skill.sh`

These update scripts simply reinstall the bundled `ui-ux-pro-max` snapshot from this repo into `CODEX_HOME/skills/ui-ux-pro-max`.

If you prefer the manual-install package, `纯手动安装/` also ships standalone `ui-ux-pro-max` install/repair scripts for Windows and macOS/Linux:

- `install-ui-ux-pro-max-skill.ps1`
- `repair-ui-ux-pro-max-skill.ps1`
- `一键安装ui-ux-pro-max技能.bat`
- `一键修复ui-ux-pro-max技能.bat`
- `install_ui_ux_pro_max_skill.sh`
- `repair_ui_ux_pro_max_skill.sh`

## Notes

- Restart `Codex CLI` after installation.
- `context7` is installed as a bundled standalone local runtime by default.
- The package is self-contained and does not depend on this machine's absolute paths.
- If you are packaging for Cursor, switch to [`../cursor一键安装技能/`](../cursor一键安装技能/).
