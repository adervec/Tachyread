import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crc32, bionicWord, buildEpub, docChapters } from './bionicEpub.js';

assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'standard CRC-32 check value');
assert.equal(bionicWord('reading,'), '<b>read</b>ing,', 'ceil(7/2) = 4 letters, same split as the Lines pane');
assert.equal(bionicWord('“Fear'), '“<b>Fe</b>ar');
assert.equal(bionicWord('a'), 'a', 'one letter left alone');
assert.equal(bionicWord('<tag>'), '&lt;<b>ta</b>g&gt;', 'escaped');

const doc = { lines: [
  { text: 'Chapter One', isEmpty: false, startWordIndex: 0 }, { text: '', isEmpty: true },
  { text: 'Fear is the', isEmpty: false, startWordIndex: 2 }, { text: 'mind-killer.', isEmpty: false, startWordIndex: 5 }, { text: '', isEmpty: true },
  { text: 'Chapter Two', isEmpty: false, startWordIndex: 6 }, { text: '', isEmpty: true },
  { text: 'I will face it.', isEmpty: false, startWordIndex: 8 },
] };
const ch = docChapters(doc, [{ title: 'One', wordIndex: 0 }, { title: 'Two', wordIndex: 6 }]);
assert.deepEqual(ch, [{ title: 'One', paragraphs: ['Chapter One', 'Fear is the mind-killer.'] }, { title: 'Two', paragraphs: ['Chapter Two', 'I will face it.'] }]);
assert.deepEqual(docChapters(doc, [{ title: 'Chapter One', wordIndex: 0 }])[0].paragraphs, ['Fear is the mind-killer.', 'Chapter Two', 'I will face it.'], 'a heading line matching the chapter title isn’t repeated');
assert.equal(docChapters(doc).length, 1, 'no ToC → parts');

const bytes = buildEpub({ title: 'Dune & Co', author: 'Herbert', chapters: ch, id: 'test' });
assert.equal(new TextDecoder().decode(bytes.slice(30, 38)), 'mimetype', 'mimetype is the first entry');
// An independent zip reader (Python's zipfile — on this machine and the CI runner) reads it back.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epub-'));
fs.writeFileSync(path.join(dir, 'b.epub'), bytes);
const py = ['python3', 'python'].find((p) => { try { execSync(`${p} --version`, { stdio: 'ignore' }); return true; } catch { return false; } });
let checked = false;
if (py) {
  const out = execSync(`${py} -c "import zipfile,json;z=zipfile.ZipFile('b.epub');print(json.dumps({'bad':z.testzip(),'names':z.namelist(),'first':z.infolist()[0].compress_type,'c1':z.read('OEBPS/c1.xhtml').decode(),'opf':z.read('OEBPS/content.opf').decode()}))"`, { cwd: dir, encoding: 'utf8' });
  const z = JSON.parse(out);
  assert.equal(z.bad, null, 'every CRC checks out');
  assert.equal(z.names[0], 'mimetype');
  assert.equal(z.first, 0, 'mimetype stored, not deflated');
  assert.ok(z.names.includes('OEBPS/c2.xhtml') && z.names.includes('OEBPS/nav.xhtml'));
  assert.ok(z.c1.includes('<b>Fe</b>ar <b>i</b>s <b>th</b>e <b>mind-k</b>iller.'), 'bionic paragraph');
  assert.ok(z.opf.includes('<dc:title>Dune &amp; Co (bionic)</dc:title>'));
  checked = true;
}
fs.rmSync(dir, { recursive: true, force: true });
console.log(`bionicEpub: all cases pass${checked ? ' (unzipped by Python zipfile)' : ' (no Python — unzip round-trip skipped)'}`);
