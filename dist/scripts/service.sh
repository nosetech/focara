#!/usr/bin/env bash
# 配布版: backend / frontend(standalone)を launchd の per-user LaunchAgent として常時起動する(macOS)。
#   scripts/service.sh {install|uninstall|start|stop|restart|status|render}
#   install   : plist を生成して登録・起動する(再実行で更新)
#   uninstall : 停止して登録を解除し、plist を削除する
#   start     : 登録済みサービスを起動する
#   stop      : 停止する(plist は残るため、次回ログイン時に再び起動する。恒久的に止めるなら uninstall)
#   restart   : 設定(config.yaml / .env)を読み直して plist を再生成し、再起動する
#   render    : plist を生成するだけで登録しない(確認・テスト用。登録済みの plist は上書きされるので、通常は使わない)
# frontend の bind 先は install / restart 時の .env の LAN_IP / TAILSCALE_IP(どちらか一方)で決まる。
set -euo pipefail
LAUNCHD_HINT="scripts/service.sh stop か uninstall を実行してください"
# shellcheck source=/dev/null
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# .env(利用者固有の設定)を読み込んで export する
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

SERVICES=(backend frontend)
AGENT_DIR="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"

usage() { echo "使い方: $0 {install|uninstall|start|stop|restart|status|render}" >&2; exit 1; }
[ $# -eq 1 ] || usage
CMD=$1

[ "$(uname)" = Darwin ] || { echo "service.sh は macOS(launchd)専用です" >&2; exit 1; }

load_config
resolve_frontend_host
mkdir -p "$LOG_DIR" "$AGENT_DIR"

plist_path() { echo "$AGENT_DIR/$(service_label "$1").plist"; }

# start.sh で起動中のプロセスがあると二重起動になるので止める
refuse_if_manual_running() {
  local svc
  for svc in "${SERVICES[@]}"; do
    if is_running "$svc"; then
      echo "$svc は scripts/start.sh で起動中です(pid $(cat "$(pid_file "$svc")"))。先に scripts/stop.sh を実行してください" >&2
      exit 1
    fi
  done
}

# 前提(未準備だと launchd が再起動を繰り返すため、登録前に検出する)
check_prerequisites() {
  [ -x "$ROOT/backend/.venv/bin/python" ] || { echo "backend の依存が未導入です。backend/ で uv sync --frozen を実行してください" >&2; exit 1; }
  [ -f "$ROOT/frontend/server.js" ] || { echo "frontend/server.js がありません。展開物が壊れていないか確認してください" >&2; exit 1; }
  command -v node >/dev/null || { echo "node が見つかりません" >&2; exit 1; }
}

# テンプレートの __KEY__ を値(XMLエスケープ済み)で置換して plist を生成する
render_plist() {
  local svc=$1 node_dir path extra=""
  node_dir="$(dirname "$(command -v node)")"
  path="$node_dir:$(dirname "$(command -v uv)"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
  if [ -n "${FOCARA_CONFIG:-}" ]; then
    local cfg=${FOCARA_CONFIG//&/&amp;}; cfg=${cfg//</&lt;}; cfg=${cfg//>/&gt;}
    extra="
    <key>FOCARA_CONFIG</key>
    <string>$cfg</string>"
  fi
  python3 -I - "$ROOT/scripts/com.nosetech.focara.$svc.plist.example" "$(plist_path "$svc")" \
    "LABEL=$(service_label "$svc")" "ROOT=$ROOT" "PATH=$path" "NODE=$(command -v node)" \
    "LOG_FILE=$LOG_DIR/$svc.log" "FRONTEND_HOST=$FRONTEND_HOST" "FRONTEND_PORT=$FRONTEND_PORT" \
    "BACKEND_URL=http://127.0.0.1:$BACKEND_PORT" "EXTRA_ENV=$extra" <<'PY'
import sys
from xml.sax.saxutils import escape

src, dst, *pairs = sys.argv[1:]
text = open(src, encoding="utf-8").read()
for pair in pairs:
    key, _, value = pair.partition("=")
    if key != "EXTRA_ENV":
        value = escape(value)
    text = text.replace(f"__{key}__", value)
open(dst, "w", encoding="utf-8").write(text)
PY
  plutil -lint "$(plist_path "$svc")" >/dev/null
}

# bootout は非同期に終わるため、登録が消えるまで待つ(最大約10秒)。失敗しても続行する
bootout_svc() {
  local _
  service_loaded "$1" || return 0
  launchctl bootout "$DOMAIN/$(service_label "$1")" 2>/dev/null || true
  for _ in $(seq 1 50); do
    service_loaded "$1" || return 0
    sleep 0.2
  done
  echo "$1 の登録解除が完了しません: $(service_label "$1")" >&2
  return 1
}

# 直前の bootout 直後は失敗することがあるため、1回だけ待ってリトライする
bootstrap_svc() {
  launchctl bootstrap "$DOMAIN" "$(plist_path "$1")" 2>/dev/null && return 0
  sleep 2
  launchctl bootstrap "$DOMAIN" "$(plist_path "$1")"
}

# 登録(再実行で更新)。backend を先に、frontend を後に起動する
register_all() {
  local svc
  for svc in "${SERVICES[@]}"; do bootout_svc "$svc"; done
  for svc in "${SERVICES[@]}"; do
    render_plist "$svc"
    bootstrap_svc "$svc"
    echo "$svc を登録・起動しました: $(service_label "$svc")"
  done
  echo "backend http://127.0.0.1:$BACKEND_PORT / frontend http://$FRONTEND_HOST:$FRONTEND_PORT"
  echo "ログ: $LOG_DIR/{backend,frontend}.log"
}

case "$CMD" in
  install)
    refuse_if_manual_running
    check_prerequisites
    register_all
    ;;
  restart)
    refuse_if_manual_running
    check_prerequisites
    register_all
    ;;
  render)
    check_prerequisites
    for svc in "${SERVICES[@]}"; do render_plist "$svc"; echo "$(plist_path "$svc")"; done
    ;;
  uninstall)
    for svc in frontend backend; do
      bootout_svc "$svc" || true
      rm -f "$(plist_path "$svc")"
      echo "$svc の登録を解除しました"
    done
    ;;
  start)
    refuse_if_manual_running
    for svc in "${SERVICES[@]}"; do
      [ -f "$(plist_path "$svc")" ] || { echo "$svc は未登録です。先に scripts/service.sh install を実行してください" >&2; exit 1; }
      if service_loaded "$svc"; then echo "$svc は既に起動しています"; else bootstrap_svc "$svc"; echo "$svc を起動しました"; fi
    done
    ;;
  stop)
    for svc in frontend backend; do
      if service_loaded "$svc"; then bootout_svc "$svc" && echo "$svc を停止しました(次回ログイン時に再び起動します。恒久的に止めるには uninstall)"; else echo "$svc は起動していません"; fi
    done
    ;;
  status)
    for svc in "${SERVICES[@]}"; do
      label="$(service_label "$svc")"
      if service_loaded "$svc"; then
        info="$(launchctl print "$DOMAIN/$label")"
        pid="$(printf '%s\n' "$info" | awk '$1 == "pid" {print $3; exit}')"
        if [ -n "$pid" ]; then echo "$svc: 稼働中 pid $pid($label)"; else echo "$svc: 登録済みだが起動していません($label)"; fi
      elif [ -f "$(plist_path "$svc")" ]; then
        echo "$svc: plist あり・停止中($label)"
      else
        echo "$svc: 未登録($label)"
      fi
    done
    echo "ログ: $LOG_DIR/{backend,frontend}.log"
    ;;
  *) usage ;;
esac
