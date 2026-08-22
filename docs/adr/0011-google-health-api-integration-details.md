# ADR-0011: Google Health API連携の実装詳細(運動記録、フェーズ1)

- Status: Accepted
- Phase: フェーズ1(GPSトラック取込はフェーズ2で追加)

## Context

Google Health API(`developers.google.com/health`、Fitbit Web APIの後継)を使って運動記録を取り込む際、公式ドキュメントの記載と実際のAPI挙動に複数の齟齬があり、実接続でのトライアル&エラーで確定した仕様が多い。

## Decision

- 運動記録の読み取りスコープは `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`。GPSトラック取得には `https://www.googleapis.com/auth/googlehealth.location.readonly` も追加で要求する。
- OAuth 2.0の認可コードフロー(`access_type=offline`, `prompt=consent`)でrefresh tokenを取得し、`dataSourceSecrets/google_health` に保存する。
- **個人利用目的はGoogleの検証審査(OAuth consent screen verification)が免除されるが、公開ステータスを「テスト中」のままにするとrefresh tokenが7日で失効する。** 本番運用には公開ステータスを「本番」に変更する必要があり、この作業はユーザー自身がGoogle Cloud Consoleで実施する(コード化不可)。
- **`dataPoints.list` の時間範囲指定は素朴なクエリパラメータ(`startTime`/`endTime`)ではなく、AIP-160形式の `filter` パラメータで行う。** 実接続で `Unknown name "startTime"` エラーが発生したため確認・修正済み。さらに、Session種別のデータタイプ(sleep/ECGを除く)では `interval.start_time`/`interval.end_time` 自体がフィルタ不可(`INVALID_DATA_POINT_FILTER`)で、**`{type}.interval.civil_start_time`(値はcivil dateのプレーンな日付文字列、例 `"2026-07-05"`)のみがサポートされる**ことも実接続のエラーで判明し修正済み。**さらに `civil_start_time` は `GREATER_THAN_EQUALS` と `LESS_THAN` の2つのコンパレータしかサポートせず、`<=` を使うと `INVALID_DATA_POINT_FILTER_RESTRICTION_COMPARATOR` エラーになる**ことも実接続で判明した。同期対象の最終日を含めるため、上限には `endTime` の**翌日**の日付を排他境界(`<`)として使う。正しい構文は `exercise.interval.civil_start_time >= "2026-07-05" AND exercise.interval.civil_start_time < "2026-07-13"`(終了日が `2026-07-12` の場合。`functions/src/dataSources/googleHealth/client.ts` の `buildCivilDateRangeFilter`/`nextCivilDate` 参照)。
- DataPointのレスポンス構造は `{name: "users/me/dataTypes/exercise/dataPoints/{id}", exercise: {interval: {startTime, endTime}, exerciseType, metricsSummary: {caloriesKcal, distanceMillimeters, averageHeartRateBeatsPerMinute, ...}}}` という形。`normalize.ts` はこの構造に基づいて実装済み(`exerciseType` の日本語ラベル化は主要な種目のみ対応、未知の種目はフォーマットした英語表記にフォールバック)。ただし `splits`/`exerciseEvents` 等の詳細フィールドは現時点で未活用。
- 同期ロジック(`functions/src/dataSources/googleHealth/sync.ts`)は直近7日分を毎回取得して冪等upsertする単純な方式。
- **GPSトラック(ウォーキング・サイクリング等)の取込**: `dataPoints.list`(`listExercises`)のレスポンスには座標は含まれず、`users.dataTypes.dataPoints` リソースのカスタムメソッド `exportExerciseTcx`(`GET /v4/{name=users/*/dataTypes/exercise/dataPoints/*}:exportExerciseTcx?alt=media`)を別途呼び出してTCX(Training Center XML v2)形式で取得する必要がある(`functions/src/dataSources/googleHealth/client.ts` の `fetchExerciseTcx`)。`alt=media` を付けないとTCX本体ではなく `{tcxData: "..."}` というJSONラッパーが返るため必須。このメソッドは `activity_and_fitness` に加えて `location` スコープが別途必要で(未同意の場合403になる)、既存にGoogle Healthを接続済みのユーザーは**再接続(OAuth再同意)が必要**(コード化不可、ユーザー側作業。`docs/manual-setup-checklist.md` 参照)。TCXのパースは正規表現ベースの軽量実装(`functions/src/dataSources/googleHealth/tcx.ts` の `parseTcxTrackpoints`)で、汎用XMLパーサは導入していない(Google Health API自身が生成する構造が固定されたマシン生成データであるため)。GPS点列は `functions/src/lib/gpsTrackStorage.ts` の `saveGpsTrack` を再利用してFirebase Storageに外部化し(`gpsTracks/google_health_exercise/{logEntryId}.json.gz`)、Google Maps Timelineの `timelinePath`([ADR-0007](0007-google-maps-timeline-manual-import.md))とは異なり**別のlogEntryを作らず、同じエクササイズのlogEntryの `raw.gpsTrack`(storagePath/pointCount/boundingBoxのみ)と `location`(先頭座標)に合成する**(`normalize.ts` の `attachGpsTrack`)。全てのエクササイズにGPSがあるわけではなく、GPS有無を示す専用フィールド(`exerciseMetadata.hasGps`等)がAPIに存在するかは実接続で確認できなかったため、`metricsSummary.distanceMillimeters` の有無(距離メトリクスを持つ=屋外系種目である可能性が高い)という保守的な指標で `exportExerciseTcx` 呼び出し対象を絞り込んでいる(`normalize.ts` の `mayHaveGpsTrack`)。TCX取得・パース結果が0点の場合(屋内エクササイズ、スコープ未同意等)はGPSトラックなしの通常のエクササイズエントリとして扱い、同期全体は失敗させない。

## Consequences

- データタイプ `exercise` がサポートする `reconcile` 操作(増分同期向け)への切り替えは、実装時に本当に必要か検討する(現状は7日分の全量取得で妥協している)。
- 食事・睡眠・体重記録への拡張は [ADR-0010](0010-google-health-nutrition-sleep-weight.md) を参照。
