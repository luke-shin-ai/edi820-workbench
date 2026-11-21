# Shot list for the 「820」 demo video (target 2:30 - 2:55, hard limit 3:00).
#
# Every plate is built from real material: the fixture files as they are on disk, the copybook
# as it is on disk with offsets taken from the compiler's own output, screenshots of the static
# demo built from this repository, captured stdout of the real commands, and the hook log the
# Kiro session wrote. Nothing is redrawn by hand and no number is typed in.
#
# The opening is Kiro: the hook log from the session that built the exception register, and the
# MCP calls the reviewer agent made. The product arrives after that, and the L4 register closes
# the loop before the tests.

SHOTS = [
    dict(
        id="s01",
        plate="hook-open",
        accent="#6BA8FF",
        zoom=(1.02, 1.07),
        focus=(0.35, 0.40),
        narration=(
            "This is the hook log from a real Kiro session. A file save ran the tests. When the "
            "agent stopped, the hook re-derived the verdict of the newest report and compared the "
            "fingerprint. Both lines are in the repository, and the transcript is beside them."
        ),
        cues=[
            "This is the hook log from a real Kiro session.",
            "A file save ran the tests. The stop hook re-derived the newest verdict.",
            "Both lines are in the repository, with the transcript beside them.",
        ],
    ),
    dict(
        id="s02",
        plate="mcp-call",
        accent="#6BA8FF",
        zoom=(1.02, 1.07),
        focus=(0.35, 0.35),
        narration=(
            "The reviewer agent did not describe the code from memory. It called the project's own "
            "MCP server: reconcile, verify, exceptions. The verdict, the finding count and the "
            "fingerprint came back from the same engine the command line runs."
        ),
        cues=[
            "The reviewer agent called the project's own MCP server.",
            "Reconcile, verify, exceptions. Same engine as the command line.",
            "A fingerprint is a check, not a claim.",
        ],
    ),
    dict(
        id="s03",
        plate="copybook",
        accent="#6BA8FF",
        zoom=(1.03, 1.09),
        focus=(0.40, 0.30),
        narration=(
            "What each byte means lives in a COBOL copybook. Amount is eleven digits with two "
            "implied decimals, and the sign is folded into the last digit. The copybook defines "
            "bytes and widths. It says nothing about what must be true of the numbers."
        ),
        cues=[
            "What each byte means lives in a COBOL copybook.",
            "Eleven digits, two implied decimals, sign folded into the last digit.",
            "It defines bytes and widths, not what must be true of the numbers.",
        ],
    ),
    dict(
        id="s04",
        plate="static-pass",
        accent="#3FB950",
        zoom=(1.00, 1.030),
        focus=(0.50, 0.40),
        narration=(
            "This screen runs in the browser tab. No server, no upload. The parser, the reconciler "
            "and the register are the same code, compiled for the page. Ten payment details, and "
            "the declared total of one million two hundred eighty four thousand five hundred "
            "fifty dollars is exactly what they sum to. Verdict pass."
        ),
        cues=[
            "This screen runs in the browser tab. No server, no upload.",
            "Same code, compiled for the page.",
            "Ten details. Declared 1,284,550.00, summed the same. Verdict pass.",
        ],
    ),
    dict(
        id="s05",
        plate="static-fail",
        accent="#F85149",
        zoom=(1.00, 1.032),
        focus=(0.50, 0.40),
        narration=(
            "Now a file with defects. Four findings. A control total short by one hundred dollars. "
            "A record of ninety nine bytes where the copybook says one hundred. Two references with "
            "no bank counterpart. One value date outside the settlement window. Exit code two."
        ),
        cues=[
            "Now a file with defects. Four findings.",
            "Control total short by 100.00. One record of 99 bytes instead of 100.",
            "Two references with no bank counterpart. One value date outside the window.",
            "Exit code two.",
        ],
    ),
    dict(
        id="s06",
        plate="static-evidence",
        accent="#D29922",
        zoom=(1.18, 1.30),
        focus=(0.82, 0.45),
        narration=(
            "Select a finding and the screen shows the bytes behind it. Record two, value date, "
            "bytes forty to forty seven, reading twenty twenty six, eleven, fourteen. Outside the "
            "window. The claim is checkable, not asserted."
        ),
        cues=[
            "Select a finding and the screen shows the bytes behind it.",
            "Record 2, value date, bytes 40 to 47: 2026, 11, 14. Outside the window.",
            "The claim is checkable, not asserted.",
        ],
    ),
    dict(
        id="s07",
        plate="static-bai2",
        accent="#6BA8FF",
        zoom=(1.00, 1.034),
        focus=(0.50, 0.40),
        narration=(
            "BAI2 is a bank statement with no copybook, read by its own reader. This one is missing "
            "a credit and carries a bank fee. The delta is -79,025.00, and the screen names the two "
            "parts: credits 1,205,550.00, minus debits 25.00."
        ),
        cues=[
            "BAI2 is a bank statement with no copybook, read by its own reader.",
            "One credit is missing and there is a 25.00 bank fee.",
            "Delta -79,025.00: credits 1,205,550.00 minus debits 25.00.",
        ],
    ),
    dict(
        id="s08",
        plate="static-l4",
        accent="#D29922",
        zoom=(1.10, 1.20),
        focus=(0.40, 0.55),
        narration=(
            "A model cannot clear a finding. A person records an exception: owner, reason, "
            "compensating control, expiry. The ledger is append only and hash chained, so an edit "
            "after the fact breaks it. The verdict stays fail, and a release puts the finding back "
            "in front of a human."
        ),
        cues=[
            "A model cannot clear a finding.",
            "A person records an exception: owner, reason, compensating control, expiry.",
            "Append only and hash chained. The verdict stays fail.",
            "A release puts the finding back in front of a human.",
        ],
    ),
    dict(
        id="s09",
        plate="verify",
        accent="#3FB950",
        zoom=(1.02, 1.07),
        focus=(0.35, 0.35),
        narration=(
            "Verify re-runs the deterministic layers from the recorded inputs and compares a "
            "SHA-256 fingerprint. Same fingerprint, same verdict, and the report file is not "
            "touched."
        ),
        cues=[
            "Verify re-runs the deterministic layers from the recorded inputs.",
            "Same fingerprint, same verdict, and the report file is not touched.",
        ],
    ),
    dict(
        id="s10",
        plate="tests",
        accent="#3FB950",
        zoom=(1.02, 1.07),
        focus=(0.35, 0.45),
        narration=(
            "Two hundred eighty four tests, property based where it matters. A truncated record "
            "used to pass with zero findings. It now reports incomplete and exits non zero, and a "
            "report verifies from any working directory."
        ),
        cues=[
            "284 tests, property based where it matters.",
            "A truncated record used to pass with zero findings.",
            "It now reports incomplete and exits non zero.",
            "A report verifies from any working directory.",
        ],
    ),
    dict(
        id="s11",
        plate="kiro",
        accent="#6BA8FF",
        zoom=(1.00, 1.05),
        focus=(0.5, 0.35),
        narration=(
            "The exception register was implemented by Kiro from spec task seven point one. The "
            "session transcript, the hook firings and the MCP calls are in the repository, with the "
            "repairs made afterwards listed beside them. Steering files set the rules, and the spec "
            "was the contract."
        ),
        cues=[
            "The exception register was implemented by Kiro from spec task 7.1.",
            "Transcript, hook firings and MCP calls are in the repository.",
            "The repairs made afterwards are listed beside them, not hidden.",
            "Steering files set the rules, and the spec was the contract.",
        ],
    ),
    dict(
        id="s12",
        plate="end",
        accent="#3FB950",
        zoom=(1.00, 1.04),
        focus=(0.5, 0.45),
        narration=(
            "For a finance team this replaces retyping a payment file into a spreadsheet with a "
            "verdict anyone can re-derive. 820. Resurrection. Apache two point zero."
        ),
        cues=[
            "For a finance team this replaces retyping a payment file into a spreadsheet.",
            "820. Resurrection. Apache 2.0.",
        ],
    ),
]
