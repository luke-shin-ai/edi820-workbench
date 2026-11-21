/**
 * L3 adapters.
 *
 * `mock` writes the explanation from the finding with deterministic templates and
 * is the default: it can be reviewed, it costs nothing, and it cannot invent a
 * number. The two live adapters exist so the same guard can be demonstrated in
 * front of a real model, but nothing here calls out unless a caller names the
 * adapter — the free-tier build runs with the 50-credit allowance untouched.
 */
import { spawn } from 'node:child_process';
import { formatAmount } from '../reconcile/index.js';
import type { Finding } from '../reconcile/index.js';
import { parseDraft } from './prompt.js';
import type { ExplanationDraft, ExplainerAdapter } from './types.js';

function render(value: Finding['declared']): string {
  if (value === undefined) return '(not declared)';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value;
  return formatAmount(value);
}

/**
 * Deterministic adapter: the finding is the only input, so the guard passes by
 * construction. It is also the honest baseline the write-up compares a model
 * against — if a model says something the templates cannot, it is either a
 * richer paraphrase or a number the guard will block.
 */
export function createMockAdapter(): ExplainerAdapter {
  return {
    name: 'mock',
    live: false,
    async explain({ finding }): Promise<ExplanationDraft> {
      switch (finding.code) {
        case 'CONTROL_TOTAL_MISMATCH':
          return {
            cause: `The trailer declares ${render(finding.declared)} but the detail records sum to ${render(finding.computed)}; the difference is ${render(finding.delta)}.`,
            suggestedFix:
              'Find the record whose amount does not belong to the declared total (record-level amounts are in the evidence panel), correct the trailer or that record, then re-run verify.',
          };
        case 'CONTROL_COUNT_MISMATCH':
          return {
            cause: `The trailer declares ${render(finding.declared)} detail records but ${render(finding.computed)} were read.`,
            suggestedFix:
              'Locate the missing or extra detail record, correct the file or the trailer, and re-run verify.',
          };
        case 'REF_UNMATCHED':
          return finding.reference === undefined || finding.reference === ''
            ? {
                cause: `Record ${finding.recordIndex} has a blank reference field, so it cannot be matched to any counterpart.`,
                suggestedFix:
                  'Fill the reference on this record from the payment instruction, re-run reconcile, and confirm the reference now matches.',
              }
            : {
                cause: `Reference ${finding.reference} on record ${finding.recordIndex} has no counterpart on the other side.`,
                suggestedFix:
                  'Check whether this reference exists on the bank side under a different value, correct the reference on the side that is wrong, and re-run reconcile.',
              };
        case 'DATE_OUT_OF_WINDOW':
          return {
            cause: `Value date ${render(finding.computed)} on record ${finding.recordIndex} is outside the settlement window ${render(finding.declared)}.`,
            suggestedFix:
              'Confirm the value date with the settlement instruction; if the window is wrong for this run, pass the correct window to reconcile rather than editing the file.',
          };
        case 'FIELD_DECLARED_LENGTH_EXCEEDED':
          return {
            cause: `Field ${finding.field ?? '(unnamed)'} on record ${finding.recordIndex} carries more bytes than the copybook declares.`,
            suggestedFix: 'Re-encode the record from the copybook, or correct the picture in the copybook if the file is right.',
          };
        default:
          return {
            cause: `${finding.code} on record ${finding.recordIndex}: ${finding.detail}`,
            suggestedFix: 'Review the finding in the evidence panel and correct the file or the spec.',
          };
      }
    },
  };
}

/** Injectable process runner, so the adapter's protocol is testable without Kiro installed. */
export interface ProcessRunner {
  run(command: string, args: string[], input: string): Promise<{ stdout: string; status: number }>;
}

export const spawnRunner: ProcessRunner = {
  run(command, args, input) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => (stdout += chunk));
      child.stderr.on('data', (chunk: string) => (stderr += chunk));
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve({ stdout, status: 0 });
        else reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 400)}`));
      });
      child.stdin.end(input);
    });
  },
};

export interface KiroCliOptions {
  command?: string;
  model?: string;
  runner?: ProcessRunner;
}

/**
 * Kiro CLI headless adapter (`kiro-cli chat --no-interactive`).
 *
 * Off by default — it spends credits. Enabled per run with
 * `820 explain --adapter kiro-cli --model <0.05x model>`.
 */
export function createKiroCliAdapter(options: KiroCliOptions = {}): ExplainerAdapter {
  const command = options.command ?? process.env.KIRO_CLI ?? 'kiro-cli';
  const model = options.model ?? process.env.KIRO_MODEL;
  const runner = options.runner ?? spawnRunner;
  return {
    name: 'kiro-cli',
    live: true,
    async explain({ prompt }) {
      const args = ['chat', '--no-interactive', '--trust-tools='];
      if (model) args.push('--model', model);
      const { stdout } = await runner.run(command, args, prompt);
      return parseDraft(stdout);
    },
  };
}

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

/** Any OpenAI-compatible chat-completions endpoint (Groq, NIM, a local llama.cpp server). */
export function createOpenAiCompatibleAdapter(options: OpenAiCompatibleOptions): ExplainerAdapter {
  const call = options.fetchImpl ?? globalThis.fetch;
  return {
    name: 'openai-compatible',
    live: true,
    async explain({ prompt }) {
      const response = await call(`${options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
        body: JSON.stringify({
          model: options.model,
          temperature: 0,
          max_tokens: 400,
          messages: [
            { role: 'system', content: 'You return JSON only.' },
            { role: 'user', content: prompt },
          ],
        }),
      });
      if (!response.ok) throw new Error(`model endpoint returned HTTP ${response.status}`);
      const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('model reply carried no content');
      return parseDraft(content);
    },
  };
}

/** Resolve an adapter name from the CLI/environment without making a call. */
export function adapterByName(name: string): ExplainerAdapter {
  switch (name) {
    case 'mock':
      return createMockAdapter();
    case 'kiro-cli':
      return createKiroCliAdapter();
    case 'openai': {
      const baseUrl = process.env.OPENAI_BASE_URL;
      const apiKey = process.env.OPENAI_API_KEY;
      const model = process.env.OPENAI_MODEL;
      if (!baseUrl || !apiKey || !model) {
        throw new Error('adapter openai needs OPENAI_BASE_URL, OPENAI_API_KEY and OPENAI_MODEL');
      }
      return createOpenAiCompatibleAdapter({ baseUrl, apiKey, model });
    }
    default:
      throw new Error(`unknown adapter "${name}" (mock | kiro-cli | openai)`);
  }
}
