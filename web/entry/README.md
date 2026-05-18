# Entry Page

This directory contains the first member-facing attendance confirmation page.

## Files

- `index.html`
- `style.css`
- `script.js`

## Current Behavior

- reads `page_token` from the URL
- fetches `list_public_tournaments`
- renders a member dropdown from `Members`
- shows only tournaments matching the selected member grade
- submits selected responses to `upsert_response`

## Current Note

`script.js` currently points to the active Apps Script web app URL directly for development.
