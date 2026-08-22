# claude-in-chromeでのローカル動作確認手順

このプロジェクトをFirebaseエミュレータ + claude-in-chrome(ブラウザ自動操作)で動作確認する際の手順・注意点。フェーズ3(Zaim/Moneyforward統合)の実装時に得た知見をまとめたもの。

## 環境の起動

1. `npm --prefix functions run build` で `functions/lib` をビルドしておく(エミュレータは `lib` から読み込むため、未ビルドだと新規追加した関数が反映されない)。
2. `firebase emulators:start --only firestore,hosting,auth,functions,storage` をバックグラウンドで起動。
3. `npx vinxi dev`(または `npm run dev:server`)をバックグラウンドで起動。
4. **新しいCloud Functions(新規export)を追加した場合、Functionsエミュレータは自動検知しないことがある。** ソース変更の再ビルド後は `pkill -f "firebase emulators:start"` からの再起動が確実(既存関数のロジック変更は再起動不要な場合もあるが、export自体の追加は再起動が必要)。
5. **エミュレータ全体を再起動するとFirestore・Authの状態(インポート済みデータ・ログインセッション)がすべて消える。** 再起動後は再ログイン・再インポートが必要になる。

## ログイン(Auth Emulator)

このアプリは `signInWithPopup(GoogleAuthProvider)` を使っており、Auth Emulator接続時は「Sign in with Google.com (Test Mode)」という擬似アカウント選択画面がポップアップウィンドウで開く。

- **このポップアップは `computer` ツールでのクリック(要素refクリック含む)では開かないことが多い。** `tabs_context_mcp` にも現れず、ポップアップブロックされているか、MCPのタブグループ外の別ウィンドウとして開いて操作不能になる。ヘッドレス/自動化クリックは実際のOS入力ではないため、Chromeのポップアップブロッカーに阻まれている可能性がある。
- 2〜3回試して開かない場合は深追いせず、**ユーザーに「ログインボタンを押して擬似アカウントでログインしてください」と依頼する**のが確実。ユーザーが手動でクリックすればポップアップは正常に開き、仮アカウントでログインが完了する。
- ログイン後はタブのセッションが保持されるので、以降の画面遷移は自動操作で問題なく行える。

## ネットワーク到達性

サンドボックス環境からブラウザ経由でCallable Functions(`localhost:5001`)を呼ぶには、**ポート5001のポートフォワーディングが別途必要になる場合がある**(Firestore emulator の40615番などは問題なくても、5001番だけ届かないことがあった)。

- 症状: Callable呼び出しが `OPTIONS`/`POST` とも **503** を返し、functionsエミュレータのログには何も出力されない(リクエストがそもそも届いていない)。
- この場合はコードのバグではなくネットワーク到達性の問題である可能性が高いので、先にユーザーにポートフォワーディングの追加を確認してから調査を続けること。

## Callable Functionsのエラー原因調査

クライアント側のエラーメッセージは「〜に失敗しました」のように握りつぶされて表示されるため、実際のエラーは以下で確認する。

1. `read_network_requests`(`urlPattern` に関数名やポート番号を指定)でHTTPステータスコードを確認する。**このツールは呼び出された時点以降のリクエストしか記録しない**ので、既に発生した操作を調べたい場合は再度同じ操作(クリックなど)をやり直す必要がある。
2. functionsエミュレータの標準出力(ログファイルにリダイレクトして `tail`/`grep` する)に実際のスタックトレース・エラーメッセージが出力される。診断に必要な情報はほぼここにある。

### `defineSecret` に依存するCallableのローカル検証

`defineSecret` の値はローカルエミュータでは既定でSecret Managerへアクセスしようとして失敗する(ADC権限があれば本番のSecret Managerに実際にアクセスしてしまうこともあるので注意)。一時的に検証したい場合:

1. `functions/.secret.local` に `SECRET_NAME=値` を書く(このファイルは `.gitignore` に入っていないので、**検証後は必ず手動で削除し、`git status` で残っていないことを確認する**)。
2. エミュレータを再起動する(secretファイルはエミュレータ起動時にのみ読み込まれる)。
3. 検証が終わったら `rm functions/.secret.local` する。

## `<input type="date">` の自動操作

日付inputへの `computer` クリック+`type` は、クリック位置によって年/月/日どのセグメントにフォーカスが当たるか安定せず、意図した日付が入力できないことが多い(実際に「年/07/26」のような崩れた値になった)。

**確実なのは `javascript_tool` でネイティブのvalue setterを使い、`input` イベントを発火させる方法:**

```js
const input = document.querySelectorAll('input[type="date"]')[N]; // 対象要素を特定
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
setter.call(input, '2026-07-01');
input.dispatchEvent(new Event('input', {bubbles: true}));
```

Solid.jsはReactと異なり合成イベント層を持たずネイティブの `input` イベントリスナーを直接張っているため、この方法で `createSignal` の状態も正しく更新される。

## ファイルアップロードのテスト

CSV/JSONアップロードのような `<input type="file">` は `computer` でクリックしない(ネイティブのファイル選択ダイアログが開き操作できなくなる)。`find`/`read_page` で要素refを取得し、`file_upload` ツールに直接渡す。アップロード可能なパスはセッションに共有されたファイル(プロジェクトディレクトリ内のファイル等)に限られ、合計10MBまで。

## 効率的な検証の進め方

- OAuth署名やCSVパーサのような純粋ロジックは、ブラウザ・ログインのセットアップを待たずに**Node単体スクリプトで実データ・実APIに対して直接検証する**方が速く、原因の切り分けもしやすい(実際、Zaim OAuth 1.0aの署名バグはブラウザ操作より先にNodeスクリプトでの検証で発見できた)。
- 複数ステップの操作(クリック→入力→クリック→スクリーンショット等)は `browser_batch` でまとめて実行するとラウンドトリップを削減できる。
