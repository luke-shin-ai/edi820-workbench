#!/usr/bin/env node
/**
 * Call the 820 MCP server the way a client does, and print what it returned.
 *
 * This is the same stdio protocol the Kiro reviewer agent used (`@820/reconcile`,
 * `@820/verify`), replayed without an agent in front of it so the output can be captured
 * verbatim into `demo-video/build/outputs/mcp-call.txt` and read in the video. If the numbers
 * here ever disagree with the CLI, one of the two surfaces is lying.
 *
 * Usage: node scripts/mcp-call.mjs [reportDir]
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const reportDir = process.argv[2] ?? 'out/l4-review';
const server = join(root, 'src', 'mcp', 'main.ts');
const tsx = join(root, 'node_modules', '.bin', 'tsx');

const child = spawn(tsx, [server], { cwd: root, stdio: ['pipe', 'pipe', 'inherit'] });
let buffer = '';
const waiting = new Map();

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    const resolve = waiting.get(message.id);
    if (resolve) {
      waiting.delete(message.id);
      resolve(message);
    }
  }
});

let nextId = 1;
function request(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

function toolResult(response) {
  const text = response.result?.content?.[0]?.text;
  if (!text) throw new Error(`no tool content: ${JSON.stringify(response).slice(0, 200)}`);
  return JSON.parse(text);
}

async function main() {
  const init = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'scripts/mcp-call.mjs', version: '1' },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const tools = await request('tools/list', {});
  console.log('$ node scripts/mcp-call.mjs');
  console.log(`server    ${init.result.serverInfo.name} ${init.result.serverInfo.version}  protocol ${init.result.protocolVersion}`);
  console.log(`tools     ${tools.result.tools.map((tool) => tool.name).join(', ')}`);
  console.log('');

  const reconcile = toolResult(
    await request('tools/call', {
      name: 'reconcile',
      arguments: {
        filePath: 'samples/data/820-bad.txt',
        copybookPath: 'samples/copybooks/820.cpy',
        bankFilePath: 'samples/data/823-bank.txt',
        bankCopybookPath: 'samples/copybooks/823.cpy',
        settlementWindow: { start: '2026-11-18', end: '2026-11-20' },
      },
    }),
  );
  console.log('@820/reconcile');
  console.log(`  verdict     ${reconcile.verdict.status}`);
  console.log(`  findings    ${reconcile.verdict.findings.length}  (${[...new Set(reconcile.verdict.findings.map((f) => f.code))].join(', ')})`);
  console.log(`  fingerprint ${reconcile.verdict.fingerprint}`);
  console.log('');

  const verify = toolResult(await request('tools/call', { name: 'verify', arguments: { reportPath: reportDir } }));
  console.log('@820/verify');
  console.log(`  report      ${verify.reportPath.split('/hackathons/kiroween-2026/').pop()}`);
  console.log(`  ok          ${verify.ok}   first difference: ${verify.firstDifference ?? 'none'}`);
  console.log(`  report      ${verify.mutation.reportBytesBefore} -> ${verify.mutation.reportBytesAfter} bytes, mtime ${verify.mutation.reportMtimeBefore === verify.mutation.reportMtimeAfter ? 'unchanged' : 'CHANGED'}`);
  console.log('');

  const exceptions = toolResult(await request('tools/call', { name: 'exceptions', arguments: { reportPath: reportDir, today: '2026-11-21' } }));
  console.log('@820/exceptions');
  console.log(`  counts      ${Object.entries(exceptions.counts).map(([k, v]) => `${k} ${v}`).join('  ')}   unadjudicated ${exceptions.unadjudicated}`);
  child.stdin.end();
}

await main();
