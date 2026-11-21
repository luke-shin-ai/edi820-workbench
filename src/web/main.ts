#!/usr/bin/env node
/**
 * Local web screen: `npx tsx src/web/main.ts --port 8720`
 * Binds to 127.0.0.1 only; files never leave the machine.
 */
import { startWebServer } from './server.js';

const portArg = process.argv.find((arg) => arg.startsWith('--port=')) ?? process.argv[process.argv.indexOf('--port') + 1];
const port = portArg ? Number(String(portArg).replace('--port=', '')) : 0;

const web = await startWebServer({ port });
process.stdout.write(`820 web screen: ${web.url()}\n`);
const shutdown = async (): Promise<void> => {
  await web.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
