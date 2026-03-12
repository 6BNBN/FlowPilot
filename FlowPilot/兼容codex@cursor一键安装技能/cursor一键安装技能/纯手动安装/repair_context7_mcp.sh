#!/usr/bin/env bash
set -euo pipefail

TARGET_CURSOR_HOME="${1:-${HOME}/.cursor}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUNDLED_CONTEXT7_ROOT="${PACKAGE_ROOT}/-Force/context7-local"
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

if [ ! -d "${BUNDLED_CONTEXT7_ROOT}" ]; then
  echo "Error: missing bundled Context7 runtime at ${BUNDLED_CONTEXT7_ROOT}" >&2
  exit 1
fi

echo "[Cursor package][manual] Running context7 MCP repair for Cursor."

echo "Refreshing bundled Context7 runtime..."
rm -rf "${LOCAL_ROOT}"
cp -R "${BUNDLED_CONTEXT7_ROOT}" "${LOCAL_ROOT}"

if [ ! -f "${ENTRY_PATH}" ]; then
  echo "Error: Context7 runtime entry was not found after repair: ${ENTRY_PATH}" >&2
  exit 1
fi

cat > "${LAUNCHER_PATH}" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "${SCRIPT_DIR}/context7-local/node_modules/@upstash/context7-mcp/dist/index.js" "$@"
EOF
chmod +x "${LAUNCHER_PATH}"

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
mcp_servers['context7'] = {'command': launcher_path, 'args': []}
with open(mcp_path, 'w', encoding='utf-8') as f:
    json.dump(config, f, ensure_ascii=False, indent=2)
    f.write('\n')
PY

echo "Repaired MCP server: context7"
echo "[Cursor package][manual] Done. Restart Cursor."
