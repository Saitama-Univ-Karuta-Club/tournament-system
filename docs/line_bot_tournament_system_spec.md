# サークル大会情報管理・参加意思確認・LINE通知Bot 仕様書

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
  ├─ Google Sheets読み書き
  ├─ LINE Messaging API送信
  ├─ Google Calendar同期
  └─ 定期実行リマインド処理

Google Sheets
  ├─ Tournaments
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
https://example.github.io/karuta-entry/admin/?admin_token=LONG_RANDOM_ADMIN_TOKEN
```

ただし、これは厳密な認証ではない。URLが漏洩した場合、第三者がアクセスできる可能性がある。

### 5.4 token管理

- `admin_token` と `page_token` は分ける
- `admin_token` はGitHubリポジトリに直書きしない
- `admin_token` はGoogle Apps ScriptのPropertiesService等で管理する
- `page_token` はGoogle Sheetsの `EntryPages` シートで管理する
- tokenは十分長いランダム文字列とする

---

## 6. データ設計

## 6.1 Tournamentsシート

大会情報を管理するシート。

| 列名 | 型 | 説明 |
|---|---|---|
| tournament_id | string | 大会ごとの一意ID |
| title | string | 大会名 |
| event_start_date | date | 大会開始日 |
| event_end_date | date | 大会終了日 |
| grades | string | 開催級。例: `B,C,D` |
| is_official | boolean | 公認大会かどうか |
| venue | string | 会場 |
| true_deadline | datetime | 真の申込締切 |
| internal_deadline | datetime | サークル内締切 |
| drive_url | string | Google Drive上の要項URL |
| entry_page_token | string | 対応する参加意思確認ページtoken |
| entry_url | string | 参加意思確認ページURL |
| manager_name | string | 申込担当者名 |
| manager_line_user_id | string | 申込担当者のLINE userId |
| status | string | `draft`, `active`, `applied`, `closed`, `canceled`, `deleted` |
| calendar_event_id_event | string | 大会日予定のGoogle Calendar event id |
| calendar_event_id_internal_deadline | string | サークル内締切予定のevent id |
| calendar_event_id_true_deadline | string | 真の締切予定のevent id |
| created_at | datetime | 作成日時 |
| updated_at | datetime | 更新日時 |
| deleted_at | datetime | 削除扱い日時 |

### 6.1.1 statusの意味

| status | 意味 |
|---|---|
| draft | 下書き。参加者ページ・通知対象にはしない |
| active | 公開中。参加者ページ・通知対象にする |
| applied | 申込完了済み。担当者リマインド対象外 |
| closed | 大会終了・運用終了 |
| canceled | 大会中止 |
| deleted | 削除扱い。物理削除はしない |

---

## 6.2 Responsesシート

参加回答を管理するシート。

| 列名 | 型 | 説明 |
|---|---|---|
| response_id | string | 回答ごとの一意ID |
| tournament_id | string | 対応する大会ID |
| member_name | string | 回答者名 |
| response | string | `yes`, `maybe`, `no` |
| comment | string | 任意コメント |
| created_at | datetime | 作成日時 |
| updated_at | datetime | 更新日時 |

### 6.2.1 responseの意味

| response | 表示 | 意味 |
|---|---|---|
| yes | ○ | 参加希望 |
| maybe | △ | 未定・条件付き |
| no | × | 不参加 |

### 6.2.2 回答更新ルール

同じ `tournament_id` と `member_name` の組み合わせが既に存在する場合、新規行を作成せず既存行を更新する。

```text
unique key = tournament_id + member_name
```

---

## 6.3 EntryPagesシート

参加意思確認ページのtokenを管理するシート。

| 列名 | 型 | 説明 |
|---|---|---|
| page_token | string | 参加意思確認ページtoken |
| title | string | ページタイトル |
| description | string | ページ説明文 |
| active_from | datetime | 有効開始日時 |
| active_until | datetime | 有効終了日時 |
| status | string | `active`, `inactive`, `archived` |
| created_at | datetime | 作成日時 |
| updated_at | datetime | 更新日時 |

---

## 6.4 Managersシート

申込担当者情報を管理するシート。

| 列名 | 型 | 説明 |
|---|---|---|
| manager_name | string | 申込担当者名 |
| line_user_id | string | LINE userId |
| display_name | string | LINE表示名または任意表示名 |
| status | string | `active`, `inactive` |
| created_at | datetime | 作成日時 |
| updated_at | datetime | 更新日時 |

---

## 6.5 NotificationLogsシート

通知済み判定に使うシート。

| 列名 | 型 | 説明 |
|---|---|---|
| log_id | string | 通知ログID |
| tournament_id | string | 対応する大会ID |
| notification_type | string | 通知種別 |
| sent_to_type | string | `group` または `manager` |
| sent_to_id | string | LINE groupId または userId |
| sent_at | datetime | 送信日時 |
| message | string | 送信本文 |

### 6.5.1 notification_type

| notification_type | 意味 |
|---|---|
| announcement | 大会情報更新通知 |
| internal_deadline_2days_before | サークル内締切2日前リマインド |
| internal_deadline_1day_before | サークル内締切前日リマインド |
| internal_deadline_next_day_manager | サークル内締切翌日の担当者通知 |
| true_deadline_morning_manager | 真の締切日朝の担当者最終通知 |
| application_completed | 申込完了通知 |

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

## 8.1 管理画面 `/admin/`

### 8.1.1 目的

申込担当者が大会情報を登録・編集するための画面。

### 8.1.2 アクセスURL

```text
https://example.github.io/karuta-entry/admin/?admin_token=LONG_RANDOM_ADMIN_TOKEN
```

### 8.1.3 機能

- 登録済み大会一覧の表示
- 新規大会作成
- 既存大会編集
- 大会情報保存
- 大会ステータス変更
- LINE更新通知送信
- カレンダー同期実行

### 8.1.4 入力項目

| 項目 | UI | 必須 | 備考 |
|---|---|---|---|
| 大会ID | text / readonly | 編集時必須 | 新規作成時は自動生成 |
| 大会名 | text | 必須 | 例: 東会大会D級 |
| 大会開始日 | date | 必須 | ISO date形式で保存 |
| 大会終了日 | date | 必須 | 1日大会なら開始日と同じ |
| 開催級 | checkbox | 任意 | A/B/C/D/E |
| 公認区分 | select | 任意 | 公認/非公認 |
| 会場 | text | 任意 | 未定可 |
| 真の申込締切 | datetime-local | 必須 | JSTとして扱う |
| サークル内締切 | datetime-local | 必須 | JSTとして扱う |
| Google Drive URL | url | 任意 | 要項PDFの保存先 |
| 申込担当者 | select / text | 必須 | Managersから選択できるのが望ましい |
| ステータス | select | 必須 | draft/active/applied/closed/canceled |
| 備考 | textarea | 任意 | 参加資格等の補足 |

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
- LINE通知は保存時に自動送信しない
- LINE通知は「LINEグループへ更新通知を送る」ボタン押下時のみ送信する

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
- 名前入力欄
- 公開中大会一覧
- 大会ごとの日程、開催級、サークル内締切、要項URL
- 大会ごとの `○ / △ / ×` 選択欄
- 大会ごとのコメント欄
- 送信ボタン

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

### 8.2.5 回答保存ルール

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

## 9.5 LINE更新通知送信 API

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

## 10. LINE通知仕様

## 10.1 大会情報更新通知

管理画面の「LINEグループへ更新通知を送る」ボタンから送信する。

### 文面例

```text
【大会情報更新】
大会情報を更新しました。
案内は下記Google Driveから閲覧可能です。

【更新内容】
6月27日 東会大会D級（公認）
7月4, 5日 東会大会BC級（公認）

【Google Drive】
https://drive.google.com/drive/dummy

【大会申し込み方法】
参加希望者は、下記URLから出たい大会の日程に○をつけてください。
各日程にサークル内締切を併記しています。
締切までの回答にご協力お願いします。

https://example.github.io/karuta-entry/entry/?page_token=...

※D, E級大会について
関東圏以外の大会は、地域制限がない大会のみ案内しています。
```

---

## 10.2 サークル内締切前リマインド

### 送信タイミング

- サークル内締切2日前の9:00
- サークル内締切前日の9:00

どちらか一方でもよい。初期設定では2日前と前日の両方を想定する。

### 送信先

サークルLINEグループ。

### 対象大会

以下をすべて満たす大会。

- `status = active`
- サークル内締切が該当タイミングに一致
- 対応する通知ログがまだ存在しない

### 文面例

```text
【大会申込リマインド】
以下の大会のサークル内締切が近づいています。

大会名: 東会大会D級
大会日: 6月27日
開催級: D級
サークル内締切: 6月20日 23:59

参加希望者は、締切までに参加意思確認ページへ回答してください。
https://example.github.io/karuta-entry/entry/?page_token=...
```

複数大会をまとめて送信してもよい。

---

## 10.3 サークル内締切翌日の担当者通知

### 送信タイミング

サークル内締切翌日の9:00。

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

大会名: 東会大会D級
大会日: 6月27日
開催級: D級
真の申込締切: 6月23日 23:59
要項: https://drive.google.com/drive/dummy
参加確認ページ: https://example.github.io/karuta-entry/entry/?page_token=...

【申込希望者】
- 山田
- 佐藤
- 鈴木

必要に応じて、級・段位・会員番号等を別途確認してから申込してください。
```

---

## 10.4 真の締切日朝の最終リマインド

### 送信タイミング

真の申込締切日の9:00。

### 送信先

申込担当者の個人LINE。

### 対象大会

以下をすべて満たす大会。

- `status = active`
- 真の申込締切日が当日
- 申込完了済みではない
- 真の締切日朝リマインドが未送信

### 文面例

```text
【最終リマインド】
本日が真の申込締切です。

大会名: 東会大会D級
真の申込締切: 本日 23:59

【申込希望者】
- 山田
- 佐藤
- 鈴木

申込完了後は、申込完了処理を行ってください。
```

---

## 10.5 申込完了通知

申込担当者が管理画面またはLINEコマンドで大会の `status` を `applied` にしたとき、LINEグループに送る。

### 文面例

```text
【大会申込完了】
以下の大会について申込を完了しました。

大会名: 東会大会D級
大会日: 6月27日

【申込者】
- 山田
- 佐藤
- 鈴木
```

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

MVPでは毎日9:00実行でよい。

### 12.1 処理概要

```text
1. Tournamentsからstatus = activeの大会を取得
2. 現在日時を取得
3. サークル内締切2日前・前日の大会を抽出
4. LINEグループへリマインド送信
5. サークル内締切翌日の大会を抽出
6. Responsesから申込希望者を抽出
7. 担当者個人LINEへ通知
8. 真の申込締切日当日の大会を抽出
9. 申込完了済みでなければ担当者へ最終通知
10. 各通知後、NotificationLogsに記録
```

### 12.2 二重送信防止

通知送信前に `NotificationLogs` を確認する。

以下の組み合わせが既に存在する場合、再送信しない。

```text
tournament_id + notification_type
```

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
6. 必要に応じてLINEグループへ更新通知を送る
7. Botまたは定期処理がGoogle Calendarへ予定を同期する
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

| 用語 | 意味 |
|---|---|
| 真の申込締切 | 大会主催者が定める正式な申込締切 |
| サークル内締切 | サークル内で参加希望を集めるための締切。真の締切より数日前に設定する |
| 申込担当者 | サークル内で大会申込作業を担当する人 |
| 参加意思確認ページ | メンバーが各大会への参加希望を回答するWebページ |
| tournament_id | 大会ごとの一意ID |
| page_token | 参加意思確認ページにアクセスするためのランダムtoken |
| admin_token | 管理画面および管理APIを利用するためのランダムtoken |
