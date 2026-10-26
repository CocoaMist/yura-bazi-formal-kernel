import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, posix, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { codeUnitCompare, walkFiles } from './core.mjs';

export const BOOK_EXTENSIONS = Object.freeze(['.txt', '.md', '.markdown', '.html', '.htm', '.xhtml', '.xml', '.epub']);
export const BOOK_CORPUS_VERSION = 'book-corpus-v1';
const DEFAULT_CHUNK_CHARS = 5_200;
const DEFAULT_OVERLAP_CHARS = 800;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function decodeBytes(bytes, requestedEncoding = 'auto') {
  let encoding = requestedEncoding;
  let offset = 0;
  if (requestedEncoding === 'auto') {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      encoding = 'utf-8';
      offset = 3;
    } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      encoding = 'utf-16le';
      offset = 2;
    } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      encoding = 'utf-16be';
      offset = 2;
    } else encoding = 'utf-8';
  }
  try {
    return { text: new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset)), encoding };
  } catch (error) {
    throw new Error(`cannot decode as ${encoding}; pass --encoding explicitly (${error.message})`);
  }
}

function decodeEntities(text) {
  const named = new Map([
    ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"],
    ['nbsp', ' '], ['ensp', ' '], ['emsp', ' '], ['ndash', '–'], ['mdash', '—'],
  ]);
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity) => {
    if (entity[0] !== '#') return named.get(entity.toLowerCase()) ?? whole;
    const radix = entity[1]?.toLowerCase() === 'x' ? 16 : 10;
    const digits = radix === 16 ? entity.slice(2) : entity.slice(1);
    const code = Number.parseInt(digits, radix);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

function normalizeText(text) {
  return text
    .replaceAll('\u0000', '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function markupToText(markup) {
  return normalizeText(decodeEntities(markup
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<(script|style|svg|nav)\b[^>]*>[^]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|h[1-6]|li|tr|blockquote)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')));
}

function extractTitle(markup, fallback) {
  const match = markup.match(/<(?:title|h1)\b[^>]*>([^]*?)<\/(?:title|h1)\s*>/i);
  return match ? markupToText(match[1]) : fallback;
}

function findEndOfCentralDirectory(bytes) {
  const floor = Math.max(0, bytes.length - 65_557);
  for (let index = bytes.length - 22; index >= floor; index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50) return index;
  }
  throw new Error('ZIP end-of-central-directory record not found');
}

function zipEntries(bytes) {
  const eocd = findEndOfCentralDirectory(bytes);
  const count = bytes.readUInt16LE(eocd + 10);
  let cursor = bytes.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('invalid ZIP central directory');
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedBytes = bytes.readUInt32LE(cursor + 20);
    const uncompressedBytes = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = nameBytes.toString(flags & 0x0800 ? 'utf8' : 'latin1').replaceAll('\\', '/');
    if (name.startsWith('/') || name.split('/').includes('..')) throw new Error(`unsafe ZIP entry: ${name}`);
    entries.push({ name, flags, method, compressedBytes, uncompressedBytes, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries.sort((left, right) => codeUnitCompare(left.name, right.name));
}

function readZipEntry(archive, entry) {
  if (entry.flags & 1) throw new Error(`encrypted ZIP entry is unsupported: ${entry.name}`);
  if (archive.readUInt32LE(entry.localOffset) !== 0x04034b50) throw new Error(`invalid local ZIP header: ${entry.name}`);
  const nameLength = archive.readUInt16LE(entry.localOffset + 26);
  const extraLength = archive.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const packed = archive.subarray(start, start + entry.compressedBytes);
  const output = entry.method === 0 ? packed : entry.method === 8 ? inflateRawSync(packed) : null;
  if (!output) throw new Error(`unsupported ZIP compression method ${entry.method}: ${entry.name}`);
  if (output.length !== entry.uncompressedBytes) throw new Error(`ZIP size mismatch: ${entry.name}`);
  return output;
}

function xmlAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match?.[1] ?? match?.[2] ?? null;
}

function resolveArchivePath(base, target) {
  const decoded = decodeURIComponent(target.split('#')[0]);
  const output = posix.normalize(posix.join(posix.dirname(base), decoded));
  if (output.startsWith('../') || output.startsWith('/')) throw new Error(`unsafe EPUB reference: ${target}`);
  return output;
}

function extractEpub(bytes, requestedEncoding) {
  const entries = zipEntries(bytes);
  const byName = new Map(entries.map(entry => [entry.name, entry]));
  let orderedNames = [];
  const containerEntry = byName.get('META-INF/container.xml');
  if (containerEntry) {
    const container = decodeBytes(readZipEntry(bytes, containerEntry), requestedEncoding).text;
    const rootfileTag = container.match(/<rootfile\b[^>]*>/i)?.[0];
    const opfName = rootfileTag ? xmlAttribute(rootfileTag, 'full-path') : null;
    const opfEntry = opfName ? byName.get(opfName) : null;
    if (opfEntry) {
      const opf = decodeBytes(readZipEntry(bytes, opfEntry), requestedEncoding).text;
      const manifest = new Map();
      for (const tag of opf.match(/<item\b[^>]*>/gi) ?? []) {
        const id = xmlAttribute(tag, 'id');
        const href = xmlAttribute(tag, 'href');
        const mediaType = xmlAttribute(tag, 'media-type') ?? '';
        if (id && href && /(?:xhtml|html|xml)/i.test(mediaType)) manifest.set(id, resolveArchivePath(opfName, href));
      }
      for (const tag of opf.match(/<itemref\b[^>]*>/gi) ?? []) {
        const name = manifest.get(xmlAttribute(tag, 'idref'));
        if (name && byName.has(name)) orderedNames.push(name);
      }
    }
  }
  if (!orderedNames.length) orderedNames = entries.map(entry => entry.name).filter(name => /\.(?:xhtml|html|htm)$/i.test(name));
  const seen = new Set();
  const sections = [];
  for (const name of orderedNames) {
    if (seen.has(name)) continue;
    seen.add(name);
    const entry = byName.get(name);
    const decoded = decodeBytes(readZipEntry(bytes, entry), requestedEncoding);
    const text = markupToText(decoded.text);
    if (text) sections.push({ title: extractTitle(decoded.text, posix.basename(name)), sourceEntry: name, text, encoding: decoded.encoding });
  }
  if (!sections.length) throw new Error('EPUB contains no readable spine or HTML sections');
  return sections;
}

export async function extractBook({ path, encoding = 'auto' }) {
  const bytes = await readFile(path);
  const extension = extname(path).toLowerCase();
  let sections;
  if (extension === '.epub') sections = extractEpub(bytes, encoding);
  else {
    const decoded = decodeBytes(bytes, encoding);
    const markup = ['.html', '.htm', '.xhtml', '.xml'].includes(extension);
    const html = ['.html', '.htm', '.xhtml'].includes(extension);
    const body = html ? decoded.text.match(/<body\b[^>]*>([^]*?)<\/body\s*>/i)?.[1] ?? decoded.text : decoded.text;
    const text = markup ? markupToText(body) : normalizeText(decoded.text);
    sections = text ? [{ title: html ? extractTitle(decoded.text, null) : null, sourceEntry: null, text, encoding: decoded.encoding }] : [];
  }
  return {
    format: extension.slice(1), bytes: bytes.length, sourceSha256: sha256(bytes),
    extractedSha256: sha256(sections.map(section => section.text).join('\n\n')),
    sections,
  };
}

function chooseBoundary(text, start, idealEnd) {
  if (idealEnd >= text.length) return text.length;
  const radius = Math.max(80, Math.floor((idealEnd - start) * 0.12));
  const floor = Math.max(start + 1, idealEnd - radius);
  const ceiling = Math.min(text.length, idealEnd + radius);
  for (let cursor = idealEnd; cursor < ceiling; cursor += 1) if (/\n|[。！？!?；;]/.test(text[cursor])) return cursor + 1;
  for (let cursor = idealEnd; cursor >= floor; cursor -= 1) if (/\n|[。！？!?；;]/.test(text[cursor])) return cursor + 1;
  return idealEnd;
}

export function chunkSections(sections, { chunkChars = DEFAULT_CHUNK_CHARS, overlapChars = DEFAULT_OVERLAP_CHARS } = {}) {
  if (!Number.isInteger(chunkChars) || chunkChars < 1) throw new Error('chunkChars must be a positive integer');
  if (!Number.isInteger(overlapChars) || overlapChars < 0 || overlapChars >= chunkChars) throw new Error('overlapChars must be an integer from 0 to chunkChars - 1');
  const chunks = [];
  sections.forEach((section, sectionIndex) => {
    let start = 0;
    while (start < section.text.length) {
      const end = chooseBoundary(section.text, start, Math.min(section.text.length, start + chunkChars));
      const text = section.text.slice(start, end);
      const textSha256 = sha256(text);
      chunks.push({ sectionIndex, sectionTitle: section.title, sourceEntry: section.sourceEntry, startChar: start, endChar: end, text, textSha256 });
      if (end >= section.text.length) break;
      start = Math.max(start + 1, end - overlapChars);
    }
  });
  return chunks;
}

async function openDatabase(path) {
  const { DatabaseSync } = await import('node:sqlite');
  await mkdir(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, format TEXT NOT NULL,
      source_sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, mtime_ms INTEGER NOT NULL,
      extracted_sha256 TEXT NOT NULL, encoding TEXT NOT NULL,
      section_count INTEGER NOT NULL, chunk_count INTEGER NOT NULL,
      chunk_chars INTEGER NOT NULL, overlap_chars INTEGER NOT NULL, corpus_version TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chunks (
      rowid INTEGER PRIMARY KEY, chunk_id TEXT NOT NULL UNIQUE,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      section_index INTEGER NOT NULL, section_title TEXT, source_entry TEXT,
      start_char INTEGER NOT NULL, end_char INTEGER NOT NULL,
      text_sha256 TEXT NOT NULL, text TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, content='chunks', content_rowid='rowid', tokenize='trigram');
    CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
      INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    END;
    CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
      INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
      INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
    END;
  `);
  database.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('corpus_version', BOOK_CORPUS_VERSION);
  return database;
}

function supportedBook(path) {
  return BOOK_EXTENSIONS.includes(extname(path).toLowerCase());
}

export async function buildBookIndex({
  boundary, start = '.', database: databaseInput, encoding = 'auto',
  chunkChars = DEFAULT_CHUNK_CHARS, overlapChars = DEFAULT_OVERLAP_CHARS, ignores = [],
}) {
  if (!databaseInput) throw new Error('database path is required');
  const databasePath = boundary.resolve(databaseInput);
  const sources = [];
  for await (const path of walkFiles({ boundary, start, ignores })) if (supportedBook(path) && resolve(path) !== resolve(databasePath)) sources.push(path);
  sources.sort(codeUnitCompare);
  const database = await openDatabase(databasePath);
  const existing = database.prepare('SELECT * FROM documents WHERE path = ?');
  const remove = database.prepare('DELETE FROM documents WHERE id = ?');
  const addDocument = database.prepare(`INSERT INTO documents
    (path, format, source_sha256, bytes, mtime_ms, extracted_sha256, encoding, section_count, chunk_count, chunk_chars, overlap_chars, corpus_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const addChunk = database.prepare(`INSERT INTO chunks
    (chunk_id, document_id, section_index, section_title, source_entry, start_char, end_char, text_sha256, text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let indexed = 0;
  let reused = 0;
  let removed = 0;
  let chunkCount = 0;
  try {
    for (const path of sources) {
      const fileStat = await stat(path);
      const pathValue = boundary.display(path);
      const prior = existing.get(pathValue);
      if (prior && prior.bytes === fileStat.size && prior.mtime_ms === Math.trunc(fileStat.mtimeMs)
          && prior.chunk_chars === chunkChars && prior.overlap_chars === overlapChars
          && prior.encoding === encoding && prior.corpus_version === BOOK_CORPUS_VERSION) {
        reused += 1;
        chunkCount += prior.chunk_count;
        continue;
      }
      const extracted = await extractBook({ path, encoding });
      const chunks = chunkSections(extracted.sections, { chunkChars, overlapChars });
      database.exec('BEGIN IMMEDIATE');
      try {
        if (prior) remove.run(prior.id);
        const result = addDocument.run(
          pathValue, extracted.format, extracted.sourceSha256, extracted.bytes, Math.trunc(fileStat.mtimeMs),
          extracted.extractedSha256, encoding, extracted.sections.length, chunks.length,
          chunkChars, overlapChars, BOOK_CORPUS_VERSION,
        );
        const documentId = Number(result.lastInsertRowid);
        for (const chunk of chunks) {
          const chunkId = sha256(`${BOOK_CORPUS_VERSION}\0${pathValue}\0${extracted.sourceSha256}\0${chunk.sectionIndex}\0${chunk.startChar}\0${chunk.endChar}\0${chunk.textSha256}`);
          addChunk.run(chunkId, documentId, chunk.sectionIndex, chunk.sectionTitle, chunk.sourceEntry, chunk.startChar, chunk.endChar, chunk.textSha256, chunk.text);
        }
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
      indexed += 1;
      chunkCount += chunks.length;
    }
    const sourcePaths = new Set(sources.map(path => boundary.display(path)));
    const scope = boundary.display(boundary.resolve(start));
    const scopePrefix = scope === '.' ? '' : `${scope.replace(/\/$/, '')}/`;
    for (const row of database.prepare('SELECT id, path FROM documents ORDER BY path').all()) {
      const inScope = scope === '.' || row.path === scope || row.path.startsWith(scopePrefix);
      if (inScope && !sourcePaths.has(row.path)) {
        remove.run(row.id);
        removed += 1;
      }
    }
    return { database: boundary.display(databasePath), files: sources.length, indexed, reused, removed, chunks: chunkCount, chunkChars, overlapChars, corpusVersion: BOOK_CORPUS_VERSION };
  } finally {
    database.close();
  }
}

function exactPhrase(query) {
  return `"${query.replaceAll('"', '""')}"`;
}

export async function searchBookIndex({ boundary, database: databaseInput, query, maxResults = Number.POSITIVE_INFINITY }) {
  if (!databaseInput) throw new Error('database path is required');
  if (!query) throw new Error('book search query is required');
  const database = await openDatabase(boundary.resolve(databaseInput));
  const columns = `SELECT d.path, d.format, d.source_sha256, d.extracted_sha256,
    c.chunk_id, c.section_index, c.section_title, c.source_entry,
    c.start_char, c.end_char, c.text_sha256, c.text`;
  let rows;
  try {
    if ([...query].length >= 3) {
      rows = database.prepare(`${columns} FROM chunks_fts f JOIN chunks c ON c.rowid=f.rowid JOIN documents d ON d.id=c.document_id WHERE chunks_fts MATCH ? ORDER BY d.path, c.section_index, c.start_char`).all(exactPhrase(query));
    } else {
      rows = database.prepare(`${columns} FROM chunks c JOIN documents d ON d.id=c.document_id WHERE instr(c.text, ?) > 0 ORDER BY d.path, c.section_index, c.start_char`).all(query);
    }
    const total = rows.length;
    const selected = Number.isFinite(maxResults) ? rows.slice(0, maxResults) : rows;
    return {
      database: boundary.display(boundary.resolve(databaseInput)), query, total, omitted: total - selected.length,
      results: selected.map(row => ({
        path: row.path, format: row.format, sourceSha256: row.source_sha256, extractedSha256: row.extracted_sha256,
        chunkId: row.chunk_id, sectionIndex: row.section_index, sectionTitle: row.section_title,
        sourceEntry: row.source_entry, startChar: row.start_char, endChar: row.end_char,
        textSha256: row.text_sha256, matchOffsets: [...row.text.matchAll(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gu'))].map(match => row.start_char + match.index),
        text: row.text,
      })),
    };
  } finally {
    database.close();
  }
}

export async function inspectBookIndex({ boundary, database: databaseInput }) {
  if (!databaseInput) throw new Error('database path is required');
  const database = await openDatabase(boundary.resolve(databaseInput));
  try {
    const totals = database.prepare('SELECT COUNT(*) documents, COALESCE(SUM(bytes),0) source_bytes, COALESCE(SUM(section_count),0) sections, COALESCE(SUM(chunk_count),0) chunks FROM documents').get();
    const formats = database.prepare('SELECT format, COUNT(*) files, SUM(bytes) bytes, SUM(chunk_count) chunks FROM documents GROUP BY format ORDER BY format').all();
    return { database: boundary.display(boundary.resolve(databaseInput)), corpusVersion: database.prepare("SELECT value FROM meta WHERE key='corpus_version'").get()?.value, ...totals, formats };
  } finally {
    database.close();
  }
}

export async function verifyBookIndex({ boundary, database: databaseInput }) {
  if (!databaseInput) throw new Error('database path is required');
  const databasePath = boundary.resolve(databaseInput);
  const database = await openDatabase(databasePath);
  const failures = [];
  try {
    const integrity = database.prepare('PRAGMA integrity_check').all().map(row => row.integrity_check);
    const foreignKeys = database.prepare('PRAGMA foreign_key_check').all();
    const documents = database.prepare('SELECT * FROM documents ORDER BY path').all();
    for (const document of documents) {
      const path = boundary.resolve(document.path);
      try {
        const extracted = await extractBook({ path, encoding: document.encoding });
        if (extracted.sourceSha256 !== document.source_sha256) failures.push({ path: document.path, type: 'source-hash', expected: document.source_sha256, actual: extracted.sourceSha256 });
        if (extracted.extractedSha256 !== document.extracted_sha256) failures.push({ path: document.path, type: 'extracted-hash', expected: document.extracted_sha256, actual: extracted.extractedSha256 });
      } catch (error) {
        failures.push({ path: document.path, type: 'source-read', error: error.message });
      }
    }
    for (const row of database.prepare('SELECT chunk_id, text_sha256, text FROM chunks ORDER BY rowid').iterate()) {
      const actual = sha256(row.text);
      if (actual !== row.text_sha256) failures.push({ chunkId: row.chunk_id, type: 'chunk-hash', expected: row.text_sha256, actual });
    }
    const chunks = database.prepare('SELECT COUNT(*) count FROM chunks').get().count;
    const ftsChunks = database.prepare('SELECT COUNT(*) count FROM chunks_fts').get().count;
    if (chunks !== ftsChunks) failures.push({ type: 'fts-count', chunks, ftsChunks });
    return { database: boundary.display(databasePath), valid: integrity.length === 1 && integrity[0] === 'ok' && !foreignKeys.length && !failures.length, integrity, foreignKeyFailures: foreignKeys, failures, documents: documents.length, chunks, ftsChunks };
  } finally {
    database.close();
  }
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, content);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function exportBookIndex({ boundary, database: databaseInput, output }) {
  if (!databaseInput) throw new Error('database path is required');
  if (!output) throw new Error('output path is required');
  const database = await openDatabase(boundary.resolve(databaseInput));
  try {
    const lines = [];
    const documents = database.prepare('SELECT * FROM documents ORDER BY path').all();
    for (const document of documents) lines.push(JSON.stringify({ type: 'document', ...document }));
    const chunks = database.prepare(`SELECT d.path, c.chunk_id, c.section_index, c.section_title, c.source_entry, c.start_char, c.end_char, c.text_sha256, c.text
      FROM chunks c JOIN documents d ON d.id=c.document_id ORDER BY d.path, c.section_index, c.start_char`).all();
    for (const chunk of chunks) lines.push(JSON.stringify({ type: 'chunk', ...chunk }));
    const body = `${lines.join('\n')}${lines.length ? '\n' : ''}`;
    const outputPath = boundary.resolve(output);
    await atomicWrite(outputPath, body);
    return { output: boundary.display(outputPath), documents: documents.length, chunks: chunks.length, bytes: Buffer.byteLength(body), sha256: sha256(body) };
  } finally {
    database.close();
  }
}
