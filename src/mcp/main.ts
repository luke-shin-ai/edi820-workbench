#!/usr/bin/env node
/**
 * MCP stdio entry point: `npx tsx src/mcp/main.ts` (or wire it into an MCP client).
 */
import { serveStdio } from './server.js';

await serveStdio(process.stdin, process.stdout);
