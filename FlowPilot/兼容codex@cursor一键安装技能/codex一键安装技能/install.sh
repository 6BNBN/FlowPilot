#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

target_codex_home=""
force=0

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
    --force)
      force=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

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

require_command codex
require_command node

echo "[Codex package] Installing skills and MCP for Codex CLI."

package_root=$script_dir
source_skills="$package_root/.codex-home-claude-parity/skills"
bundled_context7_root="$package_root/纯手动安装/context7-local-bundled"
if [ ! -d "$source_skills" ]; then
  echo "Missing packaged skills: $source_skills" >&2
  exit 1
fi
if [ ! -d "$bundled_context7_root" ]; then
  echo "Missing bundled Context7 runtime: $bundled_context7_root" >&2
  exit 1
fi

target_codex_home=$(resolve_codex_home)
target_skills="$target_codex_home/skills"
target_context7_root="$target_codex_home/context7-local"
launcher_path="$target_codex_home/run-context7.sh"
config_path="$target_codex_home/config.toml"

mkdir -p "$target_skills" "$target_codex_home"

for source_path in "$source_skills"/*; do
  [ -d "$source_path" ] || continue
  skill_name=$(basename "$source_path")
  target_path="$target_skills/$skill_name"

  if [ -d "$target_path" ] && [ "$force" -ne 1 ]; then
    echo "Skipped existing skill: $skill_name (use --force to replace)"
    continue
  fi

  rm -rf "$target_path"
  cp -R "$source_path" "$target_path"
  if [ "$force" -eq 1 ]; then
    echo "Updated skill: $skill_name"
  else
    echo "Installed skill: $skill_name"
  fi
done

rm -rf "$target_context7_root"
mkdir -p "$target_context7_root"
cp -R "$bundled_context7_root"/. "$target_context7_root"/

if [ ! -f "$target_context7_root/node_modules/@upstash/context7-mcp/dist/index.js" ]; then
  echo "Bundled Context7 runtime entry is missing after copy." >&2
  exit 1
fi

cat >"$launcher_path" <<EOF
#!/usr/bin/env sh
set -eu
SCRIPT_DIR=\$(CDPATH= cd -- "\$(dirname -- "\$0")" && pwd)
node "\${SCRIPT_DIR}/context7-local/node_modules/@upstash/context7-mcp/dist/index.js" "\$@"
EOF
chmod +x "$launcher_path"

if [ -f "$config_path" ]; then
  config_backup_source="$config_path"
else
  config_backup_source=$(mktemp)
  : >"$config_backup_source"
fi

backup_path="$config_path.bak.$(date +%Y%m%d-%H%M%S)"
cp "$config_backup_source" "$backup_path"
echo "Backed up config to: $backup_path"

tmp_config=$(mktemp)
if [ -f "$config_path" ]; then
  strip_context7_block "$config_path" >"$tmp_config"
else
  : >"$tmp_config"
fi

if [ -s "$tmp_config" ]; then
  printf '\n' >>"$tmp_config"
fi

cat >>"$tmp_config" <<EOF
[mcp_servers.context7]
command = "$launcher_path"
args = []
EOF

mv "$tmp_config" "$config_path"
if [ -f "$config_backup_source" ] && [ "$config_backup_source" != "$config_path" ]; then
  rm -f "$config_backup_source"
fi

echo "Configured MCP server: context7"
echo "Target CODEX_HOME: $target_codex_home"
echo "[Codex package] Completed successfully. Restart Codex CLI."
