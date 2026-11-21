/**
 * SHA-256 for the browser bundle.
 *
 * The deterministic layers call `createHash('sha256')` from `node:crypto`. That module does
 * not exist in a browser, so the static demo is built with this file aliased in its place.
 * The digest must be **identical** to Node's, or the demo's fingerprints would not match the
 * CLI's and the "same inputs, same verdict" claim would end at the server boundary.
 *
 * Two details make it identical:
 *  - a `string` is hashed as UTF-8, which is Node's default encoding for `update(string)`
 *    (a latin1-decoded record with a 0x80 byte hashes as two UTF-8 bytes there too);
 *  - a `Uint8Array` is hashed as raw bytes.
 *
 * `test/unit/static-sha256.test.ts` compares this implementation against `node:crypto` for
 * ASCII, high-byte strings, byte arrays and the real sample files.
 */
import type { Bytes } from '../core/bytes.js';

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** UTF-8 bytes of a string, exactly as Node encodes `update(string)`. */
export function utf8Bytes(text: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
  // Fallback for exotic hosts: hand-rolled UTF-8 for code points up to U+FFFF plus surrogates.
  const out: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    let code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        index += 1;
      }
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return Uint8Array.from(out);
}

export function sha256Hex(data: string | Bytes): string {
  const message: Uint8Array = typeof data === 'string' ? utf8Bytes(data) : data;
  const length = message.length;
  const bitLength = length * 8;
  const blockCount = Math.floor((length + 8) / 64) + 1;
  const total = blockCount * 64;
  const padded = new Uint8Array(total);
  padded.set(message);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  // 64-bit big-endian length; JS bit lengths stay far below 2^32 for our inputs.
  view.setUint32(total - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(total - 4, bitLength >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let block = 0; block < blockCount; block += 1) {
    const offset = block * 64;
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!];
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }

  let hex = '';
  for (const word of h) hex += word.toString(16).padStart(8, '0');
  return hex;
}

/** The shape `node:crypto`'s `createHash` exposes, for the two methods the engine uses. */
export function createHash(_algorithm: string) {
  let data: string | Bytes = new Uint8Array(0);
  let pending: Uint8Array[] = [];
  return {
    update(chunk: string | Bytes) {
      if (typeof chunk === 'string') pending.push(utf8Bytes(chunk));
      else pending.push(chunk);
      return this;
    },
    digest(encoding: 'hex' | 'binary' = 'hex') {
      const total = pending.reduce((sum, part) => sum + part.length, 0);
      const joined = new Uint8Array(total);
      let offset = 0;
      for (const part of pending) {
        joined.set(part, offset);
        offset += part.length;
      }
      pending = [];
      data = joined;
      const hex = sha256Hex(data);
      if (encoding === 'hex') return hex;
      return hex;
    },
  };
}

export default { createHash, sha256Hex };
