#!/usr/bin/env bash
# frontend をバックグラウンドで起動する。
#   FOCARA_FRONTEND_MODE=start(既定。未ビルドなら build する) | dev
# bind 先は LAN_IP / TAILSCALE_IP(どちらか一方)で指定する。未指定なら 127.0.0.1。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_config
resolve_frontend_host
resolve_frontend_mode
guard_start frontend
mkdir -p "$LOG_DIR"
ensure_frontend_build

# BACKEND_URL は /api/* の中継先。backend は常に 127.0.0.1
# 開発サーバは bind 先を許可オリジンの既定にする(未指定だと /_next/* が403になる)
DEV_ORIGINS="${FRONTEND_ALLOWED_DEV_ORIGINS:-}"
if [ -z "$DEV_ORIGINS" ] && [ "$FRONTEND_PUBLIC" = 1 ]; then DEV_ORIGINS="$FRONTEND_HOST"; fi

# & はコマンド単体に掛ける(cd && ... のリストに掛けると $! が bash の PID になる)
(
  cd "$ROOT/frontend"
  FRONTEND_ALLOWED_DEV_ORIGINS="$DEV_ORIGINS" FRONTEND_HOST="$FRONTEND_HOST" FRONTEND_PORT="$FRONTEND_PORT" \
    BACKEND_URL="http://127.0.0.1:$BACKEND_PORT" \
    nohup npm run "$MODE" >>"$LOG_DIR/frontend.log" 2>&1 &
  echo $! >"$(pid_file frontend)"
)

# 一括起動(start.sh)からは FOCARA_BATCH=1 で呼ばれ、案内は start.sh がまとめて出す
if [ -z "${FOCARA_BATCH:-}" ]; then
  echo "起動しました: frontend http://$FRONTEND_HOST:$FRONTEND_PORT"
  if [ "$FRONTEND_PUBLIC" = 0 ]; then
    echo "frontend はローカルのみ(127.0.0.1)で待ち受けています。LAN/Tailscale に公開するには LAN_IP か TAILSCALE_IP を指定してください"
  fi
  echo "ログ: $LOG_DIR/frontend.log"
fi
