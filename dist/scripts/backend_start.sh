#!/usr/bin/env bash
# 配布版: backend をバックグラウンドで起動する(frontend の設定は不要)。
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
start_backend
# 一括起動(start.sh)からは FOCARA_BATCH=1 で呼ばれ、案内は start.sh がまとめて出す
if [ -z "${FOCARA_BATCH:-}" ]; then
  echo "起動しました: backend http://127.0.0.1:$BACKEND_PORT"
  echo "ログ: $LOG_DIR/backend.log"
fi
