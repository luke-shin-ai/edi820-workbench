#!/usr/bin/env node
/**
 * CLI entry point.
 *
 * Kept separate from `index.ts` so tests can import `runCli` without starting a
 * process, and so the process boundary (argv in, exit code out) is explicit.
 */
import { runCli } from './index.js';

// A hook or a pager may close stdout early (`| head`). Without this the process dies
// with an unhandled EPIPE stack trace instead of exiting like a unix filter should.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

process.exitCode = await runCli(process.argv.slice(2));
