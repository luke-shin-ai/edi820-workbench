# Shot list for the 「820」 demo video (target 2:30 - 2:50, hard limit 3:00).
#
# Every plate is built from real material: the fixture files as they are on disk, the copybook
# as it is on disk with offsets taken from the compiler's own output, screenshots of the running
# screen, and captured stdout of the real commands. Nothing is redrawn by hand.

SHOTS = [
    dict(
        id="s01",
        plate="raw-file",
        accent="#6BA8FF",
        zoom=(1.02, 1.06),
        focus=(0.45, 0.35),
        narration=(
            "Corporate payment files still arrive like this. One hundred bytes per record, "
            "no field names, no separators. What each byte means lives in a COBOL copybook, "
            "and the people who could read it are retiring."
        ),
        cues=[
            "Corporate payment files still arrive like this.",
            "One hundred bytes per record. No field names, no separators.",
            "What each byte means lives in a COBOL copybook, and the people who could read it are retiring.",
        ],
    ),
    dict(
        id="s02",
        plate="copybook",
        accent="#6BA8FF",
        zoom=(1.03, 1.09),
        focus=(0.40, 0.30),
        narration=(
            "This is that copybook. Amount is eleven digits with two implied decimals, and the sign "
            "is folded into the last digit. It defines bytes and widths. It says nothing about what "
            "must be true of the numbers."
        ),
        cues=[
            "This is that copybook.",
            "Amount: eleven digits, two implied decimals, sign folded into the last digit.",
            "It defines bytes and widths. It says nothing about what must be true of the numbers.",
        ],
    ),
    dict(
        id="s03",
        plate="pass-full",
        accent="#3FB950",
        zoom=(1.00, 1.02),
        focus=(0.50, 0.45),
        narration=(
            "820 reads the file through the copybook. Ten payment details, one trailer. The trailer "
            "declares one million two hundred eighty four thousand five hundred fifty dollars, and "
            "the details sum to exactly that. Ten references matched, zero findings, verdict pass."
        ),
        cues=[
            "820 reads the file through the copybook.",
            "Ten payment details, one trailer. Declared 1,284,550.00, summed the same.",
            "Ten references matched. Zero findings. Verdict: pass.",
        ],
    ),
    dict(
        id="s04",
        plate="fail-findings",
        accent="#F85149",
        zoom=(1.00, 1.04),
        focus=(0.5, 0.35),
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
        id="s05",
        plate="evidence-bytes",
        accent="#D29922",
        zoom=(1.02, 1.07),
        focus=(0.45, 0.30),
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
        id="s06",
        plate="guarantees",
        accent="#D29922",
        zoom=(1.00, 1.05),
        focus=(0.5, 0.4),
        narration=(
            "The same screen says where the guarantee stops. It does not judge legal or accounting "
            "adequacy, and no exception can exist without a reason, an expiry date and a compensating "
            "control. That decision stays with a human."
        ),
        cues=[
            "The same screen says where the guarantee stops.",
            "It does not judge legal or accounting adequacy.",
            "No exception without a reason, an expiry date and a compensating control. That stays with a human.",
        ],
    ),
    dict(
        id="s07",
        plate="verify",
        accent="#3FB950",
        zoom=(1.02, 1.07),
        focus=(0.35, 0.35),
        narration=(
            "Verify re-runs the deterministic layers from the recorded inputs and compares a SHA-256 "
            "fingerprint. Identical fingerprint, identical verdict, and the report file is not touched."
        ),
        cues=[
            "Verify re-runs the deterministic layers from the recorded inputs.",
            "Same fingerprint, same verdict, and the report file is not touched.",
        ],
    ),
    dict(
        id="s08",
        plate="tests",
        accent="#3FB950",
        zoom=(1.02, 1.07),
        focus=(0.35, 0.45),
        narration=(
            "Property based tests hold the parser: any generated file comes back byte identical after "
            "parse and re-serialize. Two hundred twenty two tests. They found real defects, including "
            "an overpunch table that mapped A to zero instead of plus one."
        ),
        cues=[
            "Property based tests hold the parser: any generated file comes back byte identical.",
            "222 tests. They found real defects, including an overpunch table that mapped A to zero instead of plus one.",
        ],
    ),
    dict(
        id="s09",
        plate="bai2",
        accent="#6BA8FF",
        zoom=(1.00, 1.05),
        focus=(0.5, 0.4),
        narration=(
            "Three byte layouts share one reconciler. Trailing overpunch. Packed decimal with no line "
            "breaks, where a newline byte can sit inside an amount. And BAI2, a comma delimited bank "
            "statement with no copybook at all, read by its own reader."
        ),
        cues=[
            "Three byte layouts share one reconciler. Trailing overpunch. Packed decimal with no line breaks.",
            "And BAI2, a comma delimited bank statement with no copybook, read by its own reader.",
        ],
    ),
    dict(
        id="s10",
        plate="kiro",
        accent="#6BA8FF",
        zoom=(1.00, 1.05),
        focus=(0.5, 0.35),
        narration=(
            "Kiro is in the repository, not in the pitch. The spec in dot kiro was the contract for "
            "every layer. Steering files set the parsing rules, and hooks and a reviewer agent sit "
            "beside them. With read tools that reviewer found two real defects. Without them, it wrote "
            "a confident review of code it had never opened."
        ),
        cues=[
            "Kiro is in the repository, not in the pitch. The spec in .kiro was the contract for every layer.",
            "Steering files set the parsing rules. Hooks and a reviewer agent sit beside them.",
            "With read tools the reviewer found two real defects.",
            "Without them, it wrote a confident review of code it had never opened.",
        ],
    ),
    dict(
        id="s11",
        plate="end",
        accent="#3FB950",
        zoom=(1.00, 1.04),
        focus=(0.5, 0.45),
        narration=(
            "For a finance team this replaces retyping a payment file into a spreadsheet with a verdict "
            "anyone can re-derive. 820. Resurrection. Apache two point zero."
        ),
        cues=[
            "For a finance team this replaces retyping a payment file into a spreadsheet.",
            "820. Resurrection. Apache 2.0.",
        ],
    ),
]
