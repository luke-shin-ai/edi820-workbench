#!/usr/bin/env node
/**
 * Append one line to `out/hook-log.txt`.
 *
 * A hook's stdout is added to the agent's context, not to the terminal a person
 * watches, so a hook that only prints leaves no trace a reviewer can inspect. Every
 * fired hook calls this instead: the file is the evidence, and `docs/kiro-session-evidence.md`
 * quotes from it.
 *
 * Usage: node scripts/log-hook.mjs <trigger> [detail...]
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [trigger = 'unknown', ...detail] = process.argv.slice(2);
const out = join(root, 'out');
mkdirSync(out, { recursive: true });
appendFileSync(
  join(out, 'hook-log.txt'),
  `${new Date().toISOString()}  trigger=${trigger}  ${detail.join(' ')}${process.env.KIRO_FILE_PATH ? `  file=${process.env.KIRO_FILE_PATH}` : ''}\n`,
);
console.log(`hook ${trigger} recorded${detail.length ? `: ${detail.join(' ')}` : ''}`);
