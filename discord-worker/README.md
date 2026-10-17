# Discord Worker

埼玉大学かるた会の大会管理Discord Bot用Cloudflare Workerです。
現行のGoogle Apps Script / Google Sheets版と切り離して開発します。

## 現在の範囲

- `GET /health` による稼働確認
- DiscordリクエストのEd25519署名検証
- DiscordのInteraction Endpoint確認用PING/PONG
- 開発用サーバーの `/ping` コマンド
- `/member-register` によるDiscordユーザーとテスト部員の紐付け
- `/setup-channel` によるテスト告知先の設定
- `/test-tournament` による告知・対象級DM・参加回答ボタンの疎通確認
- 署名付きPING受信時の開発用サーバーへのコマンド登録
- D1による部員・大会・回答・通知履歴の管理

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
```

## D1マイグレーション

```sh
npm run db:migrate:local
npm run db:migrate:remote
```

リモートDBに適用する前に、必ずローカルDBで成功を確認します。

## DM送信のテスト制限

`/test-tournament` は開発用で、1大会あたり最大10人へのDMに制限しています。
本番で数十〜数百人へ送る処理は、Discordのレート制限とWorkerの実行時間を考慮し、キューに分離します。

## スラッシュコマンド登録

開発用Discordサーバーへの登録に限定し、変更をすぐ反映できるようにしています。

```sh
DISCORD_APPLICATION_ID=... \
DISCORD_GUILD_ID=... \
DISCORD_BOT_TOKEN=... \
npm run register:commands
```
