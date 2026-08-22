# ADR-0010: Google Health連携の拡張(食事・睡眠・体重記録)

- Status: Accepted
- Phase: フェーズ2

## Context

運動記録([ADR-0011](0011-google-health-api-integration-details.md))に加えて、食事(`nutrition-log`)・睡眠(`sleep`)・体重(`weight`)の3データタイプを取り込むことにした。

## Decision

`functions/src/dataSources/googleHealth/{client,normalize,sync}.ts` に実装。それぞれ新しい `sourceType`(`google_health_nutrition`/`google_health_sleep`/`google_health_weight`)・`category`(`nutrition`/`sleep`/`weight`)を追加し、`src/lib/schema.d.ts`・一覧ページ・日誌ページのアイコン/ラベルマップ・`JournalMap.tsx` の `CATEGORY_COLOR` を合わせて更新済み(位置情報を持たないためピン表示はされない)。

**各データタイプは運動記録とは別のOAuthスコープが必要**(公式リファレンス https://developers.google.com/health/scopes 参照)。食事は `googlehealth.nutrition.readonly`、睡眠は `googlehealth.sleep.readonly`、体重は `googlehealth.health_metrics_and_measurements.readonly`。全スコープを実際に付与した本番のrefresh tokenを使い、`dataPoints.list` を直接叩いて以下の内容を全て実接続確認済み(2026年8月)。

**`dataPoints.list` のフィルタ構文はデータタイプの「種類」によって異なる**(公式リファレンス https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/list で確認、実接続でも検証済み):

- `nutrition-log` は `exercise` と同じセッション種別のため、civil date範囲フィルタパターンを使う。**ただしfilter式のパス先頭はURLパスセグメント(kebab-case)の `nutrition-log` でもJSONレスポンスのフィールド名(camelCase)の `nutritionLog` でもなく、ハイフンをアンダースコアに置き換えた `nutrition_log` を使う必要がある**(`nutrition_log.interval.civil_start_time >= "..." AND ... < "..."`)。実接続で前者2つを試したところどちらも `INVALID_DATA_POINT_FILTER_DATA_TYPE_RESTRICTION`(`Restriction member path segment '...' does not match any data type`)エラーとなり、`nutrition_log`(アンダースコア区切り)で初めて成功することを本番のrefresh tokenを使った実接続で確認した。exercise/sleep/weightはdataTypeIdにハイフンを含まないためこの問題は起きない(`client.ts` の `buildCivilDateRangeFilter` を共通化して利用)。
- `sleep` はセッション種別の例外(ECGと同様)で、civil dateではなく素の `sleep.interval.end_time >= "ISO" AND ... < "ISO"` というRFC 3339タイムスタンプによる範囲フィルタが使える(公式リファレンスに明記、実接続でも成功を確認済み)。
- `weight` はサンプル種別のデータタイプで、`weight.sample_time.physical_time >= "ISO" AND ... < "ISO"` というタイムスタンプ範囲フィルタを使う(実接続でも成功を確認済み)。sleep/weightのタイムスタンプフィルタは `buildTimestampRangeFilter` として共通化(`client.ts`)。

**レスポンスのJSONスキーマ**(本番のrefresh tokenを使った実接続で確認済み。int64型フィールドはprotobufのJSON表現として文字列で返る点に注意):

- `nutrition-log`: `{name, nutritionLog: {interval: {startTime, endTime}, mealType, foodDisplayName, energy: {kcal}, totalCarbohydrate: {grams}, totalFat: {grams}, nutrients: [{nutrient, quantity: {grams}}]}}`。**`energy` は公式リファレンスが示す `EnergyQuantity{value, unit}` 形式ではなく `{kcal: number}` という実装依存の形で返ることを実接続で確認した**(`normalize.ts` はこの実際の形に合わせて実装)。`mealType`(`BREAKFAST`/`LUNCH`/`DINNER`/`SNACK`等)を日本語ラベル化してtitleに、`foodDisplayName` をsummaryに、`energy.kcal` を `metrics.calories` に格納する(`normalize.ts` の `normalizeNutritionLog`)。栄養素の詳細(`nutrients[]`、`totalCarbohydrate`/`totalFat`等)は現時点で未活用(rawには保持)。
- `sleep`: `{name, sleep: {interval: {startTime, endTime}, type, stages: [...], metadata: {...}, summary: {minutesAsleep, minutesAwake, minutesInSleepPeriod, minutesToFallAsleep, minutesAfterWakeUp, stagesSummary: [{type, minutes, count}]}}}`。公式リファレンス通りの構造であることを実接続で確認済み。`minutesAsleep` を `metrics.durationMinutes` に、`stagesSummary` を日本語ラベル化して睡眠段階の内訳文字列としてsummaryに整形する(`normalize.ts` の `normalizeSleep`/`formatSleepSummary`)。
- `weight`: `{name, weight: {sampleTime: {physicalTime, utcOffset, civilTime}, notes, weightGrams}}`。公式リファレンス通りの構造であることを実接続で確認済み。`weightGrams / 1000` を新設した `metrics.weightKilograms` に格納する(`normalize.ts` の `normalizeWeight`)。

**同期関数は `syncGoogleHealthExercises` から `syncGoogleHealth` にリネームし、4データタイプ(exercise/nutrition/sleep/weight)を独立にtry/catchする設計にした。** 体重のように未同意スコープで403が起きるデータタイプが1つあっても他の同期を止めないため。全データタイプ成功なら `lastSyncStatus: 'success'`、一部成功なら `'partial'`、全滅なら `'error'`(かつ `dataSources.status` も `'error'` にしてCallable呼び出し元にthrowする)。`lastSyncError` には失敗したデータタイプ名とエラーメッセージを `/` 区切りで結合して格納する。

## Consequences

- 既にGoogle Healthを接続済みのユーザーは再接続(OAuth再同意)が必要(`docs/manual-setup-checklist.md` 参照)。再接続しないと該当データタイプの同期のみ403で失敗し続ける(既存の運動記録同期には影響しない)。
