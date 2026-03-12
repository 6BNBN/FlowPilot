#!/usr/bin/env bash
set -euo pipefail

TARGET_CURSOR_HOME="${1:-${HOME}/.cursor}"
PYTHON_BIN=""
ALL_OK=1

if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
else
  echo "[MISSING] python3 or python is not available on PATH"
  ALL_OK=0
fi

report_path() {
  local label="$1"
  local path="$2"
  if [ -e "$path" ]; then
    echo "[OK] ${label} -> ${path}"
  else
    echo "[MISSING] ${label} -> ${path}"
    ALL_OK=0
  fi
}

echo "Checking Cursor install package state under: ${TARGET_CURSOR_HOME}"

if command -v node >/dev/null 2>&1; then
  echo "[OK] node -> $(node --version)"
else
  echo "[MISSING] node is not available on PATH"
  ALL_OK=0
fi

if command -v python3 >/dev/null 2>&1; then
  echo "[OK] python3 -> $(python3 --version)"
elif command -v python >/dev/null 2>&1; then
  echo "[OK] python -> $(python --version)"
else
  echo "[MISSING] python3 or python is not available on PATH"
  ALL_OK=0
fi

SKILLS_DIR="${TARGET_CURSOR_HOME}/skills"
MCP_PATH="${TARGET_CURSOR_HOME}/mcp.json"
CONTEXT7_LOCAL="${TARGET_CURSOR_HOME}/context7-local"
CONTEXT7_ENTRY="${CONTEXT7_LOCAL}/node_modules/@upstash/context7-mcp/dist/index.js"
CONTEXT7_LAUNCHER_SH="${TARGET_CURSOR_HOME}/run-context7.sh"
PLAYWRIGHT_SKILL="${SKILLS_DIR}/playwright"
PLAYWRIGHT_SH="${PLAYWRIGHT_SKILL}/scripts/playwright_cli.sh"
UIUX_SKILL="${SKILLS_DIR}/ui-ux-pro-max"
UIUX_SEARCH="${UIUX_SKILL}/scripts/search.py"

report_path "skills directory" "${SKILLS_DIR}"
report_path "mcp.json" "${MCP_PATH}"
report_path "context7 local runtime" "${CONTEXT7_LOCAL}"
report_path "context7 entry" "${CONTEXT7_ENTRY}"
report_path "context7 launcher" "${CONTEXT7_LAUNCHER_SH}"
report_path "playwright skill" "${PLAYWRIGHT_SKILL}"
report_path "playwright shell wrapper" "${PLAYWRIGHT_SH}"
report_path "ui-ux-pro-max skill" "${UIUX_SKILL}"
report_path "ui-ux-pro-max search script" "${UIUX_SEARCH}"

if [ -f "${MCP_PATH}" ] && [ -n "${PYTHON_BIN}" ]; then
  if "${PYTHON_BIN}" - <<'PY' "${MCP_PATH}"; then
import json
import sys
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    config = json.load(f)
launcher_path = sys.argv[1].rsplit('/', 1)[0] + '/run-context7.sh'
if not isinstance(config, dict) or not isinstance(config.get('mcpServers'), dict):
    raise SystemExit(1)
context7 = config['mcpServers'].get('context7')
if not isinstance(context7, dict):
    raise SystemExit(1)
if context7.get('command') != launcher_path:
    raise SystemExit(1)
PY
    echo "[OK] mcpServers.context7 points to the local launcher"
  else
    echo "[MISSING] mcpServers.context7 is missing, invalid, or not launcher-based"
    ALL_OK=0
  fi
fi

if [ -f "${CONTEXT7_ENTRY}" ] && command -v node >/dev/null 2>&1; then
  if node "${CONTEXT7_ENTRY}" --help >/dev/null 2>&1; then
    echo "[OK] context7 local entry starts successfully"
  else
    echo "[FAILED] context7 local entry did not start successfully"
    ALL_OK=0
  fi
fi

if [ "${ALL_OK}" -eq 1 ]; then
  echo "Self-check passed. Restart Cursor if you just installed or repaired."
  exit 0
fi

echo "Self-check found issues. Review the messages above."
exit 1
