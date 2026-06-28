#!/usr/bin/env bash
# Launches the Compass MCP proxy wrapping the stellar-mcp downstream.
# Used as a stdio MCP server entry for Claude Code.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"
export STELLAR_SERVER_URL="${STELLAR_SERVER_URL:-https://horizon-testnet.stellar.org}"
export COMPASS_HYBRID_GUARD_ENABLED="${COMPASS_HYBRID_GUARD_ENABLED:-false}"
# Decision feed for the dashboard (scripts/compass-dashboard.mjs tails the same file).
export COMPASS_EVENTS_FILE="${COMPASS_EVENTS_FILE:-$REPO/.compass-events.jsonl}"
exec "$REPO/node_modules/.bin/tsx" "$REPO/back/services/mcp/server/mcpServer.ts" \
  --downstream-name stellar-tools \
  --downstream-command "$REPO/node_modules/.bin/tsx" \
  --downstream-args-json "[\"$REPO/node_modules/stellar-mcp/src/index.ts\"]" \
  --downstream-env-keys STELLAR_SERVER_URL
