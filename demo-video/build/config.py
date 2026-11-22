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
            "agent stopped, the stop hook re-derived the newest verdict and compared the "
            "fingerprint. Both lines are committed, and the transcript is in docs as an excerpt."
        ),
        cues=[
            "This is the hook log from a real Kiro session.",
            "A file save ran the tests. The stop hook re-derived the newest verdict.",
            "Both lines are committed, and the transcript is in docs as an excerpt.",
        ],
    ),
    dict(
        id="s02",
        plate="mcp-call",
        accent="#6BA8FF",
        zoom=(1.02, 1.07),
        focus=(0.35, 0.35),
        narration=(
            "The reviewer agent did not describe the code from memory: it called the project's own "
            "MCP server. This is that call replayed, and the verdict, the finding count and the "
            "fingerprint are the engine's own."
        ),
        cues=[
            "This is a replay of the reviewer agent's MCP calls.",
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
            "What each byte means lives in a COBOL copybook. This bank copybook gives a record "
            "one area of a hundred bytes and two meanings: the payment, and the trailer, "
            "declared with REDEFINES. The type byte picks the layout, and the copybook must say so."
        ),
        cues=[
            "What each byte means lives in a COBOL copybook.",
            "One area of a hundred bytes, two meanings: the payment, and the trailer declared with REDEFINES.",
            "The type byte picks the layout, and the copybook must say so.",
        ],
    ),
    dict(
        id="s03b",
        plate="static-redefines",
        accent="#D29922",
        zoom=(1.04, 1.11),
        focus=(0.62, 0.26),
        narration=(
            "Here is the trailer, read through its own layout: total amount at bytes twenty two "
            "to thirty four, and the record count. The detail fields that share those bytes are "
            "not decoded at all for this record."
        ),
        cues=[
            "Here is the trailer, read through its own layout.",
            "Total amount at bytes 22 to 34, and the record count.",
            "The detail fields sharing those bytes are not decoded for this record.",
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
            "Three hundred eleven tests, property based where it matters. A truncated record used to "
            "pass with zero findings; it now reports incomplete and exits non zero. A report "
            "verifies from any working directory."
        ),
        cues=[
            "311 tests, property based where it matters.",
            "A truncated record used to pass with zero findings; it now reports incomplete.",
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
            "The exception register came from Kiro, spec task seven point one. Task nine point "
            "five ran through Kiro's task runner, and the task hook wrote its evidence row. "
            "Excerpts of the transcript, the hook firings and the MCP calls are in docs. "
            "Steering set the rules; the spec was the contract."
        ),
        cues=[
            "The exception register came from Kiro, spec task 7.1.",
            "Task 9.5 ran through Kiro's task runner: the task hook wrote its evidence row.",
            "Excerpts of the transcript, the hook firings and the MCP calls are in docs.",
            "Steering set the rules, and the spec was the contract.",
        ],
    ),
    dict(
        id="s12",
        plate="end",
        accent="#3FB950",
        zoom=(1.00, 1.04),
        focus=(0.5, 0.45),
        narration=(
            "For a finance team this replaces retyping a payment file into a spreadsheet. "
            "820. Resurrection. Apache two point zero."
        ),
        cues=[
            "For a finance team this replaces retyping a payment file into a spreadsheet.",
            "820. Resurrection. Apache 2.0.",
        ],
    ),
]
