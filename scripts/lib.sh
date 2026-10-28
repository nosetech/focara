# start.sh / stop.sh 共通。source して使う。
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
