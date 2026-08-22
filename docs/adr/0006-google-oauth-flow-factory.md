# ADR-0006: Google OAuth連携の共通化(`createGoogleOAuthFlow`)

- Status: Accepted
- Phase: フェーズ2

## Context

Google Health(フェーズ1)に加え、フェーズ2でGoogle Calendarとの新しいGoogle OAuth連携が増え、「state発行→認可URL生成→コールバックでtoken交換→`dataSources`/`dataSourceSecrets`更新」という一連の流れが重複し始めた。

## Decision

この流れを `functions/src/lib/googleOAuth.ts` の `createGoogleOAuthFlow({dataSourceId, displayName, category, scope, callbackFunctionName})` ファクトリに共通化した。各データソースの `oauth.ts` はこのファクトリを呼び出して `beginXxxOAuth`/`xxxOAuthCallback` を生成するだけでよい。`callbackFunctionName` は `functions/src/index.ts` でのexport名(=実際にデプロイされる関数名)と一致させる必要がある(リダイレクトURIの構築に使うため)。refresh tokenからaccess tokenを取得する `getGoogleAccessToken` も同ファイルで共通化し、各データソースの `client.ts` から利用する。

## Consequences

- Swarm(Foursquare)はGoogleとは無関係の独自OAuth2フローのため、このファクトリは使わず `functions/src/dataSources/swarm/oauth.ts` に個別実装している。Foursquareのアクセストークンは(v2 APIでは)明示的に失効しないため、refresh tokenの概念がなく `credentialType: 'oauth2_access_token'` として `payload.accessToken` をそのまま保存する。
- Immichも自己ホストAPIキー認証のためこのファクトリを使わない([ADR-0008](0008-immich-photo-source.md))。
- 新しいGoogle系データソースを追加する場合はまずこのファクトリの利用を検討すること。

### 補足: Swarmのチェックイン取得エンドポイント

**チェックイン履歴の取得には `/v2/users/self/checkins`(classic v2 API)を使う。** 当初は参考記事に従い `/v2/users/self/historysearch` を使っていたが、実接続で `402 credits_exhausted` エラーとなった。これはFoursquareのPersonalization API(2026年6月から段階的従量課金が導入され、月500コールの無料枠のみ)側のエンドポイントで、`historysearch` はこちらに属するため即座に枠を使い切ってしまう。一方 `checkins`/`lists`/`tastes`/`tips`/ユーザー系のエンドポイントは無料のまま継続されるとFoursquareの公式ドキュメントに明記されているため、同じくユーザーのチェックイン履歴を返す `/v2/users/self/checkins` に切り替えた(`functions/src/dataSources/swarm/client.ts`)。ページネーションは `beforeTimestamp` ではなく `offset`/`limit` 方式(レスポンスの `response.checkins.count`/`response.checkins.items` を使う)。

なお、v2 APIのレガシーエンドポイントは2026年5月15日に廃止予定とFoursquareが告知しているため、将来的に新しいPlaces API/Personalization API体系への再移行が必要になる可能性がある。また、Swarmのレスポンス実フィールドはドキュメントからの推定で実装しており未検証(初回実接続時にトライアル&エラー修正が必要になる可能性が高い)。
