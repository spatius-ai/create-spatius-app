# Record a terminal UI preview

Use this workflow when the user requests a CLI recording or when a preview
would help review changes to prompts, terminal styling, or animation. Run it
in the coding environment; no GitHub Actions job is involved.

## Generate the preview

1. Use macOS or Linux with Node.js 22+, the repository's pinned pnpm, and
   Python 3. Install project dependencies with `pnpm install --frozen-lockfile`
   if needed.
2. Check that `agg` and `ffmpeg` are available. Use
   [agg 1.9.0](https://github.com/asciinema/agg/releases/tag/v1.9.0). An
   environment-local installation is sufficient; `AGG=/absolute/path/to/agg`
   selects the renderer and FFmpeg must be on PATH. Do not install recording
   tools as application dependencies.
3. Run `pnpm terminal:record` from the repository root. This builds the current
   CLI, drives it in a real pseudo-terminal, and renders the recording.
4. Inspect the welcome, prompts, installation animation, and final state in
   `test-results/terminal/onboarding.mp4` or `onboarding.gif`. Check for
   clipping, broken glyphs, partial redraws, and readable prompt text.
5. Share the MP4 or GIF using the coding environment's local-media preview or
   an absolute file link. Include the scope of the recording in the handoff.
   Keep generated media under the ignored `test-results/` directory; do not
   commit it or upload it to an external service unless requested.

The same output directory also contains `onboarding.cast`, an asciicast v2
transcript with original terminal output and timings. If rendering tools are
unavailable, capture this replayable transcript with:

```sh
pnpm build
python3 scripts/record-terminal.py
```

For separate before/after previews, use distinct output directories:

```sh
pnpm build
python3 scripts/record-terminal.py --render --output test-results/terminal-after
```

Build and record each revision in its own checkout to avoid overwriting
uncommitted work. Clearly label which revision each preview represents.

## Fixture scope

The recorder uses the actual built CLI in an 80 × 30 terminal with scripted
answers, a temporary project, and an isolated environment. Package-manager
commands are offline stubs with short delays. It runs with `--no-setup`, so
the preview covers project creation and installation UI, not credential
onboarding, real dependency installation, or provider authentication.

The script waits for each prompt and fails if onboarding stalls or does not
complete. If prompt wording or order intentionally changes, update the
`steps` fixture in `scripts/record-terminal.py`. Do not change production
behavior just to make the recording pass. A failed capture can leave a
partial `.cast`; do not present it as a successful full recording.
