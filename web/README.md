# Web Directory

This directory contains the GitHub Pages facing web pages.

Operational rules:

- `entry/` for the attendance confirmation page
- `board-c7k2m9q4/` for lightweight tournament/member management
- `index.html` redirects the site root to `entry/`
- Do not publish actual production URLs in the repository or public documents
- Share production URLs only inside the club LINE group or directly with operators
- Both `entry/` and `board-c7k2m9q4/` include `noindex` metadata
- `robots.txt` is included to discourage indexing, but this is not access control
- Keep the admin URL separate from the member-facing URL
- If needed, use a less guessable admin path at publish time

The management UI is still public web content from an HTTP perspective, so secrecy relies on limited sharing and non-obvious URLs rather than strong authentication.

## GitHub Pages

This repository deploys `web/` as the GitHub Pages artifact via `.github/workflows/pages.yml`.

Expected published paths:

- `/entry/`
- `/board-c7k2m9q4/`
- `/manuals/`

`manuals/` exposes PDF copies of the operation and developer manuals.
