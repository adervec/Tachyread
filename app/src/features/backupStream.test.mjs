import assert from 'node:assert/strict';
import { writeBackup, readBackup, blobLines, isStreamableHeader, BACKUP_VERSION } from './backupStream.js';

async function* gen(arr) { for (const x of arr) yield x; }
const header = { app: 'tachyread', version: BACKUP_VERSION, dbVersion: 9, exportedAt: 1, local: { 'tachyread-x': 'a "quoted"\nvalue' } };
const files = [{ checksum: 'c1', fileName: 'A,\n"b".txt' }, { checksum: 'c2', totalWords: 5 }];
const audio = [{ key: 'k:1', value: { __bin: 'blob', mime: 'audio/wav', b64: 'AAAA'.repeat(1000) } }];
const parts = [];
const sizes = await writeBackup({
  header,
  stores: [
    { name: 'files', inline: true, records: gen(files) },
    { name: 'audiobook', inline: false, records: gen(audio) },
    { name: 'empty', inline: true, records: gen([]) },
  ],
  write: async (s) => { parts.push(s); },
});
const text = parts.join('');
assert.equal(sizes.files.count, 2); assert.equal(sizes.audiobook.count, 1);
assert.ok(sizes.audiobook.bytes > 4000, 'sizes say which store is big');

// Still one valid JSON document in the old bundle shape (old restores keep working).
const bundle = JSON.parse(text);
assert.equal(bundle.app, 'tachyread');
assert.deepEqual(bundle.db.files.rows, files);
assert.deepEqual(bundle.db.audiobook.entries, audio);
assert.deepEqual(bundle.db.empty.rows, []);
assert.deepEqual(bundle.local, header.local);

// Streamed back record by record, through the Blob line reader.
assert.ok(isStreamableHeader(text.split('\n')[0]));
const got = [], started = [];
const h = await readBackup(blobLines(new Blob([text])), {
  onStore: async (name, inline) => started.push(`${name}:${inline}`),
  onRecord: async (name, inline, rec) => got.push([name, rec]),
});
assert.deepEqual(h.local, header.local);
assert.deepEqual(started, ['files:true', 'audiobook:false', 'empty:true']);
assert.deepEqual(got, [['files', files[0]], ['files', files[1]], ['audiobook', audio[0]]]);

// An old single-line backup isn't mistaken for the streamable layout.
assert.ok(!isStreamableHeader(JSON.stringify(bundle)));
await assert.rejects(readBackup(blobLines(new Blob([JSON.stringify(bundle)]))), /Not a streamable/);
console.log('backupStream: all cases pass');
