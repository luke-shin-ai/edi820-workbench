#!/usr/bin/env node

import { execSync } from "child_process";
import { readFileSync, existsSync, mkdirSync } from "fs";

// Ensure .tmp directory exists
mkdirSync(".tmp", { recursive: true });

// Step 1: Run vitest and capture JSON
console.log("Running vitest...");
try {
  execSync(
    "npx vitest run --reporter=json --outputFile=.tmp/vitest-claims.json",
    { stdio: "inherit" }
  );
} catch (e) {
  // vitest exit code might be non-zero, but that's ok, we still have the file
}

// Read vitest results. The run above is what produces the file, so a missing file means the
// runner failed before it could report: say that, instead of failing with ENOENT halfway through
// a stack trace (the defect a cold run of this script used to hit, 2026-11-22).
const vitestPath = ".tmp/vitest-claims.json";
if (!existsSync(vitestPath)) {
  console.error(
    `check:claims: vitest wrote no JSON report to ${vitestPath}. Run \`npx vitest run\` on its own to see why.`
  );
  process.exit(1);
}
let vitestJson;
try {
  vitestJson = JSON.parse(readFileSync(vitestPath, "utf-8"));
} catch (error) {
  console.error(`check:claims: ${vitestPath} is not valid JSON: ${error.message}`);
  process.exit(1);
}
const numTotalTests = vitestJson.numTotalTests;
const testFiles = vitestJson.testResults.length;
if (typeof numTotalTests !== "number" || !Array.isArray(vitestJson.testResults)) {
  console.error("check:claims: the vitest report has no test totals; nothing to compare against.");
  process.exit(1);
}
console.log(`measured: ${numTotalTests} tests in ${testFiles} files, ${vitestJson.testResults.filter((f) => f.name.includes("/test/pbt/")).reduce((sum, f) => sum + (f.assertionResults ? f.assertionResults.length : 0), 0)} property tests`);

// Count property tests: all tests in /test/pbt/ directories
const numPropertyTests = vitestJson.testResults
  .filter((f) => f.name.includes("/test/pbt/"))
  .reduce((sum, f) => {
    return sum + (f.assertionResults ? f.assertionResults.length : 0);
  }, 0);

// Step 2: Count requirements
const requirementsFile = readFileSync(
  ".kiro/specs/edi820-importer/requirements.md",
  "utf-8"
);
const reqPattern = /\*\*R(\d+)\.(\d+)\*\*/g;
const reqs = [];
let match;
while ((match = reqPattern.exec(requirementsFile)) !== null) {
  reqs.push({ group: parseInt(match[1]), n: parseInt(match[2]) });
}

const totalReqs = reqs.length;
const coreReqs = reqs.filter((r) => r.group >= 1 && r.group <= 6).length;
const registerReqs = reqs.filter((r) => r.group === 8).length;
const distinctGroups = new Set(reqs.map((r) => r.group)).size;

// Step 3: Find highest task id
const tasksFile = readFileSync(
  ".kiro/specs/edi820-importer/tasks.md",
  "utf-8"
);
const taskPattern = /T(\d+)\.(\d+)/g;
let maxPhase = 0,
  maxN = 0;
while ((match = taskPattern.exec(tasksFile)) !== null) {
  const phase = parseInt(match[1]);
  const n = parseInt(match[2]);
  if (phase > maxPhase || (phase === maxPhase && n > maxN)) {
    maxPhase = phase;
    maxN = n;
  }
}
const maxTaskId = `T${maxPhase}.${maxN}`;

// Step 4: Scan published files for claims
const claims = [];

// README.md
const readmeContent = readFileSync("README.md", "utf-8");

// Look for test counts
const testCountMatches = readmeContent.match(/(\d+)\s+tests(?:\s*\/\s*(\d+)\s+files)?/g) || [];
testCountMatches.forEach((match) => {
  const parts = match.match(/(\d+)/g);
  if (parts.length === 1) {
    claims.push({
      file: "README.md",
      type: "total_tests",
      claimed: parseInt(parts[0]),
      measured: numTotalTests,
    });
  } else if (parts.length === 2) {
    claims.push({
      file: "README.md",
      type: "tests_and_files",
      claimed: `${parts[0]}/${parts[1]}`,
      measured: `${numTotalTests}/${testFiles}`,
    });
  }
});

// Look for "NN of them properties" or "NN property tests"
const propMatches =
  readmeContent.match(/(\d+)\s+(?:of them )?propert(?:ies|y tests)/g) || [];
propMatches.forEach((match) => {
  const num = parseInt(match.match(/(\d+)/)[0]);
  claims.push({
    file: "README.md",
    type: "property_tests",
    claimed: num,
    measured: numPropertyTests,
  });
});

// Look for requirement counts
const reqMatches = readmeContent.match(/(\d+)\s+(?:core\s+)?requirements?/g) || [];
reqMatches.forEach((match) => {
  if (match.includes("core")) {
    claims.push({
      file: "README.md",
      type: "core_reqs",
      claimed: parseInt(match.match(/(\d+)/)[0]),
      measured: coreReqs,
    });
  } else {
    claims.push({
      file: "README.md",
      type: "total_reqs",
      claimed: parseInt(match.match(/(\d+)/)[0]),
      measured: totalReqs,
    });
  }
});

// Look for task range like "T0.1 to TX.Y"
const taskRangeMatch = readmeContent.match(/T\d+\.\d+\s+to\s+T(\d+\.\d+)/);
if (taskRangeMatch) {
  claims.push({
    file: "README.md",
    type: "max_task_id",
    claimed: `T${taskRangeMatch[1]}`,
    measured: maxTaskId,
  });
}

// devpost-submission-draft.md
const devpostContent = readFileSync("devpost-submission-draft.md", "utf-8");
const devpostLines = devpostContent.split("\n");

// Extract lines that mention test counts but aren't phase-specific (like "38 tests) from spec task T7.1")
const devpostLinesForClaims = devpostLines
  .map((line) => {
    // Skip lines that mention "T7.1" or other phase tags to avoid phase-specific counts
    if (line.match(/\bT\d+\.\d+\b/)) {
      return "";
    }
    return line;
  })
  .join("\n");

const devpostTestMatches =
  devpostLinesForClaims.match(/(\d+)\s+tests(?:\s*\/\s*(\d+)\s+files)?/g) || [];
devpostTestMatches.forEach((match) => {
  const parts = match.match(/(\d+)/g);
  if (parts.length === 1) {
    claims.push({
      file: "devpost-submission-draft.md",
      type: "total_tests",
      claimed: parseInt(parts[0]),
      measured: numTotalTests,
    });
  } else if (parts.length === 2) {
    claims.push({
      file: "devpost-submission-draft.md",
      type: "tests_and_files",
      claimed: `${parts[0]}/${parts[1]}`,
      measured: `${numTotalTests}/${testFiles}`,
    });
  }
});

const devpostPropMatches =
  devpostContent.match(/(\d+)\s+(?:of them )?propert(?:ies|y tests)/g) || [];
devpostPropMatches.forEach((match) => {
  const num = parseInt(match.match(/(\d+)/)[0]);
  claims.push({
    file: "devpost-submission-draft.md",
    type: "property_tests",
    claimed: num,
    measured: numPropertyTests,
  });
});

const devpostReqMatches =
  devpostContent.match(/(\d+)\s+(?:core\s+)?requirements?/g) || [];
devpostReqMatches.forEach((match) => {
  if (match.includes("core")) {
    claims.push({
      file: "devpost-submission-draft.md",
      type: "core_reqs",
      claimed: parseInt(match.match(/(\d+)/)[0]),
      measured: coreReqs,
    });
  } else {
    claims.push({
      file: "devpost-submission-draft.md",
      type: "total_reqs",
      claimed: parseInt(match.match(/(\d+)/)[0]),
      measured: totalReqs,
    });
  }
});

// demo-video/820-demo-en.srt
if (existsSync("demo-video/820-demo-en.srt")) {
  const srtContent = readFileSync("demo-video/820-demo-en.srt", "utf-8");

  const srtTestMatches =
    srtContent.match(/(\d+)\s+tests(?:\s*\/\s*(\d+)\s+files)?/g) || [];
  srtTestMatches.forEach((match) => {
    const parts = match.match(/(\d+)/g);
    if (parts.length === 1) {
      claims.push({
        file: "demo-video/820-demo-en.srt",
        type: "total_tests",
        claimed: parseInt(parts[0]),
        measured: numTotalTests,
      });
    } else if (parts.length === 2) {
      claims.push({
        file: "demo-video/820-demo-en.srt",
        type: "tests_and_files",
        claimed: `${parts[0]}/${parts[1]}`,
        measured: `${numTotalTests}/${testFiles}`,
      });
    }
  });

  const srtPropMatches =
    srtContent.match(/(\d+)\s+(?:of them )?propert(?:ies|y tests)/g) || [];
  srtPropMatches.forEach((match) => {
    const num = parseInt(match.match(/(\d+)/)[0]);
    claims.push({
      file: "demo-video/820-demo-en.srt",
      type: "property_tests",
      claimed: num,
      measured: numPropertyTests,
    });
  });

  const srtReqMatches =
    srtContent.match(/(\d+)\s+(?:core\s+)?requirements?/g) || [];
  srtReqMatches.forEach((match) => {
    if (match.includes("core")) {
      claims.push({
        file: "demo-video/820-demo-en.srt",
        type: "core_reqs",
        claimed: parseInt(match.match(/(\d+)/)[0]),
        measured: coreReqs,
      });
    } else {
      claims.push({
        file: "demo-video/820-demo-en.srt",
        type: "total_reqs",
        claimed: parseInt(match.match(/(\d+)/)[0]),
        measured: totalReqs,
      });
    }
  });

  const srtTaskMatch = srtContent.match(/T\d+\.\d+\s+to\s+T(\d+\.\d+)/);
  if (srtTaskMatch) {
    claims.push({
      file: "demo-video/820-demo-en.srt",
      type: "max_task_id",
      claimed: `T${srtTaskMatch[1]}`,
      measured: maxTaskId,
    });
  }
}

// EVIDENCE.md: the one line that states the current counts. Historical rows keep their own
// numbers on purpose (they record what was true then), so only the "Test counts are from" line is
// read here.
const evidenceContent = readFileSync("EVIDENCE.md", "utf-8");
const evidenceCounts = /Test counts are from[^*]*\*\*(\d+) tests \/ (\d+) files\*\*/.exec(evidenceContent);
if (evidenceCounts) {
  claims.push({
    file: "EVIDENCE.md",
    type: "tests_and_files",
    claimed: `${evidenceCounts[1]}/${evidenceCounts[2]}`,
    measured: `${numTotalTests}/${testFiles}`,
  });
} else {
  console.log("note EVIDENCE.md tests_and_files: no current-count line found");
}
const evidenceProps = /Test counts are from[^*]*\*\*\d+ tests \/ \d+ files\*\*[^(]*\((\d+) propert(?:y|ies)/.exec(evidenceContent);
if (evidenceProps) {
  claims.push({ file: "EVIDENCE.md", type: "property_tests", claimed: parseInt(evidenceProps[1]), measured: numPropertyTests });
}

// Artefacts that were published on a date, with a count frozen into them: the subtitle burned into
// the video. It is compared against the number that was true when it was recorded, not against
// today's run, because re-rendering a published video to chase a later count would be the dishonest
// move. The Devpost text is no longer frozen: it states today's count and names the video's older
// one in place, so every count it claims is checked against the run.
const RECORDED_COUNTS = new Map([
  ["demo-video/820-demo-en.srt", { tests: 334, files: 25, note: "burned into the video recorded 2026-11-27" }],
]);

// Step 5: Report results
let failCount = 0;
claims.forEach((claim) => {
  const recorded = RECORDED_COUNTS.get(claim.file);
  const frozen = recorded && (claim.type === "total_tests" || claim.type === "tests_and_files");
  const expected = frozen
    ? claim.type === "tests_and_files"
      ? `${recorded.tests}/${recorded.files}`
      : recorded.tests
    : claim.measured;
  const pass = String(claim.claimed) === String(expected);
  const status = pass ? "ok" : "FAIL";
  console.log(
    `${status} ${claim.file} ${claim.type}: claimed=${claim.claimed} measured=${expected}${frozen ? ` (recorded, ${recorded.note})` : ""}`
  );
  if (!pass) failCount++;
});

// If no claims were found, indicate that
if (claims.length === 0) {
  console.log("No claims found in published documents");
}

console.log(
  `${claims.length - failCount}/${claims.length} claims agree with the repository`
);
process.exit(failCount > 0 ? 1 : 0);
