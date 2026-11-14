# Quanta Pulse pitch

A ten-slide, 16:9 introduction for BITS Pilani students. Designed for roughly four minutes, with six screenshot-led slides and restrained black/violet typography. Screenshots contain demo course data.

## Files

- `quanta-pulse-pitch.tex` — editable, self-contained source with relative `assets/` paths.
- `quanta-pulse-pitch.pdf` — compiled and visually checked ten-slide presentation.
- `assets/` — screenshot agent's unmodified captures. This deck uses `today.png`, `library.png`, `details.png`, `palette.png`, `calendar.png`, and `course.png`.
- `build/` — compilation logs, auxiliary files, and layout review renders.
- `presentation-notes.md` — brief presenter cues and claim boundaries.

## Build

Use a standard TeX Live installation with pdfLaTeX, latexmk, and the `geometry`, `fontenc`, `helvet` (PSNFSS + Helvetica fonts), `graphicx`, `xcolor`, `pgf`/TikZ, and `hyperref` packages. No shell escape is needed or permitted. All TeX compilation must go through the invoked skill's `compile.py`.

The temporary compiler provisioned for this task is `/tmp/quanta-pitch-tex/.TinyTeX/bin/x86_64-linux`. It is an official TinyTeX distribution, installed only under `/tmp`. It is not included in the source package and may disappear after reboot.

From this directory, with that TeX installation or an equivalent standard installation on PATH:

```bash
export PATH="/tmp/quanta-pitch-tex/.TinyTeX/bin/x86_64-linux:$PATH"
uv run python -B /home/akshay-vk/.agents/skills/latex-paper-en/scripts/compile.py quanta-pulse-pitch.tex --compiler pdflatex --outdir build
cp build/quanta-pulse-pitch.pdf quanta-pulse-pitch.pdf
```

All six screenshot files are required. The final source contains no missing-image placeholders. The PDF has ten 320 × 180 mm pages. All pages were rendered and inspected; text bounds remain within the page and the six screenshot-led slides contain their intended images.

## Release and content boundaries

The download button and visible link point to the official project release: <https://github.com/Akshay-VK/quanta-pulse/releases/tag/v0.3.0>. Its public assets were checked through GitHub's release API during preparation: the Windows x64 setup executable and its signature are present. The deck describes the published Windows installer only.

Calendar means recorded activity by date; it is not a deadline agenda. Preview is limited to supported formats. Local copies do not imply the live LMS works offline. The deck makes no auto-login, session-expiry, unreleased-fix, full-text search, fabricated statistic, testimonial, or institutional endorsement claims. The quiet first scan establishes a baseline for existing resources. App authentication source and repository state are outside this deliverable's scope.

## Verification status

See `/tmp/quanta-pitch-build-state.json` for exact compiler setup, build command, output, and visual review status from this session. A final PDF is only accepted after rendering and inspecting it.

### Final build

The initial reserved macro-name error was corrected (`\finishSlide` replaces `\endSlide`). The default latexmk path above then compiled successfully with shell escape disabled. The final PDF and source are ready to present. Screenshot data is illustrative and is identified as demo course data on every screenshot-led slide.

### Verification detail

The figure-check script exits 0 but cannot expand the parameterized screenshot macro and reports `assets/#1.png`. This is a checker limitation: all six actual paths exist, compilation resolves them, and PDF inspection confirms an image on each intended screenshot slide. All ten pages have in-page text bounds, no draft placeholders, and the final download link resolves to the release URL. See `build/verification.json`.
