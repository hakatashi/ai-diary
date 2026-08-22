# AGENTS.md

このドキュメントは、ai-diaryプロジェクトで開発作業(AIエージェントによるものを含む)を行う際に常に踏まえておくべき最新情報をまとめたものです。**このファイルは毎回エージェントのコンテキストに自動的に読み込まれるため、内容は「開発中いつでも気をつけるべきこと」に絞り、簡潔に保ってください。** 個々の設計判断の背景・経緯・実接続で判明した細かい仕様は `docs/adr/` のADR(Architecture Decision Record)に記録し、このファイルからは要点1行+リンクのみを参照します。詳細が必要な作業(該当データソースの改修など)を行う際は、該当ADRを個別に読んでください。

## AGENTS.mdを肥大化させないためのルール

- **新しいアーキテクチャ上の決定・実接続で判明した仕様の詳細・トラブルシューティングの経緯は、このファイルに直接書き足さず `docs/adr/NNNN-slug.md` として追加すること。** テンプレートは `docs/adr/TEMPLATE.md`。番号は既存ファイルの最大値+1の連番。
- 追加したADRは、下記「アーキテクチャ決定(ADR)一覧」に1行(タイトルとリンクのみ)を追記する。
- このファイル自体に新しい章立てを増やす前に、それが「毎回のタスクで踏まえるべき現在進行形のルール」なのか、「過去の一回限りの決定の経緯」なのかを自問し、後者ならADRに書く。
- 手動セットアップ手順は `docs/manual-setup-checklist.md`、未実装・既知の制約は `docs/known-issues.md` に追記する(このファイルには書かない)。

## プロジェクトの目的

個人用ライフログWebアプリケーション。様々なデータソース(家計簿、位置情報、写真、カレンダー、Home Assistant、SNS等)から行動ログを収集・保管し、日毎の日誌として閲覧できるようにする。加えて、Gemini APIを使ったAIパートナー機能により、ライフログをもとにした雑談・振り返り・生活アドバイスを行う。

**唯一の利用者は `hakatasiloving@gmail.com` のGoogleアカウントを持つ本人のみ**。マルチテナント設計は不要で、全ての設計判断は「個人が安全に長期運用できること」を優先する。

## 開発方針: フェーズ分割

一度に全機能を実装せず、フェーズに分けて開発する。進捗はGitHub Project「[ai-diary 開発ロードマップ](https://github.com/users/hakatashi/projects/2)」のkanbanボードで管理する(フェーズ単位のカードのみ、個別タスクはカード化しない)。新しいフェーズに着手する際は、GitHub Projectに新しいフェーズカードを追加し、既存のフェーズと同様にステータスを更新すること。

- **フェーズ1(実装済み)**: 認証基盤 + Google Health API連携(運動記録) + 日誌基本機能
- **フェーズ2(実装済み)**: 追加データソース(Google Calendar, Google Maps Timeline, Swarm, Immich)+ カレンダービュー・一覧ビュー + データソース間の意味的重複の統合
- **フェーズ3**: 家計簿統合(Zaim API + Moneyforward CSVエクスポート)、重複排除・統合アルゴリズム、支出分析、手動ルールによる自動振り分け
- **フェーズ4**: AIパートナー機能(Gemini API連携、自動メッセージ生成、チャット、複数ペルソナ、長期記憶、Web Push配信)
- **フェーズ5**: 残りのデータソース(Home Assistant、SNS)、全体の仕上げ・拡張

将来フェーズで必要になる認証情報の一覧は `docs/known-issues.md` を参照。

## 技術スタック

- **フロントエンド**: SolidStart 1.x(`ssr: false`、静的SPAとしてビルド)、Tailwind CSS v4、TypeScript
- **バックエンド**: Firebase Functions(v2 API、`firebase-functions/https` 等のモジュラーインポート)
- **データベース**: Cloud Firestore
- **認証**: Firebase Authentication(Googleプロバイダのみ)
- **AI**: Gemini API(フェーズ4で導入予定、現時点では未使用)
- **Lint/Format**: Biome(ESLint/Prettierではない)
- **テスト**: Vitest + `@solidjs/testing-library` + Firestore/Auth/Functionsエミュレータ

Firebaseプロジェクト: `hakatadiary`(`.firebaserc` に設定済み)。

## アーキテクチャ決定(ADR)一覧

過去の設計判断はすべて `docs/adr/` に記録している。実装の経緯・トレードオフ・実接続で判明した仕様が必要な場合は該当ファイルを参照すること。

- [0001](docs/adr/0001-static-spa-client-side-auth-guard.md) — 認証: 静的SPA + クライアント側ガード(SSRは不採用)
- [0002](docs/adr/0002-secret-manager-vs-firestore-secrets.md) — 秘密情報: Secret Managerと`dataSourceSecrets`(Firestore)の使い分け
- [0003](docs/adr/0003-firestore-normalized-log-entries-schema.md) — Firestoreデータモデル: 正規化された`logEntries`スキーマ
- [0004](docs/adr/0004-callable-functions-centric-design.md) — Cloud Functions: Callable Functions中心設計
- [0005](docs/adr/0005-collection-doc-reuse-pattern.md) — `Collection.tsx`/`Doc.tsx` 再利用パターン
- [0006](docs/adr/0006-google-oauth-flow-factory.md) — Google OAuth連携の共通化(`createGoogleOAuthFlow`)、Swarm独自OAuth
- [0007](docs/adr/0007-google-maps-timeline-manual-import.md) — Google Maps Timelineの手動インポート設計
- [0008](docs/adr/0008-immich-photo-source.md) — 写真データソース: Immich(自己ホスト、APIキー認証)
- [0009](docs/adr/0009-journal-map-and-photos.md) — 日誌ページの地図(Leaflet)・写真表示
- [0010](docs/adr/0010-google-health-nutrition-sleep-weight.md) — Google Health連携の拡張(食事・睡眠・体重)
- [0011](docs/adr/0011-google-health-api-integration-details.md) — Google Health API連携の実装詳細(運動記録・GPSトラック)
- [0012](docs/adr/0012-playnite-game-session-ingest.md) — PlayniteからのPCゲームプレイ記録はpush型・専用ingestトークン認証で取り込む
- [0013](docs/adr/0013-zaim-moneyforward-finance-integration.md) — 家計簿統合: Zaim(OAuth 1.0a)+ Moneyforward(手動CSV)、重複統合・手動振り分けルール

## 開発中、常に守るべきルール

- 新しいデータソースの秘密情報は原則 `dataSourceSecrets/{dataSourceId}` に保存し、Secret Managerには追加しない(非秘匿情報は`defineString`。[ADR-0002](docs/adr/0002-secret-manager-vs-firestore-secrets.md))。
- `logEntries` を一覧表示するクエリは必ず `src/lib/logEntries.ts` の `visibleLogEntries`/`isVisible` で `hidden` フィルタを通すこと(Firestoreクエリの`!=`は使わない。[ADR-0003](docs/adr/0003-firestore-normalized-log-entries-schema.md))。
- 新しいCloud Functionsは `asia-northeast1` リージョンを明示指定する([ADR-0004](docs/adr/0004-callable-functions-centric-design.md))。
- 認証が必要なバックエンド処理はデフォルトで `onCall`(Callable Functions)にする。生ナビゲーションが必要なOAuthコールバック等のみ `onRequest` にする([ADR-0004](docs/adr/0004-callable-functions-centric-design.md))。
- 新しいFirestoreクエリ結果を表示する画面は `src/lib/Collection.tsx`/`Doc.tsx` を再利用する([ADR-0005](docs/adr/0005-collection-doc-reuse-pattern.md))。
- 新しいGoogle系データソースのOAuthは `functions/src/lib/googleOAuth.ts` の `createGoogleOAuthFlow` ファクトリの利用を検討する([ADR-0006](docs/adr/0006-google-oauth-flow-factory.md))。
- ユーザーがブラウザから直接入力する認証情報(APIキー等)は、専用のCallable Functionを用意してAdmin SDK経由で書き込む(クライアントから直接Firestoreに書き込ませない)。

## 開発コマンド

```
npm run dev            # SolidStart dev server + Firebaseエミュレータ + Functions watch buildを同時起動
npm run build           # 本番ビルド(.output/public)
npm run lint             # Biome lint --write
npm run format            # Biome format --write
npm test                  # Firebaseエミュレータ起動 + Vitest実行
npx firebase deploy       # 本番デプロイ(hosting + firestore rules/indexes + functions)
```

`functions/` 配下は独立したnpmパッケージ(`npm install` はルートの `postinstall` 的な `install` スクリプトで自動的に `functions/` でも実行される)。

## その他のドキュメント

- `docs/manual-setup-checklist.md` — コード化不可、ユーザー自身の作業が必要な手動セットアップ手順(データソース接続時に参照)
- `docs/known-issues.md` — 既知の制約・未実装事項・将来フェーズで必要になる認証情報
- `docs/adr/` — 個々のアーキテクチャ決定の詳細(背景・トレードオフ・実接続で判明した仕様)
- `docs/browser-debugging.md` — claude-in-chromeでのローカル動作確認手順・注意点(エミュレータ起動、ログイン、Callableのデバッグ方法等)
