# Repository workflow

- `main` is the stable integration branch. Keep it deployable.
- Do not implement features directly on `main`. Start work from an up-to-date `main` in a `feature/<short-topic>` branch.
- Before merging a feature into `main`, run the relevant tests. Changes under `discord-worker/` must pass:
  - `npm test`
  - `npm run typecheck`
  - `git diff --check`
- Apply D1 migrations locally and test them before applying them to the remote database.
- Merge into `main` only after the required checks pass. Production deployments should use verified code from `main`.
