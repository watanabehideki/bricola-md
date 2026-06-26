# Bricola.md

ブラウザだけで動く、オフライン・単一フォルダ配布の Markdown ビューア／エディタ。サーバ不要。`index.html` を `file://` で開き、[File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_API) で選んだフォルダ（リポジトリ）内の Markdown を一覧・閲覧・編集・保存する。

## 特徴

- **サーバ不要・オフライン** — 依存ライブラリを同梱。`index.html` をダブルクリック（`file://`）で起動。
- **リポジトリ選択** — 起動後にフォルダを選ぶ。アプリ（`bricola-md/`）の置き場所は対象リポジトリと独立でよい。
- **glob で対象指定** — リポジトリ直下の `.bricola.yaml`（`include`/`exclude`）で表示する md を選ぶ。
- **閲覧と編集** — ソース／プレビューの 2 モード。プレビューは marked + DOMPurify。
- **安全な保存** — 最小差分・原形保持（改行や frontmatter を温存）。保存・再読込時に競合をガード。
- **相対画像** — md からの相対パス画像を FSA 経由で Blob URL として解決。
- **差し込み** — サイドバーのファイルを D&D で本文の指定位置に実体貼付（コピー）。
- **アウトライン表示・テーブル編集**。

## 使い方

1. `bricola-md/` を任意の場所に置く。
2. `index.html` をブラウザで開く（`file://` 可。File System Access API 対応の Chromium 系ブラウザが必要）。
3. 「リポジトリを選択」で、Markdown を含むフォルダを選ぶ。
4. そのフォルダ**直下**に `.bricola.yaml` を置く（下記）。マッチした md がサイドバーに並ぶ。
5. 閲覧・編集し、保存する。

## 設定（`.bricola.yaml`）

選択したリポジトリの**直下**に置く。`include` で集め、`exclude` で差し引く（glob）。

```yaml
include:
  - "docs/**/*.md"
  - "*.md"
exclude:
  - "**/node_modules/**"
```

リポジトリ内に置くのは、`file://` ではブラウザが隣接ファイルを `fetch` できず、選択フォルダの FSA ハンドル経由でのみ設定を読めるため。アプリ側に設定を置く構成は `file://` では成立しない。

## 制約

- File System Access API 対応ブラウザが必要（Chromium 系）。`file://` でも動作する。
- v1 は既存 md の**閲覧・編集・保存のみ**。新規作成・削除・リネームは行わない。
- 表示はファイルパス順。表示名の上書きや並び替えは未対応。

## 構成

```
bricola-md/
  index.html      エントリ。同梱ライブラリと app/*.js を classic script で読み込む
  app/            アプリ本体（Bricola 名前空間の classic script 群）
  styles/         スタイル
  vendor/         同梱ライブラリ（marked / DOMPurify / js-yaml / turndown）
  .bricola.yaml   設定の例（実運用では選択するリポジトリ側に置く）
```
