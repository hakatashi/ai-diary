# ADR-0004: Cookie不要のCallable Functions中心設計

- Status: Accepted
- Phase: フェーズ1

## Context

静的SPA構成([ADR-0001](0001-static-spa-client-side-auth-guard.md))のため、Cookieベースのセッション共有は行えない。認証が必要なバックエンド処理をどう設計するか検討した。

## Decision

認証が必要な処理は原則Firebase **Callable Functions**(`onCall`)にし、Firebase Functions Client SDK(`firebase/functions`)の組み込み認証コンテキストを利用する。OAuthコールバックのようにブラウザの生ナビゲーション(GET)を受ける必要がある処理のみ `onRequest` にし、使い捨ての `oauthStates` ドキュメントでCSRF対策と認可の連続性を担保する(詳細は `functions/src/dataSources/googleHealth/oauth.ts` のコメント参照)。

関数はレイテンシ低減のため `asia-northeast1` リージョンを明示指定している。

## Consequences

- 新しい関数を追加する際も `asia-northeast1` を明示指定すること。
- ブラウザの生ナビゲーションが必要なケース(OAuthコールバック等)以外は `onCall` をデフォルトとすること。
