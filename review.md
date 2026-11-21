# Self review (T6.3)

Cold scoring of the build as it stands on 2026-11-21, against the five criteria in
`rules-and-specs.md` §6 (each 20%) and the submission checklist in §5. Scores are what I would give
this submission if I were a judge with the repository and no conversation with the author.

## 1. Submission checklist

| Requirement (rules §5) | Status | Where |
|---|---|---|
| Public GitHub repository | **not yet** (local repository, clean tree) | blocked on the account holder: pushing publishes a personal GitHub account, so it is their call |
| Open source license visible in About | file present, Apache-2.0 | `LICENSE`, `package.json` |
| `/.kiro` at the repository root, not gitignored | pass | `.kiro/` (10 tracked files), `.gitignore` carries an explicit "never add .kiro" comment |
| Working application URL | **none, by design** | the screen binds to `127.0.0.1`; the repository has a one command start. Residual risk: a judge who will not run code has nothing to click |
| Feature description | pass | `README.md`, `devpost-submission-draft.md` |
| Demo video under 3 minutes | pass, 2:41 | `demo-video/820-demo-en.mp4` (17.1 MB, 1920x1080, 30 fps) |
| Video public on YouTube | **not yet** | local file only; publishing is a named external act |
| English | pass | all artifacts |
| Kiro write-up, all topics | pass (8 topics + vibe comparison) | `devpost-submission-draft.md` |
| Category identified | Resurrection | — |
| Free access for judging | pass if the judge runs Node 22 (no network, no credentials) | `README.md` |

## 2. Scores

| Criterion | Score | Why | What would move it |
|---|---|---|---|
| Potential Impact | **8.0** | A real daily job with a real cost, and the tool runs offline on files that must not leave the machine. Ten payments and six scenarios demonstrate it, but every file is synthetic and no bank dialect was tested | one real (anonymised) bank file and a time-to-read measurement |
| Technological Implementation | **7.0** | Spec (24 requirements), five steering files, a custom agent that found two real defects, six property suites, an MCP server and a CLI were all actually built. But the Kiro surface executed is the CLI only: no IDE session, hooks committed but not observed firing, powers unused, MCP not attached to a Kiro agent | a Kiro session where `PostTaskExecution` writes the evidence rows and the reviewer agent calls `reconcile` over MCP |
| Design | **8.5** | One page, three columns, byte-level evidence, the guarantee boundary printed on the same screen, empty and error states that are real captures rather than mockups | a keyboard path and a per-record filter for larger files |
| Innovation / Idea | **8.0** | "The copybook is the key, the spec is what you write down" is a sentence a judge can repeat, and the split between a layer that decides and a layer that narrates is the point of the product, not a wrapper | a second copybook dialect (REDEFINES) treated properly |
| Presentation | **8.5** | 2:41, real screens and real command output, English narration and burned subtitles, no music, and a section that states what the build does not claim | a human voice track |

**Average 8.0.** The strategy set 8.0 as the target and 7.0 as the floor for a criterion needing
repair; no criterion is below the floor, and the weakest axis (Kiro depth) is a fact about the
session I could run, not about the artifacts.

## 3. Repairs made in this pass

Applied immediately, not queued:

1. **Video is now referenced from the README** with its length and size, so a judge who only opens
   the repository sees that a demonstration exists. (`README.md`, "Watch it")
2. **Empty and error states captured from the running screen** and committed next to PASS and FAIL,
   which is what the Design claim rests on. (`docs/images/ui-empty.png`, `docs/images/ui-error.png`)
3. **A three minute path for a judge** added to the README: one command, one sample, the exact
   expected output. The missing hosted URL is the single biggest checklist gap and this is the only
   honest mitigation available.
4. **The claim ledger** in `docs/kiro-cli-validation.md` §4 and `devpost-submission-draft.md` (final
   section) now lists the four claims that are not made, in one place, so a reviewer does not have
   to discover them.
5. **`EVIDENCE.md` structure fixed**: the defect list had been interleaved into the middle of the
   log table by later appends, which made the append-only record look edited. The table is
   contiguous again and the T6 rows are appended at the end with their real commands.

## 4. What a cold judge would still mark down

- **No hosted URL.** The rules ask for one. A local-only tool is a defensible product decision for
  payment files, and it is stated in the README, the video and the submission draft, but it costs
  presentation points with a judge who will not run Node.
- **No real-world file.** Every fixture is synthetic and every defect is documented. That is good
  practice for a public repository, and it is still not the same as a bank dialect nobody wrote.
- **The video voice is synthesised.** It is clear and consistent, and it is not the author.
- **Kiro credits were never spent.** The free tier was enough because the deterministic default
  costs nothing, which is a design choice that also means the Kiro-heavy paths (IDE, hooks firing
  in a session) stayed unexercised.

## 5. Next actions by owner

| Action | Owner | Why it cannot be done here |
|---|---|---|
| Publish the repository (public, Apache-2.0 in About) | account holder | it publishes an identity and a history in their name |
| Upload the video to YouTube as public | account holder | a public upload in their name |
| Create the Devpost project and paste the draft | account holder | final submission of a named entry |
| Run one Kiro session with the hooks live, then append those rows | agent, needs a credit-granted session | a 4,000 credit request is pending; the free plan is 50 credits/month |
