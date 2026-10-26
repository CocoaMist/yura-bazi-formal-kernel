import { createReadStream } from 'node:fs';
import { lstat, open, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';

export const DEFAULT_IGNORES = Object.freeze([]);

export function codeUnitCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function parsePositiveInteger(value, label, fallback) {
  if (value == null) return fallback;
  if (!/^[1-9]\d*$/.test(String(value))) throw new Error(`${label} must be a positive integer`);
  return Number(value);
}

export function createBoundary(rootPath) {
  const root = resolve(rootPath);
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return {
    root,
    resolve(input = '.') {
      return resolve(root, input);
    },
    display(path) {
      const absolute = resolve(path);
      const value = (absolute === root || absolute.startsWith(rootPrefix)
        ? relative(root, absolute)
        : absolute).replaceAll('\\', '/');
      return value || '.';
    },
  };
}

async function isReadableTextFile(path, maxBytes = Number.POSITIVE_INFINITY) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > maxBytes) return false;
  const handle = await open(path, 'r');
  try {
    const length = Math.min(stat.size, 4096);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return !buffer.subarray(0, length).includes(0);
  } finally {
    await handle.close();
  }
}

export async function collectFiles({
  boundary,
  start = '.',
  ignores = DEFAULT_IGNORES,
  extensions = [],
  maxFiles = Number.POSITIVE_INFINITY,
}) {
  const files = [];
  for await (const file of walkFiles({ boundary, start, ignores, extensions, maxFiles })) files.push(file);
  return files.sort(codeUnitCompare);
}

export async function* walkFiles({
  boundary,
  start = '.',
  ignores = DEFAULT_IGNORES,
  extensions = [],
  maxFiles = Number.POSITIVE_INFINITY,
}) {
  const ignored = new Set(ignores);
  const normalizedExtensions = new Set(extensions.map((value) => (
    value.startsWith('.') ? value.toLowerCase() : `.${value.toLowerCase()}`
  )));
  const seenDirectories = new Set();
  let visited = 0;

  async function* walk(path) {
    const linkStat = await lstat(path);
    const actualPath = linkStat.isSymbolicLink() ? await realpath(path) : path;
    const currentStat = linkStat.isSymbolicLink() ? await stat(actualPath) : linkStat;
    if (currentStat.isFile()) {
      visited += 1;
      if (visited > maxFiles) return;
      if (!normalizedExtensions.size || normalizedExtensions.has(extname(path).toLowerCase())) yield path;
      return;
    }
    if (!currentStat.isDirectory()) return;
    const directoryIdentity = await realpath(actualPath);
    if (seenDirectories.has(directoryIdentity)) return;
    seenDirectories.add(directoryIdentity);
    const entries = (await readdir(path, { withFileTypes: true }))
      .filter((entry) => !ignored.has(entry.name))
      .sort((left, right) => codeUnitCompare(left.name, right.name));
    for (const entry of entries) yield* walk(resolve(path, entry.name));
  }

  yield* walk(boundary.resolve(start));
}

export function compactLine(text, maxColumns = Number.POSITIVE_INFINITY) {
  const oneLine = text.replaceAll('\t', ' ').trim().replace(/\s+/g, ' ');
  if (!Number.isFinite(maxColumns)) return oneLine;
  if (oneLine.length <= maxColumns) return oneLine;
  return `${oneLine.slice(0, Math.max(1, maxColumns - 1))}…`;
}

export function globToRegExp(glob, { caseSensitive = false } = {}) {
  const source = String(glob)
    .replaceAll('\\', '/')
    .split('')
    .map((char) => {
      if (char === '*') return '.*';
      if (char === '?') return '.';
      if ('\\^$+{}()|[]'.includes(char)) return `\\${char}`;
      if (char === '.') return '\\.';
      return char;
    })
    .join('');
  return new RegExp(`^${source}$`, caseSensitive ? '' : 'i');
}

export function pathMatchesQuery(path, query, { glob = false, caseSensitive = false } = {}) {
  const display = String(path).replaceAll('\\', '/');
  const name = display.slice(display.lastIndexOf('/') + 1);
  const raw = String(query ?? '').trim();
  if (!raw) return false;
  const useGlob = glob || /[*?]/u.test(raw);
  if (useGlob) {
    const expression = globToRegExp(raw, { caseSensitive });
    return expression.test(display) || expression.test(name) || expression.test(display.split('/').pop());
  }
  const hayPath = caseSensitive ? display : display.toLocaleLowerCase('en-US');
  const hayName = caseSensitive ? name : name.toLocaleLowerCase('en-US');
  const needle = caseSensitive ? raw : raw.toLocaleLowerCase('en-US');
  return hayPath.includes(needle) || hayName.includes(needle);
}

function literalHits(line, query, caseSensitive) {
  const hay = caseSensitive ? line : line.toLocaleLowerCase('en-US');
  const needle = caseSensitive ? query : query.toLocaleLowerCase('en-US');
  if (!needle) return { count: 0, column: 0, length: 0 };
  let from = 0;
  let count = 0;
  let column = 0;
  while (from <= hay.length) {
    const at = hay.indexOf(needle, from);
    if (at < 0) break;
    count += 1;
    if (!column) column = at + 1;
    from = at + Math.max(needle.length, 1);
    if (!needle.length) break;
  }
  return { count, column, length: query.length };
}

function regexHits(line, expression) {
  expression.lastIndex = 0;
  const matches = [...line.matchAll(expression)];
  if (!matches.length) return { count: 0, column: 0, length: 0 };
  return { count: matches.length, column: (matches[0].index ?? 0) + 1, length: matches[0][0].length };
}

export function matchSnippet(line, column, matchLength, maxColumns = Number.POSITIVE_INFINITY) {
  const start = Math.max(0, column - 1);
  const end = start + Math.max(matchLength, 0);
  const marked = `${line.slice(0, start)}«${line.slice(start, end)}»${line.slice(end)}`;
  return compactLine(marked, maxColumns);
}

export async function searchFileNames({
  boundary,
  query,
  start = '.',
  glob = false,
  caseSensitive = false,
  extensions = [],
  ignores = DEFAULT_IGNORES,
  maxResults = Number.POSITIVE_INFINITY,
}) {
  if (!query) throw new Error('file-name query is required');
  const files = [];
  for await (const file of walkFiles({ boundary, start, ignores, extensions })) {
    const path = boundary.display(file);
    if (!pathMatchesQuery(path, query, { glob, caseSensitive })) continue;
    files.push(path);
  }
  files.sort(codeUnitCompare);
  const selected = files.slice(0, maxResults);
  return {
    query,
    files: selected,
    total: files.length,
    omitted: Math.max(0, files.length - selected.length),
    truncated: files.length > selected.length,
  };
}

export async function searchText({
  boundary,
  query,
  start = '.',
  fixed = true,
  caseSensitive = false,
  extensions = [],
  ignores = DEFAULT_IGNORES,
  name = '',
  glob = false,
  maxResults = Number.POSITIVE_INFINITY,
  maxBytes = Number.POSITIVE_INFINITY,
  maxColumns = Number.POSITIVE_INFINITY,
  context = 0,
}) {
  if (!query) throw new Error('search query is required');
  const contextLines = Number.isInteger(context) && context >= 0 ? context : 0;
  const flags = caseSensitive ? 'g' : 'gi';
  const expression = fixed
    ? null
    : new RegExp(query, flags);
  const results = [];
  let totalMatches = 0;
  let searchedFiles = 0;
  let skippedFiles = 0;
  let truncated = false;

  fileLoop: for await (const file of walkFiles({ boundary, start, extensions, ignores })) {
    const path = boundary.display(file);
    if (name && !pathMatchesQuery(path, name, { glob, caseSensitive })) continue;
    if (!(await isReadableTextFile(file, maxBytes))) {
      skippedFiles += 1;
      continue;
    }
    searchedFiles += 1;
    const reader = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Number.POSITIVE_INFINITY });
    const previous = [];
    const openHits = [];
    let index = 0;
    for await (const line of reader) {
      index += 1;
      const hits = expression ? regexHits(line, expression) : literalHits(line, query, caseSensitive);
      if (hits.count) {
        totalMatches += hits.count;
        if (results.length < maxResults) {
          const hit = {
            path,
            line: index,
            column: hits.column,
            count: hits.count,
            text: compactLine(line, maxColumns),
            snippet: matchSnippet(line, hits.column, hits.length, maxColumns),
            before: previous.map((row) => ({ line: row.line, text: compactLine(row.text, maxColumns) })),
            after: [],
          };
          results.push(hit);
          if (contextLines) openHits.push({ hit, remaining: contextLines });
        } else {
          truncated = true;
          reader.close();
          break fileLoop;
        }
      }
      for (const pending of openHits) {
        if (pending.remaining > 0 && index > pending.hit.line) {
          pending.hit.after.push({ line: index, text: compactLine(line, maxColumns) });
          pending.remaining -= 1;
        }
      }
      while (openHits.length && openHits[0].remaining === 0) openHits.shift();
      if (contextLines) {
        previous.push({ line: index, text: line });
        if (previous.length > contextLines) previous.shift();
      }
    }
  }
  return {
    query,
    results,
    totalMatches,
    searchedFiles,
    skippedFiles,
    truncated: truncated || results.length < totalMatches,
  };
}

export function formatSearchHits(payload) {
  const lines = [];
  let currentPath = null;
  for (const row of payload.results ?? []) {
    if (row.path !== currentPath) {
      if (currentPath != null) lines.push('');
      currentPath = row.path;
      lines.push(row.path);
    }
    for (const before of row.before ?? []) lines.push(`  ${before.line}- ${before.text}`);
    lines.push(`  ${row.line}:${row.column ?? 1} ${row.snippet ?? row.text}`);
    for (const after of row.after ?? []) lines.push(`  ${after.line}- ${after.text}`);
  }
  return lines;
}

function usefulToken(value) {
  const token = String(value ?? '').trim();
  if (!token) return false;
  if (/[\u3400-\u9fff]/u.test(token)) return token.length >= 1;
  return token.length >= 3;
}

export function associateQuery(query) {
  const exact = String(query ?? '').trim();
  const variants = [];
  const seen = new Set();
  const add = (value) => {
    const token = String(value ?? '').trim();
    if (!usefulToken(token)) return;
    const key = token.toLocaleLowerCase('en-US');
    if (seen.has(key) || token === exact) return;
    seen.add(key);
    variants.push(token);
  };
  const spaced = exact
    .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, '$1 $2')
    .replace(/([\p{Lu}]+)([\p{Lu}][\p{Ll}])/gu, '$1 $2');
  for (const part of spaced.split(/[\s_./\\:,;|()[\]{}'"`+-]+/u)) add(part);
  for (const part of exact.split(/[\s\p{P}]+/u)) add(part);
  if (/^[\u3400-\u9fff]+$/u.test(exact) && exact.length >= 4) {
    for (let index = 0; index < exact.length - 1 && index < 8; index += 1) add(exact.slice(index, index + 2));
  }
  const camel = spaced.split(/[\s_./\\:-]+/u).filter(Boolean);
  if (camel.length > 1) {
    add(camel.join('_'));
    add(camel.join('-'));
    add(camel.map((part, index) => (index === 0 ? part.toLocaleLowerCase('en-US') : part)).join(''));
  }
  variants.sort(codeUnitCompare);
  return { exact, tokens: Object.freeze(variants) };
}

function parentOf(path) {
  const at = String(path).lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

export function formatLookup(payload) {
  const lines = [`QUERY ${payload.query}`];
  if (payload.files?.length) {
    lines.push('FILES');
    for (const path of payload.files) lines.push(`- ${path}`);
  }
  if (payload.content?.length) {
    lines.push('CONTENT');
    lines.push(...formatSearchHits({ results: payload.content }));
  }
  if (payload.related?.length) {
    let currentWhy = null;
    for (const row of payload.related) {
      if (row.why !== currentWhy) {
        currentWhy = row.why;
        lines.push(`RELATED ${row.why}`);
      }
      if (row.line != null) lines.push(`- ${row.path}:${row.line} ${row.snippet ?? row.text ?? ''}`);
      else lines.push(`- ${row.path}`);
    }
  }
  if (!payload.files?.length && !payload.content?.length && !payload.related?.length) lines.push('NO MATCH');
  return lines;
}

export async function lookupSources({
  boundary,
  query,
  start = '.',
  caseSensitive = false,
  extensions = [],
  ignores = DEFAULT_IGNORES,
  maxResults = Number.POSITIVE_INFINITY,
  maxRelated = Number.POSITIVE_INFINITY,
  maxBytes = Number.POSITIVE_INFINITY,
  maxColumns = Number.POSITIVE_INFINITY,
  context = 2,
}) {
  if (!query) throw new Error('lookup query is required');
  const associated = associateQuery(query);
  const files = [];
  const content = [];
  const related = [];
  const relatedKeys = new Set();
  const exactPaths = new Set();
  const seenPaths = [];
  const contextLines = Number.isInteger(context) && context >= 0 ? context : 0;
  let searchedFiles = 0;
  let skippedFiles = 0;
  let truncated = false;

  const rememberRelated = (row) => {
    const key = `${row.why}\0${row.path}\0${row.line ?? ''}`;
    if (relatedKeys.has(key) || (exactPaths.has(row.path) && row.line == null)) return;
    if (related.length >= maxRelated) {
      truncated = true;
      return;
    }
    relatedKeys.add(key);
    related.push(row);
  };

  fileLoop: for await (const file of walkFiles({ boundary, start, extensions, ignores })) {
    const path = boundary.display(file);
    seenPaths.push(path);
    if (pathMatchesQuery(path, associated.exact, { caseSensitive })) {
      if (files.length < maxResults) {
        files.push(path);
        exactPaths.add(path);
      } else truncated = true;
    } else {
      const token = associated.tokens.find((item) => pathMatchesQuery(path, item, { caseSensitive }));
      if (token) rememberRelated({ why: `name:${token}`, path });
    }

    const needContent = content.length < maxResults || related.length < maxRelated;
    if (!needContent) continue;
    if (!(await isReadableTextFile(file, maxBytes))) {
      skippedFiles += 1;
      continue;
    }
    searchedFiles += 1;
    const reader = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Number.POSITIVE_INFINITY });
    const previous = [];
    const openHits = [];
    let index = 0;
    let relatedForFile = false;
    for await (const line of reader) {
      index += 1;
      const exactHits = literalHits(line, associated.exact, caseSensitive);
      if (exactHits.count) {
        exactPaths.add(path);
        if (content.length < maxResults) {
          const hit = {
            path,
            line: index,
            column: exactHits.column,
            count: exactHits.count,
            text: compactLine(line, maxColumns),
            snippet: matchSnippet(line, exactHits.column, exactHits.length, maxColumns),
            before: previous.map((row) => ({ line: row.line, text: compactLine(row.text, maxColumns) })),
            after: [],
          };
          content.push(hit);
          if (contextLines) openHits.push({ hit, remaining: contextLines });
        } else {
          truncated = true;
          reader.close();
          break fileLoop;
        }
      } else if (!relatedForFile && related.length < maxRelated) {
        for (const token of associated.tokens) {
          const hits = literalHits(line, token, caseSensitive);
          if (!hits.count) continue;
          relatedForFile = true;
          rememberRelated({
            why: `content:${token}`,
            path,
            line: index,
            column: hits.column,
            text: compactLine(line, maxColumns),
            snippet: matchSnippet(line, hits.column, hits.length, maxColumns),
          });
          break;
        }
      }
      for (const pending of openHits) {
        if (pending.remaining > 0 && index > pending.hit.line) {
          pending.hit.after.push({ line: index, text: compactLine(line, maxColumns) });
          pending.remaining -= 1;
        }
      }
      while (openHits.length && openHits[0].remaining === 0) openHits.shift();
      if (contextLines) {
        previous.push({ line: index, text: line });
        if (previous.length > contextLines) previous.shift();
      }
    }
  }

  const parents = new Set([...exactPaths].map(parentOf).filter(Boolean));
  for (const path of seenPaths) {
    if (exactPaths.has(path)) continue;
    const parent = parentOf(path);
    if (parent && parents.has(parent)) rememberRelated({ why: 'same-directory', path });
  }

  related.sort((left, right) => codeUnitCompare(left.why, right.why) || codeUnitCompare(left.path, right.path) || (left.line ?? 0) - (right.line ?? 0));
  files.sort(codeUnitCompare);
  return {
    query: associated.exact,
    tokens: associated.tokens,
    files,
    content,
    related,
    searchedFiles,
    skippedFiles,
    truncated,
  };
}

export async function readLines({
  boundary,
  file,
  startLine = 1,
  endLine,
  maxLines = Number.POSITIVE_INFINITY,
  maxColumns = Number.POSITIVE_INFINITY,
}) {
  if (!file) throw new Error('file path is required');
  const path = boundary.resolve(file);
  const stat = await lstat(path);
  if (!stat.isFile()) throw new Error(`not a file: ${file}`);
  const lines = (await readFile(path, 'utf8')).split(/\r?\n/);
  const start = Math.max(1, startLine);
  const requestedEnd = endLine == null ? lines.length : Math.max(start, endLine);
  const end = Math.min(lines.length, requestedEnd, start + maxLines - 1);
  const width = String(end).length;
  const output = [];
  for (let line = start; line <= end; line += 1) {
    const text = lines[line - 1].replaceAll('\t', '  ');
    output.push(`${String(line).padStart(width, ' ')}|${compactLine(text, maxColumns)}`);
  }
  return {
    path: boundary.display(path),
    lines: output,
    totalLines: lines.length,
    start,
    end,
    truncated: end < Math.min(lines.length, requestedEnd),
  };
}

export async function directoryTree({
  boundary,
  start = '.',
  maxDepth = Number.POSITIVE_INFINITY,
  maxEntries = Number.POSITIVE_INFINITY,
  ignores = DEFAULT_IGNORES,
}) {
  const startPath = boundary.resolve(start);
  const ignored = new Set(ignores);
  const entries = [];
  let totalEntries = 0;

  async function walk(path, depth) {
    if (depth > maxDepth) return;
    const children = (await readdir(path, { withFileTypes: true }))
      .filter((entry) => !ignored.has(entry.name))
      .sort((left, right) => codeUnitCompare(left.name, right.name));
    for (const child of children) {
      totalEntries += 1;
      const childPath = resolve(path, child.name);
      if (entries.length < maxEntries) {
        entries.push(`${'  '.repeat(depth)}${child.name}${child.isDirectory() ? '/' : ''}`);
      }
      if (child.isDirectory() && !child.isSymbolicLink()) await walk(childPath, depth + 1);
    }
  }

  const stat = await lstat(startPath);
  if (!stat.isDirectory()) throw new Error(`not a directory: ${start}`);
  await walk(startPath, 0);
  return { path: boundary.display(startPath), entries, totalEntries, truncated: totalEntries > entries.length };
}

export function jsonAtPath(value, pathExpression = '') {
  if (!pathExpression) return value;
  const parts = pathExpression.startsWith('/')
    ? pathExpression.slice(1).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    : pathExpression.split('.').filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (current == null || !Object.hasOwn(current, part)) {
      throw new Error(`JSON path not found: ${pathExpression}`);
    }
    current = current[part];
  }
  return current;
}

export async function inspectJson({ boundary, file, pathExpression = '', maxItems = Number.POSITIVE_INFINITY }) {
  if (!file) throw new Error('JSON file path is required');
  const path = boundary.resolve(file);
  const value = jsonAtPath(JSON.parse(await readFile(path, 'utf8')), pathExpression);
  if (Array.isArray(value) && value.length > maxItems) {
    return { value: value.slice(0, maxItems), omitted: value.length - maxItems, total: value.length };
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value).sort(([left], [right]) => codeUnitCompare(left, right));
    if (entries.length > maxItems) {
      return { value: Object.fromEntries(entries.slice(0, maxItems)), omitted: entries.length - maxItems, total: entries.length };
    }
  }
  return { value, omitted: 0, total: Array.isArray(value) ? value.length : undefined };
}

export async function verifyBoundary(boundary) {
  await realpath(boundary.root);
}

export async function hashFile(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

export async function inventory({ boundary, start = '.', ignores = DEFAULT_IGNORES, extensions = [], withHash = false }) {
  const rows = [];
  for await (const path of walkFiles({ boundary, start, ignores, extensions })) {
    const fileStat = await stat(path);
    rows.push({
      path: boundary.display(path),
      bytes: fileStat.size,
      modified: fileStat.mtime.toISOString(),
      ...(withHash ? { sha256: await hashFile(path) } : {}),
    });
  }
  return rows;
}

export async function datasetStats(options) {
  const rows = await inventory(options);
  const extensions = Object.create(null);
  let bytes = 0;
  let largest = null;
  for (const row of rows) {
    bytes += row.bytes;
    const extension = extname(row.path).toLowerCase() || '[none]';
    extensions[extension] = (extensions[extension] ?? 0) + 1;
    if (!largest || row.bytes > largest.bytes) largest = row;
  }
  return {
    files: rows.length,
    bytes,
    largest,
    extensions: Object.fromEntries(Object.entries(extensions).sort(([a], [b]) => codeUnitCompare(a, b))),
  };
}

export async function duplicateFiles(options) {
  const rows = await inventory(options);
  const bySize = new Map();
  for (const row of rows) {
    if (!bySize.has(row.bytes)) bySize.set(row.bytes, []);
    bySize.get(row.bytes).push(row);
  }
  const groups = [];
  for (const candidates of bySize.values()) {
    if (candidates.length < 2) continue;
    const byHash = new Map();
    for (const row of candidates) {
      const sha256 = await hashFile(options.boundary.resolve(row.path));
      if (!byHash.has(sha256)) byHash.set(sha256, []);
      byHash.get(sha256).push(row.path);
    }
    for (const [sha256, paths] of byHash) {
      if (paths.length > 1) groups.push({ sha256, bytes: candidates[0].bytes, paths: paths.sort(codeUnitCompare) });
    }
  }
  return groups.sort((left, right) => right.bytes - left.bytes || codeUnitCompare(left.sha256, right.sha256));
}

export async function inspectJsonLines({ boundary, file, field = '' }) {
  const path = boundary.resolve(file);
  const input = createReadStream(path, { encoding: 'utf8' });
  const reader = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  const values = new Map();
  let lines = 0;
  let valid = 0;
  let invalid = 0;
  let first = true;
  for await (const line of reader) {
    if (!line.trim()) continue;
    lines += 1;
    try {
      const value = JSON.parse(first ? line.replace(/^\uFEFF/u, '') : line);
      first = false;
      valid += 1;
      if (field) {
        const selected = jsonAtPath(value, field);
        const key = typeof selected === 'string' ? selected : JSON.stringify(selected);
        values.set(key, (values.get(key) ?? 0) + 1);
      }
    } catch {
      invalid += 1;
    }
  }
  return {
    path: boundary.display(path), lines, valid, invalid,
    values: [...values].sort((a, b) => b[1] - a[1] || codeUnitCompare(a[0], b[0])).map(([value, count]) => ({ value, count })),
  };
}
