# Design Decisions

## 2026-05-18

### Monorepo first

The project starts as a single repository so specification, frontend, and Google Apps Script code can evolve together.

### Admin side should not rely on a simple public token-only page

The attendance entry page can tolerate lighter access control, but administrative operations should be handled on the Google side or behind stronger controls.

### Repository structure

- `docs/` for requirements and operational notes
- `gas/` for backend and admin logic
- `web/` for public-facing pages
