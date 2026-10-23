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
    "FRONTEND_HOST": c.frontend.host,
    "LOG_DIR": c.log.dir,
}.items():
    print(f"{k}={shlex.quote(str(v))}")
')" || exit 1
  # 相対パスは backend/ 基準(backend の db.path などと同じ)
  case "$LOG_DIR" in /*) ;; *) LOG_DIR="$ROOT/backend/$LOG_DIR" ;; esac
  PID_DIR="$LOG_DIR"
}

pid_file() { echo "$PID_DIR/focara.$INSTANCE.$1.pid"; }

is_running() {
  local f; f="$(pid_file "$1")"
  [ -f "$f" ] && kill -0 "$(cat "$f")" 2>/dev/null
}
