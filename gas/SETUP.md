# GAS Setup

## Current Script Properties

- `SHEET_ID`
- `ENTRY_BASE_URL`

## Current Endpoints

### GET

- `action=list_tournaments`
- `action=list_public_tournaments&page_token=...`
- `action=list_members`

### POST

- `action=upsert_tournament`
- `action=upsert_response`

## Manual Deployment Flow

1. Copy the latest contents of `Code.gs` into the Apps Script project
2. Save the script
3. Update the existing web app deployment
4. Test `list_tournaments`
5. Test `list_public_tournaments`
6. Test `upsert_response`

## Suggested Public Test URL

```text
https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec?action=list_public_tournaments&page_token=test-page-token
```
