/**
 * Byte helpers that work in Node and in a browser.
 *
 * The deterministic layers used to call `Buffer.from(...)` and `source.toString('latin1')`
 * directly. `Buffer` does not exist in a browser, and it was the only thing standing between
 * the parser and a static, client-side demo. These four functions are the whole surface the
 * layers need: latin1 is one byte per character, which is exactly how every record is kept.
 */

export type Bytes = Uint8Array;

/** latin1 bytes → string, one character per byte (never UTF-8, never a replacement char). */
export function toLatin1(bytes: Bytes): string {
  let out = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    out += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return out;
}

/** string → latin1 bytes; a character above 0xFF is a programming error, not data. */
export function fromLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes[index] = code > 0xff ? 0x3f /* '?' — unreachable for latin1-decoded data */ : code;
  }
  return bytes;
}

export function isBytes(value: unknown): value is Bytes {
  return value instanceof Uint8Array;
}

/** Hex digest of a byte sequence, from a `createHash`-shaped function (see sha256-browser.ts). */
export function digestHex(hash: { update(data: string | Bytes): { digest(encoding: 'hex'): string } }, data: string | Bytes): string {
  return hash.update(data).digest('hex');
}

/** Byte-for-byte equality (the `Buffer.equals` the tests used to rely on). */
export function bytesEqual(a: Bytes, b: Bytes): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}
