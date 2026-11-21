#!/usr/bin/env node
/**
 * CLI entry point.
 *
 * Kept separate from `index.ts` so tests can import `runCli` without starting a
 * process, and so the process boundary (argv in, exit code out) is explicit.
 */
import { runCli } from './index.js';

process.exitCode = await runCli(process.argv.slice(2));
