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
