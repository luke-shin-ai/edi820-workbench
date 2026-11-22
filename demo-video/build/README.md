# 「820」 demo video: assets and rebuild notes

## What is in this folder

| file | what it is |
|---|---|
| `820-demo-en.mp4` | the cut: **2:55.30** (175.30 s), 1920×1080, 30 fps, H.264 (~273 kb/s) + AAC 90 kb/s, **8.2 MB**, English narration, burned-in subtitles, no music |
| `820-demo-en.srt` | 40 subtitle cues, same words and timings as the burn |
| `build/README.md` | this file: what is real, how it was made, how to rebuild |
| `build/config.py` | the shot list: plate, narration, subtitle cues, accent colour, framing (zoom and focus) |
| `build/plates.py` | builds every 1920×1080 still from real inputs (see below) |
| `build/build.py` | `seg` / `assemble` / `check` stages (segment render, crossfade, audio mix, subtitle burn, ffprobe) |
| `build/capture_hd.py`, `capture_states.py` | Playwright captures of the running screen at devicePixelRatio 2 |
| `build/dump-copybook.mjs` | calls the real copybook compiler and prints field offsets, layouts included (used by the copybook plate) |
| `build/outputs/*.txt` | captured stdout of the commands shown in the video (`verify`, `vitest`, `git ls-files .kiro`), the hook log (`hook-fire.txt`) and a live MCP client run (`mcp-call.txt`) |
| `shots-static/` | the l4 capture sidecar (`static-l4.json`) the register plate quotes |
| `build/copybook-fields.json` | the compiler output the plate draws its byte ranges from |
| `screenshots/` | the raw captures the plates are cropped from |

## What the video shows, and where each frame comes from

| # | shot | source |
|---|---|---|
| 1 | Kiro hook log + the stop hook's own run | `grep -E "PostFileSave|PostTaskExec" out/hook-log.txt | tail -6` and the stop hook's verify run, captured in `build/outputs/hook-fire.txt` |
| 2 | the reviewer agent's MCP calls | `node scripts/mcp-call.mjs`, captured in `build/outputs/mcp-call.txt`: verdict FAIL, 4 findings, fingerprint `7af64454…` |
| 3 | the bank copybook, with byte ranges and its two layouts | `samples/copybooks/820-redefines.cpy`; ranges and layouts printed by `dump-copybook.mjs` |
| 4 | the trailer read through its own `REDEFINES` layout | `docs/images/demo-s7-trailer.png`: `TOTAL-AMOUNT` at bytes 22-34, the detail fields absent from that record |
| 5 | PASS on the clickable screen | `docs/images/demo-s1.png` (static build, eight-scenario run) |
| 6 | four findings | `docs/images/demo-s3.png` |
| 7 | the bytes behind a finding | the same screen, camera on the evidence column |
| 8 | the BAI2 delta with its parts | `docs/images/demo-s6.png`: credits 1,205,550.00 minus debits 25.00 |
| 9 | the exception register after a waiver | `docs/images/demo-l4-waived.png`, with the verdict and counts quoted from `shots-static/static-l4.json` |
| 10 | `820 verify` | real stdout, `build/outputs/verify.txt` |
| 11 | `npx vitest run` | real stdout, `build/outputs/tests.txt` (311 tests; the plate highlights the summary line it reads) |
| 12 | what the session did | `docs/kiro-session-evidence.md` facts, drawn as text |
| 13 | end card | drawn |

Terminal shots are rendered from captured stdout rather than screen-recorded, and the plate keeps
the file path in the chip so a viewer can match the text to a file. Nothing on screen is a mockup
and no number was typed in by hand.

## How it was built

```bash
cd demo-video/build
python3 dump-copybook.mjs > copybook-fields.json   # byte ranges from the real compiler
python3 plates.py                 # 13 plates, 1920x1080 design, drawn at 2x and resampled to 2560x1440
python3 make_tts.py               # edge-tts en-US-AndrewNeural at +6%, one mp3 per shot (retries on an empty response)
python3 build.py seg              # one fixed-frame segment per shot
python3 build.py assemble         # xfade, narration on a sample-accurate timeline, subtitle burn
python3 build.py check            # duration, size, streams, cue count

# the static captures the plates are cropped from (writes docs/images/demo-*.png)
LD_LIBRARY_PATH=/workspace/.sysroot/usr/lib/x86_64-linux-gnu python3 ../scripts/check-static.py
```

Screenshots come from the real server, and the server has to run inside one tool call:

```bash
LD_LIBRARY_PATH=/workspace/.sysroot/usr/lib/x86_64-linux-gnu python3 capture_hd.py
```

(`LD_LIBRARY_PATH` is only needed in this build sandbox, where Chromium's ATK libraries were fetched
into a local sysroot with `fetch_libs.py`.)

Rebuild time is a few minutes; `build.py seg` stops itself before a 300 second tool timeout and
resumes on the next call. A shot whose narration changed must have its `tts/<id>.mp3` deleted first,
because `make_tts.py` keeps existing audio; a shot whose plate changed must have its
`segs/<id>.mp4` deleted, because `build.py seg` keeps existing segments.

## Verified

- duration 175.30 s (2:55.30), under the 180 s rule
- 1920×1080, 30 fps, yuv420p, H.264 + AAC, `+faststart`
- 8.2 MB, under YouTube's 25 MB upload limit
- 40 subtitle cues; every cue is inside its shot's narration window (built from the same timeline)
- no em dash, en dash, minus sign, emoji or stock phrase in the narration or the cues (checked against
  `config.py`)
- nothing moves inside a shot: the plate is cropped to the shot's framing and scaled once, so text
  cannot shimmer the way the earlier `zoompan` cut did (two frames an arbitrarily long way apart in
  the same segment are pixel-identical apart from encoder noise; `zoompan` stepped 1 px at a time)
- 0 page errors across every browser capture
- the numbers in the narration match the files and the captured stdout (1,284,550.00 declared,
  1,284,450.00 summed, -100.00 delta, 4 findings, 311 tests, fingerprints `7af64454…` for the FAIL
  case and the S6 delta -79,025.00 with credits 1,205,550.00 minus debits 25.00; `TOTAL-AMOUNT`
  at bytes 22-34 on the REDEFINES trailer)

## Not verified

- Watching it end to end with a human ear. The narration is synthesised and the timing is generated
  from measured mp3 durations, not from listening.
- YouTube upload. The rules require a public YouTube link; that upload is the account holder's act.
