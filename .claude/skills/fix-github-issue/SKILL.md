---
name: fix-github-issue
description: github issueを対応する
disable-model-invocation: false
---

GitHub issueを分析して対応してください: issue番号 $ARGUMENTS

ブランチ運用・PR・コミットの詳細は CONTRIBUTING.md、基本ルールとコマンドは CLAUDE.md に従うこと。以下の手順で進めてください。

1. **Issue 詳細の取得**
   - `gh issue view <issue-number>` で issue 詳細を取得

2. **問題の理解**
   - Issue の説明、背景、要件を理解する

3. **関連ファイルの検索**
   - 実装に必要なファイルを特定する（backend: `backend/focara/`、frontend: `frontend/`）
   - DBスキーマに関わる場合は `backend/focara/db/` と Alembic マイグレーション（`migrations/versions/`）も対象になる
   - `docs/`（`docs/requirements.md`、`docs/design-prompt-ui.md` 等）に修正すべき箇所があるかも特定する

4. **UIに関わるissueの場合のデザイン確認**

- CLAUDE.md「画面デザインの実装ルール」に記載のArtifacts URLについて、まず `Artifact` ツールでデザインの実ソースを直接取得する（ブラウザ操作は不要）
  1. `action: "list"`、`scope: "files"` でファイル一覧を取る
  2. 実装対象の画面を `action: "read"`、`path: "project/<ファイル名>"` で読む（例: `project/Focara 実行画面.dc.html`、`project/Focara 整理画面.dc.html`、`project/HabitSheet.dc.html`、`project/TaskDetail.dc.html`、`project/QuickAdd.dc.html`）
  3. 対象コンポーネントのスタイル定義（配色トークン・余白・border-radius・アニメーション等）をそのまま読み取る。取得結果が途中で欠けていないか確認する
  - `artifact-type/` と `SKILL.md` は Artifact の仕組み側のファイルでデザインではないので読まない
- `Artifact` ツールが使えない場合（未ログイン・ツール無効等）はスクリーンショットや推測で代替せず、その旨を明記してその場で作業を停止し人間に確認を求める
- テキストの設計文書（`docs/design-prompt-ui.md` 等）にはレイアウトの要件のみが書かれており、色やアイコンの指定はデザインそのものにしかないことに注意する
- 仕様（`docs/requirements.md`、`docs/design-prompt-ui.md`）とデザインに齟齬がある場合は、勝手にどちらかに寄せず、issueで確認する
- **対象画面のデザインがまだ存在しない場合**（ファイル一覧で該当画面が見つからない等）、自分でレイアウトや配色を創作しない。`Artifact` ツールで既存デザインを直接編集することもしない（デザイン修正はClaudeのチャットから人間が指示して行う）
  - `docs/design-prompt-ui.md` と同じ形式で、チャットに貼る要件をまとめて人間に提示し、デザイン作成を依頼する
  - 既存のマスターファイルを上書きせず、作業ブランチ名を使った新規ファイル（例: `project/feature/issue-XX-xxx.dc.html`）としてデザインを作成するようチャット指示に明記する
  - 人間によるデザイン作成が完了したら（`Artifact` の `list` で新規ファイルの存在を確認）、そのファイルを `read` で取得して実装を進めてよい
  - マスターファイルへのマージは人間がArtifacts上でレビュー・承認した後に行う操作であり、本スキルの範囲では実施しない
- デザインの配色トークン（`--bg` `--surface` `--ink` `--accent` 等）、書体（Zen Kaku Gothic New / IBM Plex Mono）、ライト・ダークの切替（`data-theme`）を踏襲する
- 横スワイプで後回し・タップで詳細・FABでクイック追加といった操作と、各状態（空 / 読み込み中 / エラー）の表示を実装から落とさない

5. **コードの実装**
   - `develop` から `feature/*` ブランチを切って実装する（`master` / `develop` に直接コミットしない）
   - 実装後、変更した側のチェックを通す
     - backend（`backend/` で実行）: `uv run ruff check . && uv run ruff format --check .`、`uv run pytest`
     - frontend（`frontend/` で実行）: `npm run lint`、`npm run format:check`、`npm run typecheck`、`npm test`、必要に応じて `npm run build`
   - 画面・APIの動作確認は `scripts/dev-instance.sh start|stop|status` で起動する動作確認用インスタンスで行う。`pkill` / `killall` / ポート検索による kill はしない（運用や他worktreeのインスタンスを巻き込むため）。確認後は `scripts/dev-instance.sh stop` で停止する
   - UIに関わる場合は、動作確認用インスタンスの画面とArtifactsのデザイン（新規作成した場合は作業ブランチ名のファイル）を `mcp__claude-in-chrome__*` で見比べ、配色・アイコン等の細部が一致することを確認する

6. **プルリクエスト作成**
   - `develop` ブランチへのプルリクエストを作成する
   - PR の説明に対応issueを独立した行で `Closes #<issue番号>` と記載する
   - ステップ4で作業ブランチ名の新規デザインファイルを使った場合は、マスターファイルへのマージが未承認・未実施である旨をPR説明に明記する
   - **PR 作成完了をコンソールに表示する**

7. **CI 完了待機と確認**
   - GitHub Actions による CI が実行される
   - CI 完了を待つ（`gh pr view <PR-number> --json statusCheckRollup` で確認）。**CI実行中であること自体は人間の判断が必要な状況ではない。**
   - CI が失敗した場合は原因を調査して修正し、再度 push する

8. **コードレビュー実施**
   - `code-reviewer` エージェント(`.claude/agents/code-reviewer.md`)を Agent ツールで呼び出し、PR 番号を渡して実装コードの詳細レビューを実施させる
   - UIに関わる場合は、デザインに忠実に実装されているかのレビューも含まれる。ステップ4で作業ブランチ名の新規デザインファイルを使った場合は、そのパスもエージェントに伝える
   - 重大な問題、改善提案を含むレビュー結果を取得する
   - 「デザイン照合は未実施」と報告された場合は、原因(Artifact ツールが使えない等)を確認して人間に伝える

9. **レビュー結果をプルリクエストに投稿**
   - 取得したレビュー結果を、以下のコマンドでプルリクエストに投稿する：

   ```bash
   gh pr comment <PR-number> --body "レビュー結果のテキスト"
   ```

   - **コメント投稿完了まで、このステップは完了とはみなさない**
   - コメント投稿後、PR の URL をコンソールに表示する
