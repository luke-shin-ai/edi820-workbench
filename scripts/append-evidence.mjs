#!/usr/bin/env node
/**
 * append-evidence.mjs — called by the `.kiro/hooks` PostTaskExecution hook.
 * Receives the session context as JSON on STDIN (Kiro passes event data that way),
 * and appends one row to EVIDENCE.md.
 *
 * Designed to be safe when the event payload is unknown or partial: it prints a
 * warning and exits 0 rather than failing the agent turn.
 */
import { appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(process.cwd(), 'EVIDENCE.md');

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

function pickTask(payload) {
  if (!payload || typeof payload !== 'object') return 'n/a';
  const candidates = [
    payload.task_id, payload.taskId, payload.task,
    payload?.data?.task_id, payload?.data?.taskId, payload?.data?.task,
    payload?.event?.task_id, payload?.event?.taskId,
  ];
  for (const c of candidates) if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 80);
  return 'n/a';
}

function pick(payload, keys) {
  for (const k of keys) {
    const v = payload?.[k] ?? payload?.data?.[k] ?? payload?.event?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 120);
  }
  return '—';
}

const raw = await readStdin();
let payload = null;
try { payload = raw.trim() ? JSON.parse(raw) : null; } catch { payload = null; }

const now = new Date();
const stamp = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short',
}).format(now);

const task = pickTask(payload);
const command = pick(payload, ['command', 'cmd', 'name']);
const result = pick(payload, ['result', 'status', 'outcome', 'summary']);
const commit = pick(payload, ['commit', 'sha', 'revision']);

const row = `| ${stamp} | ${task} | ${command} | ${result} | ${commit} |\n`;

if (!existsSync(FILE)) {
  console.error('[append-evidence] EVIDENCE.md not found at', FILE);
  process.exit(0);
}

appendFileSync(FILE, row, 'utf8');
console.log(row.trim());
