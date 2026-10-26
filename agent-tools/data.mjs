import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { dirname, extname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { codeUnitCompare, hashFile, walkFiles } from './core.mjs';

async function firstBytes(path, length) {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function encodingFromBom(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8-bom';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  return 'utf-8';
}

export async function auditEncodings({ boundary, start = '.', ignores = [], extensions = [] }) {
  const rows = [];
  for await (const path of walkFiles({ boundary, start, ignores, extensions })) {
    const fileStat = await stat(path);
    const prefix = await firstBytes(path, Math.min(65_536, fileStat.size));
    const encoding = encodingFromBom(prefix);
    const decoderLabel = encoding === 'utf-8-bom' ? 'utf-8' : encoding;
    const decoder = new TextDecoder(decoderLabel, { fatal: true });
    let valid = true;
    let nulBytes = 0;
    let crlf = 0;
    let lf = 0;
    let cr = 0;
    let previousCr = false;
    try {
      for await (const chunk of createReadStream(path)) {
        for (const byte of chunk) {
          if (byte === 0) nulBytes += 1;
        }
        const decoded = decoder.decode(chunk, { stream: true });
        for (const char of decoded) {
          const followedCr = previousCr;
          if (previousCr) {
            if (char === '\n') crlf += 1;
            else cr += 1;
            previousCr = false;
          }
          if (char === '\r') previousCr = true;
          else if (char === '\n' && !followedCr) lf += 1;
        }
      }
      const tail = decoder.decode();
      for (const char of tail) {
        const followedCr = previousCr;
        if (previousCr) {
          if (char === '\n') crlf += 1;
          else cr += 1;
          previousCr = false;
        }
        if (char === '\r') previousCr = true;
        else if (char === '\n' && !followedCr) lf += 1;
      }
      if (previousCr) cr += 1;
    } catch {
      valid = false;
    }
    const newline = crlf && !lf && !cr ? 'crlf' : lf && !crlf && !cr ? 'lf' : cr && !crlf && !lf ? 'cr' : crlf || lf || cr ? 'mixed' : 'none';
    rows.push({
      path: boundary.display(path), bytes: fileStat.size, encoding,
      valid, nulBytes, binaryLikely: nulBytes > 0 && !encoding.startsWith('utf-16'),
      newline, crlf, lf, cr,
    });
  }
  return rows;
}

async function* delimitedRows(path, delimiter) {
  let row = [];
  let field = '';
  let inQuotes = false;
  let quotePending = false;
  let pendingCr = false;

  function finishField() {
    row.push(field);
    field = '';
  }

  function finishRow() {
    finishField();
    const output = row;
    row = [];
    return output;
  }

  for await (const chunk of createReadStream(path, { encoding: 'utf8' })) {
    for (const char of chunk) {
      if (pendingCr) {
        pendingCr = false;
        if (char === '\n') continue;
      }
      if (inQuotes) {
        if (quotePending) {
          if (char === '"') {
            field += '"';
            quotePending = false;
            continue;
          }
          inQuotes = false;
          quotePending = false;
        } else if (char === '"') {
          quotePending = true;
          continue;
        } else {
          field += char;
          continue;
        }
      }
      if (char === '"' && field.length === 0) inQuotes = true;
      else if (char === delimiter) finishField();
      else if (char === '\n') yield finishRow();
      else if (char === '\r') {
        yield finishRow();
        pendingCr = true;
      } else field += char;
    }
  }
  if (quotePending) inQuotes = false;
  if (inQuotes) throw new TypeError('unterminated quoted field');
  if (field.length || row.length) yield finishRow();
}

function valueKind(value) {
  const text = value.trim();
  if (!text) return 'empty';
  if (/^[+-]?\d+$/u.test(text)) return 'integer';
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u.test(text)) return 'number';
  if (/^(?:true|false)$/iu.test(text)) return 'boolean';
  if (/^\d{4}-\d{2}-\d{2}(?:[T ][^\s]+)?$/u.test(text) && !Number.isNaN(Date.parse(text))) return 'date';
  return 'string';
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function createColumn(name, index) {
  return {
    name, index, values: 0, empty: 0, integer: 0, number: 0, boolean: 0,
    date: 0, string: 0, minNumber: null, maxNumber: null, minLength: null,
    maxLength: 0, distinctBits: new Uint8Array(8192), distinctSetBits: 0,
  };
}

function observeColumn(column, value) {
  column.values += 1;
  const kind = valueKind(value);
  column[kind] += 1;
  const length = value.length;
  column.minLength = column.minLength == null ? length : Math.min(column.minLength, length);
  column.maxLength = Math.max(column.maxLength, length);
  if (kind === 'integer' || kind === 'number') {
    const numeric = Number(value);
    column.minNumber = column.minNumber == null ? numeric : Math.min(column.minNumber, numeric);
    column.maxNumber = column.maxNumber == null ? numeric : Math.max(column.maxNumber, numeric);
  }
  const slot = fnv1a(value) & 0xffff;
  const byte = slot >>> 3;
  const mask = 1 << (slot & 7);
  if (!(column.distinctBits[byte] & mask)) {
    column.distinctBits[byte] |= mask;
    column.distinctSetBits += 1;
  }
}

function distinctEstimate(setBits) {
  const slots = 65_536;
  if (setBits >= slots) return null;
  return Math.round(-slots * Math.log((slots - setBits) / slots));
}

export async function profileDelimited({ boundary, file, delimiter = ',', header = true }) {
  if (delimiter === '\\t') delimiter = '\t';
  if (delimiter.length !== 1) throw new TypeError('delimiter must be exactly one character');
  const path = boundary.resolve(file);
  let columns = [];
  let rows = 0;
  let raggedRows = 0;
  for await (const row of delimitedRows(path, delimiter)) {
    if (!columns.length) {
      if (row.length) row[0] = row[0].replace(/^\uFEFF/u, '');
      columns = row.map((value, index) => createColumn(header ? value || `column_${index + 1}` : `column_${index + 1}`, index));
      if (header) continue;
    }
    rows += 1;
    if (row.length !== columns.length) raggedRows += 1;
    while (columns.length < row.length) columns.push(createColumn(`column_${columns.length + 1}`, columns.length));
    for (let index = 0; index < columns.length; index += 1) observeColumn(columns[index], row[index] ?? '');
  }
  return {
    path: boundary.display(path), delimiter: delimiter === '\t' ? 'tab' : delimiter,
    header, rows, columns: columns.map(({ distinctBits, distinctSetBits, ...column }) => ({
      ...column, approximateDistinct: distinctEstimate(distinctSetBits),
    })), raggedRows,
  };
}

export async function listZipArchive({ boundary, file }) {
  const path = boundary.resolve(file);
  const fileStat = await stat(path);
  const tailLength = Math.min(fileStat.size, 65_557);
  const handle = await open(path, 'r');
  try {
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, fileStat.size - tailLength);
    let eocd = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
    }
    if (eocd < 0) throw new TypeError('ZIP end-of-central-directory record not found');
    const count = tail.readUInt16LE(eocd + 10);
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new TypeError('ZIP64 archive requires a dedicated ZIP64 parser');
    }
    const central = Buffer.alloc(centralSize);
    await handle.read(central, 0, centralSize, centralOffset);
    const entries = [];
    let cursor = 0;
    while (cursor < central.length) {
      if (central.readUInt32LE(cursor) !== 0x02014b50) throw new TypeError(`invalid ZIP central directory at ${cursor}`);
      const flags = central.readUInt16LE(cursor + 8);
      const method = central.readUInt16LE(cursor + 10);
      const crc32 = central.readUInt32LE(cursor + 16).toString(16).padStart(8, '0');
      const compressedBytes = central.readUInt32LE(cursor + 20);
      const bytes = central.readUInt32LE(cursor + 24);
      const nameLength = central.readUInt16LE(cursor + 28);
      const extraLength = central.readUInt16LE(cursor + 30);
      const commentLength = central.readUInt16LE(cursor + 32);
      const nameBytes = central.subarray(cursor + 46, cursor + 46 + nameLength);
      const name = nameBytes.toString(flags & 0x0800 ? 'utf8' : 'latin1').replaceAll('\\', '/');
      entries.push({ name, directory: name.endsWith('/'), method, bytes, compressedBytes, crc32 });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return { path: boundary.display(path), entriesExpected: count, entries, totalBytes: entries.reduce((sum, row) => sum + row.bytes, 0) };
  } finally {
    await handle.close();
  }
}

async function loadIndex(path) {
  const rows = new Map();
  try {
    const reader = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Number.POSITIVE_INFINITY });
    for await (const line of reader) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      if (row.type === 'file') rows.set(row.path, row);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return rows;
}

async function writeLine(stream, line) {
  if (!stream.write(line)) await once(stream, 'drain');
}

export async function buildIncrementalIndex({ boundary, start = '.', output, ignores = [], extensions = [], withHash = true }) {
  if (!output) throw new TypeError('index output path is required');
  const startPath = boundary.resolve(start);
  const outputPath = boundary.resolve(output);
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  const previous = await loadIndex(outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  const stream = createWriteStream(temporaryPath, { encoding: 'utf8' });
  const contentDigest = createHash('sha256');
  let files = 0;
  let bytes = 0;
  let reused = 0;
  let hashed = 0;
  const header = { type: 'header', schema: 'yura.agent_data_index.v1', root: startPath.replaceAll('\\', '/'), hash: withHash ? 'sha256' : null };
  await writeLine(stream, `${JSON.stringify(header)}\n`);
  try {
    for await (const path of walkFiles({ boundary, start, ignores, extensions })) {
      if (resolve(path) === outputPath || resolve(path) === resolve(temporaryPath)) continue;
      const fileStat = await stat(path);
      const displayPath = boundary.display(path);
      const prior = previous.get(displayPath);
      let sha256 = null;
      if (withHash && prior?.bytes === fileStat.size && prior?.modifiedMs === fileStat.mtimeMs && prior?.sha256) {
        sha256 = prior.sha256;
        reused += 1;
      } else if (withHash) {
        sha256 = await hashFile(path);
        hashed += 1;
      }
      const row = { type: 'file', path: displayPath, bytes: fileStat.size, modifiedMs: fileStat.mtimeMs, sha256 };
      const line = `${JSON.stringify(row)}\n`;
      contentDigest.update(line);
      await writeLine(stream, line);
      files += 1;
      bytes += fileStat.size;
    }
    const trailer = { type: 'trailer', files, bytes, contentSha256: contentDigest.digest('hex') };
    await writeLine(stream, `${JSON.stringify(trailer)}\n`);
    stream.end();
    await once(stream, 'close');
    await rename(temporaryPath, outputPath);
    return { output: boundary.display(outputPath), files, bytes, reused, hashed, contentSha256: trailer.contentSha256 };
  } catch (error) {
    stream.destroy();
    await once(stream, 'close').catch(() => {});
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function profileJsonSchema({ boundary, file }) {
  const path = boundary.resolve(file);
  const fields = new Map();
  const reader = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Number.POSITIVE_INFINITY });
  let rows = 0;
  let invalid = 0;
  let first = true;
  for await (const line of reader) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(first ? line.replace(/^\uFEFF/u, '') : line);
      first = false;
      rows += 1;
      if (value == null || typeof value !== 'object' || Array.isArray(value)) continue;
      for (const [key, child] of Object.entries(value)) {
        if (!fields.has(key)) fields.set(key, { present: 0, null: 0, string: 0, number: 0, boolean: 0, object: 0, array: 0 });
        const field = fields.get(key);
        field.present += 1;
        const kind = child === null ? 'null' : Array.isArray(child) ? 'array' : typeof child;
        if (Object.hasOwn(field, kind)) field[kind] += 1;
      }
    } catch {
      invalid += 1;
    }
  }
  return {
    path: boundary.display(path), rows, invalid,
    fields: [...fields].sort(([a], [b]) => codeUnitCompare(a, b)).map(([name, counts]) => ({ name, missing: rows - counts.present, ...counts })),
  };
}
