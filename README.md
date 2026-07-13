# ai-diary

個人用のライフログWebアプリケーションです。Google Health、家計簿アプリ、位置情報、写真、カレンダー、Home Assistant、SNSなど様々なデータソースから日々の行動ログを収集・保管し、日毎の日誌として一つの画面から振り返れるようにします。Gemini APIを使ったAIパートナーが、ライフログの内容をもとに雑談や生活のアドバイスをしてくれる機能も予定しています。

このアプリは特定の一人のユーザー(本人)のみが利用する前提で設計されており、Googleアカウントによる認証で本人以外のアクセスを一切許可しません。

## 現在実装されている機能(フェーズ1)

- Googleアカウントによる認証(許可された1アカウントのみ)
- Google Health APIから運動記録を取り込み
- 日付ごとの日誌ページ(タイムライン表示 + 手動メモ)
- データソースの接続・手動同期を行う管理画面

今後の開発計画やアーキテクチャの詳細は [AGENTS.md](./AGENTS.md) を参照してください。進捗は [GitHub Project](https://github.com/users/hakatashi/projects/2) で管理しています。

## 技術スタック

- [SolidStart](https://start.solidjs.com/) + Tailwind CSS(フロントエンド)
- Firebase(Authentication / Firestore / Functions / Hosting)
- Gemini API(AIパートナー機能、今後実装予定)

## 開発

```bash
npm install
npm run dev
```

`npm run dev` はSolidStartの開発サーバー、Firebaseエミュレータ、Cloud Functionsのウォッチビルドを同時に起動します。

```bash
npm run build   # 本番ビルド
npm run lint     # Biomeによるlint
npm run format    # Biomeによるformat
npm test           # エミュレータ上でVitestを実行
```

## デプロイ

```bash
npx firebase deploy
```

Firebaseプロジェクト `hakatadiary` にデプロイされます。APIキーなどの秘密情報はGoogle Cloud Secret Managerで管理しており、リポジトリには含まれていません。
