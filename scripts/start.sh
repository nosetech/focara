#!/usr/bin/env bash
# backend と frontend をバックグラウンドで起動する。
#   FOCARA_FRONTEND_MODE=start(既定。未ビルドなら build する) | dev
# frontend は config.yaml の frontend.host を FRONTEND_HOST として渡して起動する。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_config
mkdir -p "$LOG_DIR"

MODE="${FOCARA_FRONTEND_MODE:-start}"
case "$MODE" in start | dev) ;; *) echo "FOCARA_FRONTEND_MODE は start か dev を指定してください: $MODE" >&2; exit 1 ;; esac

for svc in backend frontend; do
  if is_running "$svc"; then
    echo "$svc は既に起動しています(pid $(cat "$(pid_file "$svc")"))。先に scripts/stop.sh を実行してください" >&2
    exit 1
  fi
done

if [ "$MODE" = start ] && [ ! -f "$ROOT/frontend/.next/BUILD_ID" ]; then
  echo "frontend をビルドします"
  (cd "$ROOT/frontend" && npm run build)
fi

(cd "$ROOT/backend" && nohup uv run python -m focara.main \
  >>"$LOG_DIR/backend.log" 2>&1 & echo $! >"$(pid_file backend)")

# BACKEND_URL は /api/* の中継先。backend は常に 127.0.0.1
(cd "$ROOT/frontend" && \
  FRONTEND_HOST="$FRONTEND_HOST" FRONTEND_PORT="$FRONTEND_PORT" \
  BACKEND_URL="http://127.0.0.1:$BACKEND_PORT" \
  nohup npm run "$MODE" >>"$LOG_DIR/frontend.log" 2>&1 & echo $! >"$(pid_file frontend)")

echo "起動しました: backend http://127.0.0.1:$BACKEND_PORT / frontend http://$FRONTEND_HOST:$FRONTEND_PORT"
echo "ログ: $LOG_DIR/{backend,frontend}.log"
