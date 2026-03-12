#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
echo "[Codex package] Running repair for Codex CLI."
exec "$script_dir/install.sh" --force "$@"
