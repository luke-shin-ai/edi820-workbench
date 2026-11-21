#!/usr/bin/env node
/**
 * Hand the newest real run in `out/` to the real CLI entry (`src/cli/main.ts verify`).
 *
 * The `AgentStop` hook used to call `npx tsx src/cli/index.ts verify out/`, which was a
 * silent no-op: `index.ts` exports `runCli` and has no entry point, so the process
 * printed nothing and exited 0, and `out/` holds timestamped run directories, so even
 * the right entry point would have failed with "no report.json at out/".
 *
 * This resolver keeps the hook honest in both directions:
 *   - no run yet  -> say so and exit 0 (nothing to verify is not a failure);
 *   - a run found -> print the exact command, then exit with the CLI's own code, so a
 *                    fingerprint drift shows up in the session instead of being swallowed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outRoot = join(root, 'out');
const cli = join(root, 'src', 'cli', 'main.ts');
const localTsx = join(root, 'node_modules', '.bin', 'tsx');

function newestRunWithReport() {
  if (!existsSync(outRoot)) return null;
  const runs = readdirSync(outRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(outRoot, entry.name);
      const report = join(dir, 'report.json');
      return { dir, name: entry.name, report, exists: existsSync(report) };
    })
    .filter((run) => run.exists)
    // A run without a verdict (`parse`) cannot be re-derived; `verify` needs one.
    .filter((run) => {
      try {
        const report = JSON.parse(readFileSync(run.report, 'utf8'));
        return Boolean(report && report.verdict);
      } catch {
        return false;
      }
    })
    .map((run) => ({ ...run, mtime: statSync(run.report).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return runs[0] ?? null;
}

const run = newestRunWithReport();
if (!run) {
  console.log(`verify: no report.json with a verdict under ${join('out')} yet — run \`npm run cli reconcile\` first, or \`npm run evidence\``);
  process.exit(0);
}

const relative = run.dir.slice(root.length + 1);
console.log(`verify: newest run ${relative}`);
console.log(`verify: npx tsx src/cli/main.ts verify ${relative}`);

const command = existsSync(localTsx) ? localTsx : 'npx';
const args = existsSync(localTsx) ? [cli, 'verify', run.dir] : ['tsx', cli, 'verify', run.dir];
const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
if (result.error) {
  console.error(`verify: could not start ${command}: ${result.error.message}`);
  process.exit(3);
}
process.exit(result.status ?? 3);
