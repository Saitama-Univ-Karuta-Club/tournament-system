# Discord Worker

埼玉大学かるた会の大会管理Discord Bot用Cloudflare Workerです。
現行のGoogle Apps Script / Google Sheets版と切り離して開発します。

## 現在の範囲

- `GET /health` による稼働確認
- DiscordリクエストのEd25519署名検証
- DiscordのInteraction Endpoint確認用PING/PONG
- 開発用サーバーの `/ping` コマンド
- `/member-register` によるDiscordユーザーとテストメンバーの紐付け
- `/setup-channel` によるテスト告知先の設定
- `/test-tournament` による告知・対象級DM・参加回答ボタンの疎通確認
- Cloudflare Accessで保護する大会登録Web管理画面
- 管理画面での大会一覧、回答者別集計、ステータス確認・変更
- 管理画面でのメンバー一覧、氏名・級・状態・DM設定の変更
- 管理者メールを記録する大会登録・ステータス変更の監査情報
- Web登録された未通知大会を1分ごとに取得するDiscord通知処理
- 署名付きPING受信時の開発用サーバーへのコマンド登録
- D1によるメンバー・大会・回答・通知履歴の管理

## Worker構成

役割と認証境界を分けるため、同じソースから2つのWorkerを配備します。

- `sukc-tournament-discord-bot`: Discord Interaction受信用。Discord署名を検証し、BotのSecretを保持する
- `sukc-tournament-admin`: 大会登録画面。Worker全体をCloudflare Accessで保護し、BotのSecretは保持しない

管理画面で保存した大会はD1へ入り、Discord WorkerのCronが1分以内を目安に取得して告知とDMを送ります。管理画面WorkerへBotトークンを複製しない構成です。

## 秘密情報

`.dev.vars.example` を `.dev.vars` にコピーし、ローカル開発用の値を設定します。
`.dev.vars` は `.gitignore` の対象です。

Cloudflareへは、デプロイ前に次の値をSecretとして登録します。

```sh
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
```

BotトークンやSecretの実値はGitへコミットしません。

## 開発コマンド

```sh
npm install
npm test
npm run typecheck
npm run dev
npm run dev:admin
```

## D1マイグレーション

```sh
npm run db:migrate:local
npm run db:migrate:remote
```

リモートDBに適用する前に、必ずローカルDBで成功を確認します。

## 管理画面の配備

次の順番で配備します。

```sh
npm run db:migrate:remote
npm run deploy
npm run deploy:admin
```

`sukc-tournament-admin` は、Cloudflareダッシュボードの `Workers & Pages` からWorkerを選び、`Access` で本番トラフィック全体を保護します。許可対象は最初はCloudflareアカウントのメンバーだけに限定します。Accessが有効でなければアプリ自身も403を返すため、管理画面は利用できません。

## 通知キュー

大会通知はD1の永続キューに登録され、該当級の有効なメンバー全員へ順次DMを送ります。失敗した通知は最大5回まで自動再送されます。
本番で数十〜数百人へ送る処理は、Discordのレート制限とWorkerの実行時間を考慮し、キューに分離します。

## スラッシュコマンド登録

開発用Discordサーバーへの登録に限定し、変更をすぐ反映できるようにしています。

```sh
DISCORD_APPLICATION_ID=... \
DISCORD_GUILD_ID=... \
DISCORD_BOT_TOKEN=... \
npm run register:commands
```
