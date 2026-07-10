# Manual Sources

This directory is the single source of truth for handover manuals.

Editable source:

- `basic-operation-manual.md`
- `developer-manual.md`

Generated artifacts:

- `basic-operation-manual.tex`
- `developer-manual.tex`
- `basic-operation-manual.pdf`
- `developer-manual.pdf`

Build command:

```sh
python3 docs/manuals/build_manuals.py
```

Temporary LaTeX build files under `.build/` are removed automatically at the start and end of every build, including failed builds.

The PDFs are copied into `web/manuals/` during the GitHub Pages workflow, so the repository does not keep a second PDF copy under `web/`.
