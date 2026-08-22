# ADR-0005: `Collection.tsx` / `Doc.tsx` によるFirestore購読の再利用パターン

- Status: Accepted
- Phase: フェーズ1

## Context

`solid-firebase` の `useFirestore` はloading/error/dataの状態を返すが、各画面で個別にこれらを出し分けるとボイラープレートが増え、画面ごとに挙動が微妙にばらつくリスクがある。

## Decision

`src/lib/Collection.tsx` と `src/lib/Doc.tsx` は `solid-firebase` の `useFirestore` 戻り値(`UseFireStoreReturn`)を受け取り、loading/error/empty/dataの状態を出し分けする再利用可能なラッパーとして実装した。

## Consequences

新しいFirestoreクエリ結果を表示する画面は、原則としてこの2つのコンポーネントを再利用すること(車輪の再発明をしない)。
