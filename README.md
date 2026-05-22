# Tournament System

Circle tournament management system for Saitama University Karuta Club.

This repository contains the initial implementation for a workflow that:

- stores tournament information in Google Sheets
- collects attendance intentions from members
- sends reminders through LINE
- tracks internal and true application deadlines

## Repository Layout

```text
docs/        Specifications, setup notes, and design decisions
gas/         Google Apps Script backend and admin-side logic
web/         Public-facing web pages, starting with the entry page
```

## Current Architecture

- `web/entry/`
  Public entry page
- `web/board-c7k2m9q4/`
  Lightweight admin console protected by `ADMIN_CONSOLE_TOKEN`
- `gas/`
  Backend API, scheduled jobs, and admin-side functionality
- `docs/`
  Source of truth for requirements and implementation notes

## Current Decisions

- Start with a single monorepo to keep specification, frontend, and GAS code in sync
- Publish `web/` through GitHub Pages
- Keep secrets in Apps Script Script Properties, not in Git-managed files
- Build the MVP in the order described in the specification

## GitHub Pages

The repository is prepared to deploy `web/` through GitHub Pages using GitHub Actions.

Published paths are expected to be:

- `/entry/`
- `/board-c7k2m9q4/`

## Documents

- Main specification: [docs/line_bot_tournament_system_spec.md](docs/line_bot_tournament_system_spec.md)
- Setup notes: [docs/setup.md](docs/setup.md)
- Design decisions: [docs/decisions.md](docs/decisions.md)

## Next Steps

1. Define the initial Google Sheets schema and operational setup
2. Implement the GAS tournament read/write API
3. Build the first admin-side input flow
4. Build the public entry page and response submission flow
