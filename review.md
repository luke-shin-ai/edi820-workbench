# Self review, re-scored after the red-team pass (T8)

Cold scoring of the build as it stands on 2026-11-21 20:30, against the five criteria (each 20%) and
the submission checklist. The first version of this file scored the artefacts 8.0 average. An
external review (`gcp-hermes-grand-prize-review.md`, not in the public repository) put the same build
at **6.4** and argued the gap was Technological Implementation and Presentation: the rules buy
*Kiro usage* and *an experience a judge can have*, not build quality. The T7 pass moved the scores
to 7.6. This pass is the red-team follow-up: two features a reviewer asked for, and a document that
stops over-claiming in the wrong direction.

## 1. Submission checklist

| Requirement | Status | Where |
|---|---|---|
| Public GitHub repository | **not yet** (local, clean tree) | pushing publishes a personal account, so it is the account holder's call |
| Open source license in About | file present, Apache-2.0 | `LICENSE`, `package.json` |
| `/.kiro` at the root, not gitignored | pass | `.kiro/` tracked, `.gitignore` carries an explicit "never add .kiro" note |
| Working application URL | **built, not deployed** | `docs/demo/index.html`, a static client-side build of the same engine, verified in Chromium at 1920 across eight scenarios. Deploying it is one step and the account holder's act |
| Feature description | pass | `README.md`, `devpost-submission-draft.md` |
| Demo video under 3 minutes | pass, 2:55 | `demo-video/820-demo-en.mp4` (19.2 MB, 1920x1080, 30 fps, 40 cues) |
| Video public on YouTube | **not yet** | local file; publishing is a named external act |
| English | pass | all artefacts |
| Kiro write-up, all topics | pass, with session evidence | `devpost-submission-draft.md` §3, §6, §8 and the closing section |
| Category identified | Resurrection | — |
| Free access for judging | pass with Node 22, and with no Node at all | `docs/demo` needs only a browser |

## 2. Scores

| Criterion | Cold | After T7 | Now | Why the movement | What is still missing |
|---|---|---|---|---|---|
| Potential Impact | 7.0 | 7.0 | **7.2** | the bank's own copybook shape (`REDEFINES`, group items, a trailer that shares the detail's bytes) is now read, not refused; that is the shape most real 820 dialects actually use | an anonymised real dialect, and a measured minutes-per-file number |
| Technological Implementation | 4.0 | 7.0 | **7.4** | +0.4 on 2026-11-22: a spec task now runs through Kiro's own task tools (`--mode spec`, `task_update`), so the task hook fires and writes its own evidence row; the other two hooks were already observed, and `REDEFINES` is product depth, not Kiro surface, and is not double-counted | one IDE session |
| Design | 8.0 | 8.5 | **8.6** | eight scenarios; clicking a record now shows how *that* record was sliced, which is the screen's whole argument and is what makes the two-layout trailer visible; subtitle box so the narration is readable over a dense UI | a keyboard path and a record filter for large files; the deployed URL |
| Innovation / Idea | 7.5 | 8.0 | **8.2** | "the same hundred bytes, twice, and the copybook must say which layout a record uses" is a sharper idea than "we parse copybooks", and the refusal of an unbound `REDEFINES` is a design position, not a limitation | a second dialect beyond `REDEFINES` (`OCCURS DEPENDING ON`) |
| Presentation | 5.5 | 7.5 | **7.8** | the opening 26 seconds are still the hook log and the MCP replay; the copybook scene now *shows* the two layouts with the compiler's own byte ranges, and a second scene reads the trailer through its layout. 2:55, 40 cues, no em dashes, no emoji | the voice is synthesised, and a hosted URL would let a judge click before watching |

**Average 7.9 (79 / 100)**, up from 7.8 after the red-team pass of 2026-11-22 (Technological
Implementation 7.0 to 7.4: the task runner is no longer a surface this build left unused). The
movement is small on purpose: the remaining points are in the IDE surface and in hosting, not in
features.

What has *not* changed, stated plainly: the samples are synthetic, the voice is not the author's,
powers are unused, and deployment and upload are the account holder's acts. Those are reasons this
is not a 9.

After the red-team pass of 2026-11-22 the two items this file used to list as missing are closed:
`PostTaskExec` fires (task T9.5 run through Kiro's own task tools, §8 of the session evidence), and
the documents no longer claim more than the code does (13 corrections, `design.md` §15).

## 3. What the REDEFINES pass changed

1. **`REDEFINES` is supported, with a rule instead of a guess.** The compiler reads a `REDEFINES`
   line as a region of shared bytes with two layouts, requires the copybook to declare which record
   type selects which layout (`* @view`), refuses an unbound `REDEFINES` (`COPYBOOK_SEMANTICS`), a
   layout wider than the bytes it claims (`COPYBOOK_REDEFINES`), and a discriminator inside its own
   region. The parser decodes exactly one layout per record; the other layout's fields are absent,
   and a record whose type byte matches no layout is `REDEFINES_VIEW_UNMATCHED`, a blocking issue
   that cannot earn a PASS.
2. **Product evidence, not just tests.** `samples/copybooks/820-redefines.cpy` plus a good and a bad
   fixture; two static scenarios (S7 PASS, S8 FAIL with `TOTAL-AMOUNT` at bytes 22-34 and a 100.00
   delta); a copybook plate and a trailer plate in the video.
3. **No fingerprint drift.** The `views:` component is added to the fingerprint only for copybooks
   that declare a region, and `test/regressions/redefines-view.test.ts` pins all six pre-existing
   scenario fingerprints, so a report recorded yesterday still verifies today.
4. **`L3 · mock` is gone.** The default explanation layer is `L3 · grounded`: a deterministic,
   zero-credit template whose numbers come from the finding, named for what it is. The old label
   invited a judge to read the layer as a mock-up.
5. **The submission text matches the video.** §9 describes the 2:55 cut shot by shot, and the
   closing section now opens with how spec, steering, the custom agent, hooks, MCP and the CLI
   combine, then lists the five boundaries plainly. Honesty is kept; self-deprecation is not the
   first thing a judge reads.
6. **The guarantees file and the screen agree.** `docs/guarantees.md` no longer says `REDEFINES` is
   refused; both strips, `820 verify` and the README read from that one file, so the claim and the
   code cannot drift apart silently.

## 3b. What the red-team pass changed (2026-11-22)

The second external review found 13 places where the documents were stronger than the code. All of
them are closed, and three were code rather than wording:

1. **A waiver needs an expiry.** The promise was in `docs/guarantees.md`, the submission text and the
   on-screen register; the code accepted `(no expiry)`. The code moved: module, CLI and browser refuse
   it, exit 3 from the CLI, and R8.1/R8.2/R8.4 say so.
2. **A declared total is never compared against another currency.** `Object.keys(buckets)[0]` used to
   substitute a bucket, so an all-EUR file with a USD declaration could PASS. `MISSING_CURRENCY` (R4.6)
   is a finding now, and the summary row says "not compared".
3. **A reference fragment is not a record number.** The L3 guard split its vocabulary into values and
   identifier tokens, so `Record 11` no longer passes on the strength of a reference ending `0011`.
4. **The documents follow the code.** Exit codes `0/2/3`, 33 requirements in seven groups, tasks to
   T9.5, 311 tests with 31 properties, the streaming claim removed (`design.md` §9), the captions
   that said the transcript was "in the repository" corrected, and the MCP scene labelled as the
   replay it is.
5. **A checker for the next drift.** `npm run check:claims` compares every published count against the
   repository and fails the build when they differ, so the class of defect does not come back.

## 4. What a cold judge would still mark down

- **The URL is not live yet.** The build exists and is verified, and the checklist row still reads
  "not deployed" until someone deploys it.
- **Synthetic only.** Every dialect is documented and generated; no real bank file was read.
- **Synthesised voice.**
- **The T7 EVIDENCE rows are hand-run.** The task hook fires now (T9.5), but the T7.1 rows were
  written by the hook's own script invoked from the CLI, and they still say so.
- **`OCCURS DEPENDING ON` is refused.** It changes every offset after it and needs a decided rule;
  saying so is better than a table that mis-slices, but it is still a closed door.

## 5. Next actions by owner

| Action | Owner | Why it cannot be done here |
|---|---|---|
| Publish the repository (public, Apache-2.0 in About) | account holder | publishes an identity and a history in their name |
| Deploy `docs/demo` to GitHub Pages or Cloudflare Pages | account holder | a public deployment under their account |
| Upload the video to YouTube as public | account holder | a public upload in their name |
| Create the Devpost project and paste the draft | account holder | final submission of a named entry |
| One IDE session | account holder | the IDE surface is a paid plan; every CLI surface is already evidenced |
