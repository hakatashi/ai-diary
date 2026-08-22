# 手動セットアップチェックリスト

コード化不可、ユーザー(hakatashi)自身の作業が必要な手順の一覧。新しいデータソースを接続する時や、デプロイ後の初回動作確認時に参照する。

## フェーズ1: 認証基盤 + Google Health

1. Firebase Console → Authentication → Sign-in method → Google 有効化(**完了済み**)。
2. Google Cloud Console → APIs & Services → Library で Google Health API を有効化。
3. Google Cloud Console → OAuth consent screen → スコープに `googlehealth.activity_and_fitness.readonly`(運動記録)と `googlehealth.location.readonly`(GPSトラック取得用)を追加、公開ステータスを「本番」に変更。
4. Google Cloud Console → Credentials → 既存OAuthクライアント(`GOOGLE_CLIENT_ID`)に `https://asia-northeast1-hakatadiary.cloudfunctions.net/googleHealthOAuthCallback` を承認済みリダイレクトURIとして追加。
5. デプロイ後、`/data-sources` から「接続」ボタンでGoogle Healthとの実際の接続確認を行う。

## フェーズ2追加分

6. Google Cloud Console → APIs & Services → Library で **Google Calendar API** を有効化し、OAuth consent screenのスコープに `calendar.readonly` を追加。
7. Google Cloud Console → Credentials → 既存OAuthクライアントに `https://asia-northeast1-hakatadiary.cloudfunctions.net/googleCalendarOAuthCallback` をリダイレクトURIとして追加。
8. Google Cloud Console → APIs & Services → Library で **Places API (New)** を有効化し、APIキーを発行(Places API (New) の Place Details にのみ制限することを推奨)。発行したキーを `firebase functions:secrets:set GOOGLE_PLACES_API_KEY` でSecret Managerに登録する。未設定の間はGoogle Maps Timelineインポート時に場所名の代わりに緯度経度が表示される(フォールバック動作、インポート自体は失敗しない。詳細: [ADR-0007](adr/0007-google-maps-timeline-manual-import.md))。
9. [Foursquare Developer Portal](https://foursquare.com/developers/apps) で作成済みのアプリの設定画面から、`https://asia-northeast1-hakatadiary.cloudfunctions.net/swarmOAuthCallback` をリダイレクトURIとして登録する。
10. `firebase functions:secrets:set FOURSQUARE_OAUTH_CLIENT_SECRET` でSecret Managerに登録する(値は `.env` の `FOURSQUARE_OAUTH_CLIENT_SECRET` と同じ)。
11. Immichサーバーの管理画面(Account Settings → API Keys)でAPIキーを発行する。Secret Managerには登録せず、`/data-sources` の画面からサーバーURL(例: `https://immich.example.com/api`)とAPIキーを直接入力して接続する(`connectImmich` Callable経由で `dataSourceSecrets/immich` に保存される。詳細: [ADR-0008](adr/0008-immich-photo-source.md))。**APIキー発行時に選択する権限(Permissions)には `Asset > View`(`asset.view`)を含める必要がある。** `connectImmich` が呼ぶ `GET /users/me` はこの権限がなくても成功するため接続自体は完了してしまうが、サムネイル取得(`getImmichThumbnail`、`GET /assets/{id}/thumbnail`)は権限不足だと `403 Missing required permission: asset.view` で失敗する(実接続で確認済み)。日誌ページの写真表示を使う場合は、この権限を含めてAPIキーを再発行し、`/data-sources` から接続し直すこと。
12. デプロイ後、`/data-sources` から各データソースの「接続」ボタンで実際の接続確認を行う。特にSwarm(Foursquare API)は実フィールドが未検証のため、初回接続時にGoogle Health連携同様のトライアル&エラー修正が必要になる可能性が高い。
13. Firebase Console(または`firebase deploy`実行時の初回プロンプト)でCloud Storage for Firebaseを有効化する(未有効の場合、デフォルトバケットの作成先リージョンを選択するダイアログが表示されることがある)。GPSトラックの保存先として使用する(`storage.rules`/`firebase.json`の`storage`設定は実装済み)。
14. 既にGoogle Healthを接続済みの場合、`googlehealth.location.readonly` スコープ追加(上記3.)後に `/data-sources` から**Google Healthを再接続(再度「接続」ボタンからOAuth同意をやり直す)**する。既存のrefresh tokenにはこのスコープが含まれていないため、再接続しないとGPSトラック取得(`exportExerciseTcx`)が403で失敗し続ける(通常のエクササイズ同期自体には影響しない)。
15. Cloud Storageバケットに `storage.cors.json` のCORS設定を適用する: `gcloud storage buckets update gs://hakatadiary.firebasestorage.app --cors-file=storage.cors.json`(`firebase deploy`ではバケットのCORS設定は反映されないため、Hostingドメインを変更した場合等はこのコマンドを再実行すること)。未適用のままだと日誌ページの地図でGPSトラックがCORSエラーで読み込めない(実接続で確認済み。詳細: [ADR-0009](adr/0009-journal-map-and-photos.md))。

## 食事・睡眠・体重記録追加分

16. Google Cloud Console → OAuth consent screen → スコープに `googlehealth.nutrition.readonly`(食事)・`googlehealth.sleep.readonly`(睡眠)・`googlehealth.health_metrics_and_measurements.readonly`(体重)を追加する。
17. 既にGoogle Healthを接続済みの場合、上記16.のスコープ追加後に `/data-sources` から**Google Healthを再接続(再度「接続」ボタンからOAuth同意をやり直す)**する。既存のrefresh tokenにはこれらのスコープが含まれていないため、再接続しないと食事・睡眠・体重の同期が403で失敗し続ける(既存の運動記録同期自体には影響しない。`syncGoogleHealth` はデータタイプごとに独立してエラー処理するため、この間は `lastSyncStatus: 'partial'` となり `lastSyncError` にどのデータタイプが失敗したかが表示される)。
18. デプロイ・再接続後、`/data-sources` から「今すぐ同期」を実行し、食事・睡眠・体重の記録が日誌ページに表示されることを確認する。フィルタ構文・レスポンススキーマは本番のrefresh tokenを使った実接続で検証済み(詳細: [ADR-0010](adr/0010-google-health-nutrition-sleep-weight.md))。
