# AGENTS.md

このドキュメントは、ai-diaryプロジェクトの全体設計・拡張計画と、今後このリポジトリで開発作業(AIエージェントによるものを含む)を行う際に必要なコンテキストをまとめたものです。実装を変更した際は、設計思想やアーキテクチャに影響する変更であればこのファイルも合わせて更新してください。

## プロジェクトの目的

個人用ライフログWebアプリケーション。様々なデータソース(家計簿、位置情報、写真、カレンダー、Home Assistant、SNS等)から行動ログを収集・保管し、日毎の日誌として閲覧できるようにする。加えて、Gemini APIを使ったAIパートナー機能により、ライフログをもとにした雑談・振り返り・生活アドバイスを行う。

**唯一の利用者は `hakatasiloving@gmail.com` のGoogleアカウントを持つ本人のみ**。マルチテナント設計は不要で、全ての設計判断は「個人が安全に長期運用できること」を優先する。

## 開発方針: フェーズ分割

一度に全機能を実装せず、以下のフェーズに分けて開発する。進捗はGitHub Project「[ai-diary 開発ロードマップ](https://github.com/users/hakatashi/projects/2)」のkanbanボードで管理する(フェーズ単位のカードのみ、個別タスクはカード化しない)。

- **フェーズ1(実装済み)**: 認証基盤 + Google Health API連携(運動記録) + 日誌基本機能
- **フェーズ2(実装済み)**: 追加データソース(Google Calendar, Google Maps Timeline, Swarm, Immich)+ カレンダービュー・一覧ビュー + データソース間の意味的重複の統合
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
2. **Firestore Security Rules(`firestore.rules`)**: 実データ保護の**唯一の真の境界**。`request.auth.token.email == 'hakatasiloving@gmail.com' && request.auth.token.email_verified` を満たさない限り一切のread/writeを許可しない。owner/非owner/未認証の3パターンでの許可・拒否は `firestore.rules.test.ts`(`@firebase/rules-unit-testing` の `initializeTestEnvironment` を使用、`npm test` に含まれる)で自動検証している。

この方式を選んだ理由: SolidStart + Firebase HostingでのSSR化(Nitroの `firebase` プリセットをCloud Functions Gen2にデプロイする構成)は主にNuxt向けに検証されており、SolidStartでの実績が薄く動作未検証のリスクが高いと判断したため。ページシェル自体には機密データを一切含まない(全データはFirestoreのリアクティブ購読経由でのみ取得される)ため、クライアント側ガードでも実害はない。**将来的にSSR化が本当に必要になった場合は、`app.config.ts` の `ssr: false` を外し、Nitroの `firebase` プリセットの動作検証をスパイクタスクとして独立させてから着手すること。**

### 2. 秘密情報管理: Secret Manager と Firestore の使い分け

Google Cloud Secret Managerの無料枠(1プロジェクトあたり月間アクティブシークレットバージョン6個まで)を超えないよう、以下の方針で厳格に運用する:

- **Secret Manager(`firebase functions:secrets:set` で登録、コードでは `defineSecret` で参照)**: アプリ全体で共有する静的なグローバル設定のみ。現在登録済みなのは `GEMINI_API_KEY`、`GOOGLE_CLIENT_SECRET`、`FOURSQUARE_OAUTH_CLIENT_SECRET`(Swarm連携用)、`GOOGLE_PLACES_API_KEY`(Google Maps Timelineの訪問先名称解決用)の4つ(合計4アクティブバージョン、予算6に対しまだ余裕あり)。`FOURSQUARE_OAUTH_CLIENT_SECRET`/`GOOGLE_PLACES_API_KEY`は値が用意でき次第 `firebase functions:secrets:set` で登録する(下記「手動セットアップチェックリスト」参照。このリポジトリでのCLI操作では意図的に未設定のままにしてある)。
- **`GOOGLE_CLIENT_ID` / `FOURSQUARE_OAUTH_CLIENT_ID`**: 非秘匿情報(OAuthクライアントIDはリダイレクトURLにも露出する)なので、Secret Managerを使わず `defineString`(`functions/src/lib/secrets.ts`)で扱う。値は `functions/.env.hakatadiary`(gitignore対象、Secret Managerの予算を消費しない)に置く。
- **`dataSourceSecrets/{dataSourceId}` コレクション(Firestore)**: 各データソース固有の認証情報(OAuthのrefresh tokenなど)。クライアントからは `firestore.rules` で完全に遮断(`allow read, write: if false;`)され、Cloud Functions(Admin SDK)からのみアクセス可能。新しいデータソースを追加する際は、この方式(Firestoreへの保存)をデフォルトとし、Secret Managerには追加しないこと。

新しいデータソースの秘密情報(Zaimのconsumer key/secret、Home Assistantの長期アクセストークン等)も、原則としてこの `dataSourceSecrets` パターンに従う。ユーザーがブラウザから直接入力する形の認証情報(APIキーなど)は、専用のCallable Functionを用意してAdmin SDK経由で書き込む設計にすること(クライアントから直接Firestoreに書き込ませない)。

### 3. Firestoreデータモデル: 複数データソース統合を見据えた正規化スキーマ

```
dataSources/{dataSourceId}       -- データソースのメタデータ(接続状態、最終同期日時等)。クライアント読み取り可
dataSourceSecrets/{dataSourceId} -- 認証情報。クライアント完全遮断
oauthStates/{state}              -- OAuth CSRF対策の使い捨てトークン。クライアント完全遮断
logEntries/{logEntryId}          -- 正規化された時系列ログ。将来の全データソースがここに集約される
journalEntries/{date}            -- 日毎の日誌(手動メモ、将来はAI要約もここに追加)
placesCache/{placeId}            -- Google Places API (New) で解決した場所詳細のキャッシュ。クライアント完全遮断
placesApiUsage/{yyyy-mm}         -- Places APIの月間呼び出し回数カウンタ(無料枠管理用)。クライアント完全遮断
```

`logEntries` が本アプリの中核。ドキュメントIDは `${sourceType}:${sourceRecordId}` から決定的に生成する(現在は `normalize.ts` 内でSHA-256ハッシュ化)ことで、再同期時の冪等なupsertを保証している。フィールド設計:

- `sourceType`: データソース内での細かい種別(例: `google_health_exercise`)。1つの `dataSources` エントリが将来複数の `sourceType` を出すケースを想定
- `category`: UI表示用の粗い分類(`exercise`, 将来 `finance`/`location`/`media`/`social`/`home`)
- `date`: `YYYY-MM-DD`(Asia/Tokyo基準)。日別一覧クエリのキー
- `metrics`: ソース横断で比較可能な数値のみ(継続時間、距離、カロリー等)
- `raw`: 元データをほぼそのまま保持(再要約・再処理に備える。ドキュメント1MiB上限に注意。GPSトラック等大容量データはraw格納方法を将来再検討する必要がある)
- `hidden` / `dedupedInto`: 意味的重複統合(下記)で他エントリに吸収された場合に `hidden: true` かつ `dedupedInto` に統合先の `logEntryId` を設定する。**削除はしない**(生データは保持し、統合ロジックの見直しで復元できるようにする)。クライアント側の一覧系クエリは `hidden === true` のエントリを表示しない(`src/lib/logEntries.ts` の `visibleLogEntries`/`isVisible` で統一的にフィルタする。Firestoreの `!=` フィルタはフィールド欠如ドキュメントを暗黙に除外してしまうため、あえてクエリではなくクライアント側フィルタとしている)。

**意味的に重複するデータソース(Google Mapsの訪問履歴とSwarmのチェックインなど)の名寄せは `functions/src/dataSources/dedup/dedupeVisitsAndCheckins.ts` で実装済み。** `sourceType === 'google_maps_visit'` のエントリと `category === 'checkin'`(Swarm)のエントリについて、`startAt` の差が20分以内かつ位置(haversine距離)が200m以内の場合に同一訪問イベントとみなし、Swarm側を `hidden` にする。Swarm同期後・Maps Timelineインポート後に対象日付で自動実行されるほか、`/data-sources` の「メンテナンス」セクションから任意の日付範囲で手動再実行できる(`dedupeLogEntriesNow` Callable)。他の組み合わせ(例: Google Calendarの予定とImmichの写真)の統合は未実装で、将来のフェーズで検討する。対象日付ごとのクエリは `mapWithConcurrency` で並列実行し、マッチした更新は日付ごとに個別commitせず全日付分をまとめてから `WriteBatch` でコミットする(Google Maps Timelineインポート時に多数の日付が一度に渡されるケースでのFirestore往復回数を削減するため)。

### 4. Cloud Functions: Cookie不要のCallable Functions中心設計

静的SPA構成のため、Cookieベースのセッション共有は行わない。認証が必要な処理は原則Firebase **Callable Functions**(`onCall`)にし、Firebase Functions Client SDK(`firebase/functions`)の組み込み認証コンテキストを利用する。OAuthコールバックのようにブラウザの生ナビゲーション(GET)を受ける必要がある処理のみ `onRequest` にし、使い捨ての `oauthStates` ドキュメントでCSRF対策と認可の連続性を担保する(詳細は `functions/src/dataSources/googleHealth/oauth.ts` のコメント参照)。

関数はレイテンシ低減のため `asia-northeast1` リージョンを明示指定している。新しい関数を追加する際もこれに合わせること。

### 5. `Collection.tsx` / `Doc.tsx` の再利用パターン

`src/lib/Collection.tsx` と `src/lib/Doc.tsx` は `solid-firebase` の `useFirestore` 戻り値(`UseFireStoreReturn`)を受け取り、loading/error/empty/dataの状態を出し分けする再利用可能なラッパー。新しいFirestoreクエリ結果を表示する画面は、原則としてこの2つのコンポーネントを再利用すること(車輪の再発明をしない)。

### 6. Google OAuth連携の共通化(`functions/src/lib/googleOAuth.ts`)

Google Health(フェーズ1)に加え、フェーズ2でGoogle Calendarとの新しいGoogle OAuth連携が増えたため、「state発行→認可URL生成→コールバックでtoken交換→`dataSources`/`dataSourceSecrets`更新」という一連の流れを `createGoogleOAuthFlow({dataSourceId, displayName, category, scope, callbackFunctionName})` ファクトリに共通化した。各データソースの `oauth.ts` はこのファクトリを呼び出して `beginXxxOAuth`/`xxxOAuthCallback` を生成するだけでよい。`callbackFunctionName` は `functions/src/index.ts` でのexport名(=実際にデプロイされる関数名)と一致させる必要がある(リダイレクトURIの構築に使うため)。また、refresh tokenからaccess tokenを取得する `getGoogleAccessToken` も同ファイルで共通化し、各データソースの `client.ts` から利用する。なお、ImmichはOAuthを持たずAPIキー認証のみのため、このファクトリは使わない(詳細は下記アーキテクチャ決定8を参照)。

Swarm(Foursquare)はGoogleとは無関係の独自OAuth2フローのため、このファクトリは使わず `functions/src/dataSources/swarm/oauth.ts` に個別実装している。Foursquareのアクセストークンは(v2 APIでは)明示的に失効しないため、refresh tokenの概念がなく `credentialType: 'oauth2_access_token'` として `payload.accessToken` をそのまま保存する。

**チェックイン履歴の取得には `/v2/users/self/checkins`(classic v2 API)を使う。** 当初は参考記事に従い `/v2/users/self/historysearch` を使っていたが、実接続で `402 credits_exhausted` エラーとなった。これはFoursquareのPersonalization API(2026年6月から段階的従量課金が導入され、月500コールの無料枠のみ)側のエンドポイントで、`historysearch` はこちらに属するため即座に枠を使い切ってしまう。一方 `checkins`/`lists`/`tastes`/`tips`/ユーザー系のエンドポイントは無料のまま継続されるとFoursquareの公式ドキュメントに明記されているため、同じくユーザーのチェックイン履歴を返す `/v2/users/self/checkins` に切り替えた(`functions/src/dataSources/swarm/client.ts`)。ページネーションは `beforeTimestamp` ではなく `offset`/`limit` 方式(レスポンスの `response.checkins.count`/`response.checkins.items` を使う)。なお、v2 APIのレガシーエンドポイントは2026年5月15日に廃止予定とFoursquareが告知しているため、将来的に新しいPlaces API/Personalization API体系への再移行が必要になる可能性がある。

### 7. Google Maps Timelineの手動インポート設計

Google Maps Timelineのエクスポート(Google Takeout等で取得する `Timeline.json`)はAPIが存在しないため、ユーザーがブラウザから直接JSONファイルをアップロードする方式にした(`/data-sources` の該当カード)。設計上の要点:

- **パースはすべてクライアント側で行う**(`file.text()` → `JSON.parse()`)。ファイルは数十MB〜100MB超になりうるため、Cloud Storageは使わずブラウザのメモリ上で完結させている。
- `semanticSegments` のうち `visit`/`activity`/`timelinePath`(生GPSトラック)/`timelineMemory`(思い出メモ)を持つセグメントを対象とする。トップレベルの `rawSignals`(生GPS/Wi-Fi信号、直近1ヶ月のみのローリングウィンドウで通し履歴を構成できない)と `userLocationProfile`(頻出地点等の単一集計データで`logEntries`の時系列モデルに馴染まない)は意図的に取込対象外としている。
- **書き込み前に必ず件数を確認ダイアログで表示**し(「訪問記録◯件・移動記録◯件・GPS経路◯件・思い出メモ◯件をインポートします」)、ユーザーの明示的な確認を経てから送信する。
- クライアントは対象セグメントを**日時が新しい順に並べ替えてから**400件ずつのチャンクに分割し、`importGoogleMapsTimelineChunk` Callableを順番に呼び出す(`firestore.rules` で `logEntries` はクライアント書き込み不可のため、大量インポートも必ずCallable経由になる)。新しい順に処理するのは、数万件規模のインポートが途中で中断されても直近のデータが優先的に取り込まれるようにするため。Callable内部ではFirestore `WriteBatch` を使い、1コミットあたり450件以下に分割してコミットする(Firestoreの1コミットあたり500件上限に対して余裕を持たせている)。クライアント側の `httpsCallable` は明示的に `timeout: 300_000`(バックエンドの `timeoutSeconds: 300` と同値)を指定している(SDKデフォルトの70秒でクライアント側が先にタイムアウトし、バックエンドがまだ処理中でも「インポート中にエラーが発生しました。」と表示されてしまう不具合が実際に発生したため)。
  - **1チャンク内のセグメント正規化は `functions/src/lib/concurrency.ts` の `mapWithConcurrency`(worker-poolパターン、同時実行数40)で並列化している。** 当初は`for...of`による逐次awaitだったため、Firestore読み取り・Places API呼び出し・Storage書き込みを含む400件の処理が70秒(クライアントのデフォルトタイムアウト)を超えて失敗する不具合があった。同様に `dedupeVisitsAndCheckins`(下記)の日付ごとの処理も同時実行数20で並列化済み。並列度は暫定値であり、実インポートでの調整が必要になる可能性がある。
- 訪問(`visit`)セグメントの `placeId` は `functions/src/dataSources/googleMapsTimeline/placesClient.ts` の `resolvePlacesBatch` でまとめて場所名を解決する。1件ずつ `get`/`set` するとplaceId件数分のFirestore往復が発生するため、チャンク内の全placeIdを `db.getAll()` で一括参照し、未キャッシュ分だけPlaces API (New) で解決したうえで新規エントリを `batch.commit` でまとめて書き込む設計にした。ただし月間呼び出しカウンタ(`placesApiUsage`、下記)への書き込みだけは意図的にAPI呼び出し1件ごとの即時書き込みのまま残している(バッチ化して遅延書き込みにすると、途中でクラッシュした際に実際に発生した呼び出し回数を記録し損ね、無料枠管理の安全性が損なわれるため)。**`GOOGLE_PLACES_API_KEY` 未設定時やAPI呼び出し失敗時は例外を投げず緯度経度表記にフォールバックする**(インポート全体を失敗させない設計)。
  - **Places API (Place Details Pro SKU) の無料枠は月5,000件**。予期しない高額請求を避けるため、`placesApiUsage/{YYYY-MM}` ドキュメント(`callCount` フィールド、Admin SDK専用)で当月の呼び出し回数を追跡し、**4,500件(500件の安全マージン)に達したら以降の呼び出しをスキップ**して緯度経度表記にフォールバックする。呼び出しはAPIレスポンスの成功・失敗を問わず記録する(リクエスト自体が課金対象になりうるため)。2026年7月時点の実績: `placesCache` の当月ドキュメント数(384件、実接続テストで判明)を初期値として本番の `placesApiUsage/2026-07` に遡及記録済み。
  - リクエストには `languageCode=ja`/`regionCode=JP` を付与し、`displayName` 等が日本語で返るようにしている。`displayName` を要求した時点でPro SKU料金が発生するため、同じ呼び出しの中で追加費用なく取得できるEssentials/Essentials IDs Only/Pro SKUの主要フィールド(`formattedAddress`, `location`, `types`, `primaryType`, `businessStatus`, `googleMapsUri` 等)をまとめて取得し、レスポンス全体を `placesCache.raw` に保存している(同じ場所について2度目のAPI呼び出しが発生しないようにするため。フィールド一覧は `functions/src/dataSources/googleMapsTimeline/placesClient.ts` の `FIELD_MASK` 参照)。
- 冪等性: `logEntryId` はセグメントの `startTime`/`endTime`/`placeId`(または距離)からのハッシュで決定的に生成されるため、同じエクスポートファイルを再アップロードしても重複しない。ただし大量書き込みのパフォーマンスを優先し、既存ドキュメントの `createdAt` を保持するための事前読み取りは行わず、再インポート時は `createdAt` も上書きする(このデータソースに限った簡略化)。
- **GPSトラック(`timelinePath`)はFirebase Storageに外部化する。** 実データ(13年分のエクスポート)で検証したところ1セグメントあたり最大134点(~10KB)程度でFirestoreの1MiBドキュメント上限に単体で抵触するリスクは低いが、GPS点列はクエリ対象にならないブロブデータであり、`logEntries`をカレンダー/一覧ビューで大量に読む際の転送量を抑えるため、あえてFirestoreにインラインで持たせない設計にした。`functions/src/lib/gpsTrackStorage.ts` の `saveGpsTrack` がJSONをgzip圧縮して `gpsTracks/google_maps_path/{logEntryId}.json.gz` に保存し、`logEntries.raw` には `storagePath`/`pointCount`/`boundingBox` のみを残す(点列本体は持たない)。距離は `functions/src/dataSources/dedup/geo.ts` の既存 `haversineDistanceMeters` を再利用して連続点間で積算する。粒度は既存の「1セグメント=1logEntry」モデルをそのまま踏襲し、日次集約のような新しいデータモデルは導入していない。コスト試算: 13年分の全履歴でも圧縮後3.3MB程度(Firebase Storage無料枠5GBの0.07%)で、実質$0/月。取り込んだトラックを地図上に描画するUIは未実装(別途検討)。
- `timelineMemory`(思い出メモ)は件数・サイズが小さいため上記の外部化は行わず、`note.note` をそのまま`logEntries.summary`としてインライン格納する(空文字の場合はスキップ)。
- Google HealthのGPS(ウォーキング/サイクリング等のトラックログ)は概念的には同じ`gpsTrackStorage`ヘルパーを再利用できる想定だが、実際のAPIエンドポイントは未実装・未確認のため別issueで扱う。

### 8. 写真データソースはImmich(自己ホスト)。API キー認証・定期自動同期対応

当初フェーズ2ではGoogle Photosと連携していたが、2025年3月末にGoogleが `photoslibrary.readonly` などの広範な読み取りスコープを廃止し、既存ライブラリへの自動バックグラウンド同期が技術的に不可能になったため(参照: https://developers.google.com/photos/support/updates )、Picker APIによる都度手動インポートのみの実装になっていた。運用してみると手動インポートの手間が大きかったため、セルフホストの[Immich](https://immich.app/)への移行に伴いGoogle Photos連携を廃止し、Immich連携に置き換えた。

Immichは自ホストサーバーでOAuthを持たず、ユーザー自身が発行したAPIキーで認証する。**このため他のデータソースと異なりOAuthフローが不要で、`dataSourceSecrets/immich` の `credentialType` は `api_key`(サーバーURL・APIキーをそのままペイロードに保存)になる。** ユーザーがブラウザから直接入力する認証情報の一般原則(上記「秘密情報管理」参照)通り、専用のCallable Function `connectImmich`(`functions/src/dataSources/immich/connect.ts`)がAdmin SDK経由でFirestoreに書き込む。`connectImmich` は保存前に `GET {serverUrl}/users/me` を叩いてAPIキーの有効性を検証する。

写真本体を自前でホストしているため、Google Photosと異なり**定期自動同期(`scheduledSync`)の対象に含まれる**(`functions/src/dataSources/immich/sync.ts` の `syncImmichPhotos`)。一覧取得には `POST {serverUrl}/search/metadata` を使う(`functions/src/dataSources/immich/client.ts`)。実接続で判明した仕様:

- `takenAfter`/`takenBefore` フィルタは日付のみの文字列(`YYYY-MM-DD`)ではエラーになり、**タイムゾーンオフセット付きのISO 8601日時文字列(例: `2026-08-01T00:00:00.000Z`)が必須**。
- レスポンスは `{assets: {items: [...], nextPage: "2" | null}}` の形。`nextPage` を使ってページング。
- 通常同期(3時間おき)は直近7日分のみ取得し、既存ドキュメントの `createdAt` を保持するため事前読み取りを行う(Google Calendar/Swarm同期と同方式)。手動の「全期間を同期」(`fullBackfill: true`)は暴走防止のためページ数上限(最大10,000件)を設け、Google Maps Timelineインポートと同様に事前読み取りを省いたバッチ書き込みで完結させる(この場合 `createdAt` も上書きされる)。
- `localDateTime` フィールドは撮影地点の壁時計時刻を(実際のUTCではなく)`Z` 付きのISO文字列として返すImmich独自の仕様。`date` フィールドの算出にはこの文字列の日付部分をそのまま使い、Google Photos連携時のような固定タイムゾーン(Asia/Tokyo)での再計算はしない(`functions/src/dataSources/immich/normalize.ts`)。`startAt` には実際のUTC時刻である `fileCreatedAt` を使う。

## Google Health API連携(フェーズ1の実装詳細)

- Fitbit Web APIの後継API(`developers.google.com/health`)。運動記録の読み取りスコープは `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`。GPSトラック取得(下記参照)には `https://www.googleapis.com/auth/googlehealth.location.readonly` も追加で要求する。
- OAuth 2.0の認可コードフロー(`access_type=offline`, `prompt=consent`)でrefresh tokenを取得し、`dataSourceSecrets/google_health` に保存する。
- **個人利用目的はGoogleの検証審査(OAuth consent screen verification)が免除されるが、公開ステータスを「テスト中」のままにするとrefresh tokenが7日で失効する。** 本番運用には公開ステータスを「本番」に変更する必要があり、この作業はユーザー自身がGoogle Cloud Consoleで実施する(コード化不可)。
- **`dataPoints.list` の時間範囲指定は素朴なクエリパラメータ(`startTime`/`endTime`)ではなく、AIP-160形式の `filter` パラメータで行う。** 実接続で `Unknown name "startTime"` エラーが発生したため確認・修正済み。さらに、Session種別のデータタイプ(sleep/ECGを除く)では `interval.start_time`/`interval.end_time` 自体がフィルタ不可(`INVALID_DATA_POINT_FILTER`)で、**`{type}.interval.civil_start_time`(値はcivil dateのプレーンな日付文字列、例 `"2026-07-05"`)のみがサポートされる**ことも実接続のエラーで判明し修正済み。**さらに `civil_start_time` は `GREATER_THAN_EQUALS` と `LESS_THAN` の2つのコンパレータしかサポートせず、`<=` を使うと `INVALID_DATA_POINT_FILTER_RESTRICTION_COMPARATOR` エラーになる**ことも実接続で判明した(フェーズ2のテスト中に発覚・修正)。同期対象の最終日を含めるため、上限には `endTime` の**翌日**の日付を排他境界(`<`)として使う。正しい構文は `exercise.interval.civil_start_time >= "2026-07-05" AND exercise.interval.civil_start_time < "2026-07-13"`(終了日が `2026-07-12` の場合。`functions/src/dataSources/googleHealth/client.ts` の `buildTimeRangeFilter`/`nextCivilDate` 参照)。
- DataPointのレスポンス構造は `{name: "users/me/dataTypes/exercise/dataPoints/{id}", exercise: {interval: {startTime, endTime}, exerciseType, metricsSummary: {caloriesKcal, distanceMillimeters, averageHeartRateBeatsPerMinute, ...}}}` という形。`normalize.ts` はこの構造に基づいて実装済み(`exerciseType` の日本語ラベル化は主要な種目のみ対応、未知の種目はフォーマットした英語表記にフォールバック)。ただし `splits`/`exerciseEvents` 等の詳細フィールドは現時点で未活用。
- 同期ロジック(`functions/src/dataSources/googleHealth/sync.ts`)は直近7日分を毎回取得して冪等upsertする単純な方式。データタイプ `exercise` がサポートする `reconcile` 操作(増分同期向け)への切り替えは、実装時に本当に必要か検討する。
- **GPSトラック(ウォーキング・サイクリング等)の取込**: `dataPoints.list`(`listExercises`)のレスポンスには座標は含まれず、`users.dataTypes.dataPoints` リソースのカスタムメソッド `exportExerciseTcx`(`GET /v4/{name=users/*/dataTypes/exercise/dataPoints/*}:exportExerciseTcx?alt=media`)を別途呼び出してTCX(Training Center XML v2)形式で取得する必要がある(`functions/src/dataSources/googleHealth/client.ts` の `fetchExerciseTcx`)。`alt=media` を付けないとTCX本体ではなく `{tcxData: "..."}` というJSONラッパーが返るため必須。このメソッドは `activity_and_fitness` に加えて `location` スコープが別途必要で(未同意の場合403になる)、既存にGoogle Healthを接続済みのユーザーは**再接続(OAuth再同意)が必要**(コード化不可、ユーザー側作業。下記「手動セットアップチェックリスト」参照)。TCXのパースは正規表現ベースの軽量実装(`functions/src/dataSources/googleHealth/tcx.ts` の `parseTcxTrackpoints`)で、汎用XMLパーサは導入していない(Google Health API自身が生成する構造が固定されたマシン生成データであるため)。GPS点列は `functions/src/lib/gpsTrackStorage.ts` の `saveGpsTrack` を再利用してFirebase Storageに外部化し(`gpsTracks/google_health_exercise/{logEntryId}.json.gz`)、Google Maps Timelineの `timelinePath` とは異なり**別のlogEntryを作らず、同じエクササイズのlogEntryの `raw.gpsTrack`(storagePath/pointCount/boundingBoxのみ)と `location`(先頭座標)に合成する**(`normalize.ts` の `attachGpsTrack`)。全てのエクササイズにGPSがあるわけではなく、GPS有無を示す専用フィールド(`exerciseMetadata.hasGps`等)がAPIに存在するかは実接続で確認できなかったため、`metricsSummary.distanceMillimeters` の有無(距離メトリクスを持つ=屋外系種目である可能性が高い)という保守的な指標で `exportExerciseTcx` 呼び出し対象を絞り込んでいる(`normalize.ts` の `mayHaveGpsTrack`)。TCX取得・パース結果が0点の場合(屋内エクササイズ、スコープ未同意等)はGPSトラックなしの通常のエクササイズエントリとして扱い、同期全体は失敗させない。

## 現時点で不足している認証情報(将来フェーズ用)

フェーズ1・2は `.env`/`functions/.env.hakatadiary` の既存キー(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY`, `FOURSQUARE_OAUTH_CLIENT_ID`, `FOURSQUARE_OAUTH_CLIENT_SECRET`)のみで完結している(Google Calendar/Photos/MapsはGOOGLE_CLIENT_ID/SECRETを再利用)。`GOOGLE_PLACES_API_KEY` はコードは実装済みだがまだ値が用意されておらず、Secret Managerへの登録が未完了(下記「手動セットアップチェックリスト」参照)。以下は将来フェーズで必要になる:

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
3. Google Cloud Console → OAuth consent screen → スコープに `googlehealth.activity_and_fitness.readonly`(運動記録)と `googlehealth.location.readonly`(GPSトラック取得用、フェーズ2追加分)を追加、公開ステータスを「本番」に変更。
4. Google Cloud Console → Credentials → 既存OAuthクライアント(`GOOGLE_CLIENT_ID`)に `https://asia-northeast1-hakatadiary.cloudfunctions.net/googleHealthOAuthCallback` を承認済みリダイレクトURIとして追加。
5. デプロイ後、`/data-sources` から「接続」ボタンでGoogle Healthとの実際の接続確認を行う。

### フェーズ2追加分

6. Google Cloud Console → APIs & Services → Library で **Google Calendar API** を有効化し、OAuth consent screenのスコープに `calendar.readonly` を追加。
7. Google Cloud Console → Credentials → 既存OAuthクライアントに `https://asia-northeast1-hakatadiary.cloudfunctions.net/googleCalendarOAuthCallback` をリダイレクトURIとして追加。
8. Google Cloud Console → APIs & Services → Library で **Places API (New)** を有効化し、APIキーを発行(Places API (New) の Place Details にのみ制限することを推奨)。発行したキーを `firebase functions:secrets:set GOOGLE_PLACES_API_KEY` でSecret Managerに登録する。未設定の間はGoogle Maps Timelineインポート時に場所名の代わりに緯度経度が表示される(フォールバック動作、インポート自体は失敗しない)。
9. [Foursquare Developer Portal](https://foursquare.com/developers/apps) で作成済みのアプリの設定画面から、`https://asia-northeast1-hakatadiary.cloudfunctions.net/swarmOAuthCallback` をリダイレクトURIとして登録する。
10. `firebase functions:secrets:set FOURSQUARE_OAUTH_CLIENT_SECRET` でSecret Managerに登録する(値は `.env` の `FOURSQUARE_OAUTH_CLIENT_SECRET` と同じ)。
11. Immichサーバーの管理画面(Account Settings → API Keys)でAPIキーを発行する。Secret Managerには登録せず、`/data-sources` の画面からサーバーURL(例: `https://immich.example.com/api`)とAPIキーを直接入力して接続する(`connectImmich` Callable経由で `dataSourceSecrets/immich` に保存される)。
12. デプロイ後、`/data-sources` から各データソースの「接続」ボタンで実際の接続確認を行う。特にSwarm(Foursquare API)は実フィールドが未検証のため、初回接続時にGoogle Health連携同様のトライアル&エラー修正が必要になる可能性が高い。
13. Firebase Console(または`firebase deploy`実行時の初回プロンプト)でCloud Storage for Firebaseを有効化する(未有効の場合、デフォルトバケットの作成先リージョンを選択するダイアログが表示されることがある)。GPSトラックの保存先として使用する(`storage.rules`/`firebase.json`の`storage`設定は実装済み)。
14. 既にGoogle Healthを接続済みの場合、`googlehealth.location.readonly` スコープ追加(上記3.)後に `/data-sources` から**Google Healthを再接続(再度「接続」ボタンからOAuth同意をやり直す)**する。既存のrefresh tokenにはこのスコープが含まれていないため、再接続しないとGPSトラック取得(`exportExerciseTcx`)が403で失敗し続ける(通常のエクササイズ同期自体には影響しない)。

## 既知の制約・今後の検討事項

- Google Maps Timelineの `timelinePath`(生GPSトラック)・`timelineMemory`(思い出メモ)、およびGoogle Healthのエクササイズ(ウォーキング/サイクリング等)のGPSトラック(詳細は上記「Google Health API連携」参照)は取込済み(いずれもFirebase Storageに外部化。Google Maps Timelineの詳細は上記「7. Google Maps Timelineの手動インポート設計」参照)。Google Maps Timelineのトップレベルの `rawSignals`(生GPS/Wi-Fi信号)・`userLocationProfile`(頻出地点プロファイル)は日誌としての価値が低い/データモデルに馴染まないと判断し、意図的に未取込のまま。取り込んだGPSトラックを地図上に描画するUIは未実装(将来検討)。
- Immichの自己ホストサーバーがネットワーク的にCloud Functionsから到達可能であることが前提(リバースプロキシ・DDNS等はユーザー側の運用に依存し、コード化不可)。サーバーが到達不能な間は同期が `error` ステータスになるのみで、リトライは次回のスケジュール実行を待つ簡易的な設計。
- Swarm(Foursquare v2 API `/v2/users/self/checkins`)のレスポンス実フィールドはドキュメントからの推定で実装しており未検証。初回実接続時にGoogle Health連携同様のトライアル&エラー修正が必要になる可能性が高い。また同エンドポイントを含むv2レガシーAPIは2026年5月15日に廃止予定とFoursquareが告知しており、将来的な再移行が必要になる見込み。
- 複数データソース間の意味的重複統合は、Google Maps訪問記録⇔Swarmチェックインの組み合わせのみ実装済み(`functions/src/dataSources/dedup/dedupeVisitsAndCheckins.ts`)。しきい値(20分/200m)は保守的な初期値であり、実データでの調整が必要になる可能性がある。Google Calendarの予定⇔Immichの写真など、他の組み合わせの統合は未実装。
- AIパートナーの複数ペルソナ・長期記憶のFirestoreスキーマはフェーズ4で設計する(現時点では未着手)。
