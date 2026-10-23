# Repository workflow

- `master` is the stable integration branch. Keep it deployable.
- Do not implement features directly on `master`. Start work from an up-to-date `master` in a `feature/<short-topic>` branch.
- Before merging a feature into `master`, run the relevant tests. Changes under `discord-worker/` must pass:
  - `npm test`
  - `npm run typecheck`
  - `git diff --check`
- Apply D1 migrations locally and test them before applying them to the remote database.
- Merge into `master` only after the required checks pass. Production deployments should use verified code from `master`.
