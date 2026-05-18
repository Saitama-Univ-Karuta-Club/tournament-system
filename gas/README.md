# GAS Directory

This directory contains the working Google Apps Script baseline for the project.

## Current Files

- `Code.gs`
  Current single-file implementation for tournament listing and upsert
- `SETUP.md`
  Script properties and deployment notes

## Implemented So Far

- `GET action=list_tournaments`
- `GET action=list_public_tournaments&page_token=...`
- `POST action=upsert_tournament`
- `POST action=upsert_response`

## Next Planned Work

- notification log helpers
- manager lookup helpers
- LINE and Calendar integration
