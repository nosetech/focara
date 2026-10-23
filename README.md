# Focara(フォカラ)

Focara(フォカラ)は、集中して作業に取り組むためのアプリです。

> このリポジトリは立ち上げ段階です。要件・仕様は順次 `docs/` 配下に整備します。

## 開発に参加する

ブランチ運用・PR作成ルール・コミット規約は [CONTRIBUTING.md](./CONTRIBUTING.md) を、
AIエージェント向けのガイドは [CLAUDE.md](./CLAUDE.md) を参照してください。

## 起動・停止

```sh
scripts/start.sh   # backend と frontend をバックグラウンドで起動(frontend は未ビルドなら build)
scripts/stop.sh    # 停止
```

設定は `config/config.yaml`(`config/config.yaml.example` をコピー)から読みます。ログと PID ファイルは `log.dir`(既定 `backend/logs/`)に出力します。

## LAN/Tailscaleからアクセスする

既定ではすべて `127.0.0.1` のみで待ち受けます。別端末から使うときは **frontend の bind 先だけ** を切り替えます(backend は常に `127.0.0.1` のままで、frontend の `/api/*` 中継経由でのみ到達します)。

1. `config/config.yaml` の `frontend.host` を設定します(`0.0.0.0`=LAN全体 / Tailscale のIP=tailnet内のみ、が目安です)。
2. `scripts/start.sh` で起動します。`frontend.host` の値が `FRONTEND_HOST` として frontend に渡されます。
3. 開発サーバで使う場合(`FOCARA_FRONTEND_MODE=dev scripts/start.sh`)は、別端末からのアクセス元ホスト名も `FRONTEND_ALLOWED_DEV_ORIGINS`(カンマ区切り)に指定します。
4. 別端末のブラウザで `http://<IPまたはホスト名>:3800` を開きます。

認証はありません。信頼できるネットワーク(自宅LAN・Tailscale)以外には公開しないでください。

## ライセンス

[LICENSE](./LICENSE) を参照してください。
