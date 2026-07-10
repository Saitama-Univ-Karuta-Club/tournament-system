# 大会申込みシステム 技術マニュアル

この文書は、大会申込みシステムを改修・保守する技術担当者向けのマニュアルです。

基本操作だけを行う申込担当者は、先に `basic-operation-manual.md` を読んでください。この文書では、GitHub、Git、Google Apps Script、GitHub Pages、Google Sheets、LINE Messaging API の基礎知識があることを前提にします。

## 技術担当者に求める前提知識

機能改修を担当する人は、少なくとも以下を理解していることが望ましいです。

- GitHubアカウントを持っている
- Gitの基本操作ができる
- HTML、CSS、JavaScriptを読める
- 静的WebサイトとWeb APIの関係を理解している
- Google Apps Script のエディタでコード更新とデプロイができる
- Google Sheets の列名がAPIの契約になっていることを理解している
- LINE Messaging API のチャネル設定を確認できる

すべてを一人で完璧に理解している必要はありませんが、GitHub Pages と Apps Script の両方に触る変更では、Webアプリの基本を知っている人が作業してください。

## システム構成

このシステムは、静的フロントエンドと Google Apps Script バックエンドで構成されています。

```text
GitHub Pages
  web/
    entry/              参加者向け回答ページ
    board-c7k2m9q4/     管理画面
    guide/              参加者向け案内ページ

Google Apps Script
  gas/Code.gs           API、Sheets連携、LINE通知、Calendar同期

Google Sheets
  Tournaments           大会情報
  Members               メンバー情報
  Responses             参加回答
  EntryPages            参加ページtoken
  Managers              申込担当者
  NotificationLogs      通知履歴

External Services
  Google Drive          要項ファイル保存先
  Google Calendar       大会日程・締切予定
  LINE Messaging API    グループ通知・担当者通知
```

正本データは Google Sheets です。GitHub Pages は画面を配信するだけで、データ保存は行いません。

## リポジトリ構成

主なディレクトリは以下です。

| パス | 役割 |
| --- | --- |
| `docs/` | 仕様書、セットアップメモ、引き継ぎ文書 |
| `gas/Code.gs` | Google Apps Script の本体 |
| `gas/SETUP.md` | GAS設定メモ |
| `web/entry/` | 参加者向けページ |
| `web/board-c7k2m9q4/` | 管理画面 |
| `web/guide/` | 参加者向け案内 |
| `web/README.md` | Web公開方針 |

現在はGASが単一ファイル構成です。Apps Script側へ反映するときは、`gas/Code.gs` の内容をApps Scriptプロジェクトへコピーし、デプロイを更新します。

## 公開URLと秘密情報の扱い

本番URLやトークンは、GitHub上の公開文書に書かないでください。

特に以下はリポジトリへコミットしないでください。

- 管理者用トークン
- Apps Script の本番デプロイURL
- `LINE_CHANNEL_ACCESS_TOKEN`
- Google Sheets の編集権限付きURL
- 個人LINE userIdの一覧
- サークル外へ出してはいけないDrive URL

現在、フロントエンドの `script.js` には Apps Script Web App URL が直接書かれています。本番URLを公開リポジトリに出したくない場合は、公開方針を再検討してください。

## フロントエンド

### 参加者向けページ

対象ファイル:

- `web/entry/index.html`
- `web/entry/style.css`
- `web/entry/script.js`

主な機能:

- URLの `page_token` を読む
- `list_public_tournaments` で大会、メンバー、ページ設定を取得する
- 名前選択後、メンバーの級に合う大会を表示する
- `未回答 / 回答済み / 出場予定 / 全て` で絞り込む
- `upsert_response` で回答を保存する
- 名前がない場合、`request_member_registration` で追加申請する
- 年間大会予定表と要項フォルダへのリンクを表示する

### 管理画面

対象ファイル:

- `web/board-c7k2m9q4/index.html`
- `web/board-c7k2m9q4/style.css`
- `web/board-c7k2m9q4/script.js`

主な機能:

- 管理者用トークンで認証する
- `admin_bootstrap` で大会、メンバー、担当者、設定をまとめて取得する
- 大会を新規登録・編集する
- 複数級大会を `upsert_tournament_batch` で級ごとに保存する
- 要項ファイルを `upload_brief_file` でGoogle Driveへ保存する
- メンバーを追加・編集する
- メンバー追加申請を承認・却下する
- LINE文面と通知時刻を編集する
- 定期トリガーを再作成する
- 手動でLINE更新通知やテスト通知を送る

## Google Apps Script API

`gas/Code.gs` の `doGet` と `doPost` がAPI入口です。

### GET

| action | 認証 | 用途 |
| --- | --- | --- |
| `list_public_tournaments` | `page_token` | 参加者向けページの初期表示 |
| `list_member_responses` | `page_token` | 選択メンバーの回答取得 |
| `list_members` | なし | 公開メンバー一覧取得 |
| `admin_bootstrap` | `admin_token` | 管理画面の初期表示 |
| `list_tournaments` | `admin_token` | 管理者向け大会一覧 |
| `list_admin_members` | `admin_token` | 管理者向けメンバー一覧 |
| `list_managers` | `admin_token` | 申込担当者一覧 |
| `list_tournament_responses` | `admin_token` | 大会ごとの回答取得 |
| `list_tournament_response_overview` | `admin_token` | 回答概要取得 |

### POST

| action | 認証 | 用途 |
| --- | --- | --- |
| `upsert_tournament` | `admin_token` | 単一大会の作成・更新 |
| `upsert_tournament_batch` | `admin_token` | 複数級大会の作成・更新 |
| `update_tournament_status` | `admin_token` | 大会ステータス更新 |
| `upsert_response` | `page_token` | 参加回答の保存 |
| `upsert_member` | `admin_token` | メンバー作成・更新 |
| `request_member_registration` | なし | メンバー追加申請 |
| `upload_brief_file` | `admin_token` | 要項ファイルアップロード |
| `send_announcement` | `admin_token` | 手動の大会情報通知 |
| `send_scheduled_daily_announcements` | `admin_token` | 未通知大会の一斉通知 |
| `send_group_reminder` | `admin_token` | グループ向けリマインド |
| `send_manager_reminder` | `admin_token` | 担当者向けリマインド |
| `send_line_template_test` | `admin_token` | LINE文面テスト送信 |
| `update_admin_settings` | `admin_token` | Script Properties更新 |
| `install_scheduled_triggers` | `admin_token` | 定期トリガー再作成 |

LINE Webhook からのPOSTは `body.events` を持つため、通常APIとは別に `handleLineWebhook` へ渡されます。

## Google Sheets

Google Sheets の列名はコードと強く結びついています。列名を変える場合は、必ず `Code.gs` とフロントエンドの両方を確認してください。

### Tournaments

大会情報の正本です。

重要な列:

- `tournament_id`
- `title`
- `event_start_date`
- `event_end_date`
- `grades`
- `tournament_type`
- `is_official`
- `venue`
- `true_deadline`
- `internal_deadline`
- `drive_url`
- `entry_page_token`
- `entry_url`
- `manager_name`
- `manager_line_user_id`
- `status`
- `calendar_event_id_event`
- `calendar_event_id_internal_deadline`
- `calendar_event_id_true_deadline`
- `created_at`
- `updated_at`
- `applied_at`
- `deleted_at`

`Code.gs` は最低限 `tournament_type` と `applied_at` が存在することを確認します。ただし、実運用では仕様書にある列一式を維持してください。

### Members

メンバー情報です。

重要な列:

- `member_id`
- `last_name`
- `last_name_kana`
- `first_name`
- `first_name_kana`
- `rank`
- `grade`
- `display_name`
- `display_name_kana`
- `normalized_name`
- `normalized_kana`
- `status`
- `created_at`
- `updated_at`

`status` は `active`、`inactive`、`pending`、`rejected` を使います。参加者ページに出すのは基本的に `active` のメンバーです。

### Responses

参加回答です。

重要な列:

- `response_id`
- `tournament_id`
- `member_name`
- `response`
- `comment`
- `created_at`
- `updated_at`

同じ `tournament_id` と `member_name` の回答は上書きされます。

### EntryPages

参加者向けページのtokenと表示文言です。

重要な列:

- `page_token`
- `title`
- `description`
- `active_from`
- `active_until`
- `status`
- `created_at`
- `updated_at`

`list_public_tournaments` では、`page_token` が一致し、`status` が `active` のページだけが有効です。

### Managers

申込担当者のLINE通知先です。

重要な列:

- `manager_name`
- `line_user_id`
- `display_name`
- `status`
- `created_at`
- `updated_at`

LINEで `/担当者登録` を実行すると、`line_user_id` を取得してこのシートに登録します。

### NotificationLogs

通知済み判定に使います。

重要な列:

- `log_id`
- `tournament_id`
- `notification_type`
- `sent_to_type`
- `sent_to_id`
- `sent_at`
- `message`

二重通知防止はこのシートに依存します。手で削除すると再通知される場合があります。

## Script Properties

Apps Script の Script Properties には、外部サービス連携や秘密情報を保存します。

主なキー:

| キー | 用途 |
| --- | --- |
| `SHEET_ID` | 運用用Google SheetsのID |
| `ADMIN_CONSOLE_TOKEN` | 管理画面/API用トークン |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging APIのアクセストークン |
| `LINE_GROUP_ID` | 本番通知先LINE groupId |
| `LINE_TEST_GROUP_ID` | テスト通知先LINE groupId |
| `DRIVE_FOLDER_ID` | 要項保存用Google DriveフォルダID |
| `CALENDAR_ID` | 同期先Google Calendar ID |
| `WEB_BASE_URL` | GitHub Pagesの基準URL |
| `ADMIN_PAGE_URL` | 管理画面URL |
| `DEFAULT_ENTRY_PAGE_TOKEN` | 既定の参加ページtoken |
| `ANNUAL_SCHEDULE_PREVIEW_URL` | 年間予定表プレビューURL |
| `ANNUAL_SCHEDULE_VIEW_URL` | 年間予定表公開URL |
| `DAILY_ANNOUNCEMENT_TIME` | 大会情報通知時刻 |
| `TOURNAMENT_REMINDER_TIME` | 締切リマインド時刻 |
| `PENDING_MEMBER_SUMMARY_TIME` | 未処理メンバー申請まとめ通知時刻 |
| `NIGHTLY_AUTOMATION_TIME` | 夜間自動処理時刻 |

LINE文面は `LINE_TEMPLATE_...` 系のプロパティとして保存されます。管理画面の設定タブから編集できます。

## LINE Bot

`handleLineWebhook` は以下のテキストコマンドを処理します。

| コマンド | 処理 |
| --- | --- |
| `/groupid` | 実行されたLINEグループの `groupId` を `LINE_GROUP_ID` に保存 |
| `/testgroupid` | 実行されたLINEグループの `groupId` を `LINE_TEST_GROUP_ID` に保存 |
| `/担当者登録` | 実行者のLINE userIdを `Managers` に保存 |

LINE通知は主に以下の関数から送られます。

- `sendScheduledDailyAnnouncements`
- `sendScheduledTournamentReminders`
- `sendScheduledAppliedNotifications`
- `sendPendingMemberRegistrationSummary`
- `sendAnnouncement`
- `sendLineTemplateTest_`

送信後は `NotificationLogs` に記録されます。

## 定期トリガー

管理画面の `設定`、`管理者操作`、`トリガーを再作成` から以下のトリガーを作ります。

| 処理 | 関数 | 既定時刻 |
| --- | --- | --- |
| 大会情報更新通知 | `sendScheduledDailyAnnouncements` | `17:00` |
| 締切リマインド | `sendScheduledTournamentReminders` | `10:00` |
| メンバー申請まとめ通知 | `sendPendingMemberRegistrationSummary` | `07:00` |
| 夜間自動処理 | `runNightlyTournamentAutomation` | `23:59` |

通知時刻を変更した後は、トリガーを再作成してください。Script Properties を変えただけでは、既存トリガーの時刻は変わりません。

## Google Calendar同期

大会保存時に、以下3種類の予定を同期します。

- 大会日予定
- サークル内締切予定
- 主催締切予定

関連する列:

- `calendar_event_id_event`
- `calendar_event_id_internal_deadline`
- `calendar_event_id_true_deadline`

これらのevent idがある場合は既存予定を更新し、ない場合は新規作成します。`CALENDAR_ID` が未設定、またはカレンダー権限が不足していると同期に失敗します。

## Google Drive要項アップロード

管理画面から要項ファイルをアップロードすると、`upload_brief_file` が `DRIVE_FOLDER_ID` のフォルダへ保存します。

ファイル名は大会情報から生成されます。同名ファイルがある場合は既存ファイルを再利用する処理があります。

Drive連携で失敗する場合は以下を確認してください。

- `DRIVE_FOLDER_ID` が設定されている
- Apps Script の実行アカウントがフォルダに書き込める
- ファイルサイズがApps Scriptで扱える範囲に収まっている

## デプロイ手順

### Web画面

`web/` 配下は GitHub Pages で公開します。

基本手順:

1. ローカルで `web/entry/` または `web/board-c7k2m9q4/` を修正する
2. ブラウザで表示と操作を確認する
3. 変更をコミットする
4. GitHubへpushする
5. GitHub ActionsとGitHub Pagesの反映を確認する

リポジトリ設定やPages設定を変える場合は、サークルのGitHub Organization権限が必要です。

### Google Apps Script

基本手順:

1. `gas/Code.gs` を修正する
2. Apps Scriptプロジェクトへ反映する
3. 保存する
4. Webアプリのデプロイを更新する
5. 管理画面またはテストURLでAPI動作を確認する
6. 必要なら定期トリガーを再作成する

Apps Script のデプロイ更新を忘れると、GitHub上のコードを直しても本番APIには反映されません。

## 改修時の確認観点

フロントエンドだけの変更でも、以下を確認してください。

- 参加者ページが読み込める
- 名前選択後に大会が表示される
- 回答を送信できる
- メンバー追加申請が送信できる
- 管理画面へ認証できる
- 大会を保存できる
- メンバーを保存できる
- 設定を読み込める

GASを変更した場合は、追加で以下を確認してください。

- `admin_bootstrap` が成功する
- `list_public_tournaments` が成功する
- `upsert_tournament_batch` が成功する
- `upsert_response` が成功する
- `NotificationLogs` に通知履歴が残る
- LINEテスト送信が成功する
- Calendar同期が成功する

## よくある改修パターン

### 入力項目を追加する

1. Google Sheets に列を追加する
2. 管理画面HTMLへ入力欄を追加する
3. 管理画面JSのpayloadへ項目を追加する
4. `Code.gs` の保存処理で値を保持できるか確認する
5. 必要なら参加者画面の表示に追加する
6. 既存データが空欄でも動くことを確認する

列名を変えるより、列を追加するほうが安全です。

### LINE文面を変える

軽微な文面変更は管理画面の `設定`、`LINE配信文面` から行います。

コード側のテンプレート初期値を変える場合は、`getDefaultLineMessageTemplates_` を修正します。ただし、Script Properties に既に保存済みの文面がある場合は、そちらが優先されます。

### 新しい通知を追加する

1. 通知対象の抽出関数を作る
2. メッセージ生成関数を作る
3. LINE送信関数を作る
4. `NotificationLogs` に新しい `notification_type` で記録する
5. 二重送信防止を実装する
6. 必要なら定期トリガーへ組み込む
7. 管理画面に手動実行や設定を追加する

通知系は二重送信が事故になりやすいため、必ず `NotificationLogs` を使ってください。

### 大会ステータスを追加する

1. `validateTournamentStatusForUpdate_` の許可値を増やす
2. 管理画面の `<select>` に選択肢を追加する
3. 一覧フィルタと表示ラベルを見直す
4. 通知対象判定に影響しないか確認する
5. Calendar同期でどう扱うか決める

## 運用上の設計判断

このシステムは、厳密なログイン認証ではなく、長いURLと管理者用トークンで簡易的に守っています。

そのため、以下の運用を守ってください。

- 管理画面URLを公開しない
- 管理者用トークンをGitに入れない
- 参加者向けURLもサークル内だけで共有する
- GitHub上のREADMEやdocsに本番URLを書かない
- 個人情報を増やす改修は慎重に判断する

正式申込に必要な電話番号、メールアドレス、会員番号などは、このシステムでは扱わない方針です。

## トラブルシュート

### APIが `Unknown action` を返す

- フロントエンドの `action` 名と `Code.gs` の分岐が一致しているか確認する
- Apps Scriptのデプロイが最新か確認する

### 管理画面で認証できない

- `ADMIN_CONSOLE_TOKEN` が設定されているか確認する
- 入力したトークンとScript Propertiesの値が一致しているか確認する
- 本番とテストのApps Script URLを取り違えていないか確認する

### 参加ページで大会が出ない

- `EntryPages` に該当 `page_token` があり、`status` が `active` か確認する
- `Tournaments` の `entry_page_token` が一致しているか確認する
- 大会の `status` が `active` か確認する
- メンバーの `grade` と大会の `grades` が合っているか確認する

### LINE通知が送れない

- `LINE_CHANNEL_ACCESS_TOKEN` が有効か確認する
- Botが対象LINEグループに参加しているか確認する
- `LINE_GROUP_ID` または `LINE_TEST_GROUP_ID` が設定されているか確認する
- LINE DevelopersのWebhook URLが最新のApps Script URLか確認する

### カレンダー同期が失敗する

- `CALENDAR_ID` が正しいか確認する
- Apps Scriptの実行アカウントにカレンダー編集権限があるか確認する
- `calendar_event_id_...` の列が存在するか確認する

### シート列エラーが出る

- エラーメッセージに出た列名をGoogle Sheetsへ追加する
- 列名のスペースや全角文字混入を確認する
- 既存列をリネームしていないか確認する

## 引き継ぎチェックリスト

技術担当者を交代するときは、以下を確認してください。

- GitHub Organization またはリポジトリへのアクセス権がある
- GitHub Pages の公開設定を確認できる
- Apps Script プロジェクトを開ける
- Apps Script のデプロイを更新できる
- Script Properties を確認・編集できる
- 運用Google Sheetsを開ける
- Driveフォルダを確認できる
- Google Calendarを確認できる
- LINE Developers のチャネル設定を確認できる
- テスト用LINEグループがある
- 管理画面URL、参加者向けURL、管理者用トークンの受け渡し方法が決まっている

## 関連ドキュメント

- `docs/line_bot_tournament_system_spec.md`: 詳細仕様
- `docs/setup.md`: 初期セットアップメモ
- `gas/SETUP.md`: GAS設定メモ
- `web/README.md`: Web公開方針
- `docs/manuals/basic-operation-manual.md`: 日常運用者向けマニュアル
