#!/usr/bin/env python3
"""Build handover manual PDFs with LuaLaTeX.

The Markdown files in this directory are the editable source. This script
generates matching .tex files and compiles them into PDFs.
"""

from __future__ import annotations

import html
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
LEGACY_BUILD_ROOT = ROOT / ".build"
BUILD_ROOT = Path(os.environ.get("MANUAL_BUILD_ROOT", "/private/tmp/tournament-system-manual-build"))
MANUALS = [
    {
        "source": ROOT / "basic-operation-manual.md",
        "tex": ROOT / "basic-operation-manual.tex",
        "pdf": ROOT / "basic-operation-manual.pdf",
        "title": "大会申込みシステム 基本操作マニュアル",
        "title_lines": ["大会申込みシステム", "基本操作マニュアル"],
        "subtitle": "日常運用担当者向け",
    },
    {
        "source": ROOT / "developer-manual.md",
        "tex": ROOT / "developer-manual.tex",
        "pdf": ROOT / "developer-manual.pdf",
        "title": "大会申込みシステム 技術マニュアル",
        "title_lines": ["大会申込みシステム", "技術マニュアル"],
        "subtitle": "機能改修・保守担当者向け",
    },
]


LATEX_SPECIALS = {
    "\\": r"\textbackslash{}",
    "&": r"\&",
    "%": r"\%",
    "$": r"\$",
    "#": r"\#",
    "_": r"\_",
    "{": r"\{",
    "}": r"\}",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
}


def latex_escape(text: str) -> str:
    return "".join(LATEX_SPECIALS.get(char, char) for char in text)


def inline_markup(text: str) -> str:
    escaped = latex_escape(text)
    escaped = re.sub(
        r"`([^`]+)`",
        lambda match: r"\code{" + latex_escape(match.group(1)) + "}",
        escaped,
    )
    escaped = re.sub(
        r"\*\*([^*]+)\*\*",
        lambda match: r"\textbf{" + latex_escape(match.group(1)) + "}",
        escaped,
    )
    return escaped


def title_block(title: str, title_lines: list[str] | None = None) -> str:
    lines = title_lines if title_lines else [title]
    return r"\\[2mm] ".join(latex_escape(line) for line in lines)


def parse_table(lines: list[str], start: int) -> tuple[list[list[str]], int]:
    rows: list[list[str]] = []
    index = start

    while index < len(lines) and lines[index].strip().startswith("|"):
        cells = [cell.strip() for cell in lines[index].strip().strip("|").split("|")]
        if not all(re.fullmatch(r":?-{3,}:?", cell or "") for cell in cells):
            rows.append(cells)
        index += 1

    return rows, index


def render_table(rows: list[list[str]]) -> list[str]:
    if not rows:
        return []

    max_cols = max(len(row) for row in rows)
    rows = [row + [""] * (max_cols - len(row)) for row in rows]
    if max_cols == 3 and rows[0] == ["番号", "やること", "詳細な方法"]:
        column_spec = (
            r">{\raggedright\arraybackslash}p{0.08\linewidth}"
            r">{\raggedright\arraybackslash}p{0.24\linewidth}"
            r">{\raggedright\arraybackslash}X"
        )
    else:
        column_spec = ">{\\raggedright\\arraybackslash}X" * max_cols
    rendered = [
        r"\rowcolors{2}{white}{soft}",
        r"\renewcommand{\arraystretch}{1.25}",
        r"\begin{tabularx}{\linewidth}{" + column_spec + "}",
        r"\toprule",
        r"\rowcolor{tablehead}",
    ]

    for row_index, row in enumerate(rows):
        cells = [inline_markup(cell) for cell in row]
        suffix = r" \\"
        if row_index == 0:
            cells = [r"\textbf{" + cell + "}" for cell in cells]
            suffix = r" \\ \midrule"
        rendered.append(" & ".join(cells) + suffix)

    rendered.append(r"\bottomrule")
    rendered.append(r"\end{tabularx}")
    return rendered


def flush_paragraph(buffer: list[str], output: list[str]) -> None:
    if not buffer:
        return
    output.append(inline_markup(" ".join(buffer)))
    output.append("")
    buffer.clear()


def close_lists(list_stack: list[str], output: list[str], target_level: int = 0) -> None:
    while len(list_stack) > target_level:
        output.append(r"\end{" + list_stack.pop() + "}")


def markdown_to_latex(markdown: str) -> str:
    lines = markdown.splitlines()
    output: list[str] = []
    paragraph: list[str] = []
    list_stack: list[str] = []
    in_code = False
    code_buffer: list[str] = []
    first_heading = True
    index = 0

    while index < len(lines):
        raw_line = lines[index]
        line = raw_line.rstrip()
        stripped = line.strip()

        if stripped.startswith("```"):
            flush_paragraph(paragraph, output)
            close_lists(list_stack, output)
            if not in_code:
                in_code = True
                code_buffer = []
            else:
                output.append(r"\begin{manualcode}")
                output.extend(code_buffer)
                output.append(r"\end{manualcode}")
                in_code = False
            index += 1
            continue

        if in_code:
            code_buffer.append(line)
            index += 1
            continue

        if not stripped:
            flush_paragraph(paragraph, output)
            close_lists(list_stack, output)
            index += 1
            continue

        if stripped == "<!-- pagebreak -->":
            flush_paragraph(paragraph, output)
            close_lists(list_stack, output)
            output.append(r"\newpage")
            output.append("")
            index += 1
            continue

        if stripped.startswith("|") and index + 1 < len(lines) and lines[index + 1].strip().startswith("|"):
            flush_paragraph(paragraph, output)
            close_lists(list_stack, output)
            rows, next_index = parse_table(lines, index)
            output.extend(render_table(rows))
            output.append("")
            index = next_index
            continue

        heading = re.match(r"^(#{1,4})\s+(.+)$", stripped)
        if heading:
            flush_paragraph(paragraph, output)
            close_lists(list_stack, output)
            level = len(heading.group(1))
            title = inline_markup(heading.group(2).strip())
            if level == 1:
                if first_heading:
                    first_heading = False
                else:
                    output.append(r"\section*{" + title + "}")
            elif level == 2:
                output.append(r"\section{" + title + "}")
            elif level == 3:
                output.append(r"\subsection{" + title + "}")
            else:
                output.append(r"\subsubsection{" + title + "}")
            output.append("")
            index += 1
            continue

        unordered = re.match(r"^[-*]\s+(.+)$", stripped)
        if unordered:
            flush_paragraph(paragraph, output)
            if not list_stack or list_stack[-1] != "itemize":
                close_lists(list_stack, output)
                output.append(r"\begin{itemize}")
                list_stack.append("itemize")
            output.append(r"\item " + inline_markup(unordered.group(1)))
            index += 1
            continue

        ordered = re.match(r"^\d+\.\s+(.+)$", stripped)
        if ordered:
            flush_paragraph(paragraph, output)
            if not list_stack or list_stack[-1] != "enumerate":
                close_lists(list_stack, output)
                output.append(r"\begin{enumerate}")
                list_stack.append("enumerate")
            output.append(r"\item " + inline_markup(ordered.group(1)))
            index += 1
            continue

        paragraph.append(stripped)
        index += 1

    flush_paragraph(paragraph, output)
    close_lists(list_stack, output)
    return "\n".join(output)


def tex_template(
    title: str,
    subtitle: str,
    body: str,
    title_lines: list[str] | None = None,
) -> str:
    display_title = title_block(title, title_lines)
    return rf"""\documentclass[a4paper,11pt]{{ltjsarticle}}
\usepackage[top=22mm,bottom=24mm,left=22mm,right=22mm]{{geometry}}
\usepackage{{luatexja-fontspec}}
\usepackage{{fontspec}}
\usepackage[table]{{xcolor}}
\usepackage{{tabularx}}
\usepackage{{booktabs}}
\usepackage{{array}}
\usepackage{{enumitem}}
\usepackage{{fancyhdr}}
\usepackage{{hyperref}}
\usepackage{{fvextra}}
\usepackage{{titlesec}}
\usepackage{{tcolorbox}}

\setmainjfont{{Hiragino Sans}}
\setsansjfont{{Hiragino Sans}}
\setmainfont{{Helvetica Neue}}
\setsansfont{{Helvetica Neue}}
\setmonofont{{Menlo}}[Scale=0.88]

\definecolor{{ink}}{{HTML}}{{172033}}
\definecolor{{muted}}{{HTML}}{{61708A}}
\definecolor{{accent}}{{HTML}}{{1F5FBF}}
\definecolor{{accentlight}}{{HTML}}{{E8F0FF}}
\definecolor{{tablehead}}{{HTML}}{{EAF1FA}}
\definecolor{{tableline}}{{HTML}}{{C9D4E3}}
\definecolor{{soft}}{{HTML}}{{F6F8FB}}

\hypersetup{{
  colorlinks=true,
  linkcolor=accent,
  urlcolor=accent,
  pdftitle={{{latex_escape(title)}}},
  pdfauthor={{Saitama University Karuta Club}}
}}

\pagestyle{{fancy}}
\setlength{{\headheight}}{{28pt}}
\fancyhf{{}}
\lhead{{\small\textcolor{{muted}}{{埼玉大学かるた会 大会申込みシステム}}}}
\rhead{{\small\textcolor{{muted}}{{{latex_escape(subtitle)}}}}}
\cfoot{{\small\textcolor{{muted}}{{\thepage}}}}
\renewcommand{{\headrulewidth}}{{0.3pt}}
\renewcommand{{\headrule}}{{\hbox to\headwidth{{\color{{tableline}}\leaders\hrule height \headrulewidth\hfill}}}}

\titleformat{{\section}}
  {{\Large\bfseries\color{{ink}}}}
  {{\thesection}}
  {{0.8em}}
  {{}}
  [{{\color{{accent}}\titlerule[0.8pt]}}]
\titleformat{{\subsection}}
  {{\large\bfseries\color{{ink}}}}
  {{\thesubsection}}
  {{0.6em}}
  {{}}
\titleformat{{\subsubsection}}
  {{\normalsize\bfseries\color{{ink}}}}
  {{\thesubsubsection}}
  {{0.6em}}
  {{}}
\titlespacing*{{\section}}{{0pt}}{{2.0\baselineskip}}{{0.8\baselineskip}}
\titlespacing*{{\subsection}}{{0pt}}{{1.3\baselineskip}}{{0.5\baselineskip}}
\titlespacing*{{\subsubsection}}{{0pt}}{{1.0\baselineskip}}{{0.3\baselineskip}}

\setlist[itemize]{{leftmargin=2.2em,itemsep=0.18em,topsep=0.35em}}
\setlist[enumerate]{{leftmargin=2.4em,itemsep=0.18em,topsep=0.35em}}
\renewcommand{{\labelitemi}}{{\textcolor{{accent}}{{\small\raisebox{{0.2ex}}{{\textbullet}}}}}}

\newcommand{{\code}}[1]{{\tcbox[
  on line,
  boxsep=0.3mm,
  left=0.7mm,
  right=0.7mm,
  top=0.2mm,
  bottom=0.2mm,
  arc=0.7mm,
  colback=soft,
  colframe=soft
]{{\ttfamily\small #1}}}}

\DefineVerbatimEnvironment{{manualcode}}{{Verbatim}}{{
  breaklines=true,
  breaksymbolleft={{}},
  fontsize=\small,
  frame=single,
  framerule=0.3pt,
  rulecolor=\color{{tableline}},
  commandchars=\\\{{\}},
}}

\AtBeginDocument{{\color{{ink}}}}
\setlength{{\parindent}}{{0pt}}
\setlength{{\parskip}}{{0.55\baselineskip}}

\begin{{document}}
\begin{{titlepage}}
\thispagestyle{{empty}}
\vspace*{{18mm}}
{{\Huge\bfseries\color{{ink}} {display_title}\par}}
\vspace{{5mm}}
{{\Large\color{{accent}} {latex_escape(subtitle)}\par}}
\vspace{{7mm}}
{{\large\color{{muted}} 埼玉大学かるた会\par}}
\vfill
\begin{{tcolorbox}}[
  colback=accentlight,
  colframe=accentlight,
  arc=2mm,
  boxrule=0pt,
  left=5mm,
  right=5mm,
  top=4mm,
  bottom=4mm,
]
このPDFは、\texttt{{docs/manuals}} にあるMarkdown原稿からLuaLaTeXで生成しています。秘密情報や本番URLそのものは含めない方針です。
\end{{tcolorbox}}
\vspace*{{12mm}}
{{\small\color{{muted}} Saitama University Karuta Club Tournament System\par}}
\end{{titlepage}}

\tableofcontents
\clearpage

{body}

\end{{document}}
"""


def build_manual(manual: dict[str, Path | str]) -> None:
    source = Path(manual["source"])
    tex = Path(manual["tex"])
    pdf = Path(manual["pdf"])
    build_dir = BUILD_ROOT / source.stem
    build_dir.mkdir(parents=True, exist_ok=True)

    body = markdown_to_latex(source.read_text(encoding="utf-8"))
    tex.write_text(
        tex_template(
            str(manual["title"]),
            str(manual["subtitle"]),
            body,
            manual.get("title_lines"),  # type: ignore[arg-type]
        ),
        encoding="utf-8",
    )

    env = os.environ.copy()
    env.setdefault("TEXMFVAR", "/private/tmp/texmf-var")
    env.setdefault("TEXMFCACHE", "/private/tmp/texmf-cache")

    for _ in range(2):
        subprocess.run(
            [
                "lualatex",
                "-interaction=nonstopmode",
                "-halt-on-error",
                f"-output-directory={build_dir}",
                str(tex),
            ],
            check=True,
            env=env,
        )

    built_pdf = build_dir / f"{tex.stem}.pdf"
    shutil.copy2(built_pdf, pdf)


def cleanup_build_root() -> None:
    for path in (BUILD_ROOT, LEGACY_BUILD_ROOT):
        if path.exists():
            shutil.rmtree(path)


def main() -> int:
    cleanup_build_root()

    try:
        for manual in MANUALS:
            build_manual(manual)

        print("Built manuals:")
        for manual in MANUALS:
            print(f"- {manual['pdf']}")
        return 0
    finally:
        cleanup_build_root()


if __name__ == "__main__":
    raise SystemExit(main())
