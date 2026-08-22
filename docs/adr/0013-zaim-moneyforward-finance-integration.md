# ADR-0013: 家計簿統合(Zaim REST API + Moneyforward手動CSV、重複統合・手動ルール)

- Status: Accepted
- Phase: フェーズ3

## Context

家計簿はZaim(手動記録、REST APIあり)とMoneyforward(口座等からの自動記録、手動CSVエクスポートのみ)の2サービスで管理している。両者には同一支出の重複記録が発生し、Moneyforward側は自動記録ゆえに品目・場所などの詳細が欠落しがちである。これらを表示上で統合し、支出の内訳・推移を可視化し、手動ルールによる自動カテゴリ振り分けを行う必要がある(元データへの書き戻しや独自マスターデータ作成は行わない)。

## Decision

### スキーマ拡張

`LogEntry` に `finance: FinanceDetails | null` を追加(`location` と同様、カテゴリ固有の構造化フィールドとして追加。`metrics` はソース横断で単純比較できる数値専用のため流用しない)。

```ts
interface FinanceDetails {
  amountYen: number; // 支出は負、収入は正。振替(isTransfer)は集計対象外なので符号は参考値
  majorCategory: string; // 表示・集計に使う実効カテゴリ(ルール適用後)
  minorCategory: string | null;
  sourceMajorCategory: string; // データソース側の元カテゴリ(ルール再適用の起点)
  sourceMinorCategory: string | null;
  account: string | null; // Zaimの口座名 / Moneyforwardの保有金融機関名
  isTransfer: boolean; // 口座間振替(集計対象外)
  matchedRuleId: string | null; // 適用された自動振り分けルールのID
}
```

`sourceType` に `zaim_money` / `moneyforward_transaction`、`category` に `finance` を追加。JPY以外の通貨(Zaimは複数通貨対応)は本フェーズでは非対応(`known-issues.md` に記載)。

### Zaim: OAuth 1.0a + 定期同期

ZaimはOAuth 1.0a(3-legged)。エンドポイントは今回参照した `testing/Zaim REST API Reference.html`(メソッドリファレンスのみ)には含まれておらず、一般に公開されているZaim API仕様(request token: `POST https://api.zaim.net/v2/auth/request`、authorize: `https://auth.zaim.net/users/auth`、access token: `POST https://api.zaim.net/v2/auth/access`)に基づき実装した。

既存の `createGoogleOAuthFlow`(OAuth2用)は流用できないため、`functions/src/lib/zaimOAuth.ts` にOAuth 1.0a署名(HMAC-SHA1)を実装した(外部ライブラリは追加せず、Node標準の `crypto` のみで実装)。3-legged特有の「request token」と「callback」の間で `oauth_token_secret` を一時的に引き継ぐ必要があるため、`OAuthState` に `oauthTokenSecret?: string` を追加し、`oauthStates/{oauth_token}` に保存する(Google/Swarmの `state` と異なり、Zaimのcallbackは独自の `state` パラメータを持たず `oauth_token` 自体が相関キーになる)。

**実際の `ZAIM_CONSUMER_KEY`/`ZAIM_CONSUMER_SECRET` を使い、`obtainRequestToken`(request token取得)が本番のZaim API(`https://api.zaim.net/v2/auth/request`)に対して実際に200を返すことを確認済み。** この検証で、`oauth_callback` のような `oauth_` プレフィックスのパラメータは署名対象に含めるだけでなく **Authorizationヘッダ自体にも含める必要がある**(署名計算にのみ使い、ヘッダへの追加を忘れていたためリクエストトークン取得が401になる実装ミスがあった)ことが判明し、修正済み(`buildAuthHeader` は `oauth_` で始まるパラメータをすべてヘッダに含め、`mapping`/`start_date` 等の非oauthパラメータはヘッダに含めずクエリ文字列側にのみ載せる)。access token交換(`exchangeAccessToken`、`oauth_verifier` を使う)と実際のブラウザ経由の認可フロー(`/users/auth` でのユーザーログイン)自体は、ユーザー本人のZaimアカウントでの対話的な同意操作が必要なため未検証のまま(Swarm連携時と同様、初回接続時にさらなるトライアル&エラー修正が必要になる可能性がある。`known-issues.md` 参照)。

`DataSourceSecret.credentialType` に `oauth1_access_token` を、`DataSourceSecretPayload` に `accessTokenSecret` を追加。`ZAIM_CONSUMER_KEY`(`defineString`)・`ZAIM_CONSUMER_SECRET`(`defineSecret`)は既存の `googleClientId`/`googleClientSecret` と同じ扱い(ADR-0002)。

同期(`syncZaimMoney`)は `GET /v2/home/category` `/v2/home/genre` `/v2/home/account` で名前解決用マップを構築してから `GET /v2/home/money` をページングして取得する。通常同期は直近30日分(Zaimは手動入力のため数日遅れて記録されることを想定し、Google Calendarの7日より長め)、手動の「全期間を同期」はページ数上限(200ページ×100件=最大20,000件)を設けてIm mich同様の暴走防止を行う。

### Moneyforward: 手動CSVアップロード

MoneyforwardのCSV(Shift_JIS)はクライアント側で `TextDecoder('shift_jis')`(WHATWG Encoding Standardのラベル、追加ライブラリ不要)でデコードし、`src/lib/moneyforwardCsv.ts` の自前CSVパーサ(クォート・カンマのみの単純な形式のため外部ライブラリは追加しない)でパースする。CSVの `ID` 列がMoneyforward側で安定した一意キーであるため、これを `sourceRecordId` としてそのまま使い、`sha256(moneyforward_transaction:${id})` を決定的ドキュメントIDにする(ADR-0003準拠)。パース済み行はGoogle Maps Timelineインポートと同じ「クライアントでチャンク分割→Callable `importMoneyforwardRows` を複数回呼ぶ」方式で取り込む。`振替` 列が `1` のレコードは `finance.isTransfer = true` とし、大項目/中項目は `振替` に固定する(Zaimの `mode: "transfer"` と同じ扱い)。`計算対象` 列(振替とは別軸で、Moneyforward側の集計から除外するフラグ)が `0` のレコードも `finance.isTransfer = true` として支出・収入の集計・重複統合の対象外にするが、`振替` と異なりカテゴリ自体は上書きしない(実際にはMoneyforward側の運用上、この2列はほぼ同時に立つが独立した条件のため両方を判定する)。

### 重複統合(Zaim ⇔ Moneyforward)

`functions/src/dataSources/dedup/dedupeZaimAndMoneyforward.ts` に、既存の `dedupeVisitsAndCheckins.ts` と同じ構造で実装した。同一日付・同額(`finance.amountYen` の完全一致)のZaim記録とMoneyforward記録があれば、Moneyforward側を `hidden: true` にしてZaim側に `dedupedInto` で統合する(Zaimは手動入力で品目・場所等の詳細を持つため常にZaim側を残す)。同額候補が複数ある場合は口座名(`finance.account`)が一致するものを優先する。振替(`isTransfer: true`)は対象外。この処理はZaim同期後・Moneyforwardインポート後の両方で、影響を受けた日付について自動実行されるほか、既存の `dedupeLogEntriesNow`(手動メンテナンス用Callable)にも `dedupeVisitsAndCheckins` と並べて追加し、指定日付範囲で手動再実行できるようにした。

しきい値は「同日・同額」のみで位置情報のような連続値のマッチングがない分、Google Maps⇔Swarmの重複統合より単純だが、同日に同額の別取引が複数ある場合は誤マッチの可能性がある(`known-issues.md` に記載)。

### 手動振り分けルール

`financeRules/{ruleId}` コレクションを新設。`journalEntries` と同様、認証済みオーナーがクライアントから直接読み書きする(Callable Functionを介さない。単純な自分専用の設定データであり、書き込み時に複雑な検証が不要なため)。

```ts
interface FinanceRule {
  account: string | null; // 完全一致条件(nullなら任意)
  amountYen: number | null; // 完全一致条件(符号込み、nullなら任意)
  descriptionContains: string | null; // title(内容/place)への部分一致条件(nullなら任意)
  assignedMajorCategory: string;
  assignedMinorCategory: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

ルール適用(`functions/src/dataSources/finance/rules.ts` の `applyFinanceRules`)は **常に `sourceMajorCategory`/`sourceMinorCategory` を起点に再計算する**(既存の実効カテゴリを起点にしない)ことで、ルールの追加・変更後に再適用しても結果が発散しない(冪等)ようにしている。マッチ規則は「`financeRules` を `createdAt` 昇順で走査し、最初に条件を満たしたルールを採用」という単純な先勝ちで、優先度の並べ替えUIは実装しない(`known-issues.md` に記載)。ルールはZaim同期時・Moneyforwardインポート時に自動適用されるほか、ルールを追加・編集した後に過去データへ再適用するための `applyFinanceRulesNow` Callable(既存の `dedupeLogEntriesNow` と同じ日付範囲指定の手動メンテナンス操作)を用意した。日付範囲は `functions/src/lib/dateRange.ts` の `enumerateDates`(`dedupeLogEntriesNow` と共通化)で日付配列に展開し、`applyFinanceRulesToDates` が日付ごとに `where('date', '==', date).where('sourceType', 'in', ['zaim_money', 'moneyforward_transaction'])` で絞り込んでから走査する(`date` の範囲クエリ1本で全カテゴリを読んでからJS側でfinance系だけ絞り込む実装は、対象期間内の他カテゴリのドキュメントまで読み取ってしまうため採用しなかった)。この2条件はいずれも等価系フィルタ(`in`は等価の論理和)のため複合インデックスは不要(実接続で確認済み)。

### 可視化画面

`/finance/[month]` を新設。月ごとの `logEntries` を `date` 範囲クエリ(カレンダー月表示 `/calendar/[month]` と同じ `where('date', '>=', ...).where('date', '<=', ...)` パターンで既存インデックスをそのまま使い回せる)で取得し、クライアント側で `category === 'finance'` かつ可視(`isVisible`)かつ非振替のものを集計する。大項目別の内訳(棒グラフ)、収入/支出合計、直近6か月の支出推移、取引一覧、ルール管理UIを1画面にまとめた。グラフは専用ライブラリを追加せず、Tailwindのdiv幅で表現する簡易棒グラフとした(既存コードベースに charting ライブラリの前例がないため)。

## Consequences

- Zaim OAuth 1.0aはrequest token取得のみ実接続で検証済み。authorize〜access token交換の完全なフローは対話的なユーザー同意が必要なため未検証で、初回接続時にさらなる修正が必要になる可能性が残る(Swarm連携時と同様)。
- JPY以外の通貨は非対応(Zaimの `currency_code` は無視し、常に額面をJPYとして扱う)。
- 重複統合は「同日・同額」のみで判定するため、同日に同額の取引が複数ある場合に誤マッチする可能性がある。
- 手動振り分けルールは優先度制御がなく「作成順で最初にマッチしたもの」のみ。複雑な優先度付けが必要になった場合は再設計が必要。
- MoneyforwardのCSVアップロードは低頻度手動運用を前提とし、Google Maps Timelineインポートと同様に既存 `createdAt` を保持するための事前読み取りは行わない(再アップロード時は `createdAt` も上書きされる)。
