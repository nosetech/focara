#!/usr/bin/env bash
# 配布版: frontend(standalone)をバックグラウンドで起動する。
# bind 先は .env の LAN_IP / TAILSCALE_IP(どちらか一方)で指定する。未指定なら 127.0.0.1。
set -euo pipefail
LAUNCHD_HINT="登録を解除してから実行してください"
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

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

guard_start frontend
mkdir -p "$LOG_DIR"

# & はコマンド単体に掛ける(cd && ... のリストに掛けると $! が bash の PID になる)
(
  cd "$ROOT/frontend"
  NODE_ENV=production PORT="$FRONTEND_PORT" HOSTNAME="$FRONTEND_HOST" \
    BACKEND_URL="http://127.0.0.1:$BACKEND_PORT" \
    nohup node server.js >>"$LOG_DIR/frontend.log" 2>&1 &
  echo $! >"$(pid_file frontend)"
)

# 一括起動(start.sh)からは FOCARA_BATCH=1 で呼ばれ、案内は start.sh がまとめて出す
if [ -z "${FOCARA_BATCH:-}" ]; then
  echo "起動しました: frontend http://$FRONTEND_HOST:$FRONTEND_PORT"
  if [ "$FRONTEND_PUBLIC" = 0 ]; then
    echo "frontend はローカルのみ(127.0.0.1)で待ち受けています。LAN/Tailscale に公開するには .env に LAN_IP か TAILSCALE_IP を設定してください"
  fi
  echo "ログ: $LOG_DIR/frontend.log"
fi
