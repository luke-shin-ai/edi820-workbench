# Shot list for the 「820」 demo video (target 2:00 - 2:40, hard limit 3:00).
#
# Rebuilt on 2026-11-27 after the third-party review. What changed from the 2026-11-22 cut:
#   - the first 15 seconds are the running screen, not a terminal: the money sentence, the
#     COBOL GHOST bar, the bytes of finding 1, and the register after a waiver;
#   - the spec and the steering documents are on screen, which is what the judge briefing
#     asks for in as many words;
#   - every count is the one the repository reports today (334 tests in 25 files).
#
# Every plate is built from real material: screenshots of docs/demo at devicePixelRatio 2,
# the requirement and steering files as they are on disk, captured stdout of the real
# commands, and the hook log the Kiro sessions wrote. Nothing is redrawn by hand and no
# number is typed in.

SHOTS = [
    dict(
        id="s01",
        plate="demo-hero",
        accent="#D29922",
        zoom=(1.00, 1.02),
        focus=(0.50, 0.42),
        narration=(
            "This is the browser, not a slide. A back office still receives fixed-width payment "
            "files from a COBOL era, and nobody left there can read them. The first line is not "
            "code, it is money: the trailer declares one million two hundred eighty four thousand "
            "five hundred fifty dollars, its ten details add up to one hundred dollars less, and "
            "the verdict is fail."
        ),
        cues=[
            "This is the browser, not a slide.",
            "A back office still receives fixed-width payment files from a COBOL era.",
            "Nobody left there can read them. The first line is not code, it is money.",
            "The trailer declares 1,284,550.00 dollars, its details add up to 100 less.",
            "The verdict is fail.",
        ],
    ),
    dict(
        id="s02",
        plate="demo-finding",
        accent="#D29922",
        zoom=(1.00, 1.02),
        focus=(0.50, 0.45),
        narration=(
            "Under it, the program that kept those totals speaks, and offers the next tap. Press "
            "it and the amount is not described, it is shown: bytes twenty four to thirty six of "
            "payment record ten, lit in column three, with the copybook field name and the value "
            "as read. The claim is checkable, not asserted."
        ),
        cues=[
            "Under it, the program that kept those totals speaks, and offers the next tap.",
            "Press it and the amount is not described, it is shown.",
            "Bytes 24 to 36 of payment record 10, lit in column three.",
            "The copybook field name and the value as read. The claim is checkable, not asserted.",
        ],
    ),
    dict(
        id="s03",
        plate="demo-waiver",
        accent="#D29922",
        zoom=(1.00, 1.03),
        focus=(0.45, 0.45),
        narration=(
            "A person can accept the gap. The register takes an owner, a reason, a compensating "
            "control and an expiry, and appends one hash-chained entry. The verdict stays fail, "
            "and that is the point: a person can accept a gap, never edit the answer. The chain "
            "says the entry was appended, not rewritten."
        ),
        cues=[
            "A person can accept the gap.",
            "The register takes an owner, a reason, a compensating control and an expiry.",
            "One hash-chained entry is appended; the verdict stays fail.",
            "A person can accept a gap, never edit the answer.",
        ],
    ),
    dict(
        id="s04",
        plate="spec-doc",
        accent="#6BA8FF",
        zoom=(1.00, 1.04),
        focus=(0.42, 0.40),
        narration=(
            "The work started from a spec. Thirty three requirements in EARS form, a design, and "
            "a task list. Task seven point one asked for the exception register, requirements "
            "eight point one to eight point eight, and a Kiro CLI session with the implementer "
            "agent wrote it: three hundred eighty four lines and thirty eight tests. The spec was "
            "the contract, and the contract is in the repository."
        ),
        cues=[
            "The work started from a spec.",
            "33 requirements in EARS form, a design, and a task list.",
            "Task 7.1 asked for the exception register, requirements 8.1 to 8.8.",
            "A Kiro CLI session with the implementer agent wrote it: 384 lines, 38 unit tests.",
            "The spec was the contract, and it is in the repository.",
        ],
    ),
    dict(
        id="s05",
        plate="steering-doc",
        accent="#6BA8FF",
        zoom=(1.00, 1.04),
        focus=(0.40, 0.40),
        narration=(
            "Five steering files set the rules before the code. The one that matters most: "
            "amounts are bigint minor units with a currency, never floats. That rule reaches every "
            "layer, from the parser to the reconciler to this register. Steering here is not "
            "documentation. It is the reason the numbers are exact."
        ),
        cues=[
            "Five steering files set the rules before the code.",
            "Amounts are bigint minor units with a currency, never floats.",
            "That rule reaches the parser, the reconciler and the register.",
            "Steering here is not documentation. It is why the numbers are exact.",
        ],
    ),
    dict(
        id="s06",
        plate="hook-open",
        accent="#6BA8FF",
        zoom=(1.00, 1.04),
        focus=(0.35, 0.40),
        narration=(
            "Three hooks ran inside those sessions. A file save ran the tests. When the agent "
            "stopped, the stop hook re-derived the newest verdict and compared the fingerprint. "
            "Every firing is a line in a committed log, not a claim in a write-up."
        ),
        cues=[
            "Three hooks ran inside those sessions.",
            "A file save ran the tests.",
            "The stop hook re-derived the newest verdict and compared the fingerprint.",
            "Every firing is a line in a committed log, not a claim in a write-up.",
        ],
    ),
    dict(
        id="s07",
        plate="copybook",
        accent="#6BA8FF",
        zoom=(1.02, 1.07),
        focus=(0.40, 0.32),
        narration=(
            "What a byte means comes from a COBOL copybook. This bank copybook gives one hundred "
            "byte area two meanings: the payment, and the trailer declared with REDEFINES. The type "
            "byte picks the layout, and the other layout's fields are never decoded."
        ),
        cues=[
            "What a byte means comes from a COBOL copybook.",
            "One 100-byte area, two meanings: the payment, and the trailer declared with REDEFINES.",
            "The type byte picks the layout, and the other fields are never decoded.",
        ],
    ),
    dict(
        id="s08",
        plate="static-bai2",
        accent="#6BA8FF",
        zoom=(1.00, 1.03),
        focus=(0.50, 0.40),
        narration=(
            "BAI2 statements carry their own layout and need no copybook. This one is missing a "
            "credit and carries a bank fee, and the delta names both parts instead of a single "
            "number pulled from the air."
        ),
        cues=[
            "BAI2 statements carry their own layout and need no copybook.",
            "One credit is missing and there is a 25 dollar bank fee.",
            "The delta names both parts, not one number pulled from the air.",
        ],
    ),
    dict(
        id="s09",
        plate="verify",
        accent="#3FB950",
        zoom=(1.02, 1.06),
        focus=(0.35, 0.35),
        narration=(
            "One command re-derives the verdict from the recorded inputs and compares a SHA-256 "
            "fingerprint. Same fingerprint, same verdict, and the report file is not touched."
        ),
        cues=[
            "One command re-derives the verdict from the recorded inputs.",
            "Same fingerprint, same verdict, and the report file is not touched.",
        ],
    ),
    dict(
        id="s10",
        plate="tests",
        accent="#3FB950",
        zoom=(1.02, 1.06),
        focus=(0.35, 0.45),
        narration=(
            "Three hundred thirty four tests in twenty five files, thirty one of them properties. "
            "A truncated record used to pass with zero findings; it now reports incomplete and "
            "exits non-zero."
        ),
        cues=[
            "334 tests in 25 files, 31 of them properties.",
            "A truncated record used to pass with zero findings; it now reports incomplete.",
            "It exits non-zero.",
        ],
    ),
    dict(
        id="s11",
        plate="end",
        accent="#3FB950",
        zoom=(1.00, 1.03),
        focus=(0.50, 0.45),
        narration=(
            "For a finance team this replaces retyping a payment file into a spreadsheet. 820. "
            "Resurrection. Apache two point zero."
        ),
        cues=[
            "For a finance team this replaces retyping a payment file into a spreadsheet.",
            "820. Resurrection. Apache 2.0.",
        ],
    ),
]
