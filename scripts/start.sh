#!/usr/bin/env bash
# backend と frontend をバックグラウンドで起動する(backend_start.sh → frontend_start.sh を順に呼ぶ)。
#   FOCARA_FRONTEND_MODE=start(既定。未ビルドなら build する) | dev
# frontend の bind 先は LAN_IP / TAILSCALE_IP(どちらか一方)で指定する。未指定なら 127.0.0.1。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib.sh"
load_config
resolve_frontend_host
resolve_frontend_mode

# どちらかが起動できない場合は、何も起動しない
for svc in backend frontend; do guard_start "$svc"; done
# ビルド失敗時に backend だけが残らないよう、先にビルドする
ensure_frontend_build

export FOCARA_BATCH=1
"$DIR/backend_start.sh"
"$DIR/frontend_start.sh"

echo "起動しました: backend http://127.0.0.1:$BACKEND_PORT / frontend http://$FRONTEND_HOST:$FRONTEND_PORT"
if [ "$FRONTEND_PUBLIC" = 1 ]; then
  echo "frontend の bind 先: $FRONTEND_HOST (http://$FRONTEND_HOST:$FRONTEND_PORT)"
else
  echo "frontend はローカルのみ(127.0.0.1)で待ち受けています。LAN/Tailscale に公開するには LAN_IP か TAILSCALE_IP を指定してください"
fi
echo "ログ: $LOG_DIR/{backend,frontend}.log"
