# Focara アーキテクチャ・技術選定

[requirements.md](./requirements.md) の確定事項を前提に、フェーズ0で確定した実装技術と方針を記録する。構成は同じ作者の deep-tracker を基本とし、AI実行方式は producer-desk の実装を調査して決めた。

## 1. 技術選定一覧

| 領域 | 採用 | 備考 |
|---|---|---|
| DB | SQLite（WALモード） | マイグレーションは Alembic |
| DBアクセス | SQLAlchemy 2.x（同期API） | Alembic と同一のモデル定義を使う |
| Webフレームワーク | FastAPI + uvicorn | |
| Python | 3.11 以上 | deep-tracker・producer-desk と同じ |
| Pythonパッケージ管理 | uv + `pyproject.toml`（`uv.lock` をコミット） | lint/format は ruff、テストは pytest |
| フロント | Next.js（App Router）/ TypeScript | |
| フロントのパッケージ管理 | npm（`package-lock.json` をコミット） | |
| frontend ⇔ backend | Next.js の `rewrites` で `/api/*` をバックエンドへ中継 | |
| モバイル対応 | PWA（ホーム画面追加、スワイプ操作） | ネイティブアプリは作らない |
| AI実行 | `AIProvider` 抽象化 + Claude Code CLI（`claude -p`） | Codex・APIは将来拡張 |

## 2. 選定理由

### 2-1. DB: SQLite

- 利用者は1名で、データ量はタスク・日記ログ程度（年間数千〜数万行）。SQLite で性能上の問題はない。
- サーバプロセスが不要で、ローカルPC・launchd 運用と相性が良い。DBファイル単体のコピーでバックアップでき、バージョン別のDB分離（3章）も容易。
- 書き込みはAPIと将来のAIジョブ・MCPサーバーの複数プロセスから並行しうるため、WALモードと `busy_timeout` を有効にする。
- スキーマ変更は Alembic で管理する。SQLite の `ALTER TABLE` 制約には batch mode（`render_as_batch=True`）で対応する。
- 将来 PostgreSQL 等へ移す場合に備え、SQLAlchemy を介して SQLite 固有機能への依存を最小限にする。

### 2-2. Webフレームワーク: FastAPI

- 型ヒントからリクエスト/レスポンス検証と OpenAPI を自動生成でき、TypeScript 側の型生成にも使える。
- API サーバは同期の SQLAlchemy を使うため、エンドポイントは基本的に `def`（スレッドプール実行）で書く。
- `claude -p` 呼び出しなどの長時間処理は、APIリクエスト内で完結させずジョブとして切り出す（Phase 4。4章）。

### 2-3. Python / パッケージ管理

- Python 3.11 以上。deep-tracker・producer-desk と揃え、実装の流用をしやすくする。
- uv: ロックファイルによる再現性と高速な環境構築が得られる。lint/format は ruff、テストは pytest。
- Next.js は npm。追加のツール導入が不要で、macOS 環境に既にある。pnpm は導入しない。

### 2-4. frontend と backend の通信

- ブラウザは常に Next.js のオリジンへ `/api/*` でアクセスし、Route Handler（`frontend/app/api/[...path]/route.ts`）がバックエンドへ中継する。同一オリジンになるため CORS 設定が不要になる。
- 中継先は環境変数 `BACKEND_URL`（既定 `http://127.0.0.1:<backend_port>`）で指定する。ビルド時に固定される `rewrites` ではなく実行時に読むため、`backend.port` を変えてもビルドし直し不要。バックエンド停止時は 502 を返す。SSE 等のストリーミング応答は使っていない。
- LAN / Tailscale 公開時もブラウザが到達するのは Next.js のポートのみでよく、バックエンドは常に `127.0.0.1` に bind したままにできる。frontend の bind 先は環境変数 `LAN_IP` / `TAILSCALE_IP` のどちらか一方で指定する（両方指定はエラー、未指定は `127.0.0.1`。`0.0.0.0` は使わない）。公開範囲は要件どおり LAN / Tailscale のみで、インターネットには公開しない。

### 2-5. モバイル対応: PWA

- モバイルは新規タスク作成・タスク実行が主用途のため、ホーム画面に追加してアプリのように起動できる PWA とする（Phase 2 で実装）。
- タスクの後回し（横スワイプ）などはタッチ操作を前提としたUIで実装し、ネイティブアプリは作らない。
- Service Worker によるオフライン動作は必須としない。まずは manifest によるホーム画面追加と全画面表示を対象とする。
- Tailscale 経由のアクセスなど、PWAのインストールに必要な HTTPS 要件は公開方式（Phase 2「LAN/Tailscale公開」）で別途確認する。
  - Android/Chrome は HTTPS（または localhost）でないと Service Worker が登録されず、インストール（アプリとして追加）できない。`http://<LANのIP>:3800` では「ホーム画面に追加」がアドレスバー付きのショートカットになる。iOS/Safari は HTTP でも追加できる。Tailscale の HTTPS（`tailscale serve --bg 3800` → `https://<host>.<tailnet>.ts.net`）経由でアクセスする。
  - `npm run dev` に LAN/Tailscale の別端末からアクセスする場合は、環境変数 `FRONTEND_ALLOWED_DEV_ORIGINS`（ホスト名をカンマ区切り。例: `192.168.10.101,host.tailnet.ts.net`）を指定する（`scripts/start.sh` は bind 先のIPを既定にする）。未指定だと `/_next/*` が403になり、JSが動かずテーマ切替などが効かない。

### 2-6. 画面デザインの運用

- 画面デザインは Claude Design で作成したものを**正**とし、実装はこれを忠実に再現する。レイアウト・配色・コンポーネント構成・インタラクションを独自解釈で変更しない。
- 正となるデザインのURLと取得手順は `CLAUDE.md` の「画面デザインの実装ルール」に記載する（デザイン作成後に追記）。
- デザインと `docs/` の仕様に齟齬がある場合は、実装前にどちらを正とするかを確認する。
- ライト/ダークの両テーマを切り替えられるようにする（requirements.md 3章）。

## 3. ポート・DBパス・複数バージョン並行稼働

バージョンごとに展開先ディレクトリを分け、設定ファイルも各展開先に同梱する。バージョン間で衝突する資源は、すべて設定ファイルの値から導出する。

| 資源 | 方針 |
|---|---|
| ポート | `backend.port` と `frontend.port` を設定ファイルで別々に持つ。既定は backend **8800** / frontend **3800**。並行稼働時はバージョンごとに +10 ずつずらす（8810 / 3810）。他プロジェクト（deep-tracker は 8700 / 3700、ほか 3000・4000・8787 など）と衝突しない値を選んだ |
| DBパス | `db.path` で指定する。既定は展開先配下の `data/focara.db`。展開先ごとに別ファイルになる |
| 待ち受けアドレス | 既定は `127.0.0.1`。LAN/Tailscale公開は設定で有効化し、適用するのは frontend のみ |
| launchdジョブ名 | `com.nosetech.focara.<instance>.<job>`（`<job>` は `backend` / `frontend` など）。`instance` は設定ファイルで指定する |
| ログ | 展開先配下の `logs/` に出力する |
| 1日の終了時刻 | `ui.day_end_hour`（0〜23、既定 22）で指定する。この時刻以降、未完了が残っていると実行画面が「1日の予定を終えた」画面に切り替わる。frontend は `GET /api/config` で取得する |

- 設定は YAML ファイル（`config/config.yaml.example` をコミット、実ファイル `config.yaml` は `.gitignore`）で行い、反映はアプリの再起動とする。
- 同じ DB ファイルを複数バージョンが同時に開かない。スキーマの異なるバージョンが同一DBを触るとマイグレーションが衝突するため、DBパスは必ずバージョンごとに分ける。
- ポートが使用中の場合は起動時にエラーで終了し、自動で別ポートへ退避しない。

### 想定ディレクトリ構成

```
backend/
  pyproject.toml
  uv.lock
  alembic.ini
  migrations/     # Alembic（env.py / versions/）
  focara/         # api / db / ai / mcp / config
  tests/
frontend/
  package.json
  package-lock.json
  next.config.ts  # rewrites
config/
  config.yaml.example
docs/
```

## 4. AI実行方式の方針

producer-desk の `orchestrator/orchestrator/agent_runner.py` の実装を調査し、以下を踏襲または調整する。

### 4-1. producer-desk の実行方式（調査結果）

| 項目 | producer-desk の実装 |
|---|---|
| 起動 | `subprocess.Popen` で `claude -p <message>` をワンショット実行する（常駐させない） |
| 出力 | `--output-format stream-json --verbose`。NDJSON（1行1JSON）を逐次読み、最後の `"type":"result"` イベントから結果（`result`・`is_error`・`api_error_status` など）を取り出す。JSONでない行（stderr混在）はスキップする |
| セッション | 新規は `--session-id <uuid>`、継続は `--resume <uuid>`。session_id は issue 単位で JSON ファイルに永続化し、会話量・ターン数が閾値を超えたらリセットする |
| 作業ディレクトリ | worktree のパスを subprocess の `cwd` に渡す |
| 権限 | `--dangerously-skip-permissions`（非対話のため）。システムプロンプトは `--append-system-prompt` で追加する |
| 環境変数 | 親プロセスの環境変数から不要なキーを除去し、必要なものだけ上書きして子プロセスに渡す |
| ログ | 実行ごとにログファイル（`logs/<repo>/<timestamp>.log`）へ出力を逐次追記し、保持日数を超えた古いログを削除する |
| 失敗時 | 終了コードと `result` の `is_error` / 上限到達（429等）を判定し、ログのパスとともに通知する |

### 4-2. Focara の方針

- AI呼び出しは `AIProvider` インターフェースの裏に置く。呼び出し側（タスク割り当て提案・MCP経由のタスク登録・スキル実行）は、プロバイダ固有のコマンドや出力形式を知らない。当面の実装は `ClaudeCodeProvider`（`claude -p`）のみで、Codex・APIは同じインターフェースの別実装として追加する。
- `ClaudeCodeProvider` の実行方式は producer-desk に合わせる。
  - **ワンショット実行**: リクエストごとに `claude -p` をサブプロセスとして起動し、常駐させない。サブスクリプションプランの Claude Code CLI を利用し、APIキーは使わない。
  - **出力**: `--output-format stream-json --verbose` の最終 `result` イベントを結果とする。
  - **セッション**: 既定は毎回新規セッション（`--session-id`）。分析など文脈を継続したい用途（スキル実行）のみ、呼び出し側が session_id を保持して `--resume` で再開する。
  - **作業ディレクトリ**: タスク管理用途ではコードリポジトリを触らないため、専用の作業ディレクトリ（設定 `ai.workdir`）を `cwd` に指定する。スキル・プロンプトはここに置く。
  - **権限**: 非対話のため権限確認ができない。producer-desk のように `--dangerously-skip-permissions` を常用せず、利用するツールを `--allowedTools` で最小限に限定することを基本とする。MCPサーバー（Phase 5）経由のタスク登録に必要なツールのみ許可する。
  - **ログ**: 実行ごとにログファイルを `logs/ai/` に出力し、保持日数を設定で変更できるようにする。
- 実行はAPIリクエスト内で完結させず、`ai_jobs` 相当のジョブとして記録し、状態（pending / running / succeeded / failed）と結果・エラーを残す。結果はジョブから取得する。
- Claude Code の利用上限はアプリ側で設けない。上限到達（429等）や異常終了は、ジョブを `failed` にしてエラー内容を返す。
- 同時実行数は設定で制限する（既定1）。サブスクリプションの利用枠を意図せず消費しないようにするため。
- フェーズ計画上、AI基盤の実装は Phase 4 で行う。MVP（Phase 0〜3）では `AIProvider` のインターフェース定義の要否も含め、実装しない。
