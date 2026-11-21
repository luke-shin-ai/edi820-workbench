"""Builds the 1920x1080 plates for the 「820」 demo video.

Design coordinates are 1920x1080. Everything is drawn on a 2x canvas and resampled to
2560x1440, so the Ken Burns move always downscales and text stays sharp.

Material: the fixture files as they are on disk, the copybook as it is on disk with byte
offsets taken from the compiler's own output, screenshots of the running screen, and
captured stdout of the real commands. No value is typed in by hand.
"""
import json
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = "/workspace/hackathons/kiroween-2026"
WORK = os.path.join(ROOT, "demo-video/build")
OUT = os.path.join(WORK, "plates")
SHOTS = os.path.join(ROOT, "demo-video/screenshots")
OUTPUTS = os.path.join(WORK, "outputs")

W, H = 1920, 1080
SS = 2
FINAL = (2560, 1440)

BG_TOP = (7, 11, 18)
BG_BOT = (13, 21, 34)
PANEL = (16, 23, 34)
PANEL_EDGE = (38, 49, 64)
INK = (241, 245, 250)
MUTED = (160, 176, 194)
DIM = (110, 128, 150)
GREEN = (63, 185, 80)
RED = (248, 81, 73)
BLUE = (107, 168, 255)
AMBER = (210, 153, 34)
VIOLET = (188, 140, 255)

SANS_R = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
SANS_B = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
MONO_R = "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf"
MONO_B = "/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf"


def font(path, size):
    return ImageFont.truetype(path, int(size * SS))


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


class Canvas:
    def __init__(self):
        self.img = Image.new("RGB", (W * SS, H * SS), BG_TOP)
        self.d = ImageDraw.Draw(self.img)
        for y in range(H * SS):
            t = y / (H * SS - 1)
            c = tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3))
            self.d.line([(0, y), (W * SS, y)], fill=c)
        self.d = ImageDraw.Draw(self.img)

    def s(self, v):
        return v * SS

    def text(self, xy, s, f, fill=INK, anchor=None):
        self.d.text((self.s(xy[0]), self.s(xy[1])), s, font=f, fill=fill, anchor=anchor)

    def width(self, s, f):
        return self.d.textlength(s, font=f) / SS

    def wrap(self, s, f, max_w):
        words = s.split()
        lines, cur = [], ""
        for w in words:
            trial = (cur + " " + w).strip()
            if self.width(trial, f) <= max_w or not cur:
                cur = trial
            else:
                lines.append(cur)
                cur = w
        if cur:
            lines.append(cur)
        return lines

    def card(self, box, stroke=PANEL_EDGE, fill=PANEL, width=2, radius=18):
        x0, y0, x1, y1 = [self.s(v) for v in box]
        self.d.rounded_rectangle([x0, y0, x1, y1], radius=self.s(radius), fill=fill,
                                 outline=stroke, width=self.s(width))

    def chip(self, label, accent):
        f = font(SANS_B, 25)
        tw = self.width(label, f)
        x0, y0 = 54, 40
        x1 = x0 + tw + 78
        y1 = y0 + 52
        self.d.rounded_rectangle([self.s(x0), self.s(y0), self.s(x1), self.s(y1)],
                                 radius=self.s(26), fill=(10, 16, 25),
                                 outline=(255, 255, 255, 36), width=self.s(1))
        self.d.ellipse([self.s(x0 + 22), self.s(y0 + 21), self.s(x0 + 32), self.s(y0 + 31)],
                       fill=rgb(accent) + (255,))
        self.text((x0 + 46, y0 + 12), label, f, (233, 239, 246))

    def save(self, name):
        os.makedirs(OUT, exist_ok=True)
        path = os.path.join(OUT, name + ".png")
        self.img.resize(FINAL, Image.LANCZOS).save(path)
        return path


def footer(c, text):
    c.text((54, H - 70), text, font(SANS_R, 20), DIM)


def clean(s):
    """Strip markdown emphasis that the sans font would otherwise print literally."""
    return s.replace("`", "").replace("**", "").replace("⇒", "->").replace("✓", "")


# --------------------------------------------------------------- plates
def plate_raw_file():
    c = Canvas()
    c.card((54, 112, W - 54, 812), fill=(11, 16, 24))
    lines = open(os.path.join(ROOT, "samples/data/820-bad.txt"), "rb").read().decode("latin1").split("\n")
    lines = [ln for ln in lines if ln != ""]
    f = font(MONO_R, 23)
    y = 150
    for i, ln in enumerate(lines):
        c.text((86, y), "%03d" % i, font(MONO_R, 19), DIM)
        body = ln.replace("\t", " ")
        c.text((146, y), body, f, (206, 220, 235))
        y += 56
    c.text((86, 780), "11 records / 100 bytes each / LF framing / ASCII", font(MONO_R, 18), DIM)
    c.text((86, 840), "One record is 99 bytes. Nothing in the file says so.", font(SANS_R, 24), AMBER)
    c.text((86, 880), "You find that out when a parser you trust disagrees with the trailer.", font(SANS_R, 24), MUTED)
    c.chip("1 / THE FILE   samples/data/820-bad.txt", "#6BA8FF")
    return c.save("p01_raw")


def plate_copybook():
    c = Canvas()
    fields = json.load(open(os.path.join(WORK, "copybook-fields.json")))["820.cpy"]["fields"]
    by_name = {f["name"]: f for f in fields}
    text = open(os.path.join(ROOT, "samples/copybooks/820.cpy"), "r", encoding="utf-8").read().split("\n")

    rows = []
    for raw in text:
        if not raw.strip():
            continue
        line = raw.replace("\t", "    ")
        stripped = line.strip()
        colour = INK
        field = None
        if stripped.startswith("*"):
            colour = DIM if "@" not in stripped else BLUE
        else:
            parts = stripped.split()
            if len(parts) >= 2 and parts[0].isdigit():
                name = parts[1].rstrip(".")
                field = by_name.get(name)
                colour = (222, 233, 244) if field else (170, 185, 200)
        max_chars = 84
        chunks = []
        while len(line) > max_chars:
            cut = line.rfind(" ", 0, max_chars)
            cut = cut if cut > 50 else max_chars
            chunks.append(line[:cut])
            line = "       " + line[cut:].lstrip()
        chunks.append(line)
        for k, chunk in enumerate(chunks):
            rows.append((chunk, colour, field if k == 0 else None))

    c.card((54, 104, 1192, 962), fill=(11, 16, 24))
    y = 138
    f = font(MONO_R, 17.5)
    for line, colour, field in rows:
        c.text((78, y), line, f, colour)
        if field:
            start, length = field["start"], field["length"]
            c.text((1014, y + 3), "%d-%d" % (start, start + length - 1), font(MONO_R, 14), (120, 155, 190))
        y += 29.5
    c.text((1014, 918), "bytes", font(MONO_R, 13), (95, 112, 132))

    c.card((1224, 104, W - 54, 962), fill=(13, 19, 29), stroke=(52, 62, 80))
    c.text((1254, 140), "COMPILED", font(SANS_B, 22), MUTED)
    c.text((1254, 180), "record length 100 bytes", font(MONO_R, 22), GREEN)
    c.text((1254, 214), "10 fields, no overlap", font(MONO_R, 22), GREEN)

    c.text((1254, 288), "NOT IN THE COPYBOOK", font(SANS_B, 22), AMBER)
    items = ["Is a short record re-synchronised,", "or reported?",
             "Are totals compared per currency?", "Is a reference match exact or fuzzy?",
             "May the agent explain a finding", "with no evidence at all?"]
    y = 328
    for it in items:
        c.text((1254, y), it, font(SANS_R, 21), (196, 210, 226))
        y += 34
    c.text((1254, 550), "Those are requirements.", font(SANS_B, 22), INK)
    c.text((1254, 586), "They are the part that lived in", font(SANS_R, 21), MUTED)
    c.text((1254, 616), "people's heads.", font(SANS_R, 21), MUTED)

    c.text((1254, 700), "Answered, and written down:", font(SANS_B, 21), BLUE)
    for i, (k, v) in enumerate([("R2.2", "report, never re-synchronise"),
                                ("R4.1", "totals compared per currency"),
                                ("R5.3", "no evidence, no explanation")]):
        c.text((1254, 744 + i * 48), k, font(MONO_B, 20), (208, 222, 236))
        c.text((1310, 744 + i * 48), v, font(MONO_R, 19), (180, 198, 216))

    c.chip("2 / THE COPYBOOK   samples/copybooks/820.cpy", "#6BA8FF")
    return c.save("p02_copybook")


def plate_from_crop(src, box, name):
    im = Image.open(os.path.join(SHOTS, src)).convert("RGB")
    im = im.crop(box).resize(FINAL, Image.LANCZOS)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + ".png")
    im.save(path)
    return path


def plate_pass_full():
    """Full screen, padded so the slow zoom never clips the outer edge of the UI."""
    im = Image.open(os.path.join(SHOTS, "hd-pass@2x.png")).convert("RGB").resize((1880, 1046), Image.LANCZOS)
    canvas = Image.new("RGB", (1920, 1080), (9, 13, 20))
    canvas.paste(im, (20, 17))
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "p03_pass.png")
    canvas.save(path)
    return path


def plate_fail_findings():
    return plate_from_crop("hd-fail-mid-1@2x.png", (0, 540, 1412, 1334), "p04_fail")


def plate_evidence():
    return plate_from_crop("hd-fail-right-1@2x.png", (0, 24, 1766, 1017), "p05_evidence")


def plate_guarantees():
    c = Canvas()
    md = open(os.path.join(ROOT, "docs/guarantees.md"), "r", encoding="utf-8").read().split("\n")
    section, groups = None, {"g": [], "n": []}
    for line in md:
        if line.startswith("## Guaranteed"):
            section = "g"
        elif line.startswith("## Not guaranteed"):
            section = "n"
        elif line.startswith("## "):
            section = None
        elif section and line[:1].isdigit():
            parts = line.split("**")
            title = parts[1] if len(parts) > 2 else line
            rest = parts[2].strip() if len(parts) > 2 else ""
            groups[section].append((clean(title), clean(rest)))

    def column(x0, x1, items, accent, head, sub):
        c.card((x0, 112, x1, 828), fill=(13, 19, 28), stroke=accent, width=3)
        c.d.rounded_rectangle([c.s(x0), c.s(112), c.s(x0 + 8), c.s(828)], radius=c.s(4), fill=accent)
        c.text((x0 + 34, 136), head, font(SANS_B, 25), accent)
        c.text((x0 + 34, 172), sub, font(SANS_R, 19), MUTED)
        y = 226
        for i, (title, rest) in enumerate(items, 1):
            c.text((x0 + 34, y), "%d." % i, font(SANS_B, 20), accent)
            c.text((x0 + 62, y), title, font(SANS_B, 20), INK)
            lines = c.wrap(rest, font(SANS_R, 18), (x1 - x0 - 104)) or [""]
            yy = y + 30
            for ln in lines:
                c.text((x0 + 62, yy), ln, font(SANS_R, 18), (186, 202, 218))
                yy += 26
            y = yy + 20

    column(54, 940, groups["g"], GREEN, "GUARANTEED", "mechanically verifiable, top strip of the screen")
    column(976, W - 54, groups["n"], AMBER, "NOT GUARANTEED", "a human decides, bottom strip of the screen")
    c.text((54, 866), "A reconciliation tool that claims to be always right is a liability.", font(SANS_R, 25), (206, 220, 234))
    footer(c, "docs/guarantees.md, parsed and printed by 820 verify and shown in both strips of the screen")
    c.chip("6 / THE BOUNDARY   docs/guarantees.md", "#D29922")
    return c.save("p06_guarantees")


def terminal(lines, name, chip_label, accent, title, hl=(), size=None, top=None):
    c = Canvas()
    if size is None:
        size = 30
        probe = Canvas()
        while size > 15:
            lh_ = int(size * 1.62)
            too_tall = 76 + len(lines) * lh_ + 30 > 790
            widest = max(probe.width(clean(l), font(MONO_R, size)) for l in lines)
            if not too_tall and widest < 1700:
                break
            size -= 1
    lh = int(size * 1.62)
    height = 76 + len(lines) * lh + 30
    if top is None:
        top = max(104, (H - height) // 2 + 24)
    c.card((54, top, W - 54, top + height), fill=(9, 13, 20), stroke=(46, 58, 74), width=2)
    c.d.rounded_rectangle([c.s(54), c.s(top), c.s(W - 54), c.s(top + 52)], radius=c.s(16), fill=(17, 24, 35))
    for i, col in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        c.d.ellipse([c.s(82 + i * 26), c.s(top + 18), c.s(96 + i * 26), c.s(top + 32)], fill=col)
    c.text((W / 2, top + 15), title, font(SANS_R, 18), (120, 136, 156), anchor="ma")

    f = font(MONO_R, size)
    y = top + 78
    for raw in lines:
        raw = clean(raw)
        colour = (206, 220, 235)
        if raw.startswith("$ "):
            colour = GREEN
        elif raw.startswith("RESULT"):
            colour = GREEN
        elif "FAIL" in raw:
            colour = (255, 150, 140)
        elif "✓" in raw or "passed" in raw:
            colour = (150, 205, 165)
        elif "fingerprint" in raw:
            colour = BLUE
        for key in hl:
            if key in raw:
                c.d.rounded_rectangle([c.s(84), c.s(y - 6), c.s(84 + c.width(raw, f) + 20), c.s(y + lh - 10)],
                                      radius=c.s(6), fill=(30, 40, 30, 255))
                colour = (196, 236, 200)
        c.text((96, y), raw.replace("✓", "+"), f, colour)
        y += lh
    c.chip(chip_label, accent)
    return c.save(name)


def plate_verify():
    lines = [ln for ln in open(os.path.join(OUTPUTS, "verify.txt"), encoding="utf-8").read().split("\n") if ln.strip()]
    keep = lines[:8]
    keep[3] = keep[3].replace("/workspace/hackathons/kiroween-2026/", "")
    return terminal(keep, "p07_verify", "7 / VERIFY   read-only re-derivation", "#3FB950",
                    "820 verify out/vid", hl=("RESULT",))


def plate_tests():
    raw = [ln for ln in open(os.path.join(OUTPUTS, "tests.txt"), encoding="utf-8").read().split("\n") if ln.strip()]
    lines = raw[:13]
    return terminal(lines, "p08_tests", "8 / PROPERTY BASED TESTS   npx vitest run", "#3FB950",
                    "npx vitest run", hl=("Tests  222",))


def plate_bai2():
    c = Canvas()
    c.card((54, 104, 1442, 356), fill=(11, 16, 24))
    c.text((82, 122), "samples/data/bai2-bad.txt", font(MONO_B, 19), (150, 175, 200))
    lines = [ln for ln in open(os.path.join(ROOT, "samples/data/bai2-bad.txt"), encoding="utf-8").read().split("\n") if ln.strip()]
    y = 160
    for ln in lines[:5]:
        code = ln.split(",")[0]
        colour = BLUE if code in ("01", "02", "03") else (206, 220, 235)
        c.text((82, y), ln[:96], font(MONO_R, 17), colour)
        y += 34
    c.card((1470, 104, W - 54, 356), fill=(13, 19, 28), stroke=AMBER)
    c.text((1500, 122), "no copybook", font(SANS_B, 22), AMBER)
    c.text((1500, 160), "01 file header", font(MONO_R, 16), (150, 170, 190))
    c.text((1500, 186), "02 group header", font(MONO_R, 16), (150, 170, 190))
    c.text((1500, 212), "03 account", font(MONO_R, 16), (150, 170, 190))
    c.text((1500, 238), "16 transaction", font(MONO_R, 16), (150, 170, 190))
    c.text((1500, 264), "98 group trailer", font(MONO_R, 16), (150, 170, 190))
    c.text((1500, 300), "comma delimited, one record per line", font(SANS_R, 16), (170, 186, 204))

    im = Image.open(os.path.join(SHOTS, "hd-bai2-mid@2x.png")).convert("RGB")
    im = im.crop((14, 520, 1400, 1052))
    # the crop is 2 CSS px per pixel; scale it to 2 design px per CSS px so the text reads
    im = im.resize((im.width * 2, im.height * 2), Image.LANCZOS)
    c.img.paste(im, (c.s(56), c.s(386)))
    c.d.rounded_rectangle([c.s(56), c.s(386), c.s(56 + im.width / SS), c.s(386 + im.height / SS)],
                          radius=c.s(8), outline=(60, 74, 92), width=c.s(2))
    c.text((56, 946), "the same reconciler, fed a reader instead of a copybook", font(SANS_R, 23), MUTED)
    c.chip("9 / BAI2   a statement with no copybook", "#6BA8FF")
    return c.save("p09_bai2")


def plate_kiro():
    c = Canvas()
    c.card((54, 112, 946, 700), fill=(11, 16, 24))
    c.text((82, 134), "$ git ls-files .kiro", font(MONO_R, 19), GREEN)
    files = [ln for ln in open(os.path.join(OUTPUTS, "kiro-files.txt"), encoding="utf-8").read().split("\n")
             if ln.startswith(".kiro/")]
    y = 176
    for ln in files:
        colour = (210, 222, 236)
        if "/specs/" in ln:
            colour = BLUE
        elif "/steering/" in ln:
            colour = VIOLET
        elif "/hooks/" in ln:
            colour = AMBER
        elif "/agents/" in ln:
            colour = GREEN
        c.text((82, y), ln, font(MONO_R, 18.5), colour)
        y += 30
    c.text((82, 490), "spec: the contract    steering: the rules", font(SANS_R, 19), MUTED)
    c.text((82, 520), "hooks and agent: the workflow around the code", font(SANS_R, 19), MUTED)

    c.card((54, 728, 946, 962), fill=(13, 19, 28), stroke=(52, 62, 80))
    c.text((82, 746), "reviewer agent, one prompt, two configurations", font(SANS_B, 19), INK)
    c.text((82, 782), "no read tools", font(MONO_B, 17.5), (255, 150, 140))
    c.text((300, 782), "3 of 4 claims false, invented line numbers", font(MONO_R, 16.5), (255, 170, 160))
    c.text((82, 812), "read tools", font(MONO_B, 17.5), (150, 205, 165))
    c.text((300, 812), "2 real defects: blank reference dropped,", font(MONO_R, 16.5), (170, 215, 180))
    c.text((300, 838), "matched count derived from a sentence", font(MONO_R, 16.5), (170, 215, 180))

    c.card((972, 112, W - 54, 700), fill=(13, 19, 28), stroke=(52, 62, 80))
    c.text((1000, 134), "requirements  ->  design  ->  tasks", font(SANS_B, 21), BLUE)
    chain = [
        ("requirements.md", "R1.1  every field gets a start and a length"),
        ("", "R2.2  a short record is reported, not re-synced"),
        ("", "R4.3  a reference matches or is listed"),
        ("", "R5.2  an unsupported number is refused"),
        ("design.md", "no model in the verdict path"),
        ("", "9 implementation deltas recorded"),
        ("tasks.md", "T0 to T5 done, evidence per task"),
        ("", "T6  write-up, review and video done"),
    ]
    y = 182
    for name, body in chain:
        if name:
            c.text((1000, y), name, font(MONO_B, 18.5), (215, 230, 240))
            c.text((1240, y), body, font(MONO_R, 17.5), (180, 196, 214))
        else:
            c.text((1016, y), body, font(MONO_R, 17.5), (160, 178, 196))
        y += 44

    c.card((972, 728, W - 54, 962), fill=(13, 19, 28), stroke=AMBER)
    c.text((1000, 746), "not claimed", font(SANS_B, 19), AMBER)
    c.text((1000, 782), "Kiro did not generate this code. The spec was the contract;", font(SANS_R, 18), (200, 214, 228))
    c.text((1000, 808), "implementation ran in this workspace.", font(SANS_R, 18), (200, 214, 228))
    c.text((1000, 844), "Hooks are committed; firing inside a live Kiro session", font(SANS_R, 18), (200, 214, 228))
    c.text((1000, 870), "is not yet verified.", font(SANS_R, 18), (200, 214, 228))

    c.chip("10 / KIRO IN THE REPOSITORY   .kiro/specs, steering, hooks, agent", "#6BA8FF")
    return c.save("p10_kiro")


def plate_end():
    c = Canvas()
    ring = (26, 62, 44)
    c.d.ellipse([c.s(840), c.s(150), c.s(1080), c.s(390)], outline=ring, width=c.s(4))
    c.d.ellipse([c.s(946), c.s(256), c.s(974), c.s(284)], fill=GREEN)
    c.text((W / 2, 430), "820", font(SANS_B, 112), INK, anchor="mm")
    c.text((W / 2, 530), "a verdict anyone can re-derive", font(SANS_R, 40), (168, 194, 214), anchor="mm")
    c.d.line([(c.s(840), c.s(600)), (c.s(1080), c.s(600))], fill=GREEN + (220,), width=c.s(3))
    rows = [
        ("Resurrection", "a file format whose readers retired"),
        ("Apache-2.0", "license file at the repository root"),
        ("Kiroween 2026", "spec, steering, hooks and agent in .kiro"),
    ]
    y = 660
    for left, right in rows:
        c.text((610, y), left, font(SANS_B, 25), GREEN)
        c.text((880, y), right, font(SANS_R, 25), (176, 194, 212))
        y += 58
    c.text((W / 2, 900), "All sample data is synthetic. No customer, bank or employer data is used.",
           font(SANS_R, 22), DIM, anchor="mm")
    return c.save("p11_end")


BUILDERS = {
    "raw-file": plate_raw_file,
    "copybook": plate_copybook,
    "pass-full": plate_pass_full,
    "fail-findings": plate_fail_findings,
    "evidence-bytes": plate_evidence,
    "guarantees": plate_guarantees,
    "verify": plate_verify,
    "tests": plate_tests,
    "bai2": plate_bai2,
    "kiro": plate_kiro,
    "end": plate_end,
}


if __name__ == "__main__":
    import sys
    from config import SHOTS as SHOT_LIST

    only = sys.argv[1:] or None
    for shot in SHOT_LIST:
        if only and shot["plate"] not in only:
            continue
        print("plate", shot["id"], BUILDERS[shot["plate"]](), flush=True)
