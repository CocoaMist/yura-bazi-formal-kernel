import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  collectFiles,
  createBoundary,
  directoryTree,
  inspectJson,
  lookupSources,
  associateQuery,
  readLines,
  searchFileNames,
  searchText,
} from './core.mjs';
import { kitRequestFromObject, runKitCommand } from './kit-commands.mjs';
import {
  auditEncodings,
  buildIncrementalIndex,
  listZipArchive,
  profileDelimited,
  profileJsonSchema,
} from './data.mjs';
import {
  buildBookIndex,
  exportBookIndex,
  inspectBookIndex,
  searchBookIndex,
  verifyBookIndex,
} from './book-corpus.mjs';

function storedZip(name, content) {
  const nameBytes = Buffer.from(name, 'utf8');
  const body = Buffer.from(content, 'utf8');
  const local = Buffer.alloc(30 + nameBytes.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  nameBytes.copy(local, 30);
  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  nameBytes.copy(central, 46);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length + body.length, 16);
  return Buffer.concat([local, body, central, eocd]);
}

function storedZipEntries(input) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, content] of input) {
    const nameBytes = Buffer.from(name, 'utf8');
    const body = Buffer.from(content, 'utf8');
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    localParts.push(local, body);
    centralParts.push(central);
    offset += local.length + body.length;
  }
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(input.length, 8);
  eocd.writeUInt16LE(input.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, eocd]);
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'yura-agent-kit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'node_modules'));
  await writeFile(join(root, 'src', 'a.mjs'), 'alpha\nneedle here\nomega\n', 'utf8');
  await writeFile(join(root, 'src', 'b.json'), '{"nested":{"items":[1,2,3]}}\n', 'utf8');
  await writeFile(join(root, 'node_modules', 'ignored.mjs'), 'needle\n', 'utf8');
  await writeFile(join(root, 'rows.csv'), 'name,age\r\nAlice,12\r\n"Bob, Jr",13\r\n', 'utf8');
  await writeFile(join(root, 'events.jsonl'), '{"type":"a","value":1}\n{"type":"b","value":"x"}\n', 'utf8');
  await writeFile(join(root, 'sample.epub'), storedZip('OPS/chapter.xhtml', '<p>text</p>'));
  return { root, boundary: createBoundary(root) };
}

test('file collection is deterministic and imposes no implicit directory ignore', async (t) => {
  const { boundary } = await fixture(t);
  assert.deepEqual(
    (await collectFiles({ boundary, extensions: ['mjs'] })).map((path) => boundary.display(path)),
    ['node_modules/ignored.mjs', 'src/a.mjs'],
  );
});

test('large-data profilers stream encoding, tables, JSONL schema and archive inventory', async (t) => {
  const { boundary } = await fixture(t);
  const encoding = await auditEncodings({ boundary, start: 'rows.csv' });
  assert.deepEqual(encoding.map(row => ({ valid: row.valid, newline: row.newline, crlf: row.crlf })), [{ valid: true, newline: 'crlf', crlf: 3 }]);
  const table = await profileDelimited({ boundary, file: 'rows.csv' });
  assert.equal(table.rows, 2);
  assert.equal(table.columns[0].name, 'name');
  assert.equal(table.columns[0].string, 2);
  assert.equal(table.columns[1].integer, 2);
  const schema = await profileJsonSchema({ boundary, file: 'events.jsonl' });
  assert.equal(schema.rows, 2);
  assert.deepEqual(schema.fields.find(row => row.name === 'value'), {
    name: 'value', missing: 0, present: 2, null: 0, string: 1, number: 1, boolean: 0, object: 0, array: 0,
  });
  const archive = await listZipArchive({ boundary, file: 'sample.epub' });
  assert.equal(archive.entries[0].name, 'OPS/chapter.xhtml');
  assert.equal(archive.entries[0].bytes, 11);
});

test('incremental index writes atomically and reuses unchanged hashes', async (t) => {
  const { boundary } = await fixture(t);
  const first = await buildIncrementalIndex({ boundary, start: 'src', output: 'index.jsonl' });
  assert.equal(first.files, 2);
  assert.equal(first.hashed, 2);
  assert.equal(first.reused, 0);
  const second = await buildIncrementalIndex({ boundary, start: 'src', output: 'index.jsonl' });
  assert.equal(second.files, 2);
  assert.equal(second.hashed, 0);
  assert.equal(second.reused, 2);
});

test('search emits bounded compact matches and counts omitted matches', async (t) => {
  const { boundary } = await fixture(t);
  const result = await searchText({ boundary, query: 'needle', maxResults: 1, context: 0 });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].path, 'node_modules/ignored.mjs');
  assert.equal(result.results[0].snippet, '«needle»');
  assert.equal(result.truncated, true);
});

test('file-name search and associative lookup are agent-readable', async (t) => {
  const { boundary } = await fixture(t);
  const files = await searchFileNames({ boundary, query: 'a.mjs' });
  assert.deepEqual(files.files, ['src/a.mjs']);
  const tokens = associateQuery('previousStateHash');
  assert.ok(tokens.tokens.includes('Hash'));
  assert.ok(tokens.tokens.includes('previous_State_Hash') || tokens.tokens.includes('previous_state_hash') || tokens.tokens.some((row) => row.toLocaleLowerCase('en-US').includes('state')));
  const lookup = await lookupSources({ boundary, query: 'needle here', maxResults: 8, maxRelated: 8, context: 1 });
  assert.equal(lookup.content[0].path, 'src/a.mjs');
  assert.match(lookup.content[0].snippet, /«needle here»/);
  assert.ok(lookup.related.some((row) => row.path === 'node_modules/ignored.mjs' && String(row.why).includes('needle')));
  assert.ok(lookup.related.some((row) => row.why === 'same-directory' && row.path === 'src/b.json'));
  const chinese = associateQuery('阴阳变化');
  assert.ok(chinese.tokens.includes('阴阳'));
  assert.ok(chinese.tokens.includes('变化'));
});

test('read, tree and JSON inspection support exact paths without implicit limits', async (t) => {
  const { boundary } = await fixture(t);
  const read = await readLines({ boundary, file: 'src/a.mjs', startLine: 2, endLine: 3 });
  assert.deepEqual(read.lines, ['2|needle here', '3|omega']);
  const tree = await directoryTree({ boundary, maxDepth: 2 });
  assert.deepEqual(tree.entries, ['events.jsonl', 'node_modules/', '  ignored.mjs', 'rows.csv', 'sample.epub', 'src/', '  a.mjs', '  b.json']);
  const json = await inspectJson({ boundary, file: 'src/b.json', pathExpression: 'nested.items', maxItems: 2 });
  assert.deepEqual(json, { value: [1, 2], omitted: 1, total: 3 });
  assert.equal(boundary.resolve('..'), join(boundary.root, '..'));
});

test('book corpus indexes plain text and EPUB spine content incrementally', async (t) => {
  const { root, boundary } = await fixture(t);
  await mkdir(join(root, 'books'));
  await writeFile(join(root, 'books', 'plain.txt'), '第一章\n天地玄黄。宇宙洪荒。\n短词检索也要准确。', 'utf8');
  await writeFile(join(root, 'books', 'plain-copy.txt'), '第一章\n天地玄黄。宇宙洪荒。\n短词检索也要准确。', 'utf8');
  await writeFile(join(root, 'books', 'classic.epub'), storedZipEntries([
    ['META-INF/container.xml', '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'],
    ['OEBPS/content.opf', '<package><manifest><item id="c1" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>'],
    ['OEBPS/chapter.xhtml', '<html><head><title>卷一</title></head><body><h1>卷一</h1><p>甲乙丙丁，原文坐标必须保存。</p></body></html>'],
  ]));
  const first = await buildBookIndex({ boundary, start: 'books', database: 'artifacts/books.sqlite', chunkChars: 12, overlapChars: 2 });
  assert.deepEqual({ files: first.files, indexed: first.indexed, reused: first.reused }, { files: 3, indexed: 3, reused: 0 });
  const second = await buildBookIndex({ boundary, start: 'books', database: 'artifacts/books.sqlite', chunkChars: 12, overlapChars: 2 });
  assert.deepEqual({ indexed: second.indexed, reused: second.reused }, { indexed: 0, reused: 3 });
  const status = await inspectBookIndex({ boundary, database: 'artifacts/books.sqlite' });
  assert.equal(status.documents, 3);
  assert.ok(status.chunks >= 2);
  await unlink(join(root, 'books', 'plain-copy.txt'));
  const third = await buildBookIndex({ boundary, start: 'books', database: 'artifacts/books.sqlite', chunkChars: 12, overlapChars: 2 });
  assert.equal(third.removed, 1);
  assert.equal((await inspectBookIndex({ boundary, database: 'artifacts/books.sqlite' })).documents, 2);
});

test('book corpus supports short Chinese search, traceable citations, verification and JSONL export', async (t) => {
  const { root, boundary } = await fixture(t);
  await mkdir(join(root, 'books'));
  await writeFile(join(root, 'books', 'source.html'), '<html><title>测试篇</title><body><p>阴阳变化，皆有原文。</p><script>阴阳伪命中</script></body></html>', 'utf8');
  await buildBookIndex({ boundary, start: 'books', database: 'books.sqlite', chunkChars: 100, overlapChars: 0 });
  const short = await searchBookIndex({ boundary, database: 'books.sqlite', query: '阴阳' });
  assert.equal(short.total, 1);
  assert.equal(short.results[0].sectionTitle, '测试篇');
  assert.deepEqual(short.results[0].matchOffsets, [0]);
  assert.match(short.results[0].sourceSha256, /^[0-9a-f]{64}$/);
  assert.match(short.results[0].textSha256, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(short.results[0].text, /伪命中/);
  const long = await searchBookIndex({ boundary, database: 'books.sqlite', query: '皆有原文' });
  assert.equal(long.total, 1);
  const verification = await verifyBookIndex({ boundary, database: 'books.sqlite' });
  assert.equal(verification.valid, true);
  const exported = await exportBookIndex({ boundary, database: 'books.sqlite', output: 'export/books.jsonl' });
  assert.equal(exported.documents, 1);
  assert.equal(exported.chunks, 1);
  assert.match(await readFile(join(root, 'export', 'books.jsonl'), 'utf8'), /"type":"chunk"/);
});

test('kit commands expose a room-safe read-only dispatcher', async (t) => {
  const { root } = await fixture(t);
  const request = kitRequestFromObject({ command: 'search', query: 'needle here', path: 'src', ext: 'mjs', max: 5 });
  const result = await runKitCommand({ ...request, root, allowWrites: false });
  assert.equal(result.payload.totalMatches, 1);
  await assert.rejects(
    () => runKitCommand({ command: 'index', args: ['src'], options: new Map([['out', 'artifacts/indexes/x.jsonl']]), root, allowWrites: false }),
    /forbids write command/,
  );
  await assert.rejects(
    () => runKitCommand({ command: 'ocr', args: ['library/scan.pdf'], options: new Map([['out', 'artifacts/ocr']]), root, allowWrites: false }),
    /forbids OCR command/,
  );
  await assert.rejects(
    () => runKitCommand({
      command: 'ocr',
      args: ['src/secret.pdf'],
      options: new Map([['out', 'artifacts/ocr/out']]),
      root,
      allowWrites: false,
      allowOcr: true,
    }),
    /library\/ or artifacts\/ocr/,
  );
  await assert.rejects(
    () => runKitCommand({
      command: 'ocr',
      args: ['library/scan.pdf'],
      options: new Map([['out', 'artifacts/indexes'], ['cpu', true]]),
      root,
      allowWrites: false,
      allowOcr: true,
    }),
    /forbids --cpu/,
  );
});
