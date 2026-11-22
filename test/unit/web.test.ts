/**
 * T5.3: the web screen's HTTP surface.
 *
 * The browser test comes later (it needs screenshots); these assertions cover what
 * a screenshot cannot: that the three columns exist in the served document, that
 * the API returns the same verdict as the CLI, that a highlighted span really is
 * the field the finding names, and that no path outside `samples/` can be read.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startWebServer, type WebServer } from '../../src/web/index.js';
import type { ViewModel } from '../../src/web/view.js';

const root = join(import.meta.dirname, '..', '..');
let web: WebServer;

beforeAll(async () => {
  web = await startWebServer({ repoRoot: root });
});

afterAll(async () => {
  await web.close();
});

const sampleCopybook = (name: string): string => readFileSync(join(root, 'samples/copybooks', name), 'utf8');
const sampleText = (name: string): string => readFileSync(join(root, 'samples/data', name), 'latin1');

async function run(body: unknown): Promise<ViewModel> {
  const response = await fetch(`${web.url()}/api/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as { view?: ViewModel; error?: string };
  if (payload.error) throw new Error(payload.error);
  return payload.view!;
}

describe('T5.3 - the page is one screen with three columns and two guarantee strips', () => {
  it('serves the document with the three panels and both strips', async () => {
    const response = await fetch(`${web.url()}/`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('1. Input');
    expect(html).toContain('2. Verdict');
    expect(html).toContain('3. Evidence');
    expect(html).toContain('id="strip-top"');
    expect(html).toContain('id="strip-bottom"');
    expect(html).toContain('grid-template-columns: 330px');
    expect(html).toContain('dropFile');
    expect(html).toContain('dropCopybook');
  });

  it('lists the samples and the guarantee strip', async () => {
    const response = await fetch(`${web.url()}/api/samples`);
    const payload = (await response.json()) as {
      copybooks: Array<{ value: string }>;
      files: Array<{ value: string }>;
      guarantees: { guaranteed: string[]; notGuaranteed: string[] };
    };
    expect(payload.copybooks.map((c) => c.value)).toContain('samples/copybooks/820.cpy');
    expect(payload.files.map((f) => f.value)).toContain('samples/data/bai2-good.txt');
    expect(payload.guarantees.guaranteed.length).toBeGreaterThanOrEqual(5);
    expect(payload.guarantees.notGuaranteed.length).toBeGreaterThanOrEqual(4);
  });
});

describe('T5.3 - the verdict column matches the deterministic layers', () => {
  it('shows PASS for the clean pair with zero findings', async () => {
    const view = await run({
      filePath: 'samples/data/820-good.txt',
      copybookPath: 'samples/copybooks/820.cpy',
      format: 'fixed',
      bankPath: 'samples/data/823-bank.txt',
      bankCopybookPath: 'samples/copybooks/823.cpy',
      bankFormat: 'fixed',
      window: { start: '2026-11-18', end: '2026-11-20' },
    });
    expect(view.status).toBe('PASS');
    expect(view.findings).toEqual([]);
    expect(view.files.payment.details).toBe(10);
    expect(view.summary.referencesMatched).toBe(10);
    expect(view.records.length).toBe(22);
  });

  it('shows FAIL with four findings, each anchored to a real byte span', async () => {
    const view = await run({
      filePath: 'samples/data/820-bad.txt',
      copybookPath: 'samples/copybooks/820.cpy',
      format: 'fixed',
      bankPath: 'samples/data/823-bank.txt',
      bankCopybookPath: 'samples/copybooks/823.cpy',
      bankFormat: 'fixed',
      window: { start: '2026-11-18', end: '2026-11-20' },
    });
    expect(view.status).toBe('FAIL');
    expect(view.findings).toHaveLength(4);
    for (const finding of view.findings) {
      expect(finding.explanation?.status).toBe('EXPLAINED');
      const evidence = finding.evidence;
      expect(evidence.raw.length).toBeGreaterThan(0);
      if (evidence.span && evidence.field) {
        const slice = evidence.raw.slice(evidence.span.start - 1, evidence.span.start - 1 + evidence.span.length);
        expect(slice).toBe(evidence.fieldText);
        expect(evidence.note).toContain('bytes');
      }
    }
    const total = view.findings.find((f) => f.code === 'CONTROL_TOTAL_MISMATCH')!;
    expect(total.evidence.field).toBe('AMOUNT');
    expect(total.evidence.span).toEqual({ start: 24, length: 13 });
    expect(total.evidence.fieldText).toBe('000012845500{');
    expect(total.declared).toBe('1,284,550.00 USD');
    expect(total.delta).toBe('-100.00 USD');
    expect(total.evidence.raw.slice(23, 36)).toBe('000012845500{');
  });

  it('an issue on a short record is carried to the screen as an issue, not silently dropped', async () => {
    const view = await run({
      filePath: 'samples/data/820-bad.txt',
      copybookPath: 'samples/copybooks/820.cpy',
      format: 'fixed',
    });
    expect(view.issues.map((i) => i.code)).toContain('RECORD_LENGTH_MISMATCH');
    const short = view.records.find((r) => r.side === 'payment' && r.index === 6)!;
    expect(short.length).toBe(99);
    expect(short.issues[0]?.code).toBe('RECORD_LENGTH_MISMATCH');
  });
});

describe('T5.3 - BAI2 and dropped files go through the same screen', () => {
  it('reconciles a BAI2 statement and labels evidence with the BAI2 side', async () => {
    const view = await run({
      filePath: 'samples/data/820-good.txt',
      copybookPath: 'samples/copybooks/820.cpy',
      format: 'fixed',
      bankPath: 'samples/data/bai2-bad.txt',
      bankFormat: 'bai2',
      window: { start: '2026-11-18', end: '2026-11-20' },
    });
    expect(view.status).toBe('FAIL');
    expect(view.files.bank?.format).toBe('bai2');
    const fee = view.findings.find((f) => f.reference === 'BANK-FEE-2611')!;
    expect(fee.evidence.side).toBe('bank');
    expect(fee.evidence.raw.startsWith('16,409,2500')).toBe(true);
    expect(fee.evidence.span).toBeDefined();
  });

  it('parses a dropped file from the request body, with its dropped copybook', async () => {
    const view = await run({
      fileName: 'dropped-820.txt',
      fileText: sampleText('820-good.txt'),
      copybookText: sampleCopybook('820.cpy'),
      format: 'fixed',
      window: { start: '2026-11-18', end: '2026-11-20' },
    });
    expect(view.status).toBe('PASS');
    expect(view.files.payment.path).toBe('dropped-820.txt');
    expect(view.files.bank).toBeUndefined();
    expect(view.summary.referencesUnmatched).toBe(0);
  });

  it('keeps COMP-3 bytes intact when the file is dropped (base64, not text)', async () => {
    // 820-packed-good.txt holds bytes above 0x7F. Reading it with `file.text()` would
    // decode UTF-8 and replace those bytes with U+FFFD; the drop path therefore sends
    // base64 of the raw bytes and the server decodes them as latin1, one char per byte.
    const bytes = readFileSync(join(root, 'samples/data/820-packed-good.txt'));
    expect(bytes.some((b) => b > 0x7f)).toBe(true);
    const view = await run({
      fileName: '820-packed-good.txt',
      fileBase64: bytes.toString('base64'),
      copybookBase64: Buffer.from(sampleCopybook('820-packed.cpy'), 'utf8').toString('base64'),
      copybookName: '820-packed.cpy',
      format: 'fixed',
      window: { start: '2026-11-18', end: '2026-11-20' },
    });
    const byPath = await run({
      filePath: 'samples/data/820-packed-good.txt',
      copybookPath: 'samples/copybooks/820-packed.cpy',
      format: 'fixed',
      window: { start: '2026-11-18', end: '2026-11-20' },
    });
    expect(view.status).toBe('PASS');
    expect(view.files.payment.fileHash).toBe(byPath.files.payment.fileHash);
    expect(view.fingerprint).toBe(byPath.fingerprint);
    expect(view.issues).toEqual([]);
  });

  it('refuses a path outside samples/ instead of reading it', async () => {
    const response = await fetch(`${web.url()}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filePath: '../../etc/passwd', copybookPath: 'samples/copybooks/820.cpy' }),
    });
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain('only files under samples/');
  });

  it('refuses a toleranceDays that is not a whole number of days, as the CLI and MCP do', async () => {
    for (const toleranceDays of [-1, 1.5, '3']) {
      const response = await fetch(`${web.url()}/api/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filePath: 'samples/data/820-good.txt', copybookPath: 'samples/copybooks/820.cpy', toleranceDays }),
      });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toContain('toleranceDays');
    }
  });

  it('reports a bad request as a message, not as a crash', async () => {
    const response = await fetch(`${web.url()}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain('not JSON');
    const missing = await fetch(`${web.url()}/api/run?file=samples/data/820-good.txt`);
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toContain('copybook');
  });
});
