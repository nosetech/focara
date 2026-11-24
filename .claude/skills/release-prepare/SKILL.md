---
name: release-prepare
description: リリース準備(バージョン更新・変更点サマリのコミット・master宛リリースPR作成)を行う
disable-model-invocation: true
---

Focara のリリース準備を行ってください: 新バージョン `$ARGUMENTS`(例: `0.2.0`。先頭の `v` は付けない)

マージ・タグ付け・`master` → `develop` のマージは**行わない**(人間が行う)。`master` / `develop` に直接コミットしない。

1. **バージョンの確認**
   - `$ARGUMENTS` が `MAJOR.MINOR.PATCH` 形式で、`backend/pyproject.toml` の現在値より新しいことを確認する。違えば中止して報告する。
   - 作業ツリーがクリーンであることを確認する。

2. **ブランチの作成**
   - `git fetch origin` し、`origin/develop` から `release/v<version>` を切る。

3. **バージョンの更新**
   - `backend/pyproject.toml` の `version`、`frontend/package.json` の `version` を更新する。
   - `frontend/package-lock.json`(`npm install --package-lock-only --ignore-scripts` を `frontend/` で実行)と `backend/uv.lock`(`uv lock` を `backend/` で実行)のバージョンを追従させる。

4. **`dist/` の最新化確認**
   - CONTRIBUTING.md の「dist/ と開発用ファイルの対応」表に従い、前バージョンタグ(なければ初回)以降の `scripts/`・`config/config.yaml.example`・`backend/focara/config.py` 等の変更が `dist/` に反映されているか差分を確認する。`service.sh` と plist テンプレート(`dist/scripts/service.sh`、frontend/backend の `*.plist.example`)も対象で、release.yml の tarball 組み立て・必須ファイル検証に含まれているかも確認する。
   - 未反映なら同じコミットで修正する。判断に迷う差分は、修正せず人間に確認する。

5. **検証**
   - `backend/` で `uv run ruff check . && uv run ruff format --check . && uv run pytest`、`frontend/` で `npm run lint && npm run typecheck && npm test && npm run build` が通ることを確認する。

6. **変更点サマリのコミット**
   - 前バージョンタグ(なければ最初のコミット)から `origin/develop` までの変更を `git log` で確認し、日本語で要約する(機能追加 / 修正 / その他、PR番号付き)。
   - `v<version> リリース` を1行目、変更点サマリを本文にした**コミットを1つだけ**作る。この本文がそのまま GitHub Release のリリースノート(タグが指す `master` コミットの本文)になるため、PR本文にも同じサマリを載せ、`master` へのマージは「PR本文がコミット本文になる squash merge」を推奨する。

7. **`master` 宛PRの作成**
   - `git push -u origin release/v<version>` 後、`gh pr create --base master --head release/v<version>` でPRを作る。
   - PR本文: 変更点サマリ、`Closes #<issue番号>` の要否の確認事項(リリースPRは通常不要)、マージ後の手順:
     1. 人間がレビューして `master` にマージする
     2. `git checkout master && git pull && git tag v<version> && git push origin v<version>`(これで release.yml が起動する)
     3. Release の tarball を確認する
     4. `master` を `develop` にマージする(PR経由)
