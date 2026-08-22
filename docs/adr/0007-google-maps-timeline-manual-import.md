# ADR-0007: Google Maps Timelineの手動インポート設計

- Status: Accepted
- Phase: フェーズ2

## Context

Google Maps Timelineのエクスポート(Google Takeout等で取得する `Timeline.json`)にはAPIが存在しない。ユーザーがブラウザから直接JSONファイルをアップロードする方式にした。

## Decision

- **パースはすべてクライアント側で行う**(`file.text()` → `JSON.parse()`)。ファイルは数十MB〜100MB超になりうるため、Cloud Storageは使わずブラウザのメモリ上で完結させる。
- `semanticSegments` のうち `visit`/`activity`/`timelinePath`(生GPSトラック)/`timelineMemory`(思い出メモ)を持つセグメントを対象とする。トップレベルの `rawSignals`(生GPS/Wi-Fi信号、直近1ヶ月のみのローリングウィンドウで通し履歴を構成できない)と `userLocationProfile`(頻出地点等の単一集計データで`logEntries`の時系列モデルに馴染まない)は意図的に取込対象外としている。
- **書き込み前に必ず件数を確認ダイアログで表示**し(「訪問記録◯件・移動記録◯件・GPS経路◯件・思い出メモ◯件をインポートします」)、ユーザーの明示的な確認を経てから送信する。
- クライアントは対象セグメントを**日時が新しい順に並べ替えてから**400件ずつのチャンクに分割し、`importGoogleMapsTimelineChunk` Callableを順番に呼び出す(`firestore.rules` で `logEntries` はクライアント書き込み不可のため、大量インポートも必ずCallable経由になる)。新しい順に処理するのは、数万件規模のインポートが途中で中断されても直近のデータが優先的に取り込まれるようにするため。
- Callable内部ではFirestore `WriteBatch` を使い、1コミットあたり450件以下に分割してコミットする(Firestoreの1コミットあたり500件上限に対して余裕を持たせている)。クライアント側の `httpsCallable` は明示的に `timeout: 300_000`(バックエンドの `timeoutSeconds: 300` と同値)を指定している(SDKデフォルトの70秒でクライアント側が先にタイムアウトし、バックエンドがまだ処理中でも「インポート中にエラーが発生しました。」と表示されてしまう不具合が実際に発生したため)。
- **1チャンク内のセグメント正規化は `functions/src/lib/concurrency.ts` の `mapWithConcurrency`(worker-poolパターン、同時実行数40)で並列化している。** 当初は`for...of`による逐次awaitだったため、Firestore読み取り・Places API呼び出し・Storage書き込みを含む400件の処理が70秒(クライアントのデフォルトタイムアウト)を超えて失敗する不具合があった。同様に `dedupeVisitsAndCheckins`([ADR-0003](0003-firestore-normalized-log-entries-schema.md))の日付ごとの処理も同時実行数20で並列化済み。並列度は暫定値であり、実インポートでの調整が必要になる可能性がある。
- 訪問(`visit`)セグメントの `placeId` は `functions/src/dataSources/googleMapsTimeline/placesClient.ts` の `resolvePlacesBatch` でまとめて場所名を解決する。1件ずつ `get`/`set` するとplaceId件数分のFirestore往復が発生するため、チャンク内の全placeIdを `db.getAll()` で一括参照し、未キャッシュ分だけPlaces API (New) で解決したうえで新規エントリを `batch.commit` でまとめて書き込む。ただし月間呼び出しカウンタ(`placesApiUsage`)への書き込みだけは意図的にAPI呼び出し1件ごとの即時書き込みのまま残している(バッチ化して遅延書き込みにすると、途中でクラッシュした際に実際に発生した呼び出し回数を記録し損ね、無料枠管理の安全性が損なわれるため)。**`GOOGLE_PLACES_API_KEY` 未設定時やAPI呼び出し失敗時は例外を投げず緯度経度表記にフォールバックする**(インポート全体を失敗させない設計)。
  - **Places API (Place Details Pro SKU) の無料枠は月5,000件**。予期しない高額請求を避けるため、`placesApiUsage/{YYYY-MM}` ドキュメント(`callCount` フィールド、Admin SDK専用)で当月の呼び出し回数を追跡し、**4,500件(500件の安全マージン)に達したら以降の呼び出しをスキップ**して緯度経度表記にフォールバックする。呼び出しはAPIレスポンスの成功・失敗を問わず記録する(リクエスト自体が課金対象になりうるため)。
  - リクエストには `languageCode=ja`/`regionCode=JP` を付与する。`displayName` を要求した時点でPro SKU料金が発生するため、同じ呼び出しの中で追加費用なく取得できるEssentials/Essentials IDs Only/Pro SKUの主要フィールド(`formattedAddress`, `location`, `types`, `primaryType`, `businessStatus`, `googleMapsUri` 等)をまとめて取得し、レスポンス全体を `placesCache.raw` に保存している(同じ場所について2度目のAPI呼び出しが発生しないようにするため。フィールド一覧は `functions/src/dataSources/googleMapsTimeline/placesClient.ts` の `FIELD_MASK` 参照)。
- 冪等性: `logEntryId` はセグメントの `startTime`/`endTime`/`placeId`(または距離)からのハッシュで決定的に生成されるため、同じエクスポートファイルを再アップロードしても重複しない。ただし大量書き込みのパフォーマンスを優先し、既存ドキュメントの `createdAt` を保持するための事前読み取りは行わず、再インポート時は `createdAt` も上書きする(このデータソースに限った簡略化)。
- **GPSトラック(`timelinePath`)はFirebase Storageに外部化する。** 実データ(13年分のエクスポート)で検証したところ1セグメントあたり最大134点(~10KB)程度でFirestoreの1MiBドキュメント上限に単体で抵触するリスクは低いが、GPS点列はクエリ対象にならないブロブデータであり、`logEntries`をカレンダー/一覧ビューで大量に読む際の転送量を抑えるため、あえてFirestoreにインラインで持たせない設計にした。`functions/src/lib/gpsTrackStorage.ts` の `saveGpsTrack` がJSONをgzip圧縮して `gpsTracks/google_maps_path/{logEntryId}.json.gz` に保存し、`logEntries.raw` には `storagePath`/`pointCount`/`boundingBox` のみを残す(点列本体は持たない)。距離は `functions/src/dataSources/dedup/geo.ts` の既存 `haversineDistanceMeters` を再利用して連続点間で積算する。コスト試算: 13年分の全履歴でも圧縮後3.3MB程度(Firebase Storage無料枠5GBの0.07%)で、実質$0/月。
- `timelineMemory`(思い出メモ)は件数・サイズが小さいため上記の外部化は行わず、`note.note` をそのまま`logEntries.summary`としてインライン格納する(空文字の場合はスキップ)。

## Consequences

- 取り込んだトラックを地図上に描画するUIは [ADR-0009](0009-journal-map-and-photos.md) で実装済み。
- Google HealthのGPS(ウォーキング/サイクリング等のトラックログ)は概念的には同じ`gpsTrackStorage`ヘルパーを再利用しているが、実際のAPIエンドポイントは別方式([ADR-0011](0011-google-health-api-integration-details.md)参照)。
- Google Maps Timelineのトップレベルの `rawSignals`・`userLocationProfile` は意図的に未取込のまま(将来もこの判断を維持する前提)。
