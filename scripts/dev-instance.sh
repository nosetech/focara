#!/usr/bin/env bash
# 動作確認用インスタンス(運用と分離した backend / frontend)を起動・停止・確認する。
#   scripts/dev-instance.sh start|stop|status
#   DEV_BACKEND_PORT / DEV_FRONTEND_PORT で明示指定できる(運用既定の 8800 / 3800 と使用中のポートは拒否)。
# 設定・DB・ログ・PID記録はすべて worktree 直下の .dev-run/ に置く(運用の config.yaml・DBは参照しない)。
# stop は .dev-run/ の記録と一致するプロセスグループだけを止める。名前・ポートからの検索 kill はしない。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/.dev-run"
CONFIG="$RUN_DIR/config.yaml"
PROD_BACKEND_PORT=8800
PROD_FRONTEND_PORT=3800
MARK="FOCARA_DEV_INSTANCE=$ROOT"

usage() {
  echo "使い方: $0 start|stop|status" >&2
  exit 1
}

rec() { echo "$RUN_DIR/$1.$2"; } # rec <backend|frontend> <pid|pgid>

# 記録された値を読む(ファイルは source せず、数字だけを受け付ける)
read_rec() {
  local f v; f="$(rec "$1" "$2")"
  [ -f "$f" ] || return 1
  v="$(cat "$f")"
  case "$v" in '' | *[!0-9]*) return 1 ;; esac
  echo "$v"
}

# 記録の PID が生存し、PGID と目印(プロセス環境)が記録と一致する場合のみ成功。
# 戻り値: 0=一致 / 1=記録なしまたは停止済み / 2=不一致(kill してはいけない)
verify() {
  local svc=$1 pid pgid cur
  pid="$(read_rec "$svc" pid)" || return 1
  pgid="$(read_rec "$svc" pgid)" || return 2
  kill -0 "$pid" 2>/dev/null || return 1
  cur="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')"
  [ "$cur" = "$pgid" ] || return 2
  [ "$pgid" = "$pid" ] || return 2
  [ "$pgid" != "$(ps -o pgid= -p $$ | tr -d ' ')" ] || return 2
  # ps eww は環境変数をコマンド行の後ろに付けて表示する。npm はプロセス表示を書き換えて
  # 環境が見えなくなるため、同じグループのいずれかのプロセスに目印があればよい
  local m
  for m in $(ps -ax -o pid=,pgid= | awk -v g="$pgid" '$2 == g { print $1 }'); do
    ps eww -p "$m" 2>/dev/null | grep -qF -- " $MARK" && return 0
  done
  return 2
}

# 空きポートを採番する(18000番台から。運用既定と使用中は除外)。引数は除外するポート
pick_port() {
  python3 -I - "$PROD_BACKEND_PORT" "$PROD_FRONTEND_PORT" "$@" <<'PY'
import socket, sys
skip = {int(a) for a in sys.argv[1:]}
for p in range(18000, 19000):
    if p in skip:
        continue
    with socket.socket() as s:
        if s.connect_ex(("127.0.0.1", p)) != 0:
            print(p)
            break
else:
    sys.exit(1)
PY
}

# 明示指定されたポートを検証する。引数: 名前 値 [重複禁止のポート]
check_port() {
  local name=$1 v=$2 other=${3:-}
  case "$v" in '' | *[!0-9]*) echo "$name は数値で指定してください: $v" >&2; exit 1 ;; esac
  if [ "$v" = "$PROD_BACKEND_PORT" ] || [ "$v" = "$PROD_FRONTEND_PORT" ]; then
    echo "$name に運用の既定ポート($v)は指定できません" >&2; exit 1
  fi
  if [ "$v" = "$other" ]; then
    echo "$name は他方のポートと異なる値にしてください: $v" >&2; exit 1
  fi
  if python3 -I -c 'import socket,sys; s=socket.socket(); sys.exit(0 if s.connect_ex(("127.0.0.1",int(sys.argv[1]))) else 1)' "$v"; then
    echo "$name のポート $v は使用中です" >&2; exit 1
  fi
}

# 新しいプロセスグループで起動し、PID/PGID を記録する。引数: サービス名 作業dir コマンド...
# NODE_ENV は next dev を壊すので除外する。目印は環境変数で子孫にも引き継ぐ。
launch() {
  local svc=$1 dir=$2; shift 2
  (cd "$dir"; env -u NODE_ENV "$MARK" python3 -I -c \
    'import os, sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' "$@" \
    >>"$RUN_DIR/$svc.log" 2>&1 </dev/null & echo $! >"$(rec "$svc" pid)")
  sleep 0.3
  ps -o pgid= -p "$(cat "$(rec "$svc" pid)")" | tr -d ' ' >"$(rec "$svc" pgid)"
}

wait_http() { # wait_http <url> <秒>
  local i
  for ((i = 0; i < $2; i++)); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "$1" || true)" = 200 ] && return 0
    sleep 1
  done
  return 1
}

ports() { # 記録した設定から "backend frontend" を出す
  local b f
  b="$(sed -n 's/^  port: \([0-9]*\) # backend$/\1/p' "$CONFIG" 2>/dev/null)"
  f="$(sed -n 's/^  port: \([0-9]*\) # frontend$/\1/p' "$CONFIG" 2>/dev/null)"
  echo "$b $f"
}

cmd_start() {
  local svc rc
  for svc in backend frontend; do
    rc=0; verify "$svc" || rc=$?
    if [ "$rc" = 0 ]; then
      echo "$svc は既に起動しています。先に $0 stop を実行してください" >&2; exit 1
    elif [ "$rc" = 2 ]; then
      echo "$svc の記録が実プロセスと一致しません。$RUN_DIR を確認してください(kill はしません)" >&2; exit 1
    fi
  done
  if [ ! -d "$ROOT/backend/.venv" ]; then
    echo "backend/.venv がありません。先に (cd backend && uv sync) を実行してください" >&2; exit 1
  fi
  if [ ! -d "$ROOT/frontend/node_modules" ]; then
    echo "frontend/node_modules がありません。先に (cd frontend && npm install) を実行してください" >&2; exit 1
  fi

  local bport fport
  bport="${DEV_BACKEND_PORT:-}"
  if [ -n "$bport" ]; then check_port DEV_BACKEND_PORT "$bport" "${DEV_FRONTEND_PORT:-}"; else bport="$(pick_port)"; fi
  fport="${DEV_FRONTEND_PORT:-}"
  if [ -n "$fport" ]; then check_port DEV_FRONTEND_PORT "$fport" "$bport"; else fport="$(pick_port "$bport")"; fi

  local name; name="dev-$(basename "$ROOT" | tr -c 'A-Za-z0-9._-\n' '-')"
  mkdir -p "$RUN_DIR"
  cat >"$CONFIG" <<YAML
# scripts/dev-instance.sh start が毎回生成する動作確認用設定(編集しても上書きされる)
instance: '$name'

backend:
  port: $bport # backend

frontend:
  port: $fport # frontend

db:
  path: '$RUN_DIR/focara.db'

log:
  dir: '$RUN_DIR'
YAML

  # 運用 shell から継承した値を参照しないよう、必要なものだけ明示して渡す
  launch backend "$ROOT/backend" env -u LAN_IP -u TAILSCALE_IP FOCARA_CONFIG="$CONFIG" uv run python -m focara.main
  launch frontend "$ROOT/frontend" env -u FOCARA_CONFIG -u LAN_IP -u TAILSCALE_IP -u FRONTEND_ALLOWED_DEV_ORIGINS FRONTEND_HOST=127.0.0.1 \
    FRONTEND_PORT="$fport" BACKEND_URL="http://127.0.0.1:$bport" npm run dev

  local ok=1
  wait_http "http://127.0.0.1:$bport/api/health" 30 || { echo "警告: backend の /api/health が 200 を返しません" >&2; ok=0; }
  wait_http "http://127.0.0.1:$fport/" 60 || { echo "警告: frontend が HTTP 200 を返しません" >&2; ok=0; }
  if [ "$ok" = 1 ]; then echo "起動しました"; else echo "起動を確認できませんでした。ログを確認してください" >&2; fi
  echo "backend:  http://127.0.0.1:$bport"
  echo "frontend: http://127.0.0.1:$fport"
  echo "ログ: $RUN_DIR/{backend,frontend}.log"
  [ "$ok" = 1 ]
}

cmd_stop() {
  local svc rc pgid i failed=0
  for svc in frontend backend; do
    rc=0; verify "$svc" || rc=$?
    if [ "$rc" = 1 ]; then
      echo "$svc は起動していません"
      rm -f "$(rec "$svc" pid)" "$(rec "$svc" pgid)"
      continue
    elif [ "$rc" = 2 ]; then
      echo "$svc: 記録(PID/PGID/目印)が実プロセスと一致しないため停止しません" >&2
      failed=1; continue
    fi
    pgid="$(read_rec "$svc" pgid)"
    kill -TERM -- "-$pgid" 2>/dev/null || true
    for ((i = 0; i < 20; i++)); do
      kill -0 -- "-$pgid" 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 -- "-$pgid" 2>/dev/null; then
      kill -KILL -- "-$pgid" 2>/dev/null || true
    fi
    rm -f "$(rec "$svc" pid)" "$(rec "$svc" pgid)"
    echo "$svc を停止しました"
  done
  exit "$failed"
}

cmd_status() {
  local svc rc p b f
  read -r b f <<<"$(ports)"
  for svc in backend frontend; do
    rc=0; verify "$svc" || rc=$?
    p="$b"; [ "$svc" = frontend ] && p="$f"
    case "$rc" in
      0) echo "$svc: 起動中(pid $(read_rec "$svc" pid)) http://127.0.0.1:$p" ;;
      1) echo "$svc: 停止中" ;;
      *) echo "$svc: 記録が実プロセスと一致しません" ;;
    esac
  done
  echo "ログ: $RUN_DIR/{backend,frontend}.log"
}

[ $# -eq 1 ] || usage
case "$1" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  *) usage ;;
esac
