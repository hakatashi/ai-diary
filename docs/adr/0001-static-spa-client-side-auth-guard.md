# ADR-0001: 認証は静的SPA + クライアント側ガードで実現し、SSRは採用しない

- Status: Accepted
- Phase: フェーズ1

## Context

このアプリの唯一の利用者は `hakatasiloving@gmail.com` のGoogleアカウントを持つ本人のみで、マルチテナント設計は不要。全ページを認証必須にする方法として、SolidStartのサーバーサイドミドルウェア(`middleware.ts`)でガードするSSR構成と、クライアント側でガードする静的SPA構成を検討した。

SolidStart + Firebase HostingでのSSR化(Nitroの `firebase` プリセットをCloud Functions Gen2にデプロイする構成)は主にNuxt向けに検証されており、SolidStartでの実績が薄く動作未検証のリスクが高いと判断した。また、ページシェル自体には機密データを一切含まない(全データはFirestoreのリアクティブ購読経由でのみ取得される)ため、クライアント側ガードでも実害はない。

## Decision

`app.config.ts` は `ssr: false` のままとし、`firebase.json` の hosting rewrite も `"**" → "/index.html"` の純粋な静的SPA配信にする。「全ページ認証必須」は以下の2層で実現する:

1. **`src/components/AuthGuard.tsx`**: `app.tsx` の `Router root` 内で全ルートをラップするクライアント側コンポーネント。`solid-firebase` の `useAuth` で認証状態を監視し、未ログインまたは許可外メール(`src/lib/constants.ts` の `ALLOWED_EMAIL`)の場合は `/login` へ `<Navigate>` する。`/login` 自身はガード対象外(無限リダイレクトループ防止)。
2. **Firestore Security Rules(`firestore.rules`)**: 実データ保護の**唯一の真の境界**。`request.auth.token.email == 'hakatasiloving@gmail.com' && request.auth.token.email_verified` を満たさない限り一切のread/writeを許可しない。

## Consequences

- owner/非owner/未認証の3パターンでの許可・拒否は `firestore.rules.test.ts`(`@firebase/rules-unit-testing` の `initializeTestEnvironment` を使用、`npm test` に含まれる)で自動検証している。
- クライアント側ガードは表示制御に過ぎず、セキュリティ境界としては機能しない前提で設計する。新しいページ・コンポーネントを追加する際も、機密データをページシェルやビルド成果物に埋め込まないこと。
- **将来的にSSR化が本当に必要になった場合は、`app.config.ts` の `ssr: false` を外し、Nitroの `firebase` プリセットの動作検証をスパイクタスクとして独立させてから着手すること。**
