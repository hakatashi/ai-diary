# ADR-0003: 複数データソース統合を見据えた正規化Firestoreスキーマ(`logEntries`中心)

- Status: Accepted
- Phase: フェーズ1(基盤)、フェーズ2で拡張

## Context

複数のデータソース(家計簿、位置情報、写真、カレンダー、Home Assistant、SNS等)を1つの日誌として統合表示するには、ソースごとにバラバラなスキーマではなく、横断的にクエリできる共通の時系列ログモデルが必要だった。

## Decision

```
dataSources/{dataSourceId}       -- データソースのメタデータ(接続状態、最終同期日時等)。クライアント読み取り可
dataSourceSecrets/{dataSourceId} -- 認証情報。クライアント完全遮断
oauthStates/{state}              -- OAuth CSRF対策の使い捨てトークン。クライアント完全遮断
logEntries/{logEntryId}          -- 正規化された時系列ログ。将来の全データソースがここに集約される
journalEntries/{date}            -- 日毎の日誌(手動メモ、将来はAI要約もここに追加)
placesCache/{placeId}            -- Google Places API (New) で解決した場所詳細のキャッシュ。クライアント完全遮断
placesApiUsage/{yyyy-mm}         -- Places APIの月間呼び出し回数カウンタ(無料枠管理用)。クライアント完全遮断
```

`logEntries` が本アプリの中核。ドキュメントIDは `${sourceType}:${sourceRecordId}` から決定的に生成する(`normalize.ts` 内でSHA-256ハッシュ化)ことで、再同期時の冪等なupsertを保証する。フィールド設計:

- `sourceType`: データソース内での細かい種別(例: `google_health_exercise`)。1つの `dataSources` エントリが将来複数の `sourceType` を出すケースを想定
- `category`: UI表示用の粗い分類(`exercise`, `nutrition`, `sleep`, `weight`, 将来 `finance`/`location`/`media`/`social`/`home`)
- `date`: `YYYY-MM-DD`(Asia/Tokyo基準)。日別一覧クエリのキー
- `metrics`: ソース横断で比較可能な数値のみ(継続時間、距離、カロリー等)
- `raw`: 元データをほぼそのまま保持(再要約・再処理に備える。ドキュメント1MiB上限に注意。GPSトラック等大容量データは [ADR-0007](0007-google-maps-timeline-manual-import.md) の外部化方式を参照)
- `hidden` / `dedupedInto`: 意味的重複統合で他エントリに吸収された場合に `hidden: true` かつ `dedupedInto` に統合先の `logEntryId` を設定する。**削除はしない**(生データは保持し、統合ロジックの見直しで復元できるようにする)。

### 意味的重複の名寄せ(Google Maps訪問履歴 ⇔ Swarmチェックイン)

`functions/src/dataSources/dedup/dedupeVisitsAndCheckins.ts` で実装済み。`sourceType === 'google_maps_visit'` のエントリと `category === 'checkin'`(Swarm)のエントリについて、`startAt` の差が20分以内かつ位置(haversine距離)が200m以内の場合に同一訪問イベントとみなし、Swarm側を `hidden` にする。Swarm同期後・Maps Timelineインポート後に対象日付で自動実行されるほか、`/data-sources` の「メンテナンス」セクションから任意の日付範囲で手動再実行できる(`dedupeLogEntriesNow` Callable)。対象日付ごとのクエリは `mapWithConcurrency` で並列実行し(同時実行数20)、マッチした更新は日付ごとに個別commitせず全日付分をまとめてから `WriteBatch` でコミットする(大量インポート時のFirestore往復回数を削減するため)。

## Consequences

- **クライアント側の一覧系クエリは `hidden === true` のエントリを表示しない**(`src/lib/logEntries.ts` の `visibleLogEntries`/`isVisible` で統一的にフィルタする)。Firestoreの `!=` フィルタはフィールド欠如ドキュメントを暗黙に除外してしまうため、あえてクエリではなくクライアント側フィルタとしている。新しい一覧系クエリを書く際は必ずこのヘルパーを経由すること。
- 他の組み合わせ(例: Google Calendarの予定とImmichの写真)の統合は未実装。しきい値(20分/200m)は保守的な初期値であり、実データでの調整が必要になる可能性がある。
