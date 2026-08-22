# ADR-0012: PlayniteからのPCゲームプレイ記録はpush型・専用ingestトークン認証で取り込む

- Status: Accepted
- Phase: フェーズ3着手前の追加データソース

## Context

PCゲームのプレイ記録(いつ・どのゲームを・どれだけプレイしたか)を日誌に取り込みたい。ユーザーはSteam/Epic Games等のストア経由のゲームと、それらと独立にインストールしたゲームの両方を[Playnite](https://playnite.link/)で統一管理・起動している。

Playnite本体は累積プレイ時間と最終プレイ日時のみを保持し、セッション単位の開始・終了時刻は保持しない。一方、Playniteの拡張機能(PowerShellスクリプトまたはC#プラグイン)は `OnGameStarted`/`OnGameStopped` イベントにフックでき、`OnGameStopped` のイベント引数には `Game`(ゲーム名・`Source.Name` でストア種別)に加え、そのセッションの実プレイ秒数 `ElapsedSeconds` が渡される([Playnite拡張イベントドキュメント](https://api.playnite.link/docs/tutorials/extensions/events.html))。

PlayniteはユーザーのローカルPCで動作するため、ai-diary側からPlayniteのデータを能動的に取得(pull)する手段がない。データは常にローカル→クラウドのpushでしか届かない。

また、Playniteの拡張(PowerShellスクリプト)はブラウザではないため、Firebase Authenticationのインタラクティブサインインができない。[ADR-0004](0004-callable-functions-centric-design.md)の「認証が必要な処理は`onCall`がデフォルト、`onRequest`はブラウザの生ナビゲーションのみ」という原則にそのままでは当てはまらない。

## Decision

- **セッションは`OnGameStopped`発火時のみ記録する。** `終了時刻 − ElapsedSeconds`で開始時刻を算出し、1件の確定した完了セッションとしてPOSTする(`OnGameStarted`時点でのin-progressドキュメントは作らない)。これにより実装がシンプルになり、書き込みも冪等な1回のupsertで完結する。
- **認証はImmich([ADR-0008](0008-immich-photo-source.md))の逆パターンとする。** ai-diary側が`connectPlaynite`(`onCall`)でランダムなingestトークンを発行して`dataSourceSecrets/playnite`に保存し、ユーザーが画面に一度だけ表示されるトークンをPlaynite拡張のローカル設定ファイルにコピーする。新設の`recordPlayniteSession`は`onRequest`とし、`Authorization: Bearer <token>`ヘッダーを`crypto.timingSafeEqual`で検証してから`logEntries`に書き込む。これは**ADR-0004の「onRequestはブラウザの生ナビゲーションのみ」という原則からの意図的な逸脱**であり、「非ブラウザ・非対話クライアントからのpush」という新しいケースへの対応として追加する。
- Playnite拡張スクリプト(PowerShell、`.psm1`)はこのリポジトリ内の`playnite-extension/`で管理する。TypeScript側のingestエンドポイント契約と密結合なため、別リポジトリに分離するメリットが薄い。
- `logEntries`に`sourceType: 'playnite_session'`、`category: 'game'`を新設する([ADR-0003](0003-firestore-normalized-log-entries-schema.md)のカテゴリ一覧に追加)。

## Consequences

- Playnite/PCのクラッシュ・強制終了時は`OnGameStopped`が発火せず、そのセッションは記録されない。POST時にネットワーク接続がない場合も同様にそのセッションは失われる。個人利用のライフログという性質上、リトライキュー等は現時点では作らず許容する(将来的に必要になれば拡張スクリプト側にローカル再送キューを追加する形で対応可能)。
- Playniteを経由せず直接起動したゲーム(まれ)は対象外。
- `recordPlayniteSession`はインターネットに素で露出するエンドポイントになるため、トークン比較は`timingSafeEqual`を使い、トークン自体は32バイトのランダム値(`crypto.randomBytes(32)`)とする。
- `dataSourceSecrets/playnite`の`payload.apiKey`は、Immichのように外部サービスへの認証に使う値ではなく、ai-diary自身が発行してPlaynite拡張に検証させる値である点が他のデータソースと異なる(フィールド自体は使い回すが意味が逆転している)。
- Playnite拡張の`OnGameStopped`実装で、PCのスリープ中に`ElapsedSeconds`が加算され続けるかどうかは未検証。実際の挙動と乖離が確認された場合はこのADRに追記する。
