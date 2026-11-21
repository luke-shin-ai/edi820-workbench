/**
 * The browser SHA-256 shim must produce the same digest as `node:crypto`, or the static demo's
 * fingerprint would differ from the CLI's for the same file. These tests compare the two
 * implementations directly, then compare a whole parse result: if the digest diverged on a
 * COMP-3 byte, the fingerprint assertion would fail.
 */
import { describe, expect, it } from 'vitest';
import { createHash as nodeCreateHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash as browserCreateHash, sha256Hex } from '../../src/static/sha256-browser.js';
import { compileCopybook } from '../../src/copybook/index.js';
import { parseFile } from '../../src/parser/index.js';
import { parseBai2 } from '../../src/bai2/index.js';

const root = join(import.meta.dirname, '..', '..');
const nodeHex = (data: string | Uint8Array): string => {
  const hash = nodeCreateHash('sha256');
  hash.update(data as never);
  return hash.digest('hex');
};

describe('browser SHA-256 equals node:crypto', () => {
  const cases: Array<[string, string | Uint8Array]> = [
    ['empty string', ''],
    ['ascii', '820 resurrection workbench'],
    ['latin1 high bytes', '\u0080\u0099\uffff A'],
    ['korean text', '결제 파일 대사'],
    ['newline + crlf', 'a\r\nb\nc'],
    ['binary bytes', Uint8Array.from([0x00, 0x80, 0xff, 0x7f, 0x01])],
    ['long ascii', 'x'.repeat(1000)],
  ];

  it.each(cases)('hashes %s identically', (_label, data) => {
    expect(sha256Hex(data)).toBe(nodeHex(data));
  });

  it('streams in two updates like node does', () => {
    const browser = browserCreateHash('sha256');
    browser.update('835,o').update('2\n');
    const node = nodeCreateHash('sha256');
    node.update('835,o').update('2\n');
    expect(browser.digest('hex')).toBe(node.digest('hex'));
  });

  it('gives a parsed COMP-3 file the same fingerprint as the Node path', () => {
    const source = readFileSync(join(root, 'samples/data/820-packed-good.txt'));
    const copybookText = readFileSync(join(root, 'samples/copybooks/820-packed.cpy'), 'utf8');
    const result = parseFile({ copybook: compileCopybook(copybookText), source, filename: '820-packed-good.txt' });
    // The parser used node:crypto here; recompute the same source hash through the browser shim.
    expect(sha256Hex(source)).toBe(result.fileHash);
    const bai2 = parseBai2(readFileSync(join(root, 'samples/data/bai2-bad.txt')));
    const bai2Source = readFileSync(join(root, 'samples/data/bai2-bad.txt'));
    expect(sha256Hex(bai2Source)).toBe(bai2.fileHash);
  });
});
