# 既知の制約・今後の検討事項

## データ取込の制約

- Google Maps Timelineの `timelinePath`(生GPSトラック)・`timelineMemory`(思い出メモ)、およびGoogle Healthのエクササイズ(ウォーキング/サイクリング等)のGPSトラックは取込済み(いずれもFirebase Storageに外部化。詳細: [ADR-0007](adr/0007-google-maps-timeline-manual-import.md)、[ADR-0011](adr/0011-google-health-api-integration-details.md))。Google Maps Timelineのトップレベルの `rawSignals`(生GPS/Wi-Fi信号)・`userLocationProfile`(頻出地点プロファイル)は日誌としての価値が低い/データモデルに馴染まないと判断し、意図的に未取込のまま。
- 日誌ページの地図(Leaflet)は訪問地点のピンとGPS経路の線表示のみで、経路の移動手段(徒歩/電車/自動車等)による線種の描き分けや、地図上での複数日横断表示は未実装(将来検討)。
- Immichの自己ホストサーバーがネットワーク的にCloud Functionsから到達可能であることが前提。サーバーが到達不能な間は同期が `error` ステータスになるのみで、リトライは次回のスケジュール実行を待つ簡易的な設計。
- Swarm(Foursquare v2 API `/v2/users/self/checkins`)のレスポンス実フィールドはドキュメントからの推定で実装しており未検証。初回実接続時にGoogle Health連携同様のトライアル&エラー修正が必要になる可能性が高い。また同エンドポイントを含むv2レガシーAPIは2026年5月15日に廃止予定とFoursquareが告知しており、将来的な再移行が必要になる見込み。
- 複数データソース間の意味的重複統合は、Google Maps訪問記録⇔Swarmチェックインの組み合わせのみ実装済み([ADR-0003](adr/0003-firestore-normalized-log-entries-schema.md))。しきい値(20分/200m)は保守的な初期値であり、実データでの調整が必要になる可能性がある。Google Calendarの予定⇔Immichの写真など、他の組み合わせの統合は未実装。
- AIパートナーの複数ペルソナ・長期記憶のFirestoreスキーマはフェーズ4で設計する(現時点では未着手)。
- Playniteのゲームセッション記録(`playnite-extension/`)はpush型かつ`OnGameStopped`確定時の単発送信のため、Playnite/PCのクラッシュ時やPOST時にオフラインだった場合はそのセッションが記録漏れになる(再送キュー未実装)。Playniteを経由せず直接起動したゲームも対象外。詳細: [ADR-0012](adr/0012-playnite-game-session-ingest.md)。
- ZaimのOAuth 1.0aはrequest token取得のみ実接続で検証済み(実装ミスを1件検出・修正済み)。authorize〜access token交換の完全なフローは対話的なユーザー同意が必要なため未検証で、初回接続時にSwarm連携時と同様のトライアル&エラー修正が必要になる可能性が残る。詳細: [ADR-0013](adr/0013-zaim-moneyforward-finance-integration.md)。
- 家計簿統合(Zaim/Moneyforward)はJPY以外の通貨に非対応(Zaimの`currency_code`は無視し常にJPYとして扱う)。Zaim⇔Moneyforwardの重複統合は「同日・同額」のみで判定するため、同日に同額の別取引が複数ある場合に誤マッチする可能性がある。手動振り分けルール(`financeRules`)は優先度制御がなく「作成順で最初にマッチしたもの」のみ採用される。詳細: [ADR-0013](adr/0013-zaim-moneyforward-finance-integration.md)。

## 将来フェーズで必要になる認証情報

フェーズ1・2は `.env`/`functions/.env.hakatadiary` の既存キー(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY`, `FOURSQUARE_OAUTH_CLIENT_ID`, `FOURSQUARE_OAUTH_CLIENT_SECRET`)のみで完結している(Google Calendar/Photos/MapsはGOOGLE_CLIENT_ID/SECRETを再利用)。`GOOGLE_PLACES_API_KEY` はコードは実装済みだがまだ値が用意されておらず、Secret Managerへの登録が未完了(`docs/manual-setup-checklist.md` 参照)。フェーズ3で `ZAIM_CONSUMER_KEY`/`ZAIM_CONSUMER_SECRET` が追加された(Moneyforwardは手動CSVエクスポートのみのためAPI認証情報は不要)。以下は将来フェーズで必要になる:

- **フェーズ4**: Web Push用VAPIDキーペア
- **フェーズ5**: Home Assistantの長期アクセストークン+ベースURL、X(Twitter) APIのベアラートークン、Mastodonインスタンスのアクセストークン+インスタンスURL
