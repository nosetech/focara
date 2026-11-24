# 常時起動(launchd)

backend / frontend を、macOS の per-user LaunchAgent として登録し、ログイン時の自動起動とクラッシュ時の自動再起動を行います。

## 方式

- **LaunchAgent**(`~/Library/LaunchAgents/`)を使います。ユーザーがログインしている間だけ動きます(ログイン前から動かす LaunchDaemon は対象外)。
- ラベルは `com.nosetech.focara.<instance>.backend` / `.frontend`。`instance` は `config/config.yaml` の値です。
- plist は `scripts/com.nosetech.focara.{backend,frontend}.plist.example` から `service.sh` が生成します。`RunAtLoad` と `KeepAlive` が有効で、再起動ループは `ThrottleInterval`(10秒)で抑えます。
- launchd は前面のプロセスを監視するため、`nohup` / PID ファイルは使いません。backend は `backend/.venv/bin/python -m focara.main`、frontend は `node` で `next start` を直接起動します(`npm` を介さない)。
- `PATH` は install 時の `node` / `uv` の場所から組み立てます(launchd の既定 `PATH` では見つからないため)。
- ログは `start.sh` と同じ `log.dir` の `backend.log` / `frontend.log` です。

## 配布版との違い

配布版(`dist/`、GitHub Releases の tarball)にも `scripts/service.sh` が含まれます(`dist/scripts/service.sh`。手順は `dist/SETUP.md`)。開発用との違い:

- frontend はビルド済みの standalone 出力を `node frontend/server.js` で起動します(`PORT` / `HOSTNAME` / `BACKEND_URL` / `NODE_ENV=production` を plist に設定)。`npm` もビルドも不要で、`next` は使いません。
- `.env` の `LAN_IP` / `TAILSCALE_IP` を読み込みます(環境変数での指定は不要)。
- 前提チェックは `backend/.venv/bin/python`(`uv sync --frozen` 済み)・`frontend/server.js`・`node` の存在です。
- backend の plist テンプレートは開発用と共通です。`render` コマンドは plist を生成するだけで登録しません(確認・テスト用)。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `install` | frontend が未ビルドなら build し、plist を生成して登録・起動(再実行で更新) |
| `uninstall` | 停止し、登録を解除して plist を削除 |
| `start` | 登録済みサービスを起動 |
| `stop` | 停止。plist は残るので次回ログイン時に再び起動する。恒久的に止めるなら `uninstall` |
| `restart` | 設定を読み直して plist を再生成し、再起動 |
| `status` | 登録・稼働状態とログの場所を表示 |

## 設定の反映

設定は YAML 編集と再起動で反映します。`config.yaml` を編集したら `scripts/service.sh restart` を実行してください。frontend の bind 先は `install` / `restart` 時の環境変数 `LAN_IP` / `TAILSCALE_IP`(どちらか一方。未指定は `127.0.0.1`)で決まり、plist に埋め込まれます。

```sh
LAN_IP=192.168.10.101 scripts/service.sh restart
```

**更新時の注意**: `restart` は frontend を再ビルドしません(`frontend/.next/BUILD_ID` がなければ build するだけ)。`git pull` などでコードを更新したら、`frontend/` で `npm run build` をしてから `restart` してください。また `node` / `uv` の場所(nvm・volta 等のバージョン付きパス)は install 時に plist へ埋め込まれるため、更新・移動したら `restart` で作り直してください。パスが無効なままだと launchd が再起動を繰り返します。

`/api/*` の中継先 `BACKEND_URL` は frontend が実行時に読むため、`backend.port` を変えても再ビルドは不要です。frontend のコードを更新したときは `npm run build` をしてから `restart` してください。

## 複数 instance

`config.yaml` の `instance`(と、ポート・`db.path`・`log.dir`)を変えた別の展開先では、ラベルが異なるので並行して登録できます。設定ファイルは `FOCARA_CONFIG`(絶対パス推奨)で切り替えられます。

## 二重起動の防止

- `start.sh` と個別の `backend_start.sh` / `frontend_start.sh` は、対象のサービスが launchd に登録(起動)されていると、メッセージを出して止まります(併用不可)。
- `service.sh install` / `start` / `restart` は、`start.sh` や個別の起動スクリプトで起動中のプロセスがあると止まります。

## ログ

stdout / stderr は `log.dir` の `backend.log` / `frontend.log` に追記し続け、ローテーションはしません。大きくなったら手動で整理してください。

## スリープ

Mac がスリープすると、LAN/Tailscale 上の他端末(スマホの PWA 等)から使えません。必要なら省エネ設定や `caffeinate` で対処してください(本機能の対象外)。

## 動作確認(手動)

1. `install` 後にログアウト・ログインし、手動操作なしで画面と API が使える。
2. 稼働中の PID(`status` で確認)を指定して `kill <PID>` すると、自動で再起動する(`pkill` / `killall` は使わない)。
3. `uninstall` で完全に止まり、plist が消える。
