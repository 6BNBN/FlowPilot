#!/usr/bin/env sh
set -eu

target_codex_home=""
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target-codex-home)
      if [ "$#" -lt 2 ]; then
        echo "Missing value for --target-codex-home" >&2
        exit 1
      fi
      target_codex_home=$2
      shift 2
      ;;
    *)
      if [ -z "$target_codex_home" ]; then
        target_codex_home=$1
        shift
      else
        echo "Unknown argument: $1" >&2
        exit 1
      fi
      ;;
  esac
done

resolve_codex_home() {
  if [ -n "$target_codex_home" ]; then
    printf '%s\n' "$target_codex_home"
    return
  fi

  if [ -n "${CODEX_HOME:-}" ]; then
    printf '%s\n' "$CODEX_HOME"
    return
  fi

  if [ -z "${HOME:-}" ]; then
    echo "HOME is not set. Pass --target-codex-home or set CODEX_HOME." >&2
    exit 1
  fi

  printf '%s/.codex\n' "$HOME"
}

strip_context7_block() {
  awk '
    BEGIN { skip = 0 }
    /^\[mcp_servers\.context7(\.env)?\]$/ { skip = 1; next }
    /^\[/ {
      if (skip == 1) {
        skip = 0
      }
    }
    skip == 0 { print }
  ' "$1"
}

if ! command -v codex >/dev/null 2>&1; then
  echo "Error: codex is required but was not found on PATH." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is required but was not found on PATH." >&2
  exit 1
fi

echo "[Codex package][manual] Installing context7 MCP for Codex CLI."

TARGET_CODEX_HOME=$(resolve_codex_home)
SOURCE_CONTEXT7_RUNTIME="${SCRIPT_DIR}/context7-local-bundled"
TARGET_CONTEXT7_RUNTIME="${TARGET_CODEX_HOME}/context7-local"
LAUNCHER_PATH="${TARGET_CODEX_HOME}/run-context7.sh"
CONFIG_PATH="${TARGET_CODEX_HOME}/config.toml"

if [ ! -d "${SOURCE_CONTEXT7_RUNTIME}" ]; then
  echo "Error: bundled Context7 runtime is missing: ${SOURCE_CONTEXT7_RUNTIME}" >&2
  exit 1
fi

mkdir -p "${TARGET_CODEX_HOME}"
rm -rf "${TARGET_CONTEXT7_RUNTIME}"
mkdir -p "${TARGET_CONTEXT7_RUNTIME}"
cp -R "${SOURCE_CONTEXT7_RUNTIME}"/. "${TARGET_CONTEXT7_RUNTIME}/"

cat > "${LAUNCHER_PATH}" <<'EOF'
#!/usr/bin/env sh
set -eu
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
node "${SCRIPT_DIR}/context7-local/node_modules/@upstash/context7-mcp/dist/index.js" "$@"
EOF
chmod +x "${LAUNCHER_PATH}"

if [ ! -f "${TARGET_CONTEXT7_RUNTIME}/node_modules/@upstash/context7-mcp/dist/index.js" ]; then
  echo "Error: Context7 runtime entry was not created under ${TARGET_CONTEXT7_RUNTIME}" >&2
  exit 1
fi

tmp_config=$(mktemp)
if [ -f "${CONFIG_PATH}" ]; then
  cp "${CONFIG_PATH}" "${CONFIG_PATH}.bak.$(date +%Y%m%d-%H%M%S)"
  strip_context7_block "${CONFIG_PATH}" >"${tmp_config}"
else
  : >"${tmp_config}"
fi

if [ -s "${tmp_config}" ]; then
  printf '\n' >>"${tmp_config}"
fi

cat >>"${tmp_config}" <<EOF
[mcp_servers.context7]
command = "${LAUNCHER_PATH}"
args = []
EOF

mv "${tmp_config}" "${CONFIG_PATH}"

echo "Configured MCP server: context7"
echo "Target CODEX_HOME: ${TARGET_CODEX_HOME}"
echo "[Codex package][manual] Completed successfully. Restart Codex CLI."
