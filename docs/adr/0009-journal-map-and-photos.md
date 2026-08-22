# ADR-0009: 日誌ページの地図・写真表示(issue #33)

- Status: Accepted
- Phase: フェーズ2

## Context

日誌ページ(`src/routes/[date].tsx`)の左パネルに、その日の訪問地点・GPS経路を表示する地図と、Immich写真のサムネイル横スクロール(クリックでライトボックス表示)を実装した。

## Decision

**地図描画ライブラリはLeaflet(+ OpenStreetMapタイル)を採用した。** Google Maps JS APIは別途APIキー・課金設定が必要になり、Places API (New)以外の新規Google Cloud API有効化・予算管理が発生するため、個人利用規模でAPIキー不要・無料で使えるLeaflet + OSMタイルを選んだ。地図タイルはCSSの `filter: grayscale(1) contrast(1.1)` で加工し(`.journal-map .leaflet-tile-pane`、`src/app.css`)、アプリ全体のモノクロ+アクセントカラーというデザイントーンに合わせている。マーカー・経路線はこのフィルタの対象外にする必要があるため、フィルタはLeafletの `.leaflet-tile-pane` にのみスコープし、地図コンテナ全体には適用しない(`src/components/JournalMap.tsx`)。

表示対象は当日の`logEntries`のうち `location` を持つもの(ピン表示)と、GPSトラックを持つもの(`sourceType === 'google_maps_path'` の `raw.storagePath`、または `google_health_exercise` の `raw.gpsTrack.storagePath`)。トラック点列はFirebase Storageから取得する(`src/lib/gpsTrack.ts`)。マーカー・経路が1件もない日は、地図の上に「この日の位置情報はまだありません」というオーバーレイを表示する。

**Immich写真のサムネイル取得は、Callable Function `getImmichThumbnail`(`functions/src/dataSources/immich/thumbnail.ts`)経由でbase64 data URLとして返す方式にした。** ImmichはユーザーがOAuthを持たない自己ホストサーバーで、APIキーはFunctions側のみが保持しているため、クライアントから直接サムネイルURLを叩くことはできない。バイナリレスポンスをそのままストリームするonRequestプロキシ(CORS・Authorizationヘッダの手動検証が必要)も検討したが、個人利用規模の写真枚数・解像度であればbase64化のオーバーヘッドは無視できると判断し、既存の「Callable Functions中心設計」([ADR-0004](0004-callable-functions-centric-design.md))を崩さない実装を優先した。サムネイル一覧は `size=thumbnail`、ライトボックス表示時のみ `size=preview` を追加取得する(`src/components/PhotoStrip.tsx`)。取得結果はモジュールスコープの `Map` でセッション中キャッシュし、日付間を行き来しても再取得しない。写真は元の色味のまま表示する(地図タイルと異なり、あえてグレースケール加工はしていない)。

## Consequences

- **GPSトラックのオブジェクトは`contentEncoding: gzip`メタデータ付きで保存されており(`gpsTrackStorage.ts`)、手動でのgzip解凍は行わない。** ブラウザは`fetch()`実行時に常に`Accept-Encoding: gzip`を送るため、Google Cloud Storageは圧縮済みバイト列を`Content-Encoding: gzip`付きで返し、ブラウザ側のfetch実装がこれを透過的に解凍してから`response.json()`等に渡す(標準的なHTTP Content-Encodingの挙動)。実装当初はここに`DecompressionStream('gzip')`を追加で通していたが、これは二重解凍になり不正なgzipヘッダとしてエラーになる(実機検証で発覚・修正済み)。
- **Firebase Storageのダウンロード(`getDownloadURL`で取得したURLへの`fetch()`)にはバケットのCORS設定が必要。** デフォルトではCORS未設定のため、本番デプロイ後に地図ページで `Access to fetch ... has been blocked by CORS policy` エラーが発生した(実機検証で発覚)。リポジトリ直下の `storage.cors.json` にオリジン(`https://hakatadiary.web.app`・`https://hakatadiary.firebaseapp.com`)・`GET`メソッドを許可する設定を用意し、`gcloud storage buckets update gs://hakatadiary.firebasestorage.app --cors-file=storage.cors.json` で適用する(Firebase CLIにCORS設定用コマンドはなく、`gcloud`/`gsutil`での手動適用が必要。バケットのCORS設定自体はfirebase.json等のプロジェクト設定ファイルでは管理されないため、ドメイン変更時等は再度手動適用が必要)。
- GPSトラックの取得失敗(個別トラックのStorage読み取りエラー等)やサムネイル取得失敗は、該当箇所のみ表示をスキップし、地図・写真一覧全体の描画は止めない設計にしている。
- 地図は訪問地点のピンとGPS経路の線表示のみで、経路の移動手段(徒歩/電車/自動車等)による線種の描き分けや、地図上での複数日横断表示は未実装(将来検討)。
