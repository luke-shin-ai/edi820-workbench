#!/usr/bin/env node
/**
 * append-evidence.mjs - called by the `.kiro/hooks` PostTaskExec hook.
 * Receives the session context as JSON on STDIN (Kiro passes event data that way),
 * and appends one row to EVIDENCE.md.
 *
 * Designed to be safe when the event payload is unknown or partial: it prints a
 * warning and exits 0 rather than failing the agent turn. The raw payload is kept
 * under `out/hook-payload/` so the shape can be read later instead of guessed
 * (the first firing, 2026-11-22, arrived with no field the old picker recognised
 * and wrote a row of "n/a").
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(process.cwd(), 'EVIDENCE.md');
const PAYLOAD_DIR = resolve(process.cwd(), 'out', 'hook-payload');

function readStdin(timeoutMs = 1500) {
  return new Promise((done) => {
    let raw = '';
    let finished = false;
    const finish = () => { if (!finished) { finished = true; done(raw); } };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { finished || (raw += c); });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    setTimeout(finish, timeoutMs).unref?.();
  });
}

/** Every place the payload may carry the task id, from the shallowest to the deepest. */
function pickTask(payload) {
  if (!payload || typeof payload !== 'object') return 'n/a';
  // The payload the CLI sends (recorded in out/hook-payload/) carries `task_name` as the whole
  // task line, e.g. "T9.5 **Claim checker** - a script that ...", so the id is its first token.
  const candidates = [
    payload.task_id, payload.taskId, payload.task_name, payload.taskName, payload.task,
    payload?.data?.task_id, payload?.data?.taskId, payload?.data?.task_name,
    payload?.event?.task_id, payload?.event?.taskId, payload?.event?.task_name,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      const first = c.trim().split(/\s+/)[0];
      return (first.length > 0 ? first : c.trim()).slice(0, 80);
    }
  }
  return 'n/a';
}

/** The spec name, which identifies which tasks.md the task came from. */
function pickSpec(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const candidates = [payload.spec_name, payload.specName, payload?.data?.spec_name, payload?.event?.spec_name];
  for (const c of candidates) if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 60);
  return '';
}

function pick(payload, keys) {
  for (const k of keys) {
    const v = payload?.[k] ?? payload?.data?.[k] ?? payload?.event?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 120);
  }
  return '-';
}

const raw = await readStdin();
let payload = null;
try { payload = raw.trim() ? JSON.parse(raw) : null; } catch { payload = null; }

const now = new Date();
const iso = now.toISOString();
const stamp = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short',
}).format(now);

// Keep the payload: evidence about the hook, in the hook's own words.
if (raw.trim()) {
  try {
    mkdirSync(PAYLOAD_DIR, { recursive: true });
    writeFileSync(resolve(PAYLOAD_DIR, `${iso.replace(/[:.]/g, '-')}.json`), raw, 'utf8');
  } catch {
    // a payload that cannot be kept must not fail the task transition
  }
}

const task = pickTask(payload);
const spec = pickSpec(payload);
const command = pick(payload, ['command', 'cmd', 'name']);
const success = payload?.task_success ?? payload?.data?.task_success;
const result =
  typeof success === 'boolean'
    ? (success ? 'task_success=true' : 'task_success=false')
    : pick(payload, ['result', 'status', 'outcome', 'summary', 'taskStatus']);
const commit = pick(payload, ['commit', 'sha', 'revision']);

const taskCell = spec ? `${task} (${spec})` : task;
const row = `| ${stamp} | ${taskCell} | ${command} | ${result} | ${commit} |\n`;

if (!existsSync(FILE)) {
  console.error('[append-evidence] EVIDENCE.md not found at', FILE);
  process.exit(0);
}

appendFileSync(FILE, row, 'utf8');
console.log(row.trim());
