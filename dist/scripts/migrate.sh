#!/usr/bin/env bash
# 旧バージョンの展開先から、新バージョン(この展開先)へ利用者固有の状態を引き継ぐ。
#   cd <新展開先> && ./scripts/migrate.sh <旧展開先> [--with-logs] [--force]
# 引き継ぎ対象: config/config.yaml / DB(db.path) / .env / logs(--with-logs のみ)
# 新展開先に同名ファイルがあれば既定でスキップし、--force で <file>.bak-<timestamp> に退避して上書きする。
# 旧展開先は変更・削除しない。何度実行しても安全。
set -euo pipefail

NEW="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y%m%d%H%M%S)"

usage() { echo "使い方: $0 <旧展開先> [--with-logs] [--force]" >&2; exit 1; }
die() { echo "エラー: $*" >&2; exit 1; }
warn() { echo "警告: $*" >&2; }

OLD_ARG="" WITH_LOGS=0 FORCE=0
for a in "$@"; do
  case "$a" in
    --with-logs) WITH_LOGS=1 ;;
    --force) FORCE=1 ;;
    -*) usage ;;
    *) [ -z "$OLD_ARG" ] || usage; OLD_ARG="$a" ;;
  esac
done
[ -n "$OLD_ARG" ] || usage
[ -d "$OLD_ARG" ] || die "旧展開先が見つかりません: $OLD_ARG"
OLD="$(cd "$OLD_ARG" && pwd -P)"
NEW="$(cd "$NEW" && pwd -P)"
[ "$OLD" != "$NEW" ] || die "旧展開先と新展開先が同じです: $OLD"
[ -d "$OLD/backend" ] || die "旧展開先に backend/ がありません(Focara の展開先ではありません): $OLD"
command -v sqlite3 >/dev/null || die "sqlite3 が見つかりません"
command -v uv >/dev/null || die "uv が見つかりません"

# 新展開先に同名ファイルがあるか判定し、あれば(--force なら退避して)書き込み可否を返す。
# 戻り値 0=書き込んでよい / 1=スキップ
prepare_dest() {
  local dest=$1
  [ -e "$dest" ] || return 0
  if [ "$FORCE" = 1 ]; then
    mv "$dest" "$dest.bak-$STAMP"
    echo "  既存を退避: $dest.bak-$STAMP"
    return 0
  fi
  echo "  スキップ(既に存在します。上書きするには --force): $dest"
  return 1
}

py() { (cd "$NEW/backend" && uv run python -I "$@"); }

# 設定値(db.path / log.dir)を取り出す。相対パスは各展開先の backend/ 基準。
read_paths() { # read_paths <cfgfile or ""> -> "db_path<TAB>log_dir"
  if [ -n "$1" ]; then
    py -c '
import sys
from focara.config import load_config
c = load_config(sys.argv[1]); print(c.db.path); print(c.log.dir)' "$1"
  else
    py -c '
from focara.config import Config
c = Config(); print(c.db.path); print(c.log.dir)'
  fi
}
abs_under() { case "$2" in /*) echo "$2" ;; *) echo "$1/backend/$2" ;; esac; }

# ---- 事前確認(何も書き込む前に、旧DBのスキーマが新バージョンで扱えるか確認する) ----
OLD_CFG="$OLD/config/config.yaml"
NEW_CFG="$NEW/config/config.yaml"
OLD_PATHS="$(read_paths "$([ -f "$OLD_CFG" ] && echo "$OLD_CFG")")" || die "旧の config.yaml が新バージョンの設定として不正です(修正してから再実行してください): $OLD_CFG"
OLD_DB="$(abs_under "$OLD" "$(echo "$OLD_PATHS" | sed -n 1p)")"
STATE=none REV=""
if [ -f "$OLD_DB" ]; then
  REV="$(sqlite3 "file:$OLD_DB?mode=ro" "SELECT version_num FROM alembic_version" 2>/dev/null | head -n1 || true)"
  if [ -n "$REV" ]; then
    STATE="$(py -c '
import sys
from alembic.config import Config
from alembic.script import ScriptDirectory
from focara.db.migrate import MIGRATIONS_DIR
cfg = Config(); cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
sd = ScriptDirectory.from_config(cfg)
known = {r.revision for r in sd.walk_revisions()}
head = sd.get_current_head()
print("unknown" if sys.argv[1] not in known else ("same" if sys.argv[1] == head else "older"))
' "$REV")"
    [ "$STATE" != unknown ] || die "旧DBのスキーマ($REV)が新バージョンに対応していません(新しすぎる可能性があります)。旧より古いバージョンへの移行ではありませんか"
  fi
fi

# ---- config/config.yaml ----
echo "[config]"
if [ -f "$OLD_CFG" ]; then
  py -c '
import sys
from focara.config import ConfigError, load_config
try:
    load_config(sys.argv[1])
except ConfigError as e:
    print(e, file=sys.stderr); sys.exit(1)
' "$OLD_CFG" || die "旧の config.yaml が新バージョンの設定として不正です(修正してから再実行してください): $OLD_CFG"
  mkdir -p "$NEW/config"
  if prepare_dest "$NEW_CFG"; then
    cp "$OLD_CFG" "$NEW_CFG"
    echo "  コピーしました: $NEW_CFG"
  fi
  warn "instance / backend.port / frontend.port / db.path は旧バージョンと同じ値です。旧バージョンと並行稼働する場合は、$NEW_CFG でこれらを変更してください(自動では書き換えません)"
  # 設定キーの差分ヒント(example にあって config にない / config にあって example にない)
  if [ -f "$NEW/config/config.yaml.example" ]; then
    hint="$(py -c '
import sys, yaml
def keys(p, pre=""):
    d = yaml.safe_load(open(p, encoding="utf-8")) or {}
    out = set()
    def walk(x, pre):
        for k, v in x.items():
            out.add(pre + str(k))
            if isinstance(v, dict): walk(v, pre + str(k) + ".")
    walk(d, "")
    return out
cur, ex = keys(sys.argv[1]), keys(sys.argv[2])
for k in sorted(ex - cur): print(f"  + 新バージョンで追加された項目(未設定なら既定値): {k}")
for k in sorted(cur - ex): print(f"  - 新バージョンの example にない項目: {k}")
' "$OLD_CFG" "$NEW/config/config.yaml.example")" || hint=""
    [ -z "$hint" ] || { echo "  config.yaml.example との差分:"; echo "$hint"; }
  fi
else
  echo "  旧の config.yaml がないためスキップ: $OLD_CFG"
fi

OLD_LOG="$(abs_under "$OLD" "$(echo "$OLD_PATHS" | sed -n 2p)")"
NEW_PATHS="$(read_paths "$([ -f "$NEW_CFG" ] && echo "$NEW_CFG")")"
NEW_DB="$(abs_under "$NEW" "$(echo "$NEW_PATHS" | sed -n 1p)")"
NEW_LOG="$(abs_under "$NEW" "$(echo "$NEW_PATHS" | sed -n 2p)")"


# ---- DB ----
echo "[db]"
if [ -f "$OLD_DB" ]; then
  [ "$(cd "$(dirname "$OLD_DB")" && pwd -P)/$(basename "$OLD_DB")" != "$(mkdir -p "$(dirname "$NEW_DB")" && cd "$(dirname "$NEW_DB")" && pwd -P)/$(basename "$NEW_DB")" ] \
    || die "移行元と移行先のDBが同じファイルです(db.path が絶対パスのままの可能性があります): $NEW_DB"
  case "$STATE" in
    older) echo "  旧DBのスキーマ: $REV(新バージョン起動時に自動で最新へ更新されます)" ;;
    same) echo "  旧DBのスキーマ: $REV(最新です)" ;;
    none) warn "旧DBに alembic_version がありません。スキーマの確認をスキップします" ;;
  esac
  mkdir -p "$(dirname "$NEW_DB")"
  if prepare_dest "$NEW_DB"; then
    rm -f "$NEW_DB-wal" "$NEW_DB-shm"
    sqlite3 "file:$OLD_DB?mode=ro" ".backup '$NEW_DB'"
    echo "  コピーしました: $NEW_DB"
  fi
else
  echo "  旧のDBがないためスキップ: $OLD_DB"
fi

# ---- .env ----
echo "[.env]"
if [ -f "$OLD/.env" ]; then
  if prepare_dest "$NEW/.env"; then
    cp -p "$OLD/.env" "$NEW/.env"
    echo "  コピーしました: $NEW/.env"
  fi
  lan="$(grep -E '^[[:space:]]*(export[[:space:]]+)?LAN_IP=.+' "$OLD/.env" || true)"
  ts="$(grep -E '^[[:space:]]*(export[[:space:]]+)?TAILSCALE_IP=.+' "$OLD/.env" || true)"
  [ -z "$lan" ] || [ -z "$ts" ] || warn ".env で LAN_IP と TAILSCALE_IP が同時に指定されています。起動時エラーになるため、どちらか一方にしてください"
  echo "  LAN_IP / TAILSCALE_IP は環境(ネットワーク)依存です。移行後に値が現在の環境と合っているか確認してください"
else
  echo "  旧の .env がないためスキップ"
fi

# ---- logs ----
echo "[logs]"
if [ "$WITH_LOGS" = 1 ]; then
  if [ -d "$OLD_LOG" ]; then
    mkdir -p "$NEW_LOG"
    for f in "$OLD_LOG"/*; do
      [ -f "$f" ] || continue
      case "$f" in *.pid) continue ;; esac # PID ファイルは引き継がない
      if prepare_dest "$NEW_LOG/$(basename "$f")"; then cp "$f" "$NEW_LOG/"; fi
    done
    echo "  コピーしました: $NEW_LOG"
  else
    echo "  旧のログディレクトリがないためスキップ: $OLD_LOG"
  fi
else
  echo "  スキップ(--with-logs で引き継ぎます)"
fi

cat <<EOM

移行が完了しました。次の手順で切り替えてください。
  1. 旧バージョンを停止する:  cd "$OLD" && ./scripts/stop.sh
  2. 新バージョンを起動する:  cd "$NEW" && ./scripts/start.sh
     (起動時にDBのスキーマが最新へ更新されます)
  ※ 旧と新で instance が同じ、またはポート・DBが同じ場合は並行稼働できません。
  ※ launchd(常時起動)に旧バージョンを登録している場合は、旧サービスを uninstall してから新バージョンで再登録してください。instance が同じだと旧サービスを上書きします。
EOM
