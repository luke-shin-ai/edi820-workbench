# Kiro CLI validation (2026-11-21, task §2 of the build brief)

Binary: `/workspace/.tools/kiro/kirocli/bin/kiro-cli` **3.5.0** (Linux x86_64).
Everything below was run from the repository root, and the credit cost was deliberately
kept at one short smoke call: the account is on the **50-credits/month free plan** while the
4,000-credit request is pending, so the goal was *proving the tooling loads*, not spending it.

## 1. Session identity

```console
$ kiro-cli --version
kiro-cli 3.5.0

$ kiro-cli whoami
Logged in with Builder ID
Email: ya***@gmail.com        # redacted in this file; the exact address lives in the
                             # workspace's non-public procedure-status.md
```

The email matches the account the credits were requested for. The address is redacted here because
this repository is destined to be public and a personal mailbox does not need to be in it.
Note for the write-up: the session is a **Builder ID** session, not an `app.kiro.dev` Google
web session - both resolve to the same Kiro account email, and the CLI is the surface the
submission needs (the web IDE requires Pro).

## 2. The custom agent is discovered and valid

```console
$ kiro-cli agent list
Workspace: ~/hackathons/kiroween-2026/.kiro/agents
Global:    ~/.kiro/agents

* kiro_default    (Built-in)    Default agent
  kiro_help       (Built-in)    Help agent that answers questions about Kiro CLI features using documentation
  kiro_planner    (Built-in)    Specialized planning agent that helps break down ideas into implementation plans
  reviewer        Workspace     Adversarial cross-review agent for 「820」. It reads only the spec artifacts and the
                                 deterministic layer's findings, then tries to break the claims: unsupported numbers,
                                 silent re-sync, dropped references, float money, missing guarantees.

$ kiro-cli agent validate --path .kiro/agents/reviewer.json ; echo $?
0
```

Validation is not a no-op - a deliberately broken config fails with a schema error and a
non-zero exit, which is what makes the `0` above meaningful:

```console
$ echo '{"name":"broken","resources":"not-an-array","prompt":42}' > /tmp/broken-agent.json
$ kiro-cli agent validate --path /tmp/broken-agent.json ; echo $?
Error: Json supplied at /tmp/broken-agent.json is invalid: invalid type: string "not-an-array", expected a sequence at line 1 column 43
1
```

Two notes for the write-up, stated honestly:

- `kiro-cli agent validate <path>` (positional) does **not** work on 3.5.0; the flag is
  `--path`. The error message suggested `kiro-cli update`, which we did not run (pinning
  3.5.0 keeps the build reproducible).
- `agent list` only finds local agents when it is invoked **from the directory that contains
  `.kiro/agents`** - a small operational detail worth knowing for CI.

## 3. One smoke call, cheapest model

```console
$ kiro-cli chat --agent reviewer --no-interactive --model qwen3-coder-next \
    --trust-tools= --trust-workspace "Reply with exactly one line: READY (reviewer agent loaded). Do not read files."
READY (reviewer agent loaded).
```

- `--model qwen3-coder-next` is the 0.05x credit model (see `--list-models`), and
  `--trust-tools=` grants no tools, so the turn could not read or write anything.
- This proves the custom agent loads end-to-end through the CLI, which is what the
  submission's "custom agent" claim rests on. It cost a fraction of a credit.
- Full log (including the login history that led here): `logs/kiro-agent-smoke.log`
  (gitignored - it stays in the workspace).

Models visible on the free plan at validation time: `auto` (1.00x), `claude-sonnet-4.5`
(1.30x), `claude-haiku-4.5` (0.40x), `deepseek-3.2` (0.25x), `minimax-m2.5` (0.25x),
`minimax-m2.1` (0.15x), `glm-5` (0.50x), `qwen3-coder-next` (0.05x).

## 4. What this validation does and does not establish
| Claim | Status |
|---|---|
| Kiro CLI 3.5.0 runs and is logged in as the credit-request account | **verified** |
| `.kiro/agents/reviewer.json` is schema-valid and discovered as a workspace agent | **verified** |
| A chat turn with that agent completes headlessly (`--no-interactive`) | **verified** (1 call) |
| `hooks` fire inside a Kiro session | **not yet verified** - hooks load only in an interactive/trusted workspace session; that is the next evidence to collect when the credit grant lands |
| A full spec-driven build inside Kiro (spec -> tasks -> implementation) | **not yet** - T1-T3 were implemented in this workspace and committed with the `.kiro` spec as the contract; the write-up must say exactly that rather than claim Kiro generated the code |

## 5. The reviewer agent, run three times: including the run that was wrong

This is the most useful evidence in the file, because it shows the failure mode the product itself
is built against: **a model narrating confidently about code it has not read.**

### Pass 1: `qwen3-coder-next` (0.05x), no tools declared in the agent config

The agent answered with a tool call printed as text (`<tool_call>file-reading-tool ...`) that never
executed, then stopped. Cost: a fraction of a credit. Diagnosis: `.kiro/agents/reviewer.json` had no
`tools` array, so the agent had no way to read a file - the schema's tool names are `read`, `grep`,
`glob`, `thinking` (`~/.kiro/agents/agent_config.json.example`).

### Pass 2: `claude-haiku-4.5` (0.40x), still no tools in the config, `--trust-tools=fs_read`

A fluent, detailed review with file and line citations - **and it was wrong**:

| Its claim | Reality |
|---|---|
| BLOCKER: "no decoder exists for zoned/packed; `parseField()` returns `value as number`" | `decodeZonedDecimal` / `decodePackedDecimal` exist in `src/parser/decode.ts`; `parseField()` does not exist |
| MAJOR: "invalid overpunch returns `0n` silently" | `decodeZonedDecimal` throws `FieldDecodeError`, the parser turns that into `FIELD_INVALID_NUMERIC`; `test/unit/overpunch.test.ts` asserts it |
| MAJOR: "`CURRENCY_SCALE_MISMATCH` is emitted nowhere" | It is emitted in `src/parser/parser.ts` and covered by a test |
| MINOR: "blank reference could match another blank reference" | The opposite was true - a blank reference was **skipped entirely** |

Three of four claims were false because it never read the files; the fourth pointed at a real hole from
the wrong direction. **This is why the product's L3 layer may only cite numbers the deterministic layers
produced**: a reviewer's confidence is not evidence.

### Pass 3: same model, config fixed (`tools: [read, grep, glob, thinking]`, prompt told to read first)

```console
$ kiro-cli chat --agent reviewer --no-interactive --model claude-haiku-4.5 \
    --trust-tools=read,grep,glob "Review only src/reconcile/reconciler.ts and src/parser/decode.ts. Read them first..."
[tool] Reading reconciler.ts:1, decode.ts:1
[tool] status: Completed
```

This time the citations match the code. Findings kept:

1. **MINOR - real:** `summary.referencesMatched` was computed by subtracting findings whose `detail`
   string contains `820-only`. String-matching a human sentence to derive a number is exactly the
   fragility the project is against; it is now counted inside the matching routine.
2. **Real gap found by pass 2 and confirmed by hand:** a record with a blank reference field was
   skipped, so it never appeared as `REF_UNMATCHED` - a silently dropped reference, against guarantee 3.
   Both are fixed with tests (`test/unit/reconcile.test.ts`, "reports a blank reference instead of
   letting two blanks agree", "counts matched references directly").

What this means for the write-up (T6.2): the custom agent is useful as a *second pair of eyes*, but only
when it is given read tools and told to read; unpinned, it produces plausible nonsense with line numbers.
That is a finding worth reporting, not hiding.
