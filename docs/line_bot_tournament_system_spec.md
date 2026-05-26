# サークル大会情報管理・参加意思確認・LINE通知Bot 仕様書

## 0. 現在の実装状況と引き継ぎ方針

この文書は初期設計書であると同時に、現在の運用手順書としても使う。

2026-05-19 時点で、以下は実装済みである。

- Google Apps Script による大会・メンバー・回答の読み書きAPI
- GitHub Pages 管理画面からの大会登録・編集
- GitHub Pages 参加意思確認ページからの回答送信
- Google Calendar への大会日、サークル内締切、真の申込締切の同期
- LINE Bot によるグループ通知
- LINE Bot による申込担当者個人通知
- `/groupid` による LINE グループID登録
- `/担当者登録` による申込担当者の LINE userId 登録
- `NotificationLogs` を使った通知履歴管理
- 毎日 17 時台の一斉大会通知トリガー

引き継ぎしやすさを重視し、以下の原則で運用する。

- 正本データは Google Sheets に置く
- 自動処理の判定根拠は `NotificationLogs` に残す
- 申込担当者の特定は `Managers` シートで行う
- 日々の運用は「大会を登録する」「必要なら修正する」だけで回るようにする
- 新しい担当者が来ても、この文書だけで最低限の再設定ができる状態を維持する

## 1. 目的

本システムは、競技かるたサークルにおける大会情報共有、参加意思確認、申込締切管理、申込担当者へのリマインドを自動化することを目的とする。

現在は、申込担当者がメーリングリストで受信した大会要項PDFをGoogle Driveに保存し、カレンダー登録、調整さん作成、LINEグループへの共有、締切後の申込確認、申込完了報告を手動で行っている。本システムでは、このうち大会情報登録後のフローを中心に自動化する。

本システムの主目的は、以下である。

- 大会情報の入力フォーマットを統一する
- 大会情報をGoogle Sheets上で一元管理する
- 参加意思確認を調整さん相当の簡易Webページで行う
- LINEグループへの大会情報共有と締切前リマインドを自動化する
- サークル内締切後、申込担当者へ申込希望者リストを通知する
- 真の申込締切日の朝に申込担当者へ最終リマインドを送る
- 申込完了状態を管理し、不要なリマインドを抑止する

---

## 2. 想定利用者

### 2.1 申込担当者

大会要項を確認し、大会情報をシステムに登録・修正する。サークル内締切後に申込希望者リストを受け取り、実際の申込を行う。

### 2.2 サークルメンバー

参加意思確認ページにアクセスし、各大会について参加希望・未定・不参加を回答する。

### 2.3 LINE Bot

大会情報DBと回答DBを参照し、LINEグループおよび申込担当者個人に通知を送信する。

---

## 3. システム構成

MVPでは以下の構成を採用する。

```text
GitHub Pages
  ├─ 大会情報入力・編集ページ
  └─ 参加意思確認ページ

Google Apps Script
  ├─ 大会情報API
  ├─ 参加回答API
  ├─ メンバーAPI
  ├─ 申込担当者API
  ├─ Google Sheets読み書き
  ├─ LINE Messaging API送信
  ├─ Google Calendar同期
  ├─ 毎日17時台の一斉大会通知
  └─ 定期実行リマインド処理

Google Sheets
  ├─ Tournaments
  ├─ Members
  ├─ Responses
  ├─ EntryPages
  ├─ Managers
  └─ NotificationLogs

LINE
  ├─ サークルLINEグループ
  └─ 申込担当者個人LINE

Google Calendar
  ├─ 大会日時
  ├─ サークル内締切
  └─ 真の申込締切
```

### 3.1 GitHub Pagesの役割

GitHub Pagesは静的Webページの配信に用いる。

担当する機能は以下である。

- 大会情報入力・編集フォームの表示
- 参加意思確認ページの表示
- JavaScriptによるGoogle Apps Script APIへの送信
- 大会情報一覧・回答フォームの描画

GitHub Pages単体ではデータ保存を行わない。

### 3.2 Google Apps Scriptの役割

Google Apps Scriptはバックエンド相当の処理を担う。

担当する機能は以下である。

- Google Sheetsへの大会情報保存
- Google Sheetsへの参加回答保存
- 大会情報・回答情報の取得API
- LINE Messaging APIによる通知送信
- Google Calendarへの予定作成・更新
- 定期実行トリガーによる締切判定
- 通知ログ管理

### 3.3 Google Sheetsの役割

Google Sheetsを本システムの簡易データベースとして扱う。

Google Sheets上の情報を正本とし、LINE通知・カレンダー同期・参加意思確認ページはこの情報を参照する。

---

## 4. 対象範囲

### 4.1 MVPで実装する機能

MVPでは以下を実装する。

1. GitHub Pages上の管理画面から大会情報を登録できる
2. 大会ごとに一意の `tournament_id` を発行できる
3. 既存大会を `tournament_id` に基づいて編集できる
4. 大会情報をGoogle Sheetsに保存できる
5. GitHub Pages上の参加意思確認ページに大会一覧を表示できる
6. メンバーが名前を入力し、大会ごとに `○ / △ / ×` を回答できる
7. 回答をGoogle Sheetsに保存できる
8. 同一大会・同一名前の回答は新規作成ではなく上書きできる
9. LINEグループへ大会情報更新通知を送信できる
10. サークル内締切前にLINEグループへリマインドを送信できる
11. サークル内締切翌日に申込担当者個人LINEへ申込希望者リストを送信できる
12. 真の申込締切日の朝に申込担当者個人LINEへ最終リマインドを送信できる
13. 申込完了ステータスを管理できる
14. 申込完了済み大会には不要なリマインドを送らない
15. Google Calendarへ大会日、サークル内締切、真の申込締切を登録・更新できる

### 4.2 MVPで実装しない機能

以下は初期実装では対象外とする。

- メーリングリストの自動監視
- PDF要項からの大会情報自動抽出
- Google DriveへのPDF自動保存
- 大会要項PDFの自動分類
- 外部大会申込フォームへの自動申込
- 電話番号、メールアドレス、学籍番号、会員番号等の管理
- 厳密なユーザー認証
- メンバーごとのログイン機能
- 管理者権限の細分化
- 複数サークル対応
- 決済・参加費管理

---

## 5. セキュリティ・個人情報方針

### 5.1 取り扱う情報

本システムで扱う個人情報は最小限とする。

原則として保存する個人情報は以下のみである。

- メンバーの名前
- 各大会への参加意思
- 任意コメント
- 申込担当者のLINE userId

### 5.2 保存しない情報

以下の情報は本システムに保存しない。

- 電話番号
- メールアドレス
- 住所
- 学籍番号
- 会員番号
- 生年月日
- LINE ID
- その他、正式申込にのみ必要な詳細情報

正式申込に必要な情報は、申込担当者が別途安全な方法で管理する。

### 5.3 URL tokenによる簡易アクセス制御

参加意思確認ページと管理画面は、それぞれ長いランダムtoken付きURLでアクセス制御する。

例：

```text
参加意思確認ページ:
https://example.github.io/karuta-entry/entry/?page_token=LONG_RANDOM_TOKEN

管理画面:
https://example.github.io/karuta-entry/board-c7k2m9q4/?admin_token=LONG_RANDOM_ADMIN_TOKEN
```

ただし、これは厳密な認証ではない。URLが漏洩した場合、第三者がアクセスできる可能性がある。

### 5.4 token管理

- `admin_token` と `page_token` は分ける
- `admin_token` はGitHubリポジトリに直書きしない
- `admin_token` はGoogle Apps ScriptのPropertiesService等で管理する
- `page_token` はGoogle Sheetsの `EntryPages` シートで管理する
- tokenは十分長いランダム文字列とする

### 5.5 現在の公開方針

当面は、強い認証機構を追加せず、以下の運用で公開する。

- GitHub Pages は公開する
- URL はサークル LINE グループ内だけで共有する
- 検索エンジン避けとして `noindex` と `robots.txt` を設定する
- GitHub 上の README、仕様書、公開文書には本番 URL を書かない
- 管理画面 URL と参加者向け URL は分ける
- 必要に応じて管理画面側は推測しにくいパス名で公開する

この方針は「見つかりにくくする」ためのものであり、厳密なアクセス制御ではない。

---

## 6. データ設計

### 6.0 大会登録の運用ルール

大会登録画面では、複数級をまとめて1回で登録できる。

- 管理画面では `A,B,C` のように複数級を同時に選択できる
- 詳細設定で、特定の級だけ大会日程・主催締切・サークル内締切を個別に上書きできる
- 保存時には、内部的には「1級ごとに1レコード」として `Tournaments` に展開して登録する
- `title` は同じでもよい
- `drive_url` は同じ要項 PDF を使い回してよい

例:

- ABC級合同開催
- 要項ファイルは1つ
- A級とB級とC級で日程や締切が異なる

この場合は、管理画面上では1回の登録操作でよいが、内部的には以下のように3件登録される。

- 東会大会 / A / A級の日程 / A級の締切 / 同じ要項URL
- 東会大会 / B / B級の日程 / B級の締切 / 同じ要項URL
- 東会大会 / C / C級の日程 / C級の締切 / 同じ要項URL

このルールにすることで、参加意思確認画面、締切リマインド、カレンダー同期を級ごとに正しく扱える。

## 6.1 Tournamentsシート

大会情報を管理するシート。


| 列名                                  | 型        | 説明                                                            |
| ----------------------------------- | -------- | ------------------------------------------------------------- |
| tournament_id                       | string   | 大会ごとの一意ID                                                     |
| title                               | string   | 大会名                                                           |
| event_start_date                    | date     | 大会開始日                                                         |
| event_end_date                      | date     | 大会終了日                                                         |
| grades                              | string   | 開催級。例: `B,C,D`                                                |
| tournament_type                     | string   | 大会種別。`official` / `support` / `event`                       |
| is_official                         | boolean  | 公認大会かどうか                                                      |
| venue                               | string   | 会場                                                            |
| true_deadline                       | datetime | 真の申込締切                                                        |
| internal_deadline                   | datetime | サークル内締切                                                       |
| drive_url                           | string   | Google Drive上の要項URL                                           |
| entry_page_token                    | string   | 対応する参加意思確認ページtoken                                            |
| entry_url                           | string   | 参加意思確認ページURL                                                  |
| manager_name                        | string   | 申込担当者名                                                        |
| manager_line_user_id                | string   | 申込担当者のLINE userId                                             |
| status                              | string   | `draft`, `active`, `applied`, `closed`, `canceled`, `deleted` |
| calendar_event_id_event             | string   | 大会日予定のGoogle Calendar event id                                |
| calendar_event_id_internal_deadline | string   | サークル内締切予定のevent id                                            |
| calendar_event_id_true_deadline     | string   | 真の締切予定のevent id                                               |
| created_at                          | datetime | 作成日時                                                          |
| updated_at                          | datetime | 更新日時                                                          |
| applied_at                          | datetime | `status = applied` に初めて切り替わった日時                                  |
| deleted_at                          | datetime | 削除扱い日時                                                        |


### 6.1.1 statusの意味


| status   | 意味                   |
| -------- | -------------------- |
| draft    | 下書き。参加者ページ・通知対象にはしない |
| active   | 公開中。参加者ページ・通知対象にする   |
| applied  | 申込完了済み。担当者リマインド対象外   |
| closed   | 大会終了・運用終了            |
| canceled | 大会中止                 |
| deleted  | 削除扱い。物理削除はしない        |

- `applied_at` は `status` が `applied` に変わった時点で自動記録する
- すでに `applied` の大会を再保存しても、既存の `applied_at` は維持する
- `applied` 以外の状態へ戻した場合は `applied_at` を空に戻す


---

## 6.2 Responsesシート

参加回答を管理するシート。


| 列名            | 型        | 説明                   |
| ------------- | -------- | -------------------- |
| response_id   | string   | 回答ごとの一意ID            |
| tournament_id | string   | 対応する大会ID             |
| member_name   | string   | 回答者名                 |
| response      | string   | `yes`, `maybe`, `no` |
| comment       | string   | 任意コメント               |
| created_at    | datetime | 作成日時                 |
| updated_at    | datetime | 更新日時                 |


### 6.2.1 responseの意味


| response | 表示  | 意味      |
| -------- | --- | ------- |
| yes      | ○   | 参加希望    |
| maybe    | △   | 未定・条件付き |
| no       | ×   | 不参加     |


### 6.2.2 回答更新ルール

同じ `tournament_id` と `member_name` の組み合わせが既に存在する場合、新規行を作成せず既存行を更新する。

```text
unique key = tournament_id + member_name
```

---

## 6.3 EntryPagesシート

参加意思確認ページのtokenを管理するシート。


| 列名           | 型        | 説明                               |
| ------------ | -------- | -------------------------------- |
| page_token   | string   | 参加意思確認ページtoken                   |
| title        | string   | ページタイトル                          |
| description  | string   | ページ説明文                           |
| active_from  | datetime | 有効開始日時                           |
| active_until | datetime | 有効終了日時                           |
| status       | string   | `active`, `inactive`, `archived` |
| created_at   | datetime | 作成日時                             |
| updated_at   | datetime | 更新日時                             |


---

## 6.4 Managersシート

申込担当者情報を管理するシート。


| 列名           | 型        | 説明                   |
| ------------ | -------- | -------------------- |
| manager_name | string   | 申込担当者名               |
| line_user_id | string   | LINE userId          |
| display_name | string   | LINE表示名または任意表示名      |
| status       | string   | `active`, `inactive` |
| created_at   | datetime | 作成日時                 |
| updated_at   | datetime | 更新日時                 |


---

## 6.5 NotificationLogsシート

通知済み判定に使うシート。


| 列名                | 型        | 説明                      |
| ----------------- | -------- | ----------------------- |
| log_id            | string   | 通知ログID                  |
| tournament_id     | string   | 対応する大会ID                |
| notification_type | string   | 通知種別                    |
| sent_to_type      | string   | `group` または `manager`   |
| sent_to_id        | string   | LINE groupId または userId |
| sent_at           | datetime | 送信日時                    |
| message           | string   | 送信本文                    |


### 6.5.1 notification_type


| notification_type                  | 意味              |
| ---------------------------------- | --------------- |
| announcement                       | 大会情報更新通知        |
| internal_deadline_2days_before     | サークル内締切2日前リマインド |
| internal_deadline_next_day_manager | サークル内締切翌日の担当者通知 |
| true_deadline_morning_manager      | 真の締切日朝の担当者最終通知  |
| application_completed              | 申込完了通知          |


---

## 7. ID設計

### 7.1 tournament_id

大会IDは以下の形式を推奨する。

```text
TYYYYMMDD_RANDOM
```

例：

```text
T20260627_AZ8KQ2
```

意味：

```text
T          tournament
20260627   大会開始日
AZ8KQ2     ランダム6文字
```

大会名からIDを生成してはならない。大会名は修正・表記揺れが発生するためである。

### 7.2 response_id

回答IDは以下の形式を推奨する。

```text
RYYYYMMDDHHMMSS_RANDOM
```

### 7.3 log_id

通知ログIDは以下の形式を推奨する。

```text
LYYYYMMDDHHMMSS_RANDOM
```

---

## 8. 画面仕様

## 8.1 管理画面 `/board-c7k2m9q4/`

### 8.1.1 目的

申込担当者が大会情報を登録・編集するための画面。

### 8.1.2 アクセスURL

```text
https://example.github.io/karuta-entry/board-c7k2m9q4/?admin_token=LONG_RANDOM_ADMIN_TOKEN
```

### 8.1.3 機能

- 登録済み大会一覧の表示
- 新規大会作成
- 既存大会編集
- 大会情報保存
- 保存中モーダルの表示と操作ロック
- 大会ステータス変更
- 申込担当者プルダウン選択
- 開催級の複数選択UI
- メンバー級の単一選択UI
- 申込み状況カード一覧の表示
- タグ絞り込み付き登録済み大会一覧の表示
- LINE更新通知送信
- カレンダー同期実行
- 申請中メンバー一覧の表示
- メンバー追加申請の承認 / 却下

### 8.1.4 入力項目


| 項目               | UI              | 必須    | 備考                                   |
| ---------------- | --------------- | ----- | ------------------------------------ |
| 大会ID             | text / readonly | 編集時必須 | 新規作成時は自動生成                           |
| 大会名              | text            | 必須    | 例: 東会大会D級                            |
| 大会開始日            | date            | 必須    | ISO date形式で保存                        |
| 大会終了日            | date            | 必須    | 1日大会なら開始日と同じ                         |
| 開催級              | 複数選択チップ        | 任意    | A/B/C/D/E/F/初心者 を複数選択可能                |
| 公認区分             | select          | 任意    | 公認/非公認                               |
| 会場               | text            | 任意    | 未定可                                  |
| 真の申込締切           | date + time     | 必須    | 日付と時刻を分けて入力し、JSTとして扱う。初期時刻は `23:59` |
| サークル内締切          | date + time     | 必須    | 日付と時刻を分けて入力し、JSTとして扱う。初期時刻は `23:59` |
| Google Drive URL | url             | 任意    | 要項PDFの保存先                            |
| 申込担当者            | select          | 必須    | `Managers` シートの active な担当者から選択する      |
| ステータス            | select          | 必須    | draft/active/applied/closed/canceled |
| 備考               | textarea        | 任意    | 参加資格等の補足                             |


### 8.1.5 ボタン

初期版で必要なボタンは以下である。

- 新規作成
- 保存
- 下書き保存
- 公開状態にする
- LINEグループへ更新通知を送る
- カレンダー同期
- 中止にする
- 削除扱いにする

MVPでは以下に絞ってもよい。

- 新規作成
- 保存
- 公開/下書き切り替え
- LINEグループへ更新通知を送る

### 8.1.6 編集ルール

- `tournament_id` が空の場合、新規作成として扱う
- `tournament_id` が既存の場合、該当行を更新する
- `tournament_id` が指定されているが未登録の場合、そのIDで新規作成する
- 既存大会を編集しても、同じ `tournament_id` に紐づく `Responses` はリセットしない
- 保存時に Google Calendar 同期も実行する
- 保存時に LINE 通知は自動送信しない
- 日常運用では、LINE 通知は毎日 17 時台の定期トリガーに任せる
- 緊急共有が必要な場合のみ「LINEグループへ更新通知を送る」ボタンを使う
- 保存中はポップアップで進捗文言を表示し、画面の他操作を受け付けない

### 8.1.7 管理画面タブと一覧表示

- 大会管理タブの順番は `新規入力` → `申込み状況` → `登録済み一覧` とする
- `申込み状況` では、終了タグの付いた大会を非表示にする
- `申込み状況` では、終了していない大会をカード形式で表示し、各大会に以下のタグを付ける
- `申込み受付中`
- `申込み済み`
- `終了`
- `登録済み一覧` は、`申込み状況` と近いカードUIで表示する
- `登録済み一覧` では、申込者名の代わりに `編集する` ボタンを表示する
- `登録済み一覧` では、以下のタグをチェック式で絞り込みできる
- `申込み受付中`
- `申込み済み`
- `終了`
- `申込み状況` では、各大会カード上で `未申込み / 申込み済み` を切り替えるスイッチ型トグルを表示する
- トグルをONにすると `status = applied` 、OFFに戻すと `status = active` に更新する
- `applied` へ切り替えた時点で `applied_at` を自動記録する
- `編集する` を押した大会は個別編集画面へ遷移させず、同一管理画面内で編集できるようにする

### 8.1.8 メンバー追加申請の管理

- `メンバー` タブ上部に `申請中メンバー` セクションを表示する
- `Members` シートで `status = pending` のメンバーだけをカード形式で表示する
- 各カードには少なくとも以下を表示する
- 氏名
- ふりがな
- 段位
- 級
- 各カードで以下の操作を行えるようにする
- `内容を確認`
- `承認`
- `却下`
- `内容を確認` を押すと、同一画面内のメンバー編集フォームへ対象データを読み込む
- `承認` を押すと `status = active` に変更する
- `却下` を押すと確認ポップアップを表示し、確定時のみ `status = rejected` に変更する

---

## 8.2 参加意思確認ページ `/entry/`

### 8.2.1 目的

サークルメンバーが大会ごとに参加意思を回答するための画面。

### 8.2.2 アクセスURL

```text
https://example.github.io/karuta-entry/entry/?page_token=LONG_RANDOM_TOKEN
```

### 8.2.3 表示内容

- ページタイトル
- 説明文
- ページタイトル下の補助導線
- 名前入力欄
- 公開中大会一覧
- 大会ごとの日程、開催級、サークル内締切、要項URL
- 大会ごとの `○ / △ / ×` 選択欄
- 大会ごとのコメント欄
- 送信ボタン
- 大会一覧ビュー
- 年間大会予定表ビュー
- メンバー追加申請ビュー

### 8.2.4 UI例

```text
大会参加確認

名前:
[ 石田 ]

--------------------------------
東会大会D級
日程: 6月27日
開催級: D級
サークル内締切: 6月20日 23:59
要項: Google Drive

回答:
( ) ○ 参加希望
( ) △ 未定・条件付き
( ) × 不参加

コメント:
[                         ]
--------------------------------

[送信]
```

ページタイトル下には、少なくとも以下の導線を置く。

- `大会一覧`
- `年間大会予定表`

`大会一覧` は別ビューで申込み状況を表示する。

`年間大会予定表` は、Google Drive 上の年間予定表 PDF 単体を埋め込み表示する。

`名前がない場合は追加申請` は、一覧の中で展開せず、同一ページ内の別ビューとして表示する。

### 8.2.5 メンバー追加申請ビュー

- 名前選択欄の近くに `名前がない場合は追加申請` の導線を置く
- 導線を押すと、年間大会予定表と同様に同一ページ内の専用ビューへ切り替える
- 申請フォームでは以下を入力させる
- 苗字（漢字）
- 苗字（ふりがな）
- 名前（漢字）
- 名前（ふりがな）
- 段位
- 出場級
- 段位は `無段 / 初段 / 二段 / ... / 十段` を表示し、保存値は `0` から `10` の文字列とする
- 出場級は `A / B / C / D / E / F / 初心者` を表示し、保存値は `A / B / C / D / E / F / beginner` とする
- 送信時は `Members` シートへ `status = pending` で登録する
- 既存メンバーや既存申請と重複する場合は登録を拒否する
- 送信成功時は、承認後に名前一覧へ表示される旨を案内する

### 8.2.6 回答保存ルール

- 名前は必須
- 回答は大会ごとに任意とするか必須とするかを選べる
- MVPでは、表示されている大会のうち回答が入力されたものだけ保存してよい
- 同一 `tournament_id` + `member_name` の回答は上書きする
- 回答送信後、保存成功メッセージを表示する

---

## 9. API仕様

Google Apps Script Web AppをAPIとして利用する。

## 9.1 大会一覧取得 API（管理画面用）

### Request

```http
GET /exec?action=list_tournaments&admin_token=LONG_RANDOM_ADMIN_TOKEN
```

### Response

```json
{
  "ok": true,
  "tournaments": [
    {
      "tournament_id": "T20260627_AZ8KQ2",
      "title": "東会大会D級",
      "event_start_date": "2026-06-27",
      "event_end_date": "2026-06-27",
      "grades": "D",
      "tournament_type": "official",
      "is_official": true,
      "venue": "○○会館",
      "true_deadline": "2026-06-23T23:59:00+09:00",
      "internal_deadline": "2026-06-20T23:59:00+09:00",
      "drive_url": "https://drive.google.com/...",
      "manager_name": "山田",
      "status": "active"
    }
  ]
}
```

---

## 9.2 大会新規作成・更新 API

### Request

```http
POST /exec
Content-Type: application/json
```

```json
{
  "action": "upsert_tournament",
  "admin_token": "LONG_RANDOM_ADMIN_TOKEN",
  "tournament": {
    "tournament_id": "T20260627_AZ8KQ2",
    "title": "東会大会D級",
    "event_start_date": "2026-06-27",
    "event_end_date": "2026-06-27",
    "grades": "D",
    "tournament_type": "official",
    "is_official": true,
    "venue": "○○会館",
    "true_deadline": "2026-06-23T23:59:00+09:00",
    "internal_deadline": "2026-06-20T23:59:00+09:00",
    "drive_url": "https://drive.google.com/...",
    "manager_name": "山田",
    "status": "active"
  }
}
```

### Response

```json
{
  "ok": true,
  "tournament_id": "T20260627_AZ8KQ2",
  "mode": "updated"
}
```

`mode` は `created` または `updated` とする。

---

## 9.3 参加者向け大会一覧取得 API

### Request

```http
GET /exec?action=list_public_tournaments&page_token=LONG_RANDOM_TOKEN
```

### Response

```json
{
  "ok": true,
  "page": {
    "title": "大会参加確認",
    "description": "参加希望の大会に○を付けてください。"
  },
  "tournaments": [
    {
      "tournament_id": "T20260627_AZ8KQ2",
      "title": "東会大会D級",
      "event_date_label": "6月27日",
      "grades": "D",
      "internal_deadline": "2026-06-20T23:59:00+09:00",
      "drive_url": "https://drive.google.com/..."
    }
  ]
}
```

参加者向けAPIでは、原則として真の締切や担当者LINE userId等の管理情報は返さない。

---

## 9.4 参加回答保存 API

### Request

```http
POST /exec
Content-Type: application/json
```

```json
{
  "action": "upsert_response",
  "page_token": "LONG_RANDOM_TOKEN",
  "member_name": "石田",
  "responses": [
    {
      "tournament_id": "T20260627_AZ8KQ2",
      "response": "yes",
      "comment": "参加希望です"
    },
    {
      "tournament_id": "T20260704_X91BND",
      "response": "no",
      "comment": ""
    }
  ]
}
```

### Response

```json
{
  "ok": true,
  "updated_count": 2
}
```

---

## 9.5 メンバー追加申請 API

### Request

```http
POST /exec
Content-Type: application/json
```

```json
{
  "action": "request_member_registration",
  "member": {
    "last_name": "石田",
    "last_name_kana": "いしだ",
    "first_name": "陽音",
    "first_name_kana": "ようおん",
    "rank": "0",
    "grade": "D"
  }
}
```

### Response

```json
{
  "ok": true,
  "member_id": "M004",
  "mode": "created",
  "status": "pending",
  "notification": {
    "sent": true,
    "skipped": false,
    "manager_count": 1
  }
}
```

- 保存時には `status = pending` を強制する
- `normalized_name` または `normalized_kana` が既存メンバーと一致する場合は重複としてエラーにする
- 登録後、`Managers` シートの `active` かつ有効な `line_user_id` を持つ担当者へ即時通知する
- 通知失敗時も、申請自体の保存は成功させる

---

## 9.6 LINE更新通知送信 API

### Request

```http
POST /exec
Content-Type: application/json
```

```json
{
  "action": "send_announcement",
  "admin_token": "LONG_RANDOM_ADMIN_TOKEN",
  "tournament_ids": [
    "T20260627_AZ8KQ2",
    "T20260704_X91BND"
  ]
}
```

### Response

```json
{
  "ok": true,
  "sent": true
}
```

---

## 9.7 大会ステータス更新 API

### Request

```http
POST /exec
Content-Type: application/json
```

```json
{
  "action": "update_tournament_status",
  "tournament_id": "T20260627_AZ8KQ2",
  "status": "applied"
}
```

### Response

```json
{
  "ok": true,
  "tournament_id": "T20260627_AZ8KQ2",
  "status": "applied",
  "calendar_sync": {
    "ok": true
  }
}
```

- 主な用途は、管理画面の申込み完了トグルから `active / applied` を切り替えること
- `status` に応じて Google Calendar 同期も再実行する
- `applied` へ切り替えた場合は `applied_at` を自動記録する

---

## 10. LINE通知仕様

### 10.0 通知種別の整理

Bot が送る LINE 文書は、送信先ごとに以下の 2 系統へ分ける。

#### グループ向け

- 大会情報更新通知
- サークル内締切2日前リマインド
- 申込完了通知

グループ向け通知の目的は、サークル全体への周知と回答促進である。

#### 担当者の個人LINE向け

- サークル内締切翌日の申込対応通知
- 主催締切日朝の最終リマインド
- メンバー追加申請の即時通知
- メンバー追加申請の朝 7:00 集約通知

個人向け通知の目的は、担当者や管理者に具体的な処理を促すことである。

## 10.1 大会情報更新通知

基本運用では、毎日 17:00 の定期トリガーから一斉送信する。

管理画面の「LINEグループへ更新通知を送る」ボタンは残しておき、以下のような例外時のみ手動送信に使う。

- 当日中に至急共有したい大会がある
- 定期トリガーの設定直後で、試験送信したい
- 何らかの理由で自動送信が失敗し、手動再送したい

### 送信対象

以下をすべて満たす大会を通知対象とする。

- `status = active`
- 前回の大会情報更新通知以降に新規作成または更新された

複数大会があれば、更新された内容だけを 1 通にまとめて送る。

17:00 以降に更新した内容は翌日の 17:00 通知へ回す。

### 二重送信防止

`NotificationLogs` に以下を満たす履歴があれば、その大会は「通知済み」とみなす。

```text
notification_type = announcement
sent_to_type = group
tournament_id = 対象大会ID
```

### 文面例

```text
【大会情報更新】
大会情報を更新しました。
参加希望者は、下記の大会一覧を確認してください。

【更新内容】
6月12日 埼玉大会C級（公認）
6月13日 埼玉大会D級（公認）
6月12日 東京大会BCD級（後援）

【参加回答】
参加希望者は、以下のページから回答してください。
各日程にサークル内締切を併記しています。
締切までの回答にご協力お願いします。
https://example.github.io/karuta-entry/entry/?page_token=...

【要項・案内】
大会要項や案内文書は、以下のDriveから確認してください。
https://drive.google.com/drive/folders/...

※サークル内限定の案内です。URLの外部共有はしないでください。
```

### 文面ルール

- `【更新内容】` は開催日単位で並べる
- 日程が異なる場合は、同じ大会名でも別行にする
- 同じ日程で同じ大会名の級違いは、`BCD級` のようにまとめて表記する
- 各行の末尾に `（公認）` `（後援）` `（イベント）` の種別ラベルを付ける
- `【参加回答】` を `【要項・案内】` より先に置く
- `【要項・案内】` には個別PDFではなく、案内一式を保存した Google Drive ディレクトリのURLを載せる
- 文末に `※サークル内限定の案内です。URLの外部共有はしないでください。` を入れる

---

### 10.1.1 実装メモ

- 実装関数: `sendScheduledDailyAnnouncements()`
- 補助関数:
  - `getPendingAnnouncementTournaments()`
  - `getAnnouncedTournamentIdMap()`
  - `sendAnnouncementForTournaments()`
- テスト関数: `testSendScheduledDailyAnnouncements()`

Apps Script の時間トリガーは厳密に 17:00:00 ではなく、17 時台のどこかで実行されることがある。

## 10.2 サークル内締切前リマインド

### 送信タイミング

- サークル内締切2日前の10:00

### 送信先

サークルLINEグループ。

### 対象大会

以下をすべて満たす大会。

- `status = active`
- サークル内締切が該当タイミングに一致
- 対応する通知ログがまだ存在しない

### 文面例

```text
＝＝＝＝＝＝＝＝＝＝＝
【回答締切リマインド】
＝＝＝＝＝＝＝＝＝＝＝

以下の大会のサークル内締切が2日後に迫っています。
参加を考えている方は、忘れずに回答してください。

【対象大会】
6月12日 埼玉大会C級（公認）
6月13日 埼玉大会D級（公認）
6月12日 東京大会BCD級（後援）

【回答ページ】
https://example.github.io/karuta-entry/entry/?page_token=...

【要項・案内】
https://drive.google.com/drive/folders/...

※サークル内限定の案内です。URLの外部共有はしないでください。
```

複数大会をまとめて送信してよい。

### 文面ルール

- 見出しは `＝＝＝＝＝＝＝＝＝＝＝` `【回答締切リマインド】` `＝＝＝＝＝＝＝＝＝＝＝` の3行で始める
- 更新通知と区別しやすいように、冒頭で `2日後に迫っています` を明記する
- `【対象大会】` には開催日単位で大会を並べる
- 日程が異なる場合は、同じ大会名でも別行にする
- 同じ日程で同じ大会名の級違いは、`BCD級` のようにまとめて表記する
- 各行の末尾に `（公認）` `（後援）` `（イベント）` の種別ラベルを付ける
- `【回答ページ】` を `【要項・案内】` より先に置く
- `【要項・案内】` には個別PDFではなく、案内一式を保存した Google Drive ディレクトリのURLを載せる
- 文末に `※サークル内限定の案内です。URLの外部共有はしないでください。` を入れる

---

## 10.3 サークル内締切翌日の担当者通知

### 送信タイミング

サークル内締切翌日の10:00。

### 送信先

申込担当者の個人LINE。

### 対象大会

以下をすべて満たす大会。

- `status = active`
- サークル内締切を過ぎている
- サークル内締切翌日通知が未送信

### 抽出対象

`Responses` シートから以下を満たす回答者を抽出する。

```text
tournament_id = 対象大会ID
response = yes
```

### 文面例

```text
【申込対応リマインド】
サークル内締切を過ぎました。
以下の大会について申込対応をお願いします。

==埼玉大会B級==
主催締切日: 6月23日 17:00
山田太郎 B級
田中花子 B級

==東京大会CD級==
主催締切日: 6月24日 20:00
佐藤花子 C級
高橋修矢 D級

【要項】
https://drive.google.com/...

【管理画面】
https://example.github.io/karuta-entry/board-c7k2m9q4/?admin_token=...

必要に応じて、級や段位を確認してから申込してください。
申込対応後は、申込完了処理を忘れずに行ってください。
```

---

## 10.4 主催締切日朝の最終リマインド

### 送信タイミング

主催締切日の10:00。

### 送信先

申込担当者の個人LINE。

### 対象大会

以下をすべて満たす大会。

- `status = active`
- 主催締切日が当日
- 申込完了処理がまだされていない
- 主催締切日朝リマインドが未送信

### 文面例

```text
【最終リマインド】
本日が主催締切日です。
以下の大会について、申込漏れがないか確認してください。

==埼玉大会B級==
主催締切日: 6月23日 17:00
山田太郎 B級
田中花子 B級

==東京大会CD級==
主催締切日: 6月24日 20:00
佐藤花子 C級
高橋修矢 D級

【要項】
https://drive.google.com/...

【管理画面】
https://example.github.io/karuta-entry/board-c7k2m9q4/?admin_token=...

申込対応後は、申込完了処理を忘れずに行ってください。
```

---

## 10.5 申込完了通知

申込担当者が管理画面で大会の `status` を `applied` にしたあと、その日の 23 時台にLINEグループへ送る。

### 送信タイミング

毎日 23:00。

他の案内と時間帯が重なって読み飛ばされることを避けるため、更新通知や締切通知と時間を分ける。

- 対象は、当日 `applied` へ更新された大会のみ
- すでに `application_completed` を送信済みの大会は再送しない

### 文面例

```text
【申込み完了】
以下の大会について申込みが完了しました。

==埼玉大会B級==
山田太郎 B級
田中花子 B級

==埼玉大会CD級==
佐藤花子 C級
高橋修矢 D級
```

### 文面ルール

- 大会見出しは `==大会名 + 級まとめ==` の形式で表示する
- 同一大会名でも、申込締切日や申込実行タイミングが異なる級は別通知ブロックとして扱う
- 通知には、その時点で実際に申込完了した級だけを含める
- たとえば `埼玉大会BCD級` のうち B級だけ先に申し込んだ場合は、先に `==埼玉大会B級==` だけを送る
- 後から C級とD級を申し込んだ場合は、別通知または別ブロックとして `==埼玉大会CD級==` を送る
- 同じ通知内で複数級を含む場合、申込者は `A, B, C, D, E, F, 初心者` の順に並べる
- 各級の中では `member_id` 昇順で並べる
- 氏名はフルネームで表示する
- 申込者がいない大会は `申込者なし` と表示する

---

## 11. Google Calendar同期仕様

大会ごとに、Google Calendarへ以下3種類の予定を作成する。

### 11.1 大会日予定

```text
タイトル: 【大会】東会大会D級
日付: event_start_date 〜 event_end_date
説明:
- 開催級
- 会場
- Google Drive URL
- 参加意思確認URL
```

### 11.2 サークル内締切予定

```text
タイトル: 【サークル内締切】東会大会D級
日時: internal_deadline
説明:
この日までに参加意思確認ページへ回答。
```

### 11.3 真の申込締切予定

```text
タイトル: 【真の申込締切】東会大会D級
日時: true_deadline
説明:
申込担当者が主催者へ申込を行う最終締切。
```

### 11.4 更新ルール

- `calendar_event_id_*` が空の場合、新規作成する
- `calendar_event_id_*` が存在する場合、既存予定を更新する
- 大会情報の修正で新規予定を重複作成してはならない
- `status = canceled` の場合、予定タイトルに `[中止]` を付与するか、予定を削除する
- `status = deleted` の場合、原則としてカレンダー予定は削除または非表示相当にする

---

## 12. 定期実行処理

Google Apps Scriptの時間主導トリガーで、毎日または毎時間実行する。

2026-05-19 時点では、少なくとも以下の定期処理を想定する。

- 毎日 17 時台の大会情報一斉通知
- 締切系リマインドの定期処理

大会情報一斉通知は実装済みである。締切系リマインドは手動テスト関数で検証できる状態にあり、必要に応じて別トリガーで定期実行する。

### 12.1 処理概要

```text
1. Tournamentsから対象大会を取得
2. 現在日時を取得
3. 大会情報一斉通知対象を抽出する
4. 未通知大会があれば1通にまとめてLINEグループへ送る
5. NotificationLogsへ記録する
6. サークル内締切2日前・前日の大会を抽出する
7. LINEグループへリマインド送信する
8. サークル内締切翌日の大会を抽出する
9. Responsesから申込希望者を抽出する
10. 担当者個人LINEへ通知する
11. 真の申込締切日当日の大会を抽出する
12. 申込完了済みでなければ担当者へ最終通知する
13. 各通知後、NotificationLogsに記録する
```

### 12.2 二重送信防止

通知送信前に `NotificationLogs` を確認する。

以下の組み合わせが既に存在する場合、再送信しない。

```text
tournament_id + notification_type + sent_to_type
```

### 12.3 大会情報一斉通知トリガー

実装済みの大会情報一斉通知トリガーは以下の運用とする。

- ハンドラ関数: `sendScheduledDailyAnnouncements`
- 作成関数: `installDailyAnnouncementTrigger()`
- 削除関数: `deleteDailyAnnouncementTrigger()`
- 実行時刻: 毎日 17 時台

`installDailyAnnouncementTrigger()` は既存の同名トリガーを削除してから再作成する。

### 12.4 自動リマインドトリガー

実装済みの自動リマインドトリガーは以下の運用とする。

- ハンドラ関数: `sendScheduledTournamentReminders`
- 作成関数: `installTournamentReminderTrigger()`
- 削除関数: `deleteTournamentReminderTrigger()`
- 実行時刻: 毎日 10 時台

このトリガーでは以下を自動送信する。

- サークル向け: サークル内締切の 2 日前リマインド
- 担当者向け: サークル内締切翌日の申込対応リマインド
- 担当者向け: 主催締切当日の最終リマインド

`installTournamentReminderTrigger()` は既存の同名トリガーを削除してから再作成する。

---

## 13. LINE Botコマンド仕様

MVPでは管理画面中心とし、LINEコマンドは最小限でよい。

### 13.1 必須に近いコマンド

```text
/担当者登録
```

実行者のLINE userIdを取得し、Managersシートに登録する。

```text
/groupid
```

現在Botが参加しているLINEグループのgroupIdを確認・登録する。

### 13.2 後から追加するコマンド

```text
/大会一覧
```

登録済み大会を表示する。

```text
/大会詳細 T20260627_AZ8KQ2
```

指定大会の詳細を表示する。

```text
/申込完了 T20260627_AZ8KQ2
```

指定大会を申込完了状態に変更し、申込完了通知をLINEグループへ送信する。

---

## 14. 入力バリデーション

### 14.1 大会情報

以下を必須とする。

- 大会名
- 大会開始日
- 大会終了日
- 真の申込締切
- サークル内締切
- 申込担当者
- ステータス

### 14.2 日時チェック

以下を検証する。

- 大会終了日は大会開始日以降であること
- サークル内締切は真の申込締切以前であること
- サークル内締切は原則として大会日以前であること
- 真の申込締切は原則として大会日以前であること

### 14.3 URLチェック

以下はURL形式を検証する。

- Google Drive URL
- 参加意思確認ページURL

### 14.4 参加回答

以下を検証する。

- 名前が空でないこと
- `response` は `yes`, `maybe`, `no` のいずれかであること
- `tournament_id` が存在する大会であること
- `page_token` が有効であること

---

## 15. 運用フロー

## 15.1 大会情報登録フロー

```text
1. 申込担当者がメーリングリストで大会要項PDFを受け取る
2. PDFをサークルのGoogle Driveに保存する
3. 管理画面を開く
4. 大会名、日時、開催級、締切、Drive URL等を入力する
5. 保存する
6. 保存時にGoogle Calendarへ同期される
7. 通常は毎日17時台の定期トリガーが未通知大会をまとめてLINEグループへ送る
8. 緊急時のみ手動でLINEグループへ更新通知を送る
```

## 15.2 参加回答フロー

```text
1. メンバーがLINEグループに投稿された参加意思確認URLを開く
2. 名前を入力する
3. 各大会について○/△/×を選ぶ
4. 必要に応じてコメントを書く
5. 送信する
6. 回答がGoogle Sheetsに保存される
```

## 15.3 申込対応フロー

```text
1. サークル内締切前にBotがLINEグループへリマインドする
2. サークル内締切翌日にBotが申込担当者へ申込希望者一覧を送る
3. 申込担当者が正式申込を行う
4. 申込完了後、管理画面またはBotコマンドでstatusをappliedにする
5. BotがLINEグループへ申込完了通知を送る
6. true_deadline当日の最終リマインドは抑止される
```

---

## 16. MVP実装順序

以下の順序で実装する。

```text
1. Google Sheetsのシート作成
2. GASでTournamentsの読み書きAPIを実装
3. GitHub Pagesに管理画面を作成
4. 管理画面から大会情報を新規作成・編集できるようにする
5. GASで参加者向け大会一覧APIを実装
6. GitHub Pagesに参加意思確認ページを作成
7. GASでResponsesのupsert APIを実装
8. 回答がGoogle Sheetsに保存されることを確認
9. LINE BotのgroupId取得・担当者登録を実装
10. LINEグループへの大会情報更新通知を実装
11. サークル内締切前リマインドを実装
12. サークル内締切翌日の担当者通知を実装
13. 真の締切日朝の最終リマインドを実装
14. Google Calendar同期を実装
15. 申込完了処理を実装
```

---

## 17. 将来的な拡張候補

MVP後に検討する機能は以下である。

- PDF要項から大会名・日程・締切を半自動抽出する
- Google Driveに保存したPDFと大会情報を紐づける
- LINE上から大会情報を登録できるようにする
- メンバー名を事前登録制にする
- 個人別回答履歴を表示する
- 回答締切後に参加者へ確認メッセージを送る
- 管理者向け回答一覧ページを作る
- 大会ごとの申込状況ダッシュボードを作る
- 大会中止時の一括通知機能を作る
- Supabase等へ移行して本格的なDB管理にする
- ログイン機能を導入する

---

## 18. 現時点の設計判断

本システムでは、初期段階でPDF読解や完全自動申込を行わない。

理由は以下である。

- 大会要項PDFはフォーマットが統一されていない
- 締切、参加資格、地域制限、級別条件などの誤抽出は実害が大きい
- 大会申込業務では人間による確認が必要である
- まずは締切忘れと共有漏れを防ぐ方が効果が高い

したがって、MVPでは以下の方針を採用する。

```text
人間が確認した大会情報を管理画面から入力し、
Botが通知・回答収集・締切管理を自動化する。
```

---

## 19. 成功条件

MVPの成功条件は以下である。

- 申込担当者が管理画面から大会情報を登録・修正できる
- 登録された大会情報がGoogle Sheetsに保存される
- メンバーが参加意思確認ページから回答できる
- 回答がGoogle Sheetsに保存される
- 同じ名前・同じ大会への再回答が上書きされる
- LINEグループへ大会情報更新通知を送れる
- サークル内締切前に自動リマインドが送れる
- サークル内締切翌日に担当者へ申込希望者一覧が送れる
- 真の締切日朝に担当者へ最終リマインドが送れる
- 申込完了済み大会には不要なリマインドが送られない
- Google Calendarに大会日・2種類の締切が登録される

---

## 20. 用語


| 用語            | 意味                                 |
| ------------- | ---------------------------------- |
| 真の申込締切        | 大会主催者が定める正式な申込締切                   |
| サークル内締切       | サークル内で参加希望を集めるための締切。真の締切より数日前に設定する |
| 申込担当者         | サークル内で大会申込作業を担当する人                 |
| 参加意思確認ページ     | メンバーが各大会への参加希望を回答するWebページ          |
| tournament_id | 大会ごとの一意ID                          |
| page_token    | 参加意思確認ページにアクセスするためのランダムtoken       |
| admin_token   | 管理画面および管理APIを利用するためのランダムtoken      |


---

## 21. 初期設定・再設定手順

この章は、新任担当者が最初に確認するための運用手順である。

### 21.1 Script Properties

Google Apps Script の `Script Properties` には最低限以下を設定する。

| キー | 用途 |
| --- | --- |
| `SHEET_ID` | 利用する Google Sheets のファイルID |
| `CALENDAR_ID` | 同期先 Google Calendar の ID |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API のチャネルアクセストークン |
| `LINE_GROUP_ID` | 通知先グループの groupId |
| `LINE_ADMIN_TOKEN` | 管理API保護用トークン。未設定でも動くが設定推奨 |
| `DRIVE_FOLDER_ID` | 要項ファイルを保存する Google Drive フォルダ ID |

### 21.2 `appsscript.json` の権限

少なくとも以下の OAuth scope を設定する。

```json
[
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/script.external_request",
  "https://www.googleapis.com/auth/script.scriptapp"
]
```

`installDailyAnnouncementTrigger()` 実行時には `script.scriptapp` 権限が必要である。

### 21.3 LINE の初期登録

1. Bot を対象 LINE グループに参加させる
2. グループ内で `/groupid` を送る
3. 申込担当者が各自 `/担当者登録` を送る
4. `Managers` シートに `line_user_id` が入ったことを確認する

### 21.4 毎日17時通知トリガー設定

Apps Script エディタから一度だけ以下を実行する。

```text
installDailyAnnouncementTrigger()
```

トリガーを作り直したいときは以下を使う。

```text
deleteDailyAnnouncementTrigger()
installDailyAnnouncementTrigger()
```

### 21.5 自動リマインドトリガー設定

Apps Script エディタから一度だけ以下を実行する。

```text
installTournamentReminderTrigger()
```

トリガーを作り直したいときは以下を使う。

```text
deleteTournamentReminderTrigger()
installTournamentReminderTrigger()
```

### 21.6 管理画面の設定タブ

管理画面の設定は以下のタブに分ける。

- リンク・外部サービス: Drive、年間大会予定表、Web URL、参加ページ token、Calendar ID
- LINE bot設定: LINE groupId、定期通知時刻
- LINE配信文面: 更新通知、締切リマインド、担当者通知、申込完了通知、メンバー申請通知
- 管理者操作: 設定再読み込み、定期トリガー再作成

LINE bot設定で通知時刻を変更した場合、管理者操作から定期トリガーを再作成する。

LINE配信文面では、現在登録されている文面を textarea に表示し、未登録の場合は既定文面を表示する。
大会一覧やURLなど、送信時に動的に決まる部分は以下の差し込み項目を残して編集する。

```text
{{TOURNAMENT_LINES}}
{{TOURNAMENT_BLOCKS}}
{{ENTRY_URL}}
{{DRIVE_FOLDER_URL}}
{{ADMIN_PAGE_URL}}
{{MEMBER_NAME}}
{{MEMBER_BLOCKS}}
```

文面更新後すぐに大会情報更新通知を送る場合は、管理画面の `保存して更新通知を送信` を使う。

### 21.7 GitHub Pages 側の更新

管理画面や参加者画面の見た目を変更した場合、`index.html` の CSS / JS のクエリバージョンを上げてキャッシュを避ける。

例:

```text
style.css?v=20260519-4
script.js?v=20260519-8
```

---

## 22. 実装済みの運用ポイント

### 22.1 大会通知の考え方

- 大会を保存しても、その場では自動通知しない
- 毎日 17 時台に、その日までに追加された未通知大会だけをまとめて 1 通送る
- すでに通知済みの大会は、`NotificationLogs` を見て再送しない
- 急ぎの大会だけ、管理画面から手動送信する

### 22.2 管理画面の現在仕様

- 申込担当者は `Managers` シートからプルダウン選択する
- 開催級は `A/B/C/D/E/F/初心者` の複数選択チップUIで入力する
- メンバー級は `A/B/C/D/E/F/初心者` の単一選択チップUIで入力する
- 主催締切とサークル内締切は、日付欄と時刻欄を分けて入力する
- 締切時刻の初期値は `23:59` とする
- 大会管理タブの順番は `新規入力` → `申込み状況` → `登録済み一覧` である
- `申込み状況` には終了していない大会だけを表示する
- `申込み状況` の各大会カードには、`未申込み / 申込み済み` のスイッチ型トグルを表示する
- トグルを切り替えると `update_tournament_status` API を呼び、`active / applied` を更新する
- `登録済み一覧` はタグ絞り込み付きのカードUIで表示し、各カードから直接編集できる
- 保存中は中央ポップアップで `保存中です...` を表示する
- 保存中は他の操作を受け付けない

### 22.2.1 参加者向け画面の現在仕様

- ページタイトル下に `大会一覧` と `年間大会予定表` の導線を置く
- `大会一覧` は、メンバー向けの申込み状況専用ビューとして表示する
- `年間大会予定表` は Google Drive 上の PDF 単体を埋め込み表示する
- `名前がない場合は追加申請` は、同一ページ内の専用ビューへ切り替えて表示する
- メンバー追加申請フォームでは `苗字/ふりがな/名前/ふりがな/段位/級` を入力させる

### 22.3 担当者通知の現在仕様

- サークル内締切翌日通知では、`Responses` の `yes` 回答者だけを抽出する
- 参加希望者がいない場合も、担当者には「申込対応不要」の通知を送る
- 大会に `manager_line_user_id` が無い場合、`Managers` シートから `manager_name` または `display_name` で補完する
- メンバー追加申請が届いた直後、`Managers` シートの `active` かつ有効な `line_user_id` を持つ担当者へ即時 LINE 通知する
- 毎朝 7:00 に、`Members` シートで `status = pending` の申請が 1 件以上残っている場合のみ、未処理申請をまとめて担当者へ LINE 通知する
- 毎日 23:00 に、当日 `applied` へ切り替わった大会があれば、LINE グループへ申込み完了通知を送る
- 即時通知の送信先は個人 userId のみとし、`U` 形式でない値は無効としてスキップする
- 通知可否やスキップ理由は `NotificationLogs` に残す

#### メンバー追加申請の即時通知例

```text
【メンバー追加申請】
新しいメンバー追加申請が届きました。

氏名: 高田修矢
ふりがな: たかだ しゅうや
段位: 無段
級: E級

【管理画面】
https://example.github.io/karuta-entry/board-c7k2m9q4/?admin_token=...

内容を確認し、承認または却下を行ってください。
```

#### メンバー追加申請の朝 7:00 集約通知例

```text
【未処理のメンバー追加申請】
未処理のメンバー追加申請があります。
内容を確認し、承認または却下を行ってください。

高田修矢
ふりがな: たかだ しゅうや
段位: 無段
級: E級

佐藤花子
ふりがな: さとう はなこ
段位: 初段
級: C級

【管理画面】
https://example.github.io/karuta-entry/board-c7k2m9q4/?admin_token=...
```

### 22.4 メンバー申請処理の現在仕様

- 管理画面の `メンバー` タブ上部に `申請中メンバー` を表示する
- 申請中カードから `内容を確認 / 承認 / 却下` を行える
- `却下` は即時反映せず、確認ポップアップで再確認してから確定する

### 22.5 Google Calendar の現在仕様

- 保存時にカレンダー同期も走る
- `draft` と `deleted` はカレンダー予定を削除対象とする
- `canceled` は `[中止]` をタイトルにつけて残す

---

## 23. 引き継ぎチェックリスト

### 23.1 新任担当者が確認すること

- Google Sheets の場所
- Apps Script プロジェクトの場所
- GitHub Pages の配置場所
- LINE Developers のチャネル情報
- Google Calendar の同期先
- `Script Properties` の設定値
- 毎日 17 時通知トリガーが生きているか

### 23.2 まず動作確認する関数

初回引き継ぎ時は、以下を順に試すと切り分けしやすい。

- `testUpsertTournament()`
- `testSendAnnouncement()`
- `testSendScheduledDailyAnnouncements()`
- `testSendGroupReminder2DaysBefore()`
- `testSendManagerReminderAfterInternalDeadline()`
- `testSendManagerReminderTrueDeadlineMorning()`
- `testSendScheduledAppliedNotifications()`
- `testSendPendingMemberRegistrationSummary()`
- `syncAllTournamentCalendars()`

### 23.3 トラブル時の見方

- 通知が送られない場合:
  - `NotificationLogs` に既存ログがないか確認する
  - `LINE_GROUP_ID` や `LINE_CHANNEL_ACCESS_TOKEN` を確認する
  - 対象大会が `active` か確認する
- 担当者通知が送られない場合:
  - `Managers` シートの `line_user_id` を確認する
  - 大会の `manager_name` が一致しているか確認する
- トリガーが作れない場合:
  - `appsscript.json` に `https://www.googleapis.com/auth/script.scriptapp` があるか確認する
- カレンダー同期しない場合:
  - `CALENDAR_ID` とカレンダー共有権限を確認する

---

## 24. 今後の実装TODO

以下は、次段階で仕様に反映しながら実装を進める項目である。

### 24.1 メンバー登録画面の入力仕様見直し

- 現在の必須項目を前提に、将来的に会員番号など追加項目が必要かを再検討する

### 24.6 表示ルールの再整理

- 現在は `申込み受付中 / 申込み済み / 終了` の 3 タグで表示している
- 今後は、表示対象、既定の並び順、アーカイブ扱い、公開側との整合をさらに整理する

### 24.6.1 メンバー一覧UIの見直し

- 管理画面の `メンバー一覧` は、現在の左側リスト形式ではなく、大会一覧と近いカードUIへ揃える
- 各メンバーカードの右側に `編集する` ボタンを配置し、同一画面内の編集フォームへ読み込めるようにする
- 一覧と編集導線の見た目を大会管理UIと統一し、管理対象が増えても探しやすい構成にする

### 24.6.2 参加画面の未回答/回答済みの扱い見直し

- 参加意思確認ページでは、`参加 / 未定 / 不参加` を選択した直後に `回答済み` タブへ即時移動しない
- 送信ボタンを押して保存が成功するまでは、対象大会を `未回答` タブ側に残す
- 保存成功後にのみ、最新の回答状態をもとに `未回答 / 回答済み` の表示を再判定する

### 24.6.3 参加送信前の確認ポップアップ

- 参加意思確認ページで `送信` を押した際、保存前の確認ポップアップを表示する
- ポップアップ内には、今回送信対象の大会と回答内容をコンパクトに列挙する
- 表示形式は少なくとも以下を想定する
- `〇〇大会 参加`
- `××交流大会 不参加`
- `▲□大会 参加`
- 確認後に送信を確定できるようにし、誤送信を減らす

### 24.6.4 送信後の一覧即時反映

- 参加意思確認ページで回答送信が成功したら、大会一覧表示を再読み込みする
- 同一ページ内で `大会一覧` ビューや `未回答 / 回答済み` の表示へ、最新の回答内容をすぐ反映させる
- 手動リロードなしで反映されることを前提に、送信完了後の画面遷移や再描画の流れを整理する

### 24.7 Drive 全体URLの扱い

- 個別要項 PDF の URL とは別に、Google Drive 全体への導線の置き場所を決める
- 管理画面、参加意思確認ページ、LINE 通知のどこで見せるか整理する

### 24.8 年間大会予定表の追加

- 現在は Google Drive 上の PDF 単体を参加意思確認ページへ埋め込み表示している
- 将来的には、差し替え方法や年度更新手順も含めて運用設計を明文化する

### 24.9 年度切り替えの設計

- 年度ごとの大会管理をどう切り替えるか決める
- `page_token` や別URL、シート分割、表示フィルタのどれで管理するか比較検討する

### 24.10 新システム案内文書

- 新システムの使い方をメンバー向けに案内する文書を用意する
- 管理者向けの運用説明とは分けて、参加者が迷わず回答できる内容にする

### 24.11 Word案内のPDF化保存

- Word 形式の案内文書を PDF に変換して保存する機能を実装する
- 保存先フォルダ、変換トリガー、元ファイルとの対応付け方法を整理する

### 23.4 今後の改善候補

- 締切系リマインドも本番トリガー化し、設定関数を揃える
- 管理画面から通知履歴を見られるようにする
- 引き継ぎ者向けのシート雛形作成手順も別紙化する
