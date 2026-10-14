# CLAUDE.md

Focara(フォカラ)リポジトリでAIエージェントが従うガイドです。
ブランチ運用・PR・コミットの詳細は [CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

## 基本ルール

- `master` / `develop` に直接コミットしない。`develop` から `feature/*` を切り、PRで `develop` に取り込む。
- PR本文には対応issueを独立した行で `Closes #<issue番号>` と記載する。

## リポジトリの現状

(後続issueで追記)

## コマンド

backend(`backend/` で実行。uv + Python 3.11+):

- `uv sync`: 依存関係のインストール
- `uv run python -m focara.main`: 起動(`127.0.0.1`、ポートは `config/config.yaml` の `backend.port`、既定 8800)
- `uv run ruff check . && uv run ruff format --check .`: lint
- `uv run pytest`: テスト

frontend(`frontend/` で実行。npm):

- `npm install`: 依存関係のインストール
- `npm run dev`: 開発サーバ(既定ポート 3800、`FRONTEND_PORT` で変更。`/api/*` は `BACKEND_URL`(既定 `http://127.0.0.1:8800`)へ中継)
- `npm run lint`: ESLint
- `npm run format:check`: Prettier チェック(`npm run format` で整形)
- `npm run typecheck`: 型チェック(tsc)
- `npm run build`: ビルド
- `npm test`: テスト

## 画面デザインの実装ルール

(後続issueで追記)
