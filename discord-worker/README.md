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
- Excel名簿のメール・フォーム送信、またはフォーム直接入力による大会申込方法の登録
- 実際の参加希望者の級・人数を反映した申込メール下書きの自動作成
- 同時登録した複数級の一括申込完了と、参加者一覧付きの告知チャンネル通知
- サークル内締切時点で参加希望者が0人の大会を「参加者なし終了」へ自動変更
- 参加希望とは別に、申込後の「結果待ち・出場確定・抽選落選・辞退」を選手ごとに管理
- 抽選前確認名簿、キャンセル待ち番号、確定名簿、当日案内と参加費の段階別管理
- 事前集金・当日現金払い、級別参加費、入金状態、未納者リマインダーの管理
- 大会終了後の個人成績、選手名簿PDF、結果PDFの登録と、過去大会記録としての公開
- 管理画面でのメンバー一覧、氏名・級・状態・DM設定の変更
- 管理画面でのメンバー登録申請の確認・承認・却下
- 管理者のメールまたはDiscord IDを記録する大会登録・ステータス変更の監査情報
- Web登録された未通知大会を1分ごとに取得するDiscord通知処理
- サークル内締切の1分後と主催者締切日0:00に、参加希望者、申込方法、大会管理画面リンクを管理者用チャンネルへ送る自動リマインダー
- サークル内締切日の2日前0:00に告知チャンネルへ案内し、対象級の未回答メンバーだけへ回答ボタン付きDMを送る自動リマインダー
- 署名付きPING受信時の開発用サーバーへのコマンド登録
- D1によるメンバー・大会・回答・通知履歴の管理と、R2による大会要項PDFの保存
- D1の日次SQLバックアップとR2上のPDFを、サークル用Google Driveへ自動退避

## Worker構成

役割と認証境界を分けるため、同じソースから4つのWorkerを配備します。

- `sukc-tournament-discord-bot`: Discord Interaction受信用。Discord署名を検証し、BotのSecretを保持する
- `sukc-tournament-admin`: 大会登録画面。移行中はCloudflare Accessを併用し、最終的にDiscord大会管理者ロールで保護する。BotのSecretは保持しない
- `sukc-tournament-portal`: 承認済みメンバー用。Discord OAuthで本人確認し、大会閲覧・PDF閲覧・Web回答を提供する
- `sukc-tournament-backup`: 毎日3:00（日本時間）にD1と未退避のR2 PDFをGoogle Driveへ保存する

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

バックアップ専用Workerには次のSecretを登録します。Discord Botトークンは登録しません。
`CLOUDFLARE_D1_API_TOKEN` には、CloudflareのAccount API Tokenを使用し、
権限は `D1 Write` のみにします（D1エクスポートAPIでは `D1 Read` だけでは不足します）。

```sh
npx wrangler secret put CLOUDFLARE_D1_API_TOKEN --config wrangler.backup.jsonc
npx wrangler secret put GOOGLE_CLIENT_ID --config wrangler.backup.jsonc
npx wrangler secret put GOOGLE_CLIENT_SECRET --config wrangler.backup.jsonc
npx wrangler secret put GOOGLE_REFRESH_TOKEN --config wrangler.backup.jsonc
npx wrangler secret put BACKUP_TRIGGER_SECRET --config wrangler.backup.jsonc
```

Google OAuthはサークル用Googleアカウントで、最小権限の
`https://www.googleapis.com/auth/drive.file` とオフラインアクセスを許可します。
バックアップWorkerが「大会システムバックアップ」フォルダと、その下の
`database`・`documents` フォルダを自動作成します。

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
npm run dev:backup
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
npm run deploy:backup
```

## Google Driveバックアップ

`sukc-tournament-backup` は毎日3:00（日本時間）に次を実行します。

1. D1をSQLとしてエクスポートし、Google Driveの `database` へ保存
2. R2の `documents/` を走査し、未退避または更新されたPDFだけを `documents` へ保存
3. Drive側に保存済みのPDFが残っていることを確認し、削除されていれば再送
4. 365日を超えた日次SQLバックアップをGoogle Driveのゴミ箱へ移動
5. 実行結果をD1の `backup_runs` に記録

失敗は既存Discord Botが管理者用リマインダーチャンネルへ通知し、通知自体も最大5回再試行します。
Google Driveへのファイル作成には再開可能アップロードを使い、同じ実行や同じR2オブジェクトを重複保存しないための識別情報をDriveの `appProperties` に記録します。

`GET /health` ではSecretの値を公開せず、設定済みかどうかと直近の実行結果だけを返します。
`POST /run` は `Authorization: Bearer <BACKUP_TRIGGER_SECRET>` を要求し、手動バックアップを開始します。

`sukc-tournament-admin` は、D1の `discord_settings.admin_role_id` に登録したDiscordロールを持つ本番サーバーのメンバーだけを許可します。OAuth移行の検証が終わるまではCloudflare Accessも併用でき、既存管理者は従来のメール認証でも操作できます。Discord認証を本番利用する際は、Developer Portalへ管理画面用Redirect URLを追加し、上記Secretと大会管理者ロールIDを設定してからCloudflare Accessを解除します。

## 通知キュー

大会通知はD1の永続キューに登録され、該当級の有効なメンバー全員へ順次DMを送ります。失敗した通知は最大5回まで自動再送されます。
本番で数十〜数百人へ送る処理は、Discordのレート制限とWorkerの実行時間を考慮し、キューに分離します。
管理者用チャンネルには締切リマインダーだけを送信し、大会追加告知や参加回答は送信しません。

## 参加希望と申込・抽選結果

`responses` はメンバー本人の参加希望（参加・未定・不参加）を保持します。主催者への申込後の状態は `tournament_entries` に分離し、参加希望の履歴を消さずに結果待ち・出場確定・抽選落選・辞退を管理します。大会を「申込完了」にした時点で、その大会の有効な参加希望者が申込結果管理へ自動登録されます。

回答受付中の大会はサークル内締切を過ぎると「申込対応中」に進みます。主催締切を過ぎた時点で、同時登録された全開催級を通じて参加希望者が0人の場合だけ、Cronが内部状態を `closed` に変更し、`closure_reason = no_participants` を記録します。管理画面とメンバーポータルでは「参加者なし終了」と表示します。

通常の運用段階は「回答受付中 → 申込対応中 → 申込完了 → 抽選前 → 参加者確定 → 大会記録」です。「申込完了」だけは担当者の完了操作で進み、その後は申込確認名簿、確定名簿と当落、大会結果の登録に連動します。「中止」は担当者が管理画面で選択した場合だけに設定されます。

## 過去の大会記録

大会を申込完了にした後、管理画面の「大会記録」から選手名簿PDF・結果PDFと各出場者の個人成績を登録できます。申込済みまたは出場確定のメンバーを出場者として扱い、抽選落選・辞退は申込履歴には残しつつ公開記録の出場者から除外します。

大会要項、選手名簿、結果ファイル、全出場者の個人成績が揃った場合だけ「過去大会として公開」できます。公開後はメンバーポータルの「過去の大会結果」タブで、大会概要・出場者・個人成績・3種類の資料をまとめて参照できます。公開の取り下げも管理画面から行えます。

## スラッシュコマンド登録

開発用Discordサーバーへの登録に限定し、変更をすぐ反映できるようにしています。

```sh
DISCORD_APPLICATION_ID=... \
DISCORD_GUILD_ID=... \
DISCORD_BOT_TOKEN=... \
npm run register:commands
```
