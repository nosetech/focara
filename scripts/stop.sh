#!/usr/bin/env bash
# start.sh(または個別の *_start.sh)で起動した frontend / backend を停止する。
# 起動していないサービスがあっても成功終了する。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$DIR/frontend_stop.sh" || true
"$DIR/backend_stop.sh" || true
