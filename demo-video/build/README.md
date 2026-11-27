# 「820」 demo video: assets and rebuild notes

## What is in this folder

| file | what it is |
|---|---|
| `820-demo-en.mp4` | the cut: **2:40.97** (160.97 s), 1920×1080, 30 fps, H.264 (~264 kb/s) + AAC 89 kb/s, **7.3 MB**, English narration, burned-in subtitles, no music |
| `820-demo-en.srt` | 39 subtitle cues, same words and timings as the burn |
| `820-thumb.png` | the 1280×720 custom thumbnail on YouTube |
| `build/README.md` | this file: what is real, how it was made, how to rebuild |
| `build/config.py` | the shot list: plate, narration, subtitle cues, accent colour, framing (zoom and focus) |
| `build/plates.py` | builds every 2560×1440 still from real inputs (see below) |
| `build/build.py` | `seg` / `assemble` / `check` stages (segment render, crossfade, audio mix, subtitle burn, ffprobe) |
| `build/capture_guide.py` | Playwright capture of `docs/demo` at devicePixelRatio 2: the hero, the opened finding, the register after a waiver, the guide bar and the clean run |
| `build/capture_hd.py`, `capture_states.py` | earlier Playwright captures of the local screen (still used for older plates) |
| `build/dump-copybook.mjs` | calls the real copybook compiler and prints field offsets, layouts included (used by the copybook plate) |
| `build/outputs/*.txt` | captured stdout of the commands shown in the video (`verify`, `vitest`, `git ls-files .kiro`), the hook log (`hook-fire.txt`) and a live MCP client run (`mcp-call.txt`). They are captures from the machine that rendered the video, so the occasional absolute path in them is what the terminal printed, not a setting of the repository; punctuation was normalised to ASCII (dashes, arrows, ellipses) so the public repository carries none of the typography this project avoids, with the words and numbers unchanged |
| `shots-static/` | the l4 capture sidecar (`static-l4.json`) the register plate quotes |
| `build/capture-guide-report.json` | what the page said at capture time (money sentence, guide line, buttons, bytes lit, waiver counts, chain) |
| `build/copybook-fields.json` | the compiler output the plate draws its byte ranges from |
| `screenshots/` | the raw captures the plates are cropped from |

## Running the build again

Every script derives its paths from `build/paths.py` (repository root, node/bin directory, local
library sysroot), so a clone needs no editing. Set `EDI820_ROOT`, `EDI820_NODE_BIN` or
`EDI820_SYSROOT` to point somewhere else.

## What the video shows, and where each frame comes from

| # | shot | source |
|---|---|---|
| 1 | the question and the screen (0:00) | `demo-video/screenshots/guide-hero@2x.png`: `docs/demo` in Chromium at 1920×1080, devicePixelRatio 2, scenario S3 |
| 2 | the money sentence and the guide bar | the same capture, framed tighter |
| 3 | the amount is shown, not described | `guide-finding@2x.png`: after the guide's `Open the total finding` tap; bytes 24 to 36 of payment record 10 lit in column three |
| 4 | a person waives the finding, the verdict stays FAIL | `guide-bar-waived@2x.png` and `guide-l4-waived@2x.png`, with badge, counts and chain read from `shots-static/static-l4.json` |
| 5 | the spec as a document | `.kiro/specs/edi820-importer/requirements.md` R8.1 to R8.4 and `tasks.md` T7.1, read at build time |
| 6 | steering as a document | `.kiro/steering/tech.md` rules 3 to 7, with the money rule lit; the five files and their inclusion mode parsed from their own front matter |
| 7 | the hooks | `grep -E "PostFileSave|PostTaskExec" out/hook-log.txt | tail -6` and the stop hook's verify run, captured in `build/outputs/hook-fire.txt` |
| 8 | the bank copybook, with byte ranges and its two layouts | `samples/copybooks/820-redefines.cpy`; ranges and layouts printed by `dump-copybook.mjs` |
| 9 | the BAI2 delta with its parts | `docs/images/demo-s6.png`: credits 1,205,550.00 minus debits 25.00 |
| 10 | `820 verify` | real stdout, `build/outputs/verify.txt` |
| 11 | `npx vitest run` | real stdout, `build/outputs/tests.txt` (334 tests, 25 files; the plate highlights the summary line it reads) |
| 12 | end card | drawn, with the repository and Pages URLs |

Terminal shots are rendered from captured stdout rather than screen-recorded, and the plate keeps
the file path in the chip so a viewer can match the text to a file. Nothing on screen is a mockup
and no number was typed in by hand: the money sentence, the guide line, the button labels, the
lit bytes, the waiver counts and the chain all come from the capture report, and the document
plates read the repository files at build time.

## How it was built

```bash
cd demo-video/build
LD_LIBRARY_PATH=$EDI820_SYSROOT/usr/lib/x86_64-linux-gnu python3 capture_guide.py   # 2x captures of docs/demo
python3 dump-copybook.mjs > copybook-fields.json   # byte ranges from the real compiler
python3 plates.py                 # the plates, 1920x1080 design, drawn at 2x and resampled to 2560x1440
python3 make_tts.py               # edge-tts en-US-AndrewNeural at +6%, one mp3 per shot (retries on an empty response)
python3 build.py seg              # one fixed-frame segment per shot
python3 build.py assemble         # xfade, narration on a sample-accurate timeline, subtitle burn
python3 build.py check            # duration, size, streams, cue count
```

(`LD_LIBRARY_PATH` is only needed in this build sandbox, where Chromium's ATK libraries were fetched
into a local sysroot with `fetch_libs.py`.)

Rebuild time is a few minutes; `build.py seg` stops itself before a 300 second tool timeout and
resumes on the next call. A shot whose narration changed must have its `tts/<id>.mp3` deleted first,
because `make_tts.py` keeps existing audio; a shot whose plate changed must have its `segs/<id>.mp4`
deleted, because `build.py seg` keeps existing segments.

## Verified

- duration 160.97 s (2:40.97), under the 180 s rule
- 1920×1080, 30 fps, yuv420p, H.264 + AAC, `+faststart`
- 7.3 MB, under YouTube's 25 MB upload limit
- 39 subtitle cues; every cue is inside its shot's narration window (built from the same timeline)
- no em dash, en dash, minus sign, middle dot, arrow, emoji or stock phrase in the narration or the cues (checked against `config.py` and the rendered `.srt`)
- nothing moves inside a shot: the plate is cropped to the shot's framing and scaled once
- 0 page errors across the browser capture
- the numbers on screen match the files and the captured stdout: 1,284,550.00 declared, 1,284,450.00 summed, -100.00 delta, 4 findings, bytes 24 to 36 of payment record 10, 33 requirements, 334 tests in 25 files, 31 properties, fingerprint `7af64454...` on the FAIL case and `c459b81b...` on the verify shot
- published on YouTube on 2026-11-27 (https://youtu.be/65xfo3u-DaU) with the custom thumbnail and the English SRT track; the 2026-11-22 cut is unlisted

## Not verified

- Watching it end to end with a human ear. The narration is synthesised and the timing is generated
  from measured mp3 durations, not from listening.
