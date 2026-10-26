# CONTRIBUTING

人とAIが同じルールで開発するための運用ルールです。

## ブランチ運用

| ブランチ | 役割 |
| --- | --- |
| `master` | リリース用。直接コミット・直接pushしない |
| `develop` | 開発の統合ブランチ。直接コミット・直接pushしない |
| `feature/*` | 作業ブランチ。`develop` から切り、PRで `develop` に取り込む |

- **`master` / `develop` には直接コミットしません。** 必ず `feature/*` ブランチからPRを経由します。
- 作業は最新の `develop` から `feature/<issue番号>-<概要>` を切って開始します(例: `feature/10-contributing-claude-md`)。
- PRのマージ先は `develop` です。

## PR作成ルール

- 1つのPRは1つのissueに対応させます。
- PR本文に、対応するissueを独立した行で `Closes #<issue番号>` と記載します(前後は空行で区切る)。
  - `Closes #10で対応` のように、issue番号の直後に日本語等を続けないでください(自動リンクが認識されません)。
- PRには変更内容と確認方法を簡潔に記載します。

## コミット規約

- コミットメッセージは変更内容が分かる簡潔な1行目(日本語可)から始めます。
- 1コミットは1つの論理的な変更にまとめます。
- 必要に応じて本文に背景・理由を記載します。

## 動作確認用インスタンス

画面・APIの動作確認は、運用インスタンスとは別に `scripts/dev-instance.sh` で起動します。

```sh
scripts/dev-instance.sh start   # backend / frontend を起動し、URLを表示
scripts/dev-instance.sh status  # 起動状態・URL・ログの場所
scripts/dev-instance.sh stop    # 起動したプロセスグループだけを停止
```

- 事前に `backend/` で `uv sync`、`frontend/` で `npm install` を済ませておきます。
- ポートは18000番台から空きを自動採番します。`DEV_BACKEND_PORT` / `DEV_FRONTEND_PORT` で指定もできますが、運用の既定ポート(8800 / 3800)と使用中のポートは拒否されます。
- 設定(`.dev-run/config.yaml`、毎回生成)・DB(`.dev-run/focara.db`)・ログ・PID記録はすべて worktree 直下の `.dev-run/`(`.gitignore` 対象)に置かれ、運用の `config/config.yaml` や `data/focara.db` は参照・変更しません。worktree ごとに独立しているため、複数worktreeで同時に起動できます。
- `stop` は `.dev-run/` に記録したPID/PGID/目印と一致するプロセスグループだけを止めます。不一致の場合は何も止めずにエラー終了します。`pkill` / `killall` やポート検索による kill は、運用や他worktreeのインスタンスを巻き込むため行わないでください。
- `NODE_ENV` は子プロセスに引き継ぎません(`NODE_ENV=production` の shell でも `next dev` が動作します)。
- 現状 Focara には Slack通知・AI呼び出し・launchdジョブなどの外部副作用がありません。今後追加する際は、動作確認用インスタンスでは無効化してください。
