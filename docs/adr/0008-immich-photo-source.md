# ADR-0008: 写真データソースはImmich(自己ホスト)。APIキー認証・定期自動同期対応

- Status: Accepted
- Phase: フェーズ2(Google Photosから移行)

## Context

当初フェーズ2ではGoogle Photosと連携していたが、2025年3月末にGoogleが `photoslibrary.readonly` などの広範な読み取りスコープを廃止し、既存ライブラリへの自動バックグラウンド同期が技術的に不可能になった(参照: https://developers.google.com/photos/support/updates )。そのためPicker APIによる都度手動インポートのみの実装になっていたが、運用してみると手動インポートの手間が大きかった。

## Decision

セルフホストの[Immich](https://immich.app/)への移行に伴いGoogle Photos連携を廃止し、Immich連携に置き換えた。

Immichは自ホストサーバーでOAuthを持たず、ユーザー自身が発行したAPIキーで認証する。**このため他のデータソースと異なりOAuthフローが不要で、`dataSourceSecrets/immich` の `credentialType` は `api_key`(サーバーURL・APIキーをそのままペイロードに保存)になる。** ユーザーがブラウザから直接入力する認証情報の一般原則([ADR-0002](0002-secret-manager-vs-firestore-secrets.md))通り、専用のCallable Function `connectImmich`(`functions/src/dataSources/immich/connect.ts`)がAdmin SDK経由でFirestoreに書き込む。`connectImmich` は保存前に `GET {serverUrl}/users/me` を叩いてAPIキーの有効性を検証する。

写真本体を自前でホストしているため、Google Photosと異なり**定期自動同期(`scheduledSync`)の対象に含まれる**(`functions/src/dataSources/immich/sync.ts` の `syncImmichPhotos`)。一覧取得には `POST {serverUrl}/search/metadata` を使う(`functions/src/dataSources/immich/client.ts`)。

## Consequences

実接続で判明した仕様:

- `takenAfter`/`takenBefore` フィルタは日付のみの文字列(`YYYY-MM-DD`)ではエラーになり、**タイムゾーンオフセット付きのISO 8601日時文字列(例: `2026-08-01T00:00:00.000Z`)が必須**。
- レスポンスは `{assets: {items: [...], nextPage: "2" | null}}` の形。`nextPage` を使ってページング。
- 通常同期(3時間おき)は直近7日分のみ取得し、既存ドキュメントの `createdAt` を保持するため事前読み取りを行う(Google Calendar/Swarm同期と同方式)。手動の「全期間を同期」(`fullBackfill: true`)は暴走防止のためページ数上限(最大10,000件)を設け、Google Maps Timelineインポート([ADR-0007](0007-google-maps-timeline-manual-import.md))と同様に事前読み取りを省いたバッチ書き込みで完結させる(この場合 `createdAt` も上書きされる)。
- `localDateTime` フィールドは撮影地点の壁時計時刻を(実際のUTCではなく)`Z` 付きのISO文字列として返すImmich独自の仕様。`date` フィールドの算出にはこの文字列の日付部分をそのまま使い、Google Photos連携時のような固定タイムゾーン(Asia/Tokyo)での再計算はしない(`functions/src/dataSources/immich/normalize.ts`)。`startAt` には実際のUTC時刻である `fileCreatedAt` を使う。
- Immichの自己ホストサーバーがネットワーク的にCloud Functionsから到達可能であることが前提(リバースプロキシ・DDNS等はユーザー側の運用に依存し、コード化不可)。サーバーが到達不能な間は同期が `error` ステータスになるのみで、リトライは次回のスケジュール実行を待つ簡易的な設計。
- APIキー発行時の権限設定(`asset.view`)については `docs/manual-setup-checklist.md` 参照。
