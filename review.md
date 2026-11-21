# Self review, re-scored after the T7 upgrade

Cold scoring of the build as it stands on 2026-11-21 19:00, against the five criteria (each 20%) and
the submission checklist. The first version of this file scored the artefacts 8.0 average. An
external review (`gcp-hermes-grand-prize-review.md`, not in the public repository) put the same build
at **6.4** and argued the gap was Technological Implementation and Presentation: the rules buy
*Kiro usage* and *an experience a judge can have*, not build quality. That review was right, so the
scores below start from its numbers and are moved only by work that is now in the repository.

## 1. Submission checklist

| Requirement | Status | Where |
|---|---|---|
| Public GitHub repository | **not yet** (local, clean tree) | pushing publishes a personal account, so it is the account holder's call |
| Open source license in About | file present, Apache-2.0 | `LICENSE`, `package.json` |
| `/.kiro` at the root, not gitignored | pass | `.kiro/` tracked, `.gitignore` carries an explicit "never add .kiro" note |
| Working application URL | **built, not deployed** | `docs/demo/index.html` is a static, client-side build of the same engine, verified in Chromium at 1920. Deploying it (GitHub Pages or Cloudflare Pages) is one step and the account holder's act |
| Feature description | pass | `README.md`, `devpost-submission-draft.md` |
| Demo video under 3 minutes | pass, 2:52 | `demo-video/820-demo-en.mp4` (19.5 MB, 1920x1080, 30 fps, 38 cues) |
| Video public on YouTube | **not yet** | local file; publishing is a named external act |
| English | pass | all artefacts |
| Kiro write-up, all topics | pass, and now with session evidence | `devpost-submission-draft.md` §3, §6, §8 and the final list |
| Category identified | Resurrection | — |
| Free access for judging | pass with Node 22, and now also with no Node at all | `docs/demo` needs only a browser |

## 2. Scores

| Criterion | Was (cold) | Now | Why the movement | What is still missing |
|---|---|---|---|---|
| Potential Impact | 7.0 | **7.0** | unchanged: the job is real and the tool runs where the file is, but every fixture is synthetic and no time-to-read was measured | one anonymised real dialect, and a measured minutes-per-file number |
| Technological Implementation | 4.0 | **7.0** | the rules ask "how thoroughly and skillfully does the project use Kiro". Now: a Kiro CLI V3 session implemented layer 4 from spec task T7.1 (`src/exception` 384 lines, CLI commands, MCP tool, 38 tests); `PostFileSave` and `Stop` hooks fired inside sessions and logged; the reviewer agent called `@820/reconcile`, `@820/verify` and `@820/exceptions` and got the engine's answer. Not 8 or 9 because the IDE and Web surfaces were still not used, `PostTaskExecution` never fired, and powers were not used | one spec run through Kiro's task runner, and one IDE session |
| Design | 8.0 | **8.5** | the screen is no longer only a claim: `docs/demo` is clickable with six scenarios, a drop zone that keeps bytes intact, and an exception panel; the totals row now states its comparison basis and the credit/debit split | a keyboard path and a record filter for large files; the deployed URL |
| Innovation / Idea | 7.5 | **8.0** | the fourth layer is real now: a finding cannot be cleared by a model, a waiver needs an owner, a reason, a compensating control and an expiry, and an append-only hash chain makes an edit after the fact visible. "The verdict is code, the exception is a person, and the record cannot be rewritten" is one sentence | a second copybook dialect (REDEFINES) |
| Presentation | 5.5 | **7.5** | the opening 25 seconds are the hook log and the MCP call from a real session, the product arrives at 0:25 on a screen a judge can also open, the BAI2 delta names its parts, and the register gets a scene of its own. 2:52, 38 cues, no em dashes, no emoji | the voice is synthesised, and a hosted URL would let a judge click before watching |

**Average 7.6 (76 / 100)**, up from the cold 6.4. The movement is entirely in the two axes the
external review identified, which is the point: the remaining work was never about the code.

What has *not* changed, stated plainly: the samples are synthetic, the video's voice is not the
author's, powers are unused, and the deployment and upload are still the account holder's acts. Those
are reasons this is not a 9.

## 3. Repairs made in this pass

1. **Verdict integrity.** A truncated record used to produce `verdict: PASS` with zero findings; it
   now yields `INCOMPLETE` and exit 2, with the blocking issues inside the fingerprint. Regression
   tests in `test/regressions/verdict-integrity.test.ts`.
2. **`verify` is independent of the working directory.** Reports record repository-relative paths and
   resolution falls back through the report's own ancestors; the same command run from `/tmp` prints
   `RESULT: identical`.
3. **BAI2 comparison basis is named.** `03`/`100` declares gross credits while the details net
   credits against debits; the reader now keeps gross credit and debit totals and the S6 finding
   reads `credits 1,205,550.00 minus debits 25.00`, delta `-79,025.00`. `samples/data/DEFECTS.md`
   had said `-81,500.00`, which double-counted the 25.00 fee.
4. **The drop zone keeps bytes.** `file.text()` was a UTF-8 read in front of a latin1 parser, so a
   COMP-3 amount was corrupted on the way in; dropped files now travel as base64 of raw bytes, and a
   test asserts the dropped COMP-3 file parses to the same hash as the same file read by path.
5. **The hooks are corrected and observed.** The stop hook's command pointed at a module with no
   entry point (0 bytes, exit 0) and at `out/` rather than `out/<timestamp>/`; the trigger was
   `AgentStop`, which never fires on CLI V3. Both are fixed, every firing is logged, and the log is
   quoted in `docs/kiro-session-evidence.md`.
6. **The MCP server is attached.** `.kiro/settings/mcp.json` plus `includeMcpJson` and `@820` in the
   reviewer agent. Three real calls are recorded, and `scripts/mcp-call.mjs` reproduces them outside
   an agent.
7. **A clickable surface exists.** `docs/demo` is built by `scripts/build-static.ts` and verified by
   `scripts/check-static.py`, which asserts every scenario's fingerprint equals the CLI's and that no
   request leaves the tab after load.

## 4. What a cold judge would still mark down

- **The URL is not live yet.** The build exists and is verified, and the checklist row still reads
  "not deployed" until someone deploys it.
- **Synthetic only.** No real bank dialect; the fixtures are documented and generated.
- **Synthesised voice.**
- **`PostTaskExecution` unobserved,** so the EVIDENCE rows for T7 are written by the hook's script
  invoked from the CLI, marked with the session they came from.
- **Two of the six repairs are mine, not Kiro's.** `docs/kiro-session-evidence.md` §4.1 lists them
  by name, because "the agent wrote it" would be a false claim about six specific changes.

## 5. Next actions by owner

| Action | Owner | Why it cannot be done here |
|---|---|---|
| Publish the repository (public, Apache-2.0 in About) | account holder | publishes an identity and a history in their name |
| Deploy `docs/demo` to GitHub Pages or Cloudflare Pages | account holder | a public deployment under their account |
| Upload the video to YouTube as public | account holder | a public upload in their name |
| Create the Devpost project and paste the draft | account holder | final submission of a named entry |
| One IDE session, and one spec run through Kiro's task runner | agent, with the account holder's go ahead | needs a plan that includes the IDE surface; the free allowance is small |
