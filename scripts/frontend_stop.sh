#!/usr/bin/env bash
# frontend を停止する(起動していなければ失敗終了する)。
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_config
stop_service frontend
