# Discord Worker

埼玉大学かるた会の大会管理Discord Bot用Cloudflare Workerです。
現行のGoogle Apps Script / Google Sheets版と切り離して開発します。

## 現在の範囲

- `GET /health` による稼働確認
- DiscordリクエストのEd25519署名検証
- DiscordのInteraction Endpoint確認用PING/PONG
- 開発用サーバーの `/ping` コマンド
- `/member-register` による氏名・よみがな・級・段位の新規登録・登録内容変更の申請
- `/setup-channel` によるテスト告知先の設定
- `/setup-reminder-channel` による管理者用締切リマインダー送信先の設定
- `/test-reminder` による管理者用チャンネルの送信権限・表示テスト
- `/test-tournament` による告知・対象級DM・参加回答ボタンの疎通確認
- Cloudflare AccessまたはDiscord大会管理者ロールで保護する大会登録Web管理画面
- 同名大会の複数級一括登録、級ごとの開催日設定、全級メンバーを対象にする「すべて」の大会
- 大会要項PDFの直接アップロード、自動リネーム、Discordからの閲覧リンク
- 管理画面での大会一覧、回答者別集計、ステータス確認・変更
- 管理画面での大会情報編集と、回答受付中大会の更新告知・対象メンバーDM再送
- 同時登録した複数級の一括申込完了と、参加者一覧付きの告知チャンネル通知
- 管理画面でのメンバー一覧、氏名・級・状態・DM設定の変更
- 管理画面でのメンバー登録申請の確認・承認・却下
- 管理者のメールまたはDiscord IDを記録する大会登録・ステータス変更の監査情報
- Web登録された未通知大会を1分ごとに取得するDiscord通知処理
- サークル内締切の翌日0:00と主催者締切日0:00に、参加希望者の氏名・よみがなと大会管理画面リンクを管理者用チャンネルへ送る自動リマインダー
- サークル内締切日の2日前0:00に告知チャンネルへ案内し、対象級の未回答メンバーだけへ回答ボタン付きDMを送る自動リマインダー
- 署名付きPING受信時の開発用サーバーへのコマンド登録
- D1によるメンバー・大会・回答・通知履歴の管理と、R2による大会要項PDFの保存

## Worker構成

役割と認証境界を分けるため、同じソースから2つのWorkerを配備します。

- `sukc-tournament-discord-bot`: Discord Interaction受信用。Discord署名を検証し、BotのSecretを保持する
- `sukc-tournament-admin`: 大会登録画面。移行中はCloudflare Accessを併用し、最終的にDiscord大会管理者ロールで保護する。BotのSecretは保持しない
- `sukc-tournament-portal`: 承認済みメンバー用。Discord OAuthで本人確認し、大会閲覧・PDF閲覧・Web回答を提供する

管理画面で保存した大会はD1へ入り、Discord WorkerのCronが1分以内を目安に取得して告知とDMを送ります。管理画面WorkerへBotトークンを複製しない構成です。

PDF本体は非公開のR2バケット `sukc-tournament-documents` に保存し、D1には閲覧URLだけを記録します。閲覧URLには推測困難なUUIDを含め、Bot Workerが該当ファイルだけを返します。URLを知っている人は閲覧できるため、Discord外へリンクを公開しない運用を前提とします。

メンバーポータル内のPDFリンクは、ログイン済みの承認済みメンバーだけが利用できます。既存のDiscord通知に記載済みのBot Worker側URLは、段階移行のため引き続き閲覧できます。

## 秘密情報

`.dev.vars.example` を `.dev.vars` にコピーし、ローカル開発用の値を設定します。
`.dev.vars` は `.gitignore` の対象です。

Cloudflareへは、デプロイ前に次の値をSecretとして登録します。

```sh
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
```

BotトークンやSecretの実値はGitへコミットしません。

メンバーポータルには次のSecretを登録します。Botトークンは登録しません。

```sh
npx wrangler secret put DISCORD_APPLICATION_ID --config wrangler.portal.jsonc
npx wrangler secret put DISCORD_CLIENT_SECRET --config wrangler.portal.jsonc
npx wrangler secret put SESSION_SECRET --config wrangler.portal.jsonc
```

大会管理画面のDiscord認証にも同じ3種類のSecretを登録します。Botトークンは登録しません。

```sh
npx wrangler secret put DISCORD_APPLICATION_ID --config wrangler.admin.jsonc
npx wrangler secret put DISCORD_CLIENT_SECRET --config wrangler.admin.jsonc
npx wrangler secret put SESSION_SECRET --config wrangler.admin.jsonc
```

Discord Developer PortalのOAuth2 Redirectsには、次を登録します。

```text
https://sukc-tournament-portal.saitama-univ-karuta-club.workers.dev/auth/discord/callback
https://sukc-tournament-admin.saitama-univ-karuta-club.workers.dev/auth/discord/callback
```

## 開発コマンド

```sh
npm install
npm test
npm run typecheck
npm run dev
npm run dev:admin
npm run dev:portal
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
npm run deploy:portal
```

`sukc-tournament-admin` は、D1の `discord_settings.admin_role_id` に登録したDiscordロールを持つ本番サーバーのメンバーだけを許可します。OAuth移行の検証が終わるまではCloudflare Accessも併用でき、既存管理者は従来のメール認証でも操作できます。Discord認証を本番利用する際は、Developer Portalへ管理画面用Redirect URLを追加し、上記Secretと大会管理者ロールIDを設定してからCloudflare Accessを解除します。

## 通知キュー

大会通知はD1の永続キューに登録され、該当級の有効なメンバー全員へ順次DMを送ります。失敗した通知は最大5回まで自動再送されます。
本番で数十〜数百人へ送る処理は、Discordのレート制限とWorkerの実行時間を考慮し、キューに分離します。
管理者用チャンネルには締切リマインダーだけを送信し、大会追加告知や参加回答は送信しません。

## スラッシュコマンド登録

開発用Discordサーバーへの登録に限定し、変更をすぐ反映できるようにしています。

```sh
DISCORD_APPLICATION_ID=... \
DISCORD_GUILD_ID=... \
DISCORD_BOT_TOKEN=... \
npm run register:commands
```
