# CLAUDE.md

Focara(フォカラ)リポジトリでAIエージェントが従うガイドです。
ブランチ運用・PR・コミットの詳細は [CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

## 基本ルール

- `master` / `develop` に直接コミットしない。`develop` から `feature/*` を切り、PRで `develop` に取り込む。
- PR本文には対応issueを独立した行で `Closes #<issue番号>` と記載する。

## リポジトリの現状

- DB: SQLAlchemy + Alembic(`backend/focara/db/`)。マイグレーションは `migrations/versions/`、起動時に `upgrade_db()` で最新まで適用する。

## コマンド

- `scripts/start.sh` / `scripts/stop.sh`: backend と frontend をまとめて起動・停止(`LAN_IP` / `TAILSCALE_IP` のどちらか一方で frontend の bind 先を指定。未指定は `127.0.0.1`、両方指定はエラー。`0.0.0.0` は使わない)

- `scripts/dev-instance.sh start|stop|status`: 動作確認用インスタンス(運用と分離。ポートは18000番台から自動採番、設定・DB・ログ・PID記録は `.dev-run/`)。画面・APIの動作確認はこれで行う。`pkill` / `killall` / ポート検索による kill はしない(運用や他worktreeのインスタンスを巻き込むため)。

backend(`backend/` で実行。uv + Python 3.11+):

- `uv sync`: 依存関係のインストール
- `uv run python -m focara.main`: 起動(`127.0.0.1`、ポートは `config/config.yaml` の `backend.port`、既定 8800)
- `uv run ruff check . && uv run ruff format --check .`: lint
- `uv run pytest`: テスト

frontend(`frontend/` で実行。npm):

- `npm install`: 依存関係のインストール
- `npm run dev`: 開発サーバ(既定ポート 3800、`FRONTEND_PORT` で変更。`/api/*` は Route Handler が実行時に `BACKEND_URL`(既定 `http://127.0.0.1:8800`)へ中継。別端末からアクセスする場合は `FRONTEND_ALLOWED_DEV_ORIGINS` にホスト名をカンマ区切りで指定)
- `npm run lint`: ESLint
- `npm run format:check`: Prettier チェック(`npm run format` で整形)
- `npm run typecheck`: 型チェック(tsc)
- `npm run build`: ビルド
- `npm test`: テスト

## 画面デザインの実装ルール

画面デザインは Claude Design のプロジェクトを正とする。画面を実装する際は、必ず `DesignSync` でデザインのソースを取得し、それに合わせて実装する(スクリーンショットや推測で実装しない)。

- デザインURL: https://claude.ai/design/p/3bacbcce-0eaa-4dfc-a270-306fd1ff4e98
- `projectId`: `3bacbcce-0eaa-4dfc-a270-306fd1ff4e98`
- 取得手順: `DesignSync` の `list_files` でファイル一覧を取り、実装対象の画面のファイルを `get_file` で読む。
- 主なファイル(`.dc.html` がデザイン本体、`support.js` は共通スクリプト):
  - `Focara 実行画面.dc.html`: 実行画面(モバイル)。通常 / 1日の予定を終えた / 空 / 読み込み中 / エラー
  - `Focara タスク詳細・クイック追加.dc.html`、`TaskDetail.dc.html`、`QuickAdd.dc.html`: タスク詳細とinboxクイック追加
  - `Focara 整理画面.dc.html`: 整理画面(デスクトップ中心)
- 仕様(`docs/requirements.md`、`docs/design-prompt-ui.md`)とデザインに齟齬がある場合は、勝手にどちらかに寄せず、issueで確認する。
- デザイン内の配色トークン(`--bg` `--surface` `--ink` `--accent` 等)、書体(Zen Kaku Gothic New / IBM Plex Mono)、ライト・ダークの切替(`data-theme`)を踏襲する。
- 横スワイプで後回し・タップで詳細・FABでクイック追加といった操作と、各状態(空 / 読み込み中 / エラー)の表示を実装から落とさない。
