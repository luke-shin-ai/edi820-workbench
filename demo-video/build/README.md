# 「820」 demo video: assets and rebuild notes

## What is in this folder

| file | what it is |
|---|---|
| `820-demo-en.mp4` | the cut: **2:41.13**, 1920×1080, 30 fps, H.264 (~750 kb/s) + AAC 87 kb/s, **17.1 MB**, English narration, burned-in subtitles, no music |
| `820-demo-en.srt` | 31 subtitle cues, same words and timings as the burn |
| `build/README.md` | this file: what is real, how it was made, how to rebuild |
| `build/config.py` | the shot list: plate, narration, subtitle cues, accent colour, camera move |
| `build/plates.py` | builds every 1920×1080 still from real inputs (see below) |
| `build/build.py` | `seg` / `assemble` / `check` stages (segment render, crossfade, audio mix, subtitle burn, ffprobe) |
| `build/capture_hd.py`, `capture_states.py` | Playwright captures of the running screen at devicePixelRatio 2 |
| `build/dump-copybook.mjs` | calls the real copybook compiler and prints field offsets (used by the copybook plate) |
| `build/outputs/*.txt` | captured stdout of the commands shown in the video (`verify`, `vitest`, `git ls-files .kiro`) |
| `build/copybook-fields.json` | the compiler output the plate draws its byte ranges from |
| `screenshots/` | the raw captures the plates are cropped from |

## What the video shows, and where each frame comes from

| # | shot | source |
|---|---|---|
| 1 | the raw 100-byte record file | `samples/data/820-bad.txt` rendered as text, unchanged |
| 2 | the copybook, with byte ranges | `samples/copybooks/820.cpy` unchanged; ranges printed by `dump-copybook.mjs` |
| 3 | PASS screen | `capture_hd.py`, live server, `hd-pass@2x.png` |
| 4 | four findings | live server, `hd-fail-mid-1@2x.png` (a row was clicked in the browser) |
| 5 | bytes behind a finding | live server, `hd-fail-right-1@2x.png` (VALUE-DATE highlighted after the click) |
| 6 | guarantee boundary | `docs/guarantees.md`, the same text the CLI prints and the screen shows |
| 7 | `820 verify` | real stdout, `build/outputs/verify.txt` |
| 8 | `npx vitest run` | real stdout, `build/outputs/tests.txt` |
| 9 | BAI2 | `samples/data/bai2-bad.txt` plus the live FAIL screen for that case |
| 10 | `.kiro` and the reviewer | `git ls-files .kiro` output, and the two reviewer outcomes recorded in `docs/kiro-cli-validation.md` §5 |
| 11 | end card | drawn |

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

- duration 161.13 s, under the 180 s rule, inside the 150–170 s target
- 1920×1080, 30 fps, yuv420p, H.264 + AAC, `+faststart`
- 17.14 MB, under the 20 MB encode budget and Devpost's 25 MB upload limit
- 31 subtitle cues; every cue is inside its shot's narration window (built from the same timeline)
- 0 page errors across every browser capture
- the numbers in the narration match the files and the captured stdout (1,284,550.00 declared, 1,284,450.00 summed, −100.00 delta, 4 findings, 222 tests, fingerprint `a69a9c1d…`)

## Not verified

- Watching it end to end with a human ear. The narration is synthesised and the timing is generated
  from measured mp3 durations, not from listening.
- YouTube upload. The rules require a public YouTube link; that upload is the account holder's act.
