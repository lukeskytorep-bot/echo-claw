#!/usr/bin/env sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "${1:-}" != "--accept-capabilities" ]; then
  printf '%s\n' 'ECHO-4 requires explicit capability review. Read openclaw.plugin.json, then rerun:' >&2
  printf '  %s --accept-capabilities\n' "$0" >&2
  exit 2
fi
node "$SCRIPT_DIR/echo4-install.mjs" preflight --json
node "$SCRIPT_DIR/echo4-install.mjs" plan --json
node "$SCRIPT_DIR/echo4-install.mjs" install --source local-link --accept-capabilities --json
printf '%s\n' 'Install complete. Run the ECHO-4 host self-test against the active Gateway:'
printf '  node "%s/echo4-host-self-test.mjs"\n' "$SCRIPT_DIR"
