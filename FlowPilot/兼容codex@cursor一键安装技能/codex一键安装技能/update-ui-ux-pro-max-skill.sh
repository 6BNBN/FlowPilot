#!/usr/bin/env sh
set -eu

target_codex_home=""

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
      echo "Unknown argument: $1" >&2
      exit 1
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

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_skill_dir="$script_dir/.codex-home-claude-parity/skills/ui-ux-pro-max"
codex_home=$(resolve_codex_home)
target_skill_dir="$codex_home/skills/ui-ux-pro-max"

if [ ! -d "$source_skill_dir" ]; then
  echo "Bundled ui-ux-pro-max skill not found: $source_skill_dir" >&2
  exit 1
fi

rm -rf "$target_skill_dir"
mkdir -p "$codex_home/skills"
cp -R "$source_skill_dir" "$target_skill_dir"

echo "Reinstalled bundled ui-ux-pro-max skill to: $target_skill_dir"
echo "Completed successfully. Restart Codex CLI."
