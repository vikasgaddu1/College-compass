#!/usr/bin/env bash
# Build the production web bundle with a test client ID, serve it with `vite preview`,
# run the Playwright end-to-end flow against it, then stop the server.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${E2E_PORT:-4173}"
export E2E_BASE_URL="${E2E_BASE_URL:-http://localhost:${PORT}/College-compass/app/}"

VITE_CC_CHATGPT_CLIENT_ID=oaiapp_e2e_test npm run build

set -m # background job gets its own process group, so the whole npx → vite tree can be stopped
npx vite preview --port "$PORT" --strictPort >e2e/.preview.log 2>&1 &
SERVER=$!
trap 'kill -TERM -- "-$SERVER" 2>/dev/null || true; wait "$SERVER" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  if curl --noproxy '*' -sf -o /dev/null "$E2E_BASE_URL"; then break; fi
  if ! kill -0 "$SERVER" 2>/dev/null; then cat e2e/.preview.log; echo "vite preview exited" >&2; exit 1; fi
  sleep 0.5
done

python3 e2e/full-flow.py
