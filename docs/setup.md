# Setup Notes

This file tracks the initial setup needed to start development.

## GitHub

- Organization: `Saitama-Univ-Karuta-Club`
- Repository: `tournament-system`
- Suggested initial visibility: `private`

## Planned Components

### Google Apps Script

- tournament read/write API
- response upsert API
- LINE notification logic
- scheduled reminder jobs
- Google Calendar sync

## Script Properties

- `SHEET_ID`: 運用用 Google Sheets の ID
- `CALENDAR_ID`: 大会予定を書き込む Google Calendar の ID
- `LINE_CHANNEL_ACCESS_TOKEN`: LINE Messaging API のチャネルアクセストークン
- `LINE_GROUP_ID`: 通知先 LINE グループの groupId
- `LINE_ADMIN_TOKEN`: 管理画面から LINE 更新通知を送るときの任意トークン

### Google Sheets

- `Tournaments`
- `Responses`
- `EntryPages`
- `Managers`
- `NotificationLogs`

### Web

- public entry page for attendance responses
- lightweight shared assets for future UI work

## Development Flow

1. Keep the specification updated in `docs/`
2. Add implementation notes before large structural changes
3. Build the backend contract before the UI depends on it
