"""Synthesises the English narration for each shot and records its duration."""
import json
import os
import subprocess
import sys
import wave

import imageio_ffmpeg

sys.path.insert(0, os.path.dirname(__file__))
from config import SHOTS

ROOT = "/workspace"
WORK = os.path.join(ROOT, "hackathons/kiroween-2026/demo-video/build")
TTS = os.path.join(WORK, "tts")
FF = imageio_ffmpeg.get_ffmpeg_exe()
VOICE = "en-US-AndrewNeural"
RATE = "+6%"

os.makedirs(TTS, exist_ok=True)


def duration_of(path):
    wav = path + ".probe.wav"
    subprocess.run([FF, "-y", "-hide_banner", "-loglevel", "error", "-i", path,
                    "-ac", "1", "-ar", "48000", wav], check=True)
    with wave.open(wav) as w:
        d = w.getnframes() / w.getframerate()
    os.remove(wav)
    return d


def synth(text, out_mp3):
    subprocess.run([os.path.join(ROOT, ".local/bin/edge-tts"), "--voice", VOICE,
                    "--rate=" + RATE, "--text", text, "--write-media", out_mp3], check=True)


durs = {}
for s in SHOTS:
    mp3 = os.path.join(TTS, s["id"] + ".mp3")
    if not os.path.exists(mp3) or os.path.getsize(mp3) < 1000:
        synth(s["narration"], mp3)
    durs[s["id"]] = round(duration_of(mp3), 3)
    print(s["id"], durs[s["id"]], flush=True)

json.dump(durs, open(os.path.join(WORK, "durations.json"), "w"), indent=2)
total = sum(durs.values())
n = len(SHOTS)
print("narration total", round(total, 1), "s")
print("video total with 1.3s padding/shot minus 0.5s xfades:",
      round(total + n * 1.3 - 0.5 * (n - 1), 1), "s")
