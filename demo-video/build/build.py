"""Renders the 「820」 demo video.

Pipeline: plate (2560x1440 still) -> per-shot segment with a slow Ken Burns move
          -> xfade assembly -> narration mixed on a sample-accurate timeline
          -> one final encode that burns the English subtitles -> mp4 + srt.

Stages (the sandbox kills long calls, so each stage can be run on its own):
    python3 build.py seg        # render any missing shot segment, stops before the timeout
    python3 build.py assemble   # crossfade, mix audio, burn subtitles, write mp4 + srt
    python3 build.py check      # ffprobe the result: duration, size, streams, subtitle count
"""
import json
import os
import subprocess
import sys
import time
import wave
from array import array

import imageio_ffmpeg

sys.path.insert(0, os.path.dirname(__file__))
from config import SHOTS

WORK = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(WORK)  # demo-video/
PLATES = os.path.join(WORK, "plates")
SEGS = os.path.join(WORK, "segs")
TTS = os.path.join(WORK, "tts")
FF = imageio_ffmpeg.get_ffmpeg_exe()

FPS = 30
W, H = 1920, 1080
LEAD = 0.6
TAIL = 0.7
XFADE = 0.5
NAME = "820-demo-en"

for d in (SEGS,):
    os.makedirs(d, exist_ok=True)


def probe_duration(path):
    wav = path + ".probe.wav"
    subprocess.run([FF, "-y", "-hide_banner", "-loglevel", "error", "-i", path,
                    "-ac", "1", "-ar", "48000", wav], check=True)
    with wave.open(wav) as w:
        d = w.getnframes() / w.getframerate()
    os.remove(wav)
    return d


def plan():
    durs = json.load(open(os.path.join(WORK, "durations.json")))
    shots = []
    for s in SHOTS:
        audio = durs[s["id"]]
        shots.append(dict(shot=s, audio=audio, dur=round(audio + LEAD + TAIL, 3)))

    starts, acc = [], 0.0
    for i, p in enumerate(shots):
        starts.append(acc)
        acc += p["dur"] - (XFADE if i < len(shots) - 1 else 0.0)
    total = acc

    cues = []
    for p, st in zip(shots, starts):
        words = [len(c.split()) for c in p["shot"]["cues"]]
        tot = sum(words)
        t = st + LEAD
        for c, wc in zip(p["shot"]["cues"], words):
            cd = p["audio"] * wc / tot
            cues.append((t, t + cd - 0.08, c))
            t += cd
    return shots, starts, total, cues


PLATE_FILE = {
    "raw-file": "p01_raw",
    "copybook": "p02_copybook",
    "pass-full": "p03_pass",
    "fail-findings": "p04_fail",
    "evidence-bytes": "p05_evidence",
    "guarantees": "p06_guarantees",
    "verify": "p07_verify",
    "tests": "p08_tests",
    "bai2": "p09_bai2",
    "kiro": "p10_kiro",
    "end": "p11_end",
}


def render_segment(p):
    shot = p["shot"]
    seg = os.path.join(SEGS, shot["id"] + ".mp4")
    plate = os.path.join(PLATES, PLATE_FILE[shot["plate"]] + ".png")
    n = max(2, int(round(p["dur"] * FPS)))
    z0, z1 = shot["zoom"]
    fx, fy = shot["focus"]
    vf = ("zoompan=z='{z0}+({dz})*min(max(on,0),{n1})/{n1}':"
          "x='(iw-iw/zoom)*{fx}':y='(ih-ih/zoom)*{fy}':d={n}:s={w}x{h}:fps={fps}") \
        .format(z0=z0, dz=z1 - z0, n1=n - 1, fx=fx, fy=fy, n=n, w=W, h=H, fps=FPS)
    cmd = [FF, "-y", "-hide_banner", "-loglevel", "error",
           "-loop", "1", "-framerate", str(FPS), "-i", plate, "-t", "%.3f" % p["dur"],
           "-vf", vf + ",format=yuv420p", "-r", str(FPS),
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
           seg]
    subprocess.run(cmd, check=True)
    return seg


def srt_time(t):
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return "%02d:%02d:%02d,%03d" % (h, m, s, ms)


def ass_time(t):
    cs = int(round(t * 100))
    h, cs = divmod(cs, 360000)
    m, cs = divmod(cs, 6000)
    s, cs = divmod(cs, 100)
    return "%d:%02d:%02d.%02d" % (h, m, s, cs)


ASS_HEAD = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Liberation Sans,36,&H00F5F8FC,&H000000FF,&H00000000,&H9E0A0E16,0,0,0,0,100,100,0,0,1,3,0,2,90,90,48,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def write_subs(cues):
    srt_path = os.path.join(OUT, NAME + ".srt")
    with open(srt_path, "w", encoding="utf-8") as f:
        for i, (a, b, text) in enumerate(cues, 1):
            f.write("%d\n%s --> %s\n%s\n\n" % (i, srt_time(a), srt_time(b), text))
    ass_path = os.path.join(WORK, NAME + ".ass")
    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(ASS_HEAD)
        for a, b, text in cues:
            f.write("Dialogue: 0,%s,%s,Cap,,0,0,0,,%s\n" % (ass_time(a), ass_time(b), text))
    return srt_path, ass_path


def stage_seg():
    shots, _, _, _ = plan()
    t0 = time.time()
    done = 0
    for p in shots:
        seg = os.path.join(SEGS, p["shot"]["id"] + ".mp4")
        if os.path.exists(seg) and os.path.getsize(seg) > 20000:
            continue
        if time.time() - t0 > 215:
            print("pausing before", p["shot"]["id"], flush=True)
            break
        print("render", p["shot"]["id"], p["dur"], flush=True)
        render_segment(p)
        done += 1
    print("rendered", done, "elapsed", round(time.time() - t0, 1), flush=True)


def stage_assemble():
    shots, starts, total, cues = plan()
    segs = [os.path.join(SEGS, p["shot"]["id"] + ".mp4") for p in shots]
    missing = [s for s in segs if not os.path.exists(s)]
    if missing:
        raise SystemExit("missing segments: %s" % missing)

    inputs = []
    for s in segs:
        inputs += ["-i", s]
    fc, prev, off = [], "0:v", 0.0
    for i in range(1, len(segs)):
        off += shots[i - 1]["dur"] - XFADE
        out = "x%d" % i
        fc.append("[%s][%d:v]xfade=transition=fade:duration=%.2f:offset=%.3f[%s]"
                  % (prev, i, XFADE, off, out))
        prev = out
    fc.append("[%s]format=yuv420p[vout]" % prev)
    video_only = os.path.join(WORK, "video_only.mp4")
    subprocess.run([FF, "-y", "-hide_banner", "-loglevel", "error"] + inputs +
                   ["-filter_complex", ";".join(fc), "-map", "[vout]",
                    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                    "-pix_fmt", "yuv420p", "-r", str(FPS), video_only], check=True)
    print("video", round(total, 2), "s", flush=True)

    sr = 48000
    n = int((total + 1.0) * sr)
    buf = array("h", bytes(2 * 2 * n))
    for p, st in zip(shots, starts):
        mp3 = os.path.join(TTS, p["shot"]["id"] + ".mp3")
        wv = mp3 + ".mix.wav"
        subprocess.run([FF, "-y", "-loglevel", "error", "-i", mp3, "-af",
                        "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", str(sr), "-ac", "2", wv], check=True)
        with wave.open(wv) as w:
            frames = w.readframes(w.getnframes())
        os.remove(wv)
        data = array("h")
        data.frombytes(frames)
        off_s = int((st + LEAD) * sr) * 2
        end = min(len(buf), off_s + len(data))
        buf[off_s:end] = data[:end - off_s]
    audio = os.path.join(WORK, "narration.wav")
    with wave.open(audio, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(buf.tobytes())

    srt_path, ass_path = write_subs(cues)
    final = os.path.join(OUT, NAME + ".mp4")
    subprocess.run([FF, "-y", "-hide_banner", "-loglevel", "error",
                    "-i", video_only, "-i", audio,
                    "-vf", "subtitles=%s" % ass_path.replace(":", "\\:"),
                    "-map", "0:v", "-map", "1:a",
                    "-c:v", "libx264", "-preset", "medium", "-crf", "25",
                    "-maxrate", "860k", "-bufsize", "1720k", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart",
                    "-shortest", final], check=True)
    print("final", final, "dur", round(probe_duration(final), 2),
          "size", round(os.path.getsize(final) / 1e6, 2), "MB", flush=True)


def stage_check():
    final = os.path.join(OUT, NAME + ".mp4")
    info = subprocess.run([FF, "-hide_banner", "-i", final], capture_output=True, text=True).stderr
    dur = probe_duration(final)
    size = os.path.getsize(final) / 1e6
    print("duration", round(dur, 2), "s")
    print("size", round(size, 2), "MB")
    for line in info.split("\n"):
        if "Stream #" in line or "Duration" in line:
            print(line.strip())
    srt = os.path.join(OUT, NAME + ".srt")
    cues = [b for b in open(srt, encoding="utf-8").read().split("\n\n") if b.strip()]
    print("srt cues", len(cues))
    ok = dur < 180 and size < 20 and "1920x1080" in info
    print("PASS" if ok else "CHECK FAILED")
    return ok


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else "seg"
    if stage == "seg":
        stage_seg()
    elif stage == "assemble":
        stage_assemble()
    elif stage == "check":
        stage_check()
    else:
        raise SystemExit("unknown stage " + stage)
