# アプリアイコン デザインプロンプト(Claude Design 用)

Focara(フォカラ)のアプリアイコン・favicon を Claude Design で作成した際の指示と、採用結果の記録です。デザインは [CLAUDE.md](../CLAUDE.md) の Claude Design プロジェクト内「Focara アイコン案.dc.html」にあります。

## プロンプト

```
Focara(フォカラ)のアプリアイコンと favicon の案を作ってください。

- コンセプト: 「集中(focus)」と、1日を3枠で見通す実行画面の雰囲気を連想させるシンボル。
- 16px・24px でも潰れないシンプルな形にする。
- ライト/ダーク両テーマで視認できること。
- favicon 用の小サイズでも識別できること。
- PWAのマスカブル用に余白を確保できること。
- 配色は既存のデザイントークン(--ink / --accent 等)に合わせる。
- 160 / 64 / 32 / 16px と、ブラウザタブでの見え方を並べて提示する。
```

## 採用案

案 1b「F と点」。頭文字 F の中の横棒を点に置き換えたモノグラム。

- ライト: 紙色(白)の地にインク色(`#1a1a18`)の F、点は `--accent`(`oklch(0.5 0.08 195)` = `#157171`)。
- ダーク: 墨色(`#1c1c1b`)の地に明るい F(`#edece7`)、点は `oklch(0.76 0.07 195)`(`#7abfbf`)。

## アセット

- `frontend/app/icon.svg`: マスター。`prefers-color-scheme` でライト/ダークを切り替える。
- `frontend/app/favicon.ico`: ライト配色(16/32/48px)。
- `frontend/public/icons/`: `icon-192.png` / `icon-512.png` / `apple-touch-icon.png`(ライト配色・全面塗り)、`icon-maskable-512.png`(F と点を 80% に縮小して余白を確保)。
- 画面ロゴ: `frontend/components/BrandLogo.tsx`(CSS変数でテーマ追従)。
