#!/usr/bin/env bash
# ==============================================================================
# run_e2e_tests.sh
# Master E2E Test Suite Execution Script for Live TV App
# ==============================================================================

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="$(command -v node || echo "/data/data/com.termux/files/usr/bin/node")"

if [ ! -x "$NODE_BIN" ]; then
    echo "Error: Node.js runtime not found."
    exit 1
fi

exec "$NODE_BIN" "$SCRIPT_DIR/run_e2e_tests.js" "$@"
