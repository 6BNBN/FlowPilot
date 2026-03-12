#!/usr/bin/env bash
set -euo pipefail

TARGET_CURSOR_HOME="${1:-${HOME}/.cursor}"
SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_SKILLS="${SCRIPT_ROOT}/skills"
BUNDLED_CONTEXT7_ROOT="${SCRIPT_ROOT}/-Force/context7-local"
TARGET_SKILLS="${TARGET_CURSOR_HOME}/skills"
LOCAL_ROOT="${TARGET_CURSOR_HOME}/context7-local"
ENTRY_PATH="${LOCAL_ROOT}/node_modules/@upstash/context7-mcp/dist/index.js"
LAUNCHER_PATH="${TARGET_CURSOR_HOME}/run-context7.sh"
MCP_PATH="${TARGET_CURSOR_HOME}/mcp.json"
PYTHON_BIN=""

if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
else
  echo "Error: python3 or python is required but was not found on PATH." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is required but was not found on PATH." >&2
  exit 1
fi

if [ ! -d "${SOURCE_SKILLS}" ]; then
  echo "Error: missing skills package at ${SOURCE_SKILLS}" >&2
  exit 1
fi

if [ ! -d "${BUNDLED_CONTEXT7_ROOT}" ]; then
  echo "Error: missing bundled Context7 runtime at ${BUNDLED_CONTEXT7_ROOT}" >&2
  exit 1
fi

echo "[Cursor package] Installing skills and MCP for Cursor."
mkdir -p "${TARGET_CURSOR_HOME}" "${TARGET_SKILLS}"

echo "Installing Cursor personal skills to: ${TARGET_SKILLS}"
echo "Internal built-in directory ~/.cursor/skills-cursor will not be modified."

for skill_dir in "${SOURCE_SKILLS}"/*; do
  [ -d "${skill_dir}" ] || continue
  skill_name="$(basename "${skill_dir}")"
  target_path="${TARGET_SKILLS}/${skill_name}"
  rm -rf "${target_path}"
  cp -R "${skill_dir}" "${target_path}"
  echo "Installed skill: ${skill_name}"
done

echo "Installing bundled Context7 runtime to: ${LOCAL_ROOT}"
rm -rf "${LOCAL_ROOT}"
cp -R "${BUNDLED_CONTEXT7_ROOT}" "${LOCAL_ROOT}"

if [ ! -f "${ENTRY_PATH}" ]; then
  echo "Error: Context7 runtime entry was not created: ${ENTRY_PATH}" >&2
  exit 1
fi

cat > "${LAUNCHER_PATH}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "${SCRIPT_DIR}/context7-local/node_modules/@upstash/context7-mcp/dist/index.js" "$@"
EOF
chmod +x "${LAUNCHER_PATH}"

if [ -f "${MCP_PATH}" ]; then
  cp "${MCP_PATH}" "${MCP_PATH}.bak.$(date +%Y%m%d-%H%M%S)"
  echo "Backed up mcp.json"
fi

"${PYTHON_BIN}" - <<'PY' "${MCP_PATH}" "${LAUNCHER_PATH}"
import json
import os
import sys

mcp_path = sys.argv[1]
launcher_path = sys.argv[2]
config = {}
if os.path.exists(mcp_path):
    try:
        with open(mcp_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
    except Exception:
        config = {}

if not isinstance(config, dict):
    config = {}

mcp_servers = config.get('mcpServers')
if not isinstance(mcp_servers, dict):
    mcp_servers = {}
    config['mcpServers'] = mcp_servers

mcp_servers['context7'] = {
    'command': launcher_path,
    'args': []
}

with open(mcp_path, 'w', encoding='utf-8') as f:
    json.dump(config, f, ensure_ascii=False, indent=2)
    f.write('\n')
PY

echo "Configured MCP server: context7"
echo "[Cursor package] Done. Restart Cursor to load the latest personal skills and MCP config."
