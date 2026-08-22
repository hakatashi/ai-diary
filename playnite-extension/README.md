# ai-diary Game Session Tracker (Playnite拡張)

Playniteでゲームを終了する(`OnGameStopped`)たびに、そのセッションのゲーム名・プラットフォーム・開始/終了時刻をai-diaryに送信するPowerShellスクリプト拡張。設計の背景は [docs/adr/0012-playnite-game-session-ingest.md](../docs/adr/0012-playnite-game-session-ingest.md) を参照。

## インストール手順

1. ai-diaryの `/data-sources` ページで Playnite カードの「接続」を押し、表示されたingestトークンを控える(この画面を離れると再表示できないので注意。忘れた場合は「トークンを再発行」で再取得できるが、古いトークンは無効になる)。
2. `%APPDATA%\AiDiaryPlaynite\config.json` を作成し、以下の内容を書く(`ingestToken` は手順1で控えた値に置き換える):

   ```json
   {
     "endpointUrl": "https://asia-northeast1-hakatadiary.cloudfunctions.net/recordPlayniteSession",
     "ingestToken": "ここにトークンを貼り付け"
   }
   ```

3. このディレクトリ(`extension.yaml` と `AiDiaryPlaynite.psm1`)を丸ごと `%APPDATA%\Playnite\Extensions\ai-diary-playnite-tracker\` にコピーする。
4. Playniteを再起動する。Playniteのメニュー → 拡張機能 で `ai-diary Game Session Tracker` が有効になっていることを確認する。
5. 適当なゲームを起動・終了し、`/data-sources` の Playnite カードの「最終受信」が更新されることを確認する。

## 既知の制約

- ゲームがクラッシュ・強制終了した場合や、終了時にPCがオフラインだった場合、そのセッションは記録されない(再送キューは未実装)。
- Playniteを経由せず直接起動したゲームは対象外。
- スリープ中に `ElapsedSeconds` が加算され続けるかどうかは未検証。
