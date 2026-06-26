---
title: Mermaid 動作確認
author: bricola
---

# Mermaid 動作確認

このファイルは Mermaid 描画（ADR-0012）と基本的な Markdown 表示の確認用。
プレビューで各図が SVG として表示されれば成功。**最後の節は意図的に壊した図**で、エラー表示（`.mermaid-error`）になれば成功。

## 1. フローチャート（subgraph 入り）

```mermaid
graph TD
  A[開始] --> B{設定あり?}
  B -- yes --> C[リポジトリ走査]
  B -- no --> D[作成を促す]
  C --> E[md 一覧]
  subgraph 描画
    E --> F[marked]
    F --> G[DOMPurify]
    G --> H[プレビュー]
  end
```

## 2. シーケンス図（foreignObject を含む / svg profile の確認）

```mermaid
sequenceDiagram
  participant U as ユーザ
  participant App as Bricola.md
  participant FS as File System Access
  U->>App: リポジトリを選択
  App->>FS: showDirectoryPicker()
  FS-->>App: rootHandle
  App->>FS: .bricola.yaml を読む
  App-->>U: md 一覧を表示
```

## 3. クラス図

```mermaid
classDiagram
  class Repository {
    +rootHandle
    +pick()
    +walk()
    +readConfigText()
  }
  class Config {
    +include
    +exclude
    +matches(path)
  }
  Repository --> Config : 設定を渡す
```

## 4. 状態遷移図

```mermaid
stateDiagram-v2
  [*] --> 閲覧
  閲覧 --> 編集 : 編集開始
  編集 --> 閲覧 : 編集終了
  編集 --> 保存 : 保存
  保存 --> 閲覧
  保存 --> [*]
```

## 5. ガントチャート

```mermaid
gantt
  title 実装スケジュール（例）
  dateFormat  YYYY-MM-DD
  section 設定
  config 読込   :done, a1, 2026-06-24, 2d
  Mermaid 対応  :active, a2, 2026-06-26, 1d
  section 仕上げ
  検証          :a3, after a2, 1d
```

## 6. 円グラフ

```mermaid
pie title 同梱ライブラリの比率（例）
  "mermaid" : 60
  "marked"  : 15
  "DOMPurify" : 10
  "js-yaml" : 8
  "turndown" : 7
```

## 通常 Markdown の確認

### テーブル（操作 UI / ADR-0007）

| 要素 | 対応 | 備考 |
|------|:----:|------|
| 見出し | ✅ | アウトラインに反映 |
| テーブル | ✅ | 行列操作 |
| コード | ✅ | 下記 |

### コードブロック（mermaid 以外はそのまま表示）

```js
Bricola.mermaid.enhance(el.preview); // ADR-0012
```

### リスト・引用・強調

- 箇条書き 1
- 箇条書き 2
  - ネスト
1. 番号付き
2. 番号付き

> 引用ブロック。**太字** と *斜体* と `インラインコード`。

## 7. 意図的に壊した図（エラー表示の確認）

> ここは**わざと**構文を壊しています。図ではなく赤いエラー枠が出れば正常。

```mermaid
graph TD
  A -->
```
