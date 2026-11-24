# 起動・停止スクリプト共通。source して使う。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# config.yaml の値を読み込む(検証は backend の設定ローダーに任せる。不正なら失敗する)。
load_config() {
  eval "$(cd "$ROOT/backend" && uv run python -c '
import shlex
from focara.config import load_config
c = load_config()
for k, v in {
    "INSTANCE": c.instance,
    "BACKEND_PORT": c.backend.port,
    "FRONTEND_PORT": c.frontend.port,
    "LOG_DIR": c.log.dir,
}.items():
    print(f"{k}={shlex.quote(str(v))}")
')" || exit 1
  # 相対パスは backend/ 基準(backend の db.path などと同じ)
  case "$LOG_DIR" in /*) ;; *) LOG_DIR="$ROOT/backend/$LOG_DIR" ;; esac
  PID_DIR="$LOG_DIR"
}

# frontend の bind 先を TAILSCALE_IP / LAN_IP から決める(0.0.0.0 は使わない)。
# 両方指定はエラー、どちらも未指定なら 127.0.0.1(ローカルのみ)。
resolve_frontend_host() {
  local lan="${LAN_IP:-}" ts="${TAILSCALE_IP:-}"
  if [ -n "$lan" ] && [ -n "$ts" ]; then
    echo "LAN_IP と TAILSCALE_IP は同時に指定できません。どちらか一方だけを指定してください" >&2
    exit 1
  fi
  FRONTEND_HOST="${lan:-${ts:-127.0.0.1}}"
  if [ -n "$lan" ] || [ -n "$ts" ]; then FRONTEND_PUBLIC=1; else FRONTEND_PUBLIC=0; fi
}

pid_file() { echo "$PID_DIR/focara.$INSTANCE.$1.pid"; }

is_running() {
  local f; f="$(pid_file "$1")"
  [ -f "$f" ] && kill -0 "$(cat "$f")" 2>/dev/null
}

# launchd(常時起動)のラベルと登録状態。service.sh / start.sh 共通。
service_label() { echo "com.nosetech.focara.$INSTANCE.$1"; }
service_loaded() { launchctl print "gui/$(id -u)/$(service_label "$1")" >/dev/null 2>&1; }

# --- 起動・停止(backend_*.sh / frontend_*.sh / start.sh / stop.sh 共通) ---

# launchd 登録中だった場合に案内する対処(配布版は呼び出し側で上書きする)
LAUNCHD_HINT="${LAUNCHD_HINT:-scripts/service.sh stop か uninstall を実行してください}"

# 起動前のチェック: 対象サービスが launchd に登録されている、または起動中なら失敗する
guard_start() {
  local svc=$1
  if [ "$(uname)" = Darwin ] && service_loaded "$svc"; then
    echo "$svc は launchd(常時起動)に登録されています。$LAUNCHD_HINT" >&2
    exit 1
  fi
  if is_running "$svc"; then
    echo "$svc は既に起動しています(pid $(cat "$(pid_file "$svc")"))。先に scripts/stop.sh を実行してください" >&2
    exit 1
  fi
}

# FOCARA_FRONTEND_MODE(start | dev)を検証して MODE に入れる
resolve_frontend_mode() {
  MODE="${FOCARA_FRONTEND_MODE:-start}"
  case "$MODE" in start | dev) ;; *) echo "FOCARA_FRONTEND_MODE は start か dev を指定してください: $MODE" >&2; exit 1 ;; esac
}

# 開発用: start モードで未ビルドなら frontend をビルドする
ensure_frontend_build() {
  if [ "$MODE" = start ] && [ ! -f "$ROOT/frontend/.next/BUILD_ID" ]; then
    echo "frontend をビルドします"
    (cd "$ROOT/frontend" && npm run build)
  fi
}

# load_config 済みであること。backend をバックグラウンドで起動する。
start_backend() {
  guard_start backend
  mkdir -p "$LOG_DIR"
  # uv run は exec せず子プロセスとしてサーバーを起こすため、PID ファイルにはサーバー自身の PID が
  # 書かれるよう venv の python を直接起動する(service.sh の plist と同じ方式)。
  local py="$ROOT/backend/.venv/bin/python"
  if [ ! -x "$py" ]; then
    echo "backend/.venv がありません。backend で uv sync を実行してください" >&2
    exit 1
  fi
  # & はコマンド単体に掛ける(cd && ... のリストに掛けると $! が bash の PID になる)
  (
    cd "$ROOT/backend"
    nohup "$py" -m focara.main >>"$LOG_DIR/backend.log" 2>&1 &
    echo $! >"$(pid_file backend)"
  )
}

# npm / uv は子プロセスを起こすので、子孫を先に止めてから親を止める
kill_tree() {
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null || true
}

# サービスを停止する。起動していなければ 1 を返す(PIDファイルはどちらでも消す)。
stop_service() {
  local svc=$1 f rc=0
  f="$(pid_file "$svc")"
  if is_running "$svc"; then
    kill_tree "$(cat "$f")"
    echo "$svc を停止しました"
  else
    echo "$svc は起動していません"
    rc=1
  fi
  rm -f "$f"
  return "$rc"
}
