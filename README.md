# Focara(フォカラ)

Focara(フォカラ)は、集中して作業に取り組むためのアプリです。

> このリポジトリは立ち上げ段階です。要件・仕様は順次 `docs/` 配下に整備します。

## 開発に参加する

ブランチ運用・PR作成ルール・コミット規約は [CONTRIBUTING.md](./CONTRIBUTING.md) を、
AIエージェント向けのガイドは [CLAUDE.md](./CLAUDE.md) を参照してください。

## 配布版(GitHub Releases)

利用者向けの tarball は GitHub Releases で配布します。セットアップ・更新手順は tarball 内の `SETUP.md`(ソースでは [dist/SETUP.md](./dist/SETUP.md))を参照してください。

## 起動・停止

```sh
scripts/start.sh   # backend と frontend をバックグラウンドで起動(frontend は未ビルドなら build)
scripts/stop.sh    # 停止
```

設定は `config/config.yaml`(`config/config.yaml.example` をコピー)から読みます。ログと PID ファイルは `log.dir`(既定 `backend/logs/`)に出力します。

## 常時起動(macOS / launchd)

Mac へのログイン時に自動で起動し、落ちても自動で再起動させるには、launchd の LaunchAgent に登録します。

```sh
scripts/service.sh install    # 登録して起動(再実行で更新)
scripts/service.sh status     # 状態
scripts/service.sh restart    # config.yaml / LAN_IP / TAILSCALE_IP を読み直して再起動
scripts/service.sh stop       # 停止(次回ログイン時に再び起動)
scripts/service.sh uninstall  # 登録解除(plist も削除)
```

事前に `backend/` で `uv sync`、`frontend/` で `npm install` を済ませてください。`scripts/start.sh` との併用はできません(二重起動を防ぐため、どちらかが動いていると他方は止まります)。詳細は [docs/service.md](./docs/service.md) を参照してください。

## LAN/Tailscaleからアクセスする

既定ではすべて `127.0.0.1` のみで待ち受けます。別端末から使うときは **frontend の bind 先だけ** を切り替えます(backend は常に `127.0.0.1` のままで、frontend の `/api/*` 中継経由でのみ到達します)。

1. 環境変数 `LAN_IP`(LANのIP)か `TAILSCALE_IP`(TailscaleのIP)の**どちらか一方**を指定して `scripts/start.sh` を起動します(例: `LAN_IP=192.168.10.101 scripts/start.sh`)。そのIPにのみ bind し、`0.0.0.0` では待ち受けません。両方指定するとエラーで起動しません。どちらも未指定なら `127.0.0.1` のみです。
2. `/api/*` は frontend の Route Handler が実行時に `BACKEND_URL`(`scripts/start.sh` が `backend.port` から設定)へ中継するため、`backend.port` を変えてもビルドし直す必要はありません。
3. 開発サーバで使う場合(`FOCARA_FRONTEND_MODE=dev scripts/start.sh`)は、bind 先のIPが `FRONTEND_ALLOWED_DEV_ORIGINS` の既定値になります。ホスト名など他の許可元が必要なら、カンマ区切りで明示してください。
4. 別端末のブラウザで `http://<IPまたはホスト名>:3800` を開きます。

認証はありません。信頼できるネットワーク(自宅LAN・Tailscale)以外には公開しないでください。

## ライセンス

[LICENSE](./LICENSE) を参照してください。
