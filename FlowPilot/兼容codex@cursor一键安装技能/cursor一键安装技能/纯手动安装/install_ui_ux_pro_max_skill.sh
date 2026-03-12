#!/usr/bin/env bash
set -euo pipefail

target_cursor_home="${1:-${HOME}/.cursor}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source_skill_dir="${script_dir}/skills/ui-ux-pro-max"
target_skill_dir="${target_cursor_home}/skills/ui-ux-pro-max"

if [ ! -d "${source_skill_dir}" ]; then
  echo "Bundled ui-ux-pro-max skill not found: ${source_skill_dir}" >&2
  exit 1
fi

rm -rf "${target_skill_dir}"
mkdir -p "${target_cursor_home}/skills"
echo "[Cursor package][manual] Installing ui-ux-pro-max for Cursor."
cp -R "${source_skill_dir}" "${target_skill_dir}"

echo "Installed bundled ui-ux-pro-max skill to: ${target_skill_dir}"
echo "[Cursor package][manual] Completed successfully. Restart Cursor."
