# AGENTS.md

このドキュメントは、ai-diaryプロジェクトの全体設計・拡張計画と、今後このリポジトリで開発作業(AIエージェントによるものを含む)を行う際に必要なコンテキストをまとめたものです。実装を変更した際は、設計思想やアーキテクチャに影響する変更であればこのファイルも合わせて更新してください。

## プロジェクトの目的

個人用ライフログWebアプリケーション。様々なデータソース(家計簿、位置情報、写真、カレンダー、Home Assistant、SNS等)から行動ログを収集・保管し、日毎の日誌として閲覧できるようにする。加えて、Gemini APIを使ったAIパートナー機能により、ライフログをもとにした雑談・振り返り・生活アドバイスを行う。

**唯一の利用者は `hakatasiloving@gmail.com` のGoogleアカウントを持つ本人のみ**。マルチテナント設計は不要で、全ての設計判断は「個人が安全に長期運用できること」を優先する。

## 開発方針: フェーズ分割

一度に全機能を実装せず、以下のフェーズに分けて開発する。進捗はGitHub Project「[ai-diary 開発ロードマップ](https://github.com/users/hakatashi/projects/2)」のkanbanボードで管理する(フェーズ単位のカードのみ、個別タスクはカード化しない)。

- **フェーズ1(実装済み)**: 認証基盤 + Google Health API連携(運動記録) + 日誌基本機能
- **フェーズ2**: 追加データソース(Google Calendar, Google Maps Timeline, Swarm, Google Photos)+ カレンダービュー・一覧ビュー + データソース間の意味的重複の統合
- **フェーズ3**: 家計簿統合(Zaim API + Moneyforward CSVエクスポート)、重複排除・統合アルゴリズム、支出分析、手動ルールによる自動振り分け
- **フェーズ4**: AIパートナー機能(Gemini API連携、自動メッセージ生成、チャット、複数ペルソナ、長期記憶、Web Push配信)
- **フェーズ5**: 残りのデータソース(Home Assistant、SNS)、全体の仕上げ・拡張

新しいフェーズに着手する際は、GitHub Projectに新しいフェーズカードを追加し、既存のフェーズと同様にステータスを更新すること。

## 技術スタック

- **フロントエンド**: SolidStart 1.x(`ssr: false`、静的SPAとしてビルド)、Tailwind CSS v4、TypeScript
- **バックエンド**: Firebase Functions(v2 API、`firebase-functions/https` 等のモジュラーインポート)
- **データベース**: Cloud Firestore
- **認証**: Firebase Authentication(Googleプロバイダのみ)
- **AI**: Gemini API(フェーズ4で導入予定、現時点では未使用)
- **Lint/Format**: Biome(ESLint/Prettierではない)
- **テスト**: Vitest + `@solidjs/testing-library` + Firestore/Auth/Functionsエミュレータ

Firebaseプロジェクト: `hakatadiary`(`.firebaserc` に設定済み)。

## アーキテクチャ上の重要な決定と理由

### 1. 認証: 静的SPA + クライアント側ガード(SSRは採用しない)

`app.config.ts` は `ssr: false` のままであり、`firebase.json` の hosting rewrite も `"**" → "/index.html"` の純粋な静的SPA配信になっている。

「全ページ認証必須」は、SolidStartの `middleware.ts`(サーバーサイドガード)ではなく、以下の2層で実現している:

1. **`src/components/AuthGuard.tsx`**: `app.tsx` の `Router root` 内で全ルートをラップするクライアント側コンポーネント。`solid-firebase` の `useAuth` で認証状態を監視し、未ログインまたは許可外メール(`src/lib/constants.ts` の `ALLOWED_EMAIL`)の場合は `/login` へ `<Navigate>` する。`/login` 自身はガード対象外(無限リダイレクトループ防止)。
2. **Firestore Security Rules(`firestore.rules`)**: 実データ保護の**唯一の真の境界**。`request.auth.token.email == 'hakatasiloving@gmail.com' && request.auth.token.email_verified` を満たさない限り一切のread/writeを許可しない。

この方式を選んだ理由: SolidStart + Firebase HostingでのSSR化(Nitroの `firebase` プリセットをCloud Functions Gen2にデプロイする構成)は主にNuxt向けに検証されており、SolidStartでの実績が薄く動作未検証のリスクが高いと判断したため。ページシェル自体には機密データを一切含まない(全データはFirestoreのリアクティブ購読経由でのみ取得される)ため、クライアント側ガードでも実害はない。**将来的にSSR化が本当に必要になった場合は、`app.config.ts` の `ssr: false` を外し、Nitroの `firebase` プリセットの動作検証をスパイクタスクとして独立させてから着手すること。**

### 2. 秘密情報管理: Secret Manager と Firestore の使い分け

Google Cloud Secret Managerの無料枠(1プロジェクトあたり月間アクティブシークレットバージョン6個まで)を超えないよう、以下の方針で厳格に運用する:

- **Secret Manager(`firebase functions:secrets:set` で登録、コードでは `defineSecret` で参照)**: アプリ全体で共有する静的なグローバル設定のみ。現在登録済みなのは `GEMINI_API_KEY` と `GOOGLE_CLIENT_SECRET` の2つ(合計2アクティブバージョン、予算に十分な余裕あり)。
- **`GOOGLE_CLIENT_ID`**: 非秘匿情報(OAuthクライアントIDはリダイレクトURLにも露出する)なので、Secret Managerを使わず `defineString`(`functions/src/lib/secrets.ts`)で扱う。値は `functions/.env.hakatadiary`(gitignore対象、Secret Managerの予算を消費しない)に置く。
- **`dataSourceSecrets/{dataSourceId}` コレクション(Firestore)**: 各データソース固有の認証情報(OAuthのrefresh tokenなど)。クライアントからは `firestore.rules` で完全に遮断(`allow read, write: if false;`)され、Cloud Functions(Admin SDK)からのみアクセス可能。新しいデータソースを追加する際は、この方式(Firestoreへの保存)をデフォルトとし、Secret Managerには追加しないこと。

新しいデータソースの秘密情報(Zaimのconsumer key/secret、Home Assistantの長期アクセストークン等)も、原則としてこの `dataSourceSecrets` パターンに従う。ユーザーがブラウザから直接入力する形の認証情報(APIキーなど)は、専用のCallable Functionを用意してAdmin SDK経由で書き込む設計にすること(クライアントから直接Firestoreに書き込ませない)。

### 3. Firestoreデータモデル: 複数データソース統合を見据えた正規化スキーマ

```
dataSources/{dataSourceId}       -- データソースのメタデータ(接続状態、最終同期日時等)。クライアント読み取り可
dataSourceSecrets/{dataSourceId} -- 認証情報。クライアント完全遮断
oauthStates/{state}              -- OAuth CSRF対策の使い捨てトークン。クライアント完全遮断
logEntries/{logEntryId}          -- 正規化された時系列ログ。将来の全データソースがここに集約される
journalEntries/{date}            -- 日毎の日誌(手動メモ、将来はAI要約もここに追加)
```

`logEntries` が本アプリの中核。ドキュメントIDは `${sourceType}:${sourceRecordId}` から決定的に生成する(現在は `normalize.ts` 内でSHA-256ハッシュ化)ことで、再同期時の冪等なupsertを保証している。フィールド設計:

- `sourceType`: データソース内での細かい種別(例: `google_health_exercise`)。1つの `dataSources` エントリが将来複数の `sourceType` を出すケースを想定
- `category`: UI表示用の粗い分類(`exercise`, 将来 `finance`/`location`/`media`/`social`/`home`)
- `date`: `YYYY-MM-DD`(Asia/Tokyo基準)。日別一覧クエリのキー
- `metrics`: ソース横断で比較可能な数値のみ(継続時間、距離、カロリー等)
- `raw`: 元データをほぼそのまま保持(再要約・再処理に備える。ドキュメント1MiB上限に注意。GPSトラック等大容量データはraw格納方法を将来再検討する必要がある)

**意味的に重複するデータソース(Google Mapsの訪問履歴とSwarmのチェックインなど)の統合ロジックはフェーズ2以降で設計する。** 現時点では1データソースのみのため未実装。統合時は `sourceType` をまたいだ名寄せ(時刻・位置の近接性で同一イベントと判定するなど)が必要になる見込み。

### 4. Cloud Functions: Cookie不要のCallable Functions中心設計

静的SPA構成のため、Cookieベースのセッション共有は行わない。認証が必要な処理は原則Firebase **Callable Functions**(`onCall`)にし、Firebase Functions Client SDK(`firebase/functions`)の組み込み認証コンテキストを利用する。OAuthコールバックのようにブラウザの生ナビゲーション(GET)を受ける必要がある処理のみ `onRequest` にし、使い捨ての `oauthStates` ドキュメントでCSRF対策と認可の連続性を担保する(詳細は `functions/src/dataSources/googleHealth/oauth.ts` のコメント参照)。

関数はレイテンシ低減のため `asia-northeast1` リージョンを明示指定している。新しい関数を追加する際もこれに合わせること。

### 5. `Collection.tsx` / `Doc.tsx` の再利用パターン

`src/lib/Collection.tsx` と `src/lib/Doc.tsx` は `solid-firebase` の `useFirestore` 戻り値(`UseFireStoreReturn`)を受け取り、loading/error/empty/dataの状態を出し分けする再利用可能なラッパー。新しいFirestoreクエリ結果を表示する画面は、原則としてこの2つのコンポーネントを再利用すること(車輪の再発明をしない)。

## Google Health API連携(フェーズ1の実装詳細)

- Fitbit Web APIの後継API(`developers.google.com/health`)。運動記録の読み取りスコープは `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`。
- OAuth 2.0の認可コードフロー(`access_type=offline`, `prompt=consent`)でrefresh tokenを取得し、`dataSourceSecrets/google_health` に保存する。
- **個人利用目的はGoogleの検証審査(OAuth consent screen verification)が免除されるが、公開ステータスを「テスト中」のままにするとrefresh tokenが7日で失効する。** 本番運用には公開ステータスを「本番」に変更する必要があり、この作業はユーザー自身がGoogle Cloud Consoleで実施する(コード化不可)。
- **`dataPoints.list` の時間範囲指定は素朴なクエリパラメータ(`startTime`/`endTime`)ではなく、AIP-160形式の `filter` パラメータで行う。** 実接続で `Unknown name "startTime"` エラーが発生したため確認・修正済み。さらに、Session種別のデータタイプ(sleep/ECGを除く)では `interval.start_time`/`interval.end_time` 自体がフィルタ不可(`INVALID_DATA_POINT_FILTER`)で、**`{type}.interval.civil_start_time`(値はcivil dateのプレーンな日付文字列、例 `"2026-07-05"`)のみがサポートされる**ことも実接続のエラーで判明し修正済み。正しい構文は `exercise.interval.civil_start_time >= "2026-07-05" AND exercise.interval.civil_start_time < "2026-07-12"`(`functions/src/dataSources/googleHealth/client.ts` の `buildTimeRangeFilter` 参照)。
- DataPointのレスポンス構造は `{name: "users/me/dataTypes/exercise/dataPoints/{id}", exercise: {interval: {startTime, endTime}, exerciseType, metricsSummary: {caloriesKcal, distanceMillimeters, averageHeartRateBeatsPerMinute, ...}}}` という形。`normalize.ts` はこの構造に基づいて実装済み(`exerciseType` の日本語ラベル化は主要な種目のみ対応、未知の種目はフォーマットした英語表記にフォールバック)。ただし `splits`/`exerciseEvents` 等の詳細フィールドは現時点で未活用。
- 同期ロジック(`functions/src/dataSources/googleHealth/sync.ts`)は直近7日分を毎回取得して冪等upsertする単純な方式。データタイプ `exercise` がサポートする `reconcile` 操作(増分同期向け)への切り替えは、実装時に本当に必要か検討する。

## 現時点で不足している認証情報(将来フェーズ用)

フェーズ1は `.env` の既存3キー(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY`)のみで完結している。以下は将来フェーズで必要になる:

- **フェーズ2**: Swarm/Foursquare APIトークン(Google Calendar/Photos/MapsはGOOGLE_CLIENT_ID/SECRETを再利用できる見込み)
- **フェーズ3**: ZaimのOAuth consumer key/secret(Moneyforwardは手動CSVエクスポートのみのためAPI認証情報は不要)
- **フェーズ4**: Web Push用VAPIDキーペア
- **フェーズ5**: Home Assistantの長期アクセストークン+ベースURL、X(Twitter) APIのベアラートークン、Mastodonインスタンスのアクセストークン+インスタンスURL

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

## 手動セットアップチェックリスト(コード化不可、ユーザー側作業)

1. Firebase Console → Authentication → Sign-in method → Google 有効化(**完了済み**)。
2. Google Cloud Console → APIs & Services → Library で Google Health API を有効化。
3. Google Cloud Console → OAuth consent screen → スコープに `googlehealth.activity_and_fitness.readonly` を追加、公開ステータスを「本番」に変更。
4. Google Cloud Console → Credentials → 既存OAuthクライアント(`GOOGLE_CLIENT_ID`)に `https://asia-northeast1-hakatadiary.cloudfunctions.net/googleHealthOAuthCallback` を承認済みリダイレクトURIとして追加。
5. デプロイ後、`/data-sources` から「接続」ボタンでGoogle Healthとの実際の接続確認を行う。

## 既知の制約・今後の検討事項

- `logEntries.raw` へのGPSトラック等大容量生データの格納方法(Firestoreドキュメント1MiB上限との兼ね合い)は未検討。フェーズ2でGoogle Maps Timelineを扱う際に再設計が必要になる可能性が高い。
- 複数データソース間の意味的重複統合ロジックはフェーズ2以降で設計する。
- AIパートナーの複数ペルソナ・長期記憶のFirestoreスキーマはフェーズ4で設計する(現時点では未着手)。
- `firestore.rules` の自動テスト(`@firebase/rules-unit-testing`)は未整備。将来的に追加を検討する。
