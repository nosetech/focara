#!/usr/bin/env bash
# backend をバックグラウンドで起動する(frontend の設定は不要)。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_config
start_backend
# 一括起動(start.sh)からは FOCARA_BATCH=1 で呼ばれ、案内は start.sh がまとめて出す
if [ -z "${FOCARA_BATCH:-}" ]; then
  echo "起動しました: backend http://127.0.0.1:$BACKEND_PORT"
  echo "ログ: $LOG_DIR/backend.log"
fi
