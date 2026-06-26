# 横長テーブル 動作確認

横に長いテーブルの表示挙動を確認する。プレビューで横スクロールできるか、列が潰れないか、長い語が溢れないかを見る。

## 1. 多列テーブル（15 列）

| ID | 氏名 | 部署 | 役職 | 入社年 | 都市 | 電話 | メール | プロジェクト | 状態 | 優先度 | 期限 | 進捗 | 担当 | 備考 |
|----|------|------|------|--------|------|------|--------|--------------|------|--------|------|------|------|------|
| 1 | 田中太郎 | 開発 | リード | 2018 | 東京 | 03-1111-2222 | tanaka@example.com | Bricola | 進行中 | 高 | 2026-07-01 | 60% | 佐藤 | 設定まわり |
| 2 | 鈴木花子 | 設計 | 主任 | 2020 | 大阪 | 06-3333-4444 | suzuki@example.com | Mermaid | レビュー | 中 | 2026-06-30 | 80% | 高橋 | 図描画 |
| 3 | 高橋一郎 | QA | 担当 | 2021 | 名古屋 | 052-5555-6666 | takahashi@example.com | 保存 | 未着手 | 低 | 2026-07-15 | 10% | 田中 | 競合検知 |
| 4 | 渡辺次郎 | 開発 | 担当 | 2022 | 福岡 | 092-7777-8888 | watanabe@example.com | 相対画像 | 完了 | 中 | 2026-06-20 | 100% | 鈴木 | Blob 解決 |

## 2. 長い非改行コンテンツを含むテーブル

| キー | 値（長い） | URL |
|------|------------|-----|
| token | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dummysignaturedummysignaturedummysignature` | https://example.com/very/long/path/that/does/not/break/easily/segment/another/segment/yet/another |
| path | /Users/hideki/development/Bricola.md/bricola-md/app/repository.js | https://github.com/watanabehideki/bricola-md/blob/main/app/repository.js |

## 3. 比較用：通常の狭いテーブル

| 要素 | 対応 |
|------|:----:|
| 見出し | ✅ |
| テーブル | ✅ |
| コード | ✅ |
