# 「820」 demo video: assets and rebuild notes

## What is in this folder

| file | what it is |
|---|---|
| `820-demo-en.mp4` | the cut: **2:52.30**, 1920×1080, 30 fps, H.264 (~809 kb/s) + AAC 87 kb/s, **19.5 MB**, English narration, burned-in subtitles, no music |
| `820-demo-en.srt` | 38 subtitle cues, same words and timings as the burn |
| `build/README.md` | this file: what is real, how it was made, how to rebuild |
| `build/config.py` | the shot list: plate, narration, subtitle cues, accent colour, camera move |
| `build/plates.py` | builds every 1920×1080 still from real inputs (see below) |
| `build/build.py` | `seg` / `assemble` / `check` stages (segment render, crossfade, audio mix, subtitle burn, ffprobe) |
| `build/capture_hd.py`, `capture_states.py` | Playwright captures of the running screen at devicePixelRatio 2 |
| `build/dump-copybook.mjs` | calls the real copybook compiler and prints field offsets (used by the copybook plate) |
| `build/outputs/*.txt` | captured stdout of the commands shown in the video (`verify`, `vitest`, `git ls-files .kiro`), the hook log (`hook-fire.txt`) and a live MCP client run (`mcp-call.txt`) |
| `shots-static/` | the l4 capture sidecar (`static-l4.json`) the register plate quotes |
| `build/copybook-fields.json` | the compiler output the plate draws its byte ranges from |
| `screenshots/` | the raw captures the plates are cropped from |

## What the video shows, and where each frame comes from

| # | shot | source |
|---|---|---|
| 1 | Kiro hook log + the stop hook's own run | `out/hook-log.txt` and `820 verify out/l4-review` from the T7.1 session, captured in `build/outputs/hook-fire.txt` |
| 2 | the reviewer agent's MCP calls | `node scripts/mcp-call.mjs`, captured in `build/outputs/mcp-call.txt`: verdict FAIL, 4 findings, fingerprint `7af64454…` |
| 3 | the copybook, with byte ranges | `samples/copybooks/820.cpy`; ranges printed by `dump-copybook.mjs` |
| 4 | PASS on the clickable screen | `docs/images/demo-s1.png` (static build, six-scenario run) |
| 5 | four findings | `docs/images/demo-s3.png` |
| 6 | the bytes behind a finding | the same screen, camera on the evidence column |
| 7 | the BAI2 delta with its parts | `docs/images/demo-s6.png`: credits 1,205,550.00 minus debits 25.00 |
| 8 | the exception register after a waiver | `docs/images/demo-l4-waived.png`, with the verdict and counts quoted from `shots-static/static-l4.json` |
| 9 | `820 verify` | real stdout, `build/outputs/verify.txt` |
| 10 | `npx vitest run` | real stdout, `build/outputs/tests.txt` (284 tests) |
| 11 | what the session did | `docs/kiro-session-evidence.md` facts, drawn as text |
| 12 | end card | drawn |

Terminal shots are rendered from captured stdout rather than screen-recorded, and the plate keeps
the file path in the chip so a viewer can match the text to a file. Nothing on screen is a mockup
and no number was typed in by hand.

## How it was built

```bash
cd demo-video/build
python3 plates.py                 # 11 plates, 1920x1080 design, drawn at 2x and resampled to 2560x1440
python3 make_tts.py               # edge-tts en-US-AndrewNeural at +6%, one mp3 per shot
python3 build.py seg              # one zoompan segment per shot
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
resumes on the next call.

## Verified

- duration 172.29 s, under the 180 s rule
- 1920×1080, 30 fps, yuv420p, H.264 + AAC, `+faststart`
- 19.51 MB, under Devpost's 25 MB upload limit
- 38 subtitle cues; every cue is inside its shot's narration window (built from the same timeline)
- no em dash, en dash, emoji or stock phrase in the narration or the cues (checked in `config.py`)
- 0 page errors across every browser capture
- the numbers in the narration match the files and the captured stdout (1,284,550.00 declared, 1,284,450.00 summed, -100.00 delta, 4 findings, 284 tests, fingerprints `7af64454…` for the FAIL case and the S6 delta -79,025.00 with credits 1,205,550.00 minus debits 25.00)

## Not verified

- Watching it end to end with a human ear. The narration is synthesised and the timing is generated
  from measured mp3 durations, not from listening.
- YouTube upload. The rules require a public YouTube link; that upload is the account holder's act.
