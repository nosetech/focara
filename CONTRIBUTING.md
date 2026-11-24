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
- 常時起動(`scripts/service.sh`、launchd)は運用インスタンス用です。動作確認では `install` しないでください(登録名は `instance` で決まるため、`instance` が同じ運用の登録を上書きします)。
- 現状 Focara には Slack通知・AI呼び出し・launchdジョブなどの外部副作用がありません。今後追加する際は、動作確認用インスタンスでは無効化してください。

## バージョン

- 画面に表示されるバージョンは `backend/pyproject.toml` の `version` が正です。リリース時はここを更新します(更新後に `uv sync` で反映)。
- `frontend/package.json` の `version` は表示に使わないため、触りません。
- 設定ファイルの `instance` は並行稼働の識別子で、バージョンとは別物です。

## リリース

リリースは次の手順で行います(自動アップデートはありません。配布物は GitHub Releases の tarball です)。

1. `/release-prepare <version>`(`.claude/skills/release-prepare`)で `release/v<version>` ブランチを作り、バージョン更新と変更点サマリのコミット、`master` 宛PRの作成までを行う。
   - **例外:** リリースPRは `develop` ではなく **`master` 宛**です(`feature/*` → `develop` の通常ルールとは異なる)。
2. 人間がPRをレビューして `master` にマージする(PR本文のサマリがコミット本文になる squash 推奨。この本文が Release のノートになる)。
3. 人間が `master` にタグを付けて push する: `git tag v<version> && git push origin v<version>`。`.github/workflows/release.yml` がバージョン一致検証・テスト・ビルドを行い、tarball と sha256 を Release に公開する。
4. `master` を `develop` にマージする。

### dist/ の管理

`dist/` は配布専用のファイルを置きます。開発用と共通実体のものは `dist/` に複製せず、release.yml が組み立て時にコピーします(二重管理しない)。

| 配布物のパス | 元 | 備考 |
| --- | --- | --- |
| `SETUP.md` | `dist/SETUP.md` | 配布専用 |
| `.env.example` | `dist/.env.example` | 配布専用 |
| `config/config.yaml.example` | `dist/config/config.yaml.example` | 開発用 `config/config.yaml.example` と項目は揃える(`backend/focara/config.py` の項目を変えたら両方更新) |
| `scripts/start.sh` | `dist/scripts/start.sh` | standalone(`node server.js`)で起動するため開発用と別実装。`.env` を読み込む |
| `scripts/migrate.sh` | `dist/scripts/migrate.sh` | 配布専用(テスト: `backend/tests/test_dist_migrate.py`) |
| `scripts/lib.sh` / `scripts/stop.sh` | `scripts/` | 共通実体をコピー |
| `backend/` | `backend/` | `tests` などを除いてコピー(利用者側で `uv sync --frozen`) |
| `frontend/` | `frontend/` のビルド | `output: "standalone"` の出力 + `.next/static` + `public/` |

`scripts/dev-instance.sh` / `service.sh` は同梱しません。`scripts/lib.sh` / `stop.sh`、設定項目、`start.sh` の挙動を変えたときは `dist/` への反映を確認してください(release-prepare スキルも確認します)。
