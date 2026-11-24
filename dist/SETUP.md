# Focara セットアップ(配布版)

GitHub Releases の `focara-<version>.tar.gz` を展開した状態からのセットアップ手順です。対象OSは macOS です。
Focara は認証を持たないため、信頼できるネットワーク / tailnet 内でのみ使ってください。

## 前提

- Python 3.11+ と [uv](https://docs.astral.sh/uv/)
- Node.js 22+(frontend はビルド済みのため `npm` やビルドは不要)

## 1. 展開と依存の導入

```sh
shasum -a 256 -c focara-<version>.tar.gz.sha256   # 任意: 改ざん・破損の確認
tar xzf focara-<version>.tar.gz
cd focara-<version>
(cd backend && uv sync --frozen)
```

## 2. 設定

```sh
cp config/config.yaml.example config/config.yaml   # ポート・DB・ログの場所などを必要に応じて編集
cp .env.example .env                               # frontend の公開先IP(任意)
```

`.env` で指定できるのは frontend の公開先IPだけです(backend は常に `127.0.0.1`)。

| 変数 | 用途 |
| --- | --- |
| `LAN_IP` | 同一LAN内の別端末からアクセスする。自機のLAN IPを指定 |
| `TAILSCALE_IP` | 外出先から Tailscale 経由でアクセスする。`tailscale ip -4` のIPを指定 |

- 両方指定すると起動時エラーになります(どちらか一方だけ指定)。
- どちらも未指定なら `127.0.0.1`(ローカルのみ)で待ち受けます。`0.0.0.0` は使いません。

## 3. 起動・停止

```sh
scripts/start.sh   # backend と frontend をバックグラウンドで起動
scripts/stop.sh    # 停止
```

片方だけ操作する場合は `scripts/backend_start.sh` / `backend_stop.sh` / `frontend_start.sh` / `frontend_stop.sh` を使います(いずれもバックグラウンドで起動して即終了)。PID・ログは共通なので、一括と個別を混在させても `stop.sh` で止められます。個別の停止は、対象が起動していないと失敗終了します。

起動時にDBのスキーマが最新へ自動で更新されます。ログとPIDファイルは `config.yaml` の `log.dir`(既定 `backend/logs/`)に出力します。

## 4. 新バージョンへの更新(マイグレーション)

新バージョンを別ディレクトリに展開し(手順1)、旧バージョンから設定・DB・`.env` を引き継ぎます。

```sh
cd focara-<新version>
./scripts/migrate.sh <旧展開先> [--with-logs] [--force]
```

- 引き継ぎ対象: `config/config.yaml` / DB(`db.path`、`sqlite3 .backup` でコピー。旧バージョン稼働中でも可) / `.env` / `logs/`(`--with-logs` のみ)
- 新展開先に同名ファイルがあればスキップします。`--force` で `<file>.bak-<timestamp>` に退避して上書きします。何度実行しても安全です。
- 旧展開先は変更・削除しません。旧DBのスキーマが新バージョンより新しい場合は停止します。
- 旧バージョンと並行稼働する場合は、新側の `config/config.yaml` で `instance` / `backend.port` / `frontend.port` / `db.path` を変更してください。
- 移行後に、旧バージョンで `scripts/stop.sh`、新バージョンで `scripts/start.sh` を実行します。

## 5. 常時起動(任意)

ログイン時の自動起動とクラッシュ時の自動再起動を、launchd の LaunchAgent で設定できます。

```sh
scripts/service.sh install     # plist を生成して登録・起動(再実行で更新)
scripts/service.sh status      # 稼働状態
scripts/service.sh restart     # config.yaml / .env を読み直して plist を再生成し、再起動
scripts/service.sh stop        # 停止(次回ログイン時に再び起動)
scripts/service.sh uninstall   # 停止して登録を解除
```

- `install` は **ログイン項目を変更**します。内容を確認してから実行してください。
- `scripts/start.sh` とは併用できません。起動中は先に `scripts/stop.sh` を実行してください(登録中は `start.sh` が拒否します)。
- frontend の bind 先は `install` / `restart` 時の `.env`(`LAN_IP` / `TAILSCALE_IP`)で決まり、plist に埋め込まれます。
- `node` / `uv` のパス(nvm・volta 等のバージョン付きパス)は plist に埋め込まれます。更新・移動したら `restart` で作り直してください。
- 新バージョンに更新したら、新しい展開先で `install` し直します(旧展開先は先に `uninstall`。同じ `instance` だと登録名が同じです)。
