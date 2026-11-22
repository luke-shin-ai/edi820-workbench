/**
 * L3 adapters.
 *
 * `grounded` writes the explanation from the finding with deterministic templates and
 * is the default: it can be reviewed, it costs nothing, and it cannot invent a
 * number. The two live adapters exist so the same guard can be demonstrated in
 * front of a real model, but nothing here calls out unless a caller names the
 * adapter - the free-tier build runs with the 50-credit allowance untouched.
 */
import { spawn } from 'node:child_process';
import { parseDraft } from './prompt.js';
import { createGroundedAdapter } from './grounded.js';
import type { ExplanationDraft, ExplainerAdapter } from './types.js';

export { createGroundedAdapter } from './grounded.js';

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
 * Off by default - it spends credits. Enabled per run with
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
    case 'grounded':
      return createGroundedAdapter();
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
      throw new Error(`unknown adapter "${name}" (grounded | kiro-cli | openai)`);
  }
}
