/**
 * Dumps the compiled copybook (field name, start, length, picture, type) for the demo
 * video's copybook plate. It calls the real compiler, so the offsets drawn in the video
 * are the ones the parser uses, not a hand count.
 */
import { readFileSync } from 'node:fs';
import { compileCopybook } from '../../src/copybook/index.ts';

const files = ['820.cpy', '820-packed.cpy', '823.cpy'];
const out = {};
for (const name of files) {
  const text = readFileSync(new URL(`../../samples/copybooks/${name}`, import.meta.url), 'utf8');
  const book = compileCopybook(text);
  out[name] = {
    recordLength: book.recordLength,
    fields: book.fields.map((f) => ({
      name: f.name,
      start: f.start,
      length: f.length,
      type: f.type,
      ...(f.scale !== undefined ? { scale: f.scale } : {}),
      ...(f.sign ? { sign: f.sign } : {}),
    })),
  };
}
console.log(JSON.stringify(out, null, 2));
