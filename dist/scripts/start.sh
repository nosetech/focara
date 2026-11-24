#!/usr/bin/env bash
# 配布版: backend と frontend をバックグラウンドで起動する(backend_start.sh → frontend_start.sh を順に呼ぶ)。
# frontend の bind 先は .env の LAN_IP / TAILSCALE_IP(どちらか一方)で指定する。未指定なら 127.0.0.1。
set -euo pipefail
LAUNCHD_HINT="登録を解除してから実行してください"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/lib.sh"

# .env(利用者固有の設定)を読み込んで export する
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

load_config
resolve_frontend_host

[ -f "$ROOT/frontend/server.js" ] || { echo "frontend/server.js がありません。展開物が壊れていないか確認してください" >&2; exit 1; }
command -v node >/dev/null || { echo "node が見つかりません" >&2; exit 1; }

# どちらかが起動できない場合は、何も起動しない
for svc in backend frontend; do guard_start "$svc"; done

export FOCARA_BATCH=1
"$DIR/backend_start.sh"
"$DIR/frontend_start.sh"

echo "起動しました: backend http://127.0.0.1:$BACKEND_PORT / frontend http://$FRONTEND_HOST:$FRONTEND_PORT"
if [ "$FRONTEND_PUBLIC" = 0 ]; then
  echo "frontend はローカルのみ(127.0.0.1)で待ち受けています。LAN/Tailscale に公開するには .env に LAN_IP か TAILSCALE_IP を設定してください"
fi
echo "ログ: $LOG_DIR/{backend,frontend}.log"
