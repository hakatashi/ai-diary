# ADR-0002: 秘密情報はSecret Managerと`dataSourceSecrets`(Firestore)で使い分ける

- Status: Accepted
- Phase: フェーズ1〜2(データソース追加のたびに継続適用)

## Context

Google Cloud Secret Managerの無料枠は1プロジェクトあたり月間アクティブシークレットバージョン6個まで。データソースを増やすたびに新しいシークレットをSecret Managerに登録すると、この予算をすぐに超過する。一方で、非秘匿情報(OAuthクライアントIDなど)まで秘密情報として扱う必要はない。

## Decision

秘密情報の性質によって保存先を3種類に分ける:

- **Secret Manager**(`firebase functions:secrets:set` で登録、コードでは `defineSecret` で参照): アプリ全体で共有する静的なグローバル設定のみ。現在登録済みは `GEMINI_API_KEY`、`GOOGLE_CLIENT_SECRET`、`FOURSQUARE_OAUTH_CLIENT_SECRET`、`GOOGLE_PLACES_API_KEY` の4つ(合計4アクティブバージョン、予算6に対しまだ余裕あり)。
- **`GOOGLE_CLIENT_ID` / `FOURSQUARE_OAUTH_CLIENT_ID`**: 非秘匿情報(OAuthクライアントIDはリダイレクトURLにも露出する)なので、Secret Managerを使わず `defineString`(`functions/src/lib/secrets.ts`)で扱う。値は `functions/.env.hakatadiary`(gitignore対象、Secret Managerの予算を消費しない)に置く。
- **`dataSourceSecrets/{dataSourceId}` コレクション(Firestore)**: 各データソース固有の認証情報(OAuthのrefresh tokenなど)。クライアントからは `firestore.rules` で完全に遮断(`allow read, write: if false;`)され、Cloud Functions(Admin SDK)からのみアクセス可能。**新しいデータソースを追加する際は、この方式(Firestoreへの保存)をデフォルトとし、Secret Managerには追加しない。**

ユーザーがブラウザから直接入力する形の認証情報(APIキーなど)は、専用のCallable Functionを用意してAdmin SDK経由で書き込む設計にする(クライアントから直接Firestoreに書き込ませない。実例: `connectImmich`、[ADR-0008](0008-immich-photo-source.md))。

## Consequences

- `FOURSQUARE_OAUTH_CLIENT_SECRET`/`GOOGLE_PLACES_API_KEY` は値が用意でき次第 `firebase functions:secrets:set` で登録する(`docs/manual-setup-checklist.md` 参照)。
- 将来のフェーズで追加が見込まれる秘密情報(Zaimのconsumer key/secret、Home Assistantの長期アクセストークン等)も、原則としてこの `dataSourceSecrets` パターンに従うこと。
