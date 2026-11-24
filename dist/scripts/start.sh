#!/usr/bin/env bash
# 配布版: backend と frontend(standalone)をバックグラウンドで起動する。
# frontend の bind 先は .env の LAN_IP / TAILSCALE_IP(どちらか一方)で指定する。未指定なら 127.0.0.1。
set -euo pipefail
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
mkdir -p "$LOG_DIR"

[ -f "$ROOT/frontend/server.js" ] || { echo "frontend/server.js がありません。展開物が壊れていないか確認してください" >&2; exit 1; }
command -v node >/dev/null || { echo "node が見つかりません" >&2; exit 1; }

for svc in backend frontend; do
  if [ "$(uname)" = Darwin ] && service_loaded "$svc"; then
    echo "$svc は launchd に登録されています。登録を解除してから実行してください" >&2
    exit 1
  fi
  if is_running "$svc"; then
    echo "$svc は既に起動しています(pid $(cat "$(pid_file "$svc")"))。先に scripts/stop.sh を実行してください" >&2
    exit 1
  fi
done

(cd "$ROOT/backend" && nohup uv run python -m focara.main \
  >>"$LOG_DIR/backend.log" 2>&1 & echo $! >"$(pid_file backend)")

(cd "$ROOT/frontend" && \
  NODE_ENV=production PORT="$FRONTEND_PORT" HOSTNAME="$FRONTEND_HOST" \
  BACKEND_URL="http://127.0.0.1:$BACKEND_PORT" \
  nohup node server.js >>"$LOG_DIR/frontend.log" 2>&1 & echo $! >"$(pid_file frontend)")

echo "起動しました: backend http://127.0.0.1:$BACKEND_PORT / frontend http://$FRONTEND_HOST:$FRONTEND_PORT"
if [ "$FRONTEND_PUBLIC" = 0 ]; then
  echo "frontend はローカルのみ(127.0.0.1)で待ち受けています。LAN/Tailscale に公開するには .env に LAN_IP か TAILSCALE_IP を設定してください"
fi
echo "ログ: $LOG_DIR/{backend,frontend}.log"
