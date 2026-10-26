import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  collectFiles,
  createBoundary,
  datasetStats,
  directoryTree,
  duplicateFiles,
  inventory,
  inspectJson,
  inspectJsonLines,
  parsePositiveInteger,
  readLines,
  searchFileNames,
  searchText,
  lookupSources,
  verifyBoundary,
} from './core.mjs';
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

export const ROOM_KIT_COMMANDS = Object.freeze([
  'files', 'find', 'search-files', 'search', 'search-content', 'lookup', 'read', 'tree', 'json', 'jsonl', 'stats', 'inventory',
  'dupes', 'encoding', 'table', 'schema', 'archive', 'book-search', 'book-status', 'book-verify',
]);

export const ROOM_OCR_COMMANDS = Object.freeze(['ocr', 'ocr-status', 'ocr-relayout']);

export const WRITE_KIT_COMMANDS = Object.freeze([
  'index', 'book-index', 'book-export', 'ocr-smoke',
]);

const BOOLEAN_OPTIONS = new Set(['regex', 'case', 'json', 'hash', 'no-header', 'no-hash', 'cpu', 'force', 'glob']);

function option(options, name, fallback) {
  return options.has(name) ? options.get(name) : fallback;
}

function extensionList(options) {
  return String(option(options, 'ext', '')).split(',').map((value) => value.trim()).filter(Boolean);
}

function nonNegativeInteger(value, label, fallback) {
  if (value == null) return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`${label} must be a non-negative integer`);
  return Number(value);
}

function ignoreList(options) {
  return String(option(options, 'ignore', '')).split(',').map((value) => value.trim()).filter(Boolean);
}

function asOptions(value) {
  if (value instanceof Map) return value;
  const options = new Map();
  for (const [key, item] of Object.entries(value ?? {})) {
    if (item == null || item === false) continue;
    options.set(key, item === true ? true : String(item));
  }
  return options;
}

export function parseKitArgs(argv) {
  const positionals = [];
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }
    const [name, inline] = value.slice(2).split('=', 2);
    if (BOOLEAN_OPTIONS.has(name)) options.set(name, true);
    else if (inline != null) options.set(name, inline);
    else {
      index += 1;
      if (argv[index] == null || argv[index].startsWith('--')) throw new Error(`--${name} requires a value`);
      options.set(name, argv[index]);
    }
  }
  return { positionals, options };
}

function insideRoot(root, candidate) {
  const rel = relative(root, candidate).replaceAll('\\', '/');
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function underPrefix(root, candidate, prefix) {
  const rel = relative(root, candidate).replaceAll('\\', '/');
  return rel === prefix || rel.startsWith(`${prefix}/`);
}

export function assertRoomOcrPaths(root, inputPath, outputPath) {
  const rootResolved = resolve(root);
  if (outputPath) {
    const output = resolve(rootResolved, outputPath);
    if (!insideRoot(rootResolved, output) || !underPrefix(rootResolved, output, 'artifacts/ocr')) {
      throw new TypeError('room OCR --out must stay under artifacts/ocr');
    }
  }
  if (inputPath) {
    const input = resolve(rootResolved, inputPath);
    if (!insideRoot(rootResolved, input) || !(underPrefix(rootResolved, input, 'library') || underPrefix(rootResolved, input, 'artifacts/ocr'))) {
      throw new TypeError('room OCR input must stay under library/ or artifacts/ocr/');
    }
  }
}

function parseJsonPayload(text) {
  const lines = String(text ?? '').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].startsWith('{') || lines[index].startsWith('[')) return JSON.parse(lines[index]);
  }
  return { text: String(text ?? '').slice(0, 4000) };
}

async function runPythonTool(scriptName, arguments_) {
  const toolDirectory = fileURLToPath(new URL('./ocr/', import.meta.url));
  const python = `${toolDirectory}.venv/Scripts/python.exe`;
  const script = `${toolDirectory}${scriptName}`;
  return new Promise((accept, reject) => {
    const child = spawn(python, [script, ...arguments_], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, OMP_NUM_THREADS: '2', OPENBLAS_NUM_THREADS: '2', MKL_NUM_THREADS: '2' },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      const payload = parseJsonPayload(stdout) ?? { error: stderr.slice(0, 1000) };
      if (code === 0) accept(payload);
      else reject(new Error(payload.error ?? `OCR process exited with code ${code}`));
    });
  });
}

export function kitRequestFromObject(input = {}) {
  const command = String(input.command ?? '').trim();
  const args = [];
  const options = new Map();
  const copy = (name, alias = name) => {
    if (input[name] != null && input[name] !== false) options.set(alias, input[name] === true ? true : String(input[name]));
  };
  if (command === 'search' || command === 'search-content' || command === 'find' || command === 'search-files' || command === 'lookup') {
    if (input.query != null) args.push(String(input.query));
    if (input.path != null) args.push(String(input.path));
  } else if (command === 'read' || command === 'json' || command === 'jsonl' || command === 'table' || command === 'schema' || command === 'archive') {
    if (input.path != null || input.file != null) args.push(String(input.path ?? input.file));
    if (command === 'json' && input.pointer != null) args.push(String(input.pointer));
  } else if (command === 'book-search') {
    if (input.query != null) args.push(String(input.query));
  } else if (command === 'ocr-relayout') {
    if (input.path != null || input.file != null) args.push(String(input.path ?? input.file));
  } else if (input.path != null) args.push(String(input.path));
  copy('ext');
  copy('ignore');
  copy('max');
  copy('max-bytes');
  copy('columns');
  copy('depth');
  copy('lines');
  copy('field');
  copy('delimiter');
  copy('db');
  copy('out');
  copy('encoding');
  copy('chunk-chars');
  copy('overlap-chars');
  copy('dpi');
  copy('root');
  copy('context');
  copy('name');
  copy('related-max');
  if (input.relatedMax != null) copy('relatedMax', 'related-max');
  if (input.regex === true) options.set('regex', true);
  if (input.case === true) options.set('case', true);
  if (input.glob === true) options.set('glob', true);
  if (input.hash === true) options.set('hash', true);
  if (input['no-header'] === true || input.noHeader === true) options.set('no-header', true);
  if (input['no-hash'] === true || input.noHash === true) options.set('no-hash', true);
  if (input.cpu === true) options.set('cpu', true);
  if (input.force === true) options.set('force', true);
  return { command, args, options };
}

export async function runKitCommand({
  command,
  args = [],
  options: rawOptions = new Map(),
  root,
  allowWrites = true,
  allowOcr = false,
} = {}) {
  const options = asOptions(rawOptions);
  const name = String(command ?? '').trim();
  if (!name || name === 'help' || name === '--help' || name === '-h') {
    return { command: 'help', format: 'help', payload: null, exitCode: 0 };
  }
  if (!allowWrites && WRITE_KIT_COMMANDS.includes(name)) {
    throw new TypeError(`agent_tools forbids write command: ${name}`);
  }
  if (!allowWrites && ROOM_OCR_COMMANDS.includes(name) && !allowOcr) {
    throw new TypeError(`agent_tools forbids OCR command: ${name}`);
  }
  if (!allowWrites && !ROOM_KIT_COMMANDS.includes(name) && !(allowOcr && ROOM_OCR_COMMANDS.includes(name))) {
    throw new TypeError(`unsupported agent_tools command: ${name}`);
  }
  const boundary = createBoundary(option(options, 'root', root));
  await verifyBoundary(boundary);
  const max = parsePositiveInteger(option(options, 'max'), '--max', Number.POSITIVE_INFINITY);

  if (name === 'files') {
    const files = await collectFiles({ boundary, start: args[0] ?? '.', extensions: extensionList(options), ignores: ignoreList(options) });
    const selected = files.slice(0, max).map((path) => boundary.display(path));
    return {
      command: name,
      format: 'files',
      payload: { files: selected, total: files.length, omitted: Math.max(0, files.length - selected.length) },
      exitCode: 0,
    };
  }

  if (name === 'find' || name === 'search-files') {
    const payload = await searchFileNames({
      boundary,
      query: args[0],
      start: args[1] ?? '.',
      glob: options.has('glob') || /[*?]/u.test(String(args[0] ?? '')),
      caseSensitive: options.has('case'),
      extensions: extensionList(options),
      ignores: ignoreList(options),
      maxResults: max,
    });
    return { command: name, format: 'find', payload, exitCode: payload.total ? 0 : 1 };
  }

  if (name === 'search' || name === 'search-content') {
    const context = option(options, 'context', name === 'search-content' ? 2 : 2);
    const payload = await searchText({
      boundary,
      query: args[0],
      start: args[1] ?? '.',
      fixed: !options.has('regex'),
      caseSensitive: options.has('case'),
      extensions: extensionList(options),
      ignores: ignoreList(options),
      name: option(options, 'name', ''),
      glob: options.has('glob'),
      maxResults: max,
      maxBytes: parsePositiveInteger(option(options, 'max-bytes'), '--max-bytes', Number.POSITIVE_INFINITY),
      maxColumns: parsePositiveInteger(option(options, 'columns'), '--columns', Number.POSITIVE_INFINITY),
      context: nonNegativeInteger(context, '--context', 2),
    });
    return { command: name, format: 'search', payload, exitCode: payload.totalMatches ? 0 : 1 };
  }

  if (name === 'lookup') {
    const payload = await lookupSources({
      boundary,
      query: args[0],
      start: args[1] ?? '.',
      caseSensitive: options.has('case'),
      extensions: extensionList(options),
      ignores: ignoreList(options),
      maxResults: max,
      maxRelated: option(options, 'related-max') == null
        ? (Number.isFinite(max) ? max : Number.POSITIVE_INFINITY)
        : nonNegativeInteger(option(options, 'related-max'), '--related-max', 0),
      maxBytes: parsePositiveInteger(option(options, 'max-bytes'), '--max-bytes', Number.POSITIVE_INFINITY),
      maxColumns: parsePositiveInteger(option(options, 'columns'), '--columns', Number.POSITIVE_INFINITY),
      context: nonNegativeInteger(option(options, 'context', 2), '--context', 2),
    });
    return {
      command: name,
      format: 'lookup',
      payload,
      exitCode: payload.files.length || payload.content.length || payload.related.length ? 0 : 1,
    };
  }

  if (name === 'read') {
    const range = String(option(options, 'lines', '1:')).match(/^(\d+)?(?::(\d+)?)?$/);
    if (!range) throw new Error('--lines must look like START:END');
    const payload = await readLines({
      boundary,
      file: args[0],
      startLine: range[1] ? Number(range[1]) : 1,
      endLine: range[2] ? Number(range[2]) : undefined,
      maxLines: max,
      maxColumns: parsePositiveInteger(option(options, 'columns'), '--columns', Number.POSITIVE_INFINITY),
    });
    return { command: name, format: 'read', payload, exitCode: 0 };
  }

  if (name === 'tree') {
    const payload = await directoryTree({
      boundary,
      start: args[0] ?? '.',
      maxDepth: parsePositiveInteger(option(options, 'depth'), '--depth', Number.POSITIVE_INFINITY),
      maxEntries: max,
      ignores: ignoreList(options),
    });
    return { command: name, format: 'tree', payload, exitCode: 0 };
  }

  if (name === 'json') {
    const payload = await inspectJson({ boundary, file: args[0], pathExpression: args[1] ?? '', maxItems: max });
    return { command: name, format: 'json', payload, exitCode: 0 };
  }

  if (name === 'jsonl') {
    const payload = await inspectJsonLines({ boundary, file: args[0], field: option(options, 'field', '') });
    return { command: name, format: 'object', payload, exitCode: 0 };
  }

  if (name === 'stats') {
    const payload = await datasetStats({ boundary, start: args[0] ?? '.', extensions: extensionList(options), ignores: ignoreList(options) });
    return { command: name, format: 'object', payload, exitCode: 0 };
  }

  if (name === 'inventory' || name === 'hash') {
    const payload = await inventory({
      boundary,
      start: args[0] ?? '.',
      extensions: extensionList(options),
      ignores: ignoreList(options),
      withHash: name === 'hash' || options.has('hash'),
    });
    return { command: name, format: 'rows', payload, exitCode: 0, summary: { files: payload.length } };
  }

  if (name === 'dupes') {
    const groups = await duplicateFiles({ boundary, start: args[0] ?? '.', extensions: extensionList(options), ignores: ignoreList(options) });
    return {
      command: name,
      format: 'object',
      payload: { groups, duplicateGroups: groups.length, duplicateFiles: groups.reduce((sum, row) => sum + row.paths.length, 0) },
      exitCode: 0,
    };
  }

  if (name === 'encoding') {
    const payload = await auditEncodings({ boundary, start: args[0] ?? '.', extensions: extensionList(options), ignores: ignoreList(options) });
    return {
      command: name,
      format: 'rows',
      payload,
      exitCode: 0,
      summary: { files: payload.length, invalid: payload.filter(row => !row.valid).length, binary: payload.filter(row => row.binaryLikely).length },
    };
  }

  if (name === 'table') {
    const defaultDelimiter = String(args[0] ?? '').toLowerCase().endsWith('.tsv') ? '\t' : ',';
    const requestedDelimiter = option(options, 'delimiter', defaultDelimiter);
    const payload = await profileDelimited({
      boundary,
      file: args[0],
      delimiter: requestedDelimiter === 'tab' ? '\t' : requestedDelimiter,
      header: !options.has('no-header'),
    });
    return { command: name, format: 'object', payload, exitCode: 0 };
  }

  if (name === 'schema') {
    const payload = await profileJsonSchema({ boundary, file: args[0] });
    return { command: name, format: 'object', payload, exitCode: 0 };
  }

  if (name === 'archive') {
    const payload = await listZipArchive({ boundary, file: args[0] });
    return { command: name, format: 'rows', payload: payload.entries, exitCode: 0, summary: { entries: payload.entries.length, expected: payload.entriesExpected, bytes: payload.totalBytes } };
  }

  if (name === 'index') {
    const payload = await buildIncrementalIndex({
      boundary,
      start: args[0] ?? '.',
      output: option(options, 'out'),
      extensions: extensionList(options),
      ignores: ignoreList(options),
      withHash: !options.has('no-hash'),
    });
    return { command: name, format: 'object', payload, exitCode: 0 };
  }

  if (name === 'book-index') {
    const payload = await buildBookIndex({
      boundary,
      start: args[0] ?? '.',
      database: option(options, 'db'),
      encoding: option(options, 'encoding', 'auto'),
      chunkChars: parsePositiveInteger(option(options, 'chunk-chars'), '--chunk-chars', 5_200),
      overlapChars: nonNegativeInteger(option(options, 'overlap-chars'), '--overlap-chars', 800),
      ignores: ignoreList(options),
    });
    return { command: name, format: 'object', payload, exitCode: 0 };
  }

  if (name === 'book-search') {
    const payload = await searchBookIndex({ boundary, database: option(options, 'db'), query: args[0], maxResults: max });
    return { command: name, format: 'book-search', payload, exitCode: payload.total ? 0 : 1 };
  }

  if (name === 'book-status') {
    const payload = await inspectBookIndex({ boundary, database: option(options, 'db') });
    return { command: name, format: 'object', payload, exitCode: 0 };
  }

  if (name === 'book-verify') {
    const payload = await verifyBookIndex({ boundary, database: option(options, 'db') });
    return { command: name, format: 'object', payload, exitCode: payload.valid ? 0 : 1 };
  }

  if (name === 'book-export') {
    const payload = await exportBookIndex({ boundary, database: option(options, 'db'), output: option(options, 'out') });
    return { command: name, format: 'object', payload, exitCode: 0 };
  }

  if (name === 'ocr') {
    if (!args[0]) throw new Error('OCR input path is required');
    if (!option(options, 'out')) throw new Error('--out is required');
    if (!allowWrites && allowOcr) {
      if (options.has('cpu')) throw new TypeError('room OCR forbids --cpu; GPU execution is required');
      assertRoomOcrPaths(boundary.root, args[0], option(options, 'out'));
    }
    const ocrArgs = ['run', boundary.resolve(args[0]), '--output', boundary.resolve(option(options, 'out')), '--dpi', String(option(options, 'dpi', 300))];
    if (options.has('cpu')) ocrArgs.push('--cpu');
    if (options.has('force')) ocrArgs.push('--force');
    const payload = await runPythonTool('ocr.py', ocrArgs);
    return { command: name, format: 'ocr', payload, exitCode: payload.failed ? 1 : 0 };
  }

  if (name === 'ocr-status') {
    const payload = await runPythonTool('ocr.py', ['status', ...(options.has('cpu') ? ['--cpu'] : ['--require-gpu'])]);
    return { command: name, format: 'ocr', payload, exitCode: 0 };
  }

  if (name === 'ocr-relayout') {
    if (!args[0]) throw new Error('OCR jsonl path is required');
    if (!allowWrites && allowOcr) assertRoomOcrPaths(boundary.root, args[0], args[0]);
    const payload = await runPythonTool('layout.py', ['--jsonl', boundary.resolve(args[0])]);
    return { command: name, format: 'ocr', payload, exitCode: 0 };
  }

  if (name === 'ocr-smoke') {
    if (!option(options, 'out')) throw new Error('--out is required');
    const payload = await runPythonTool('ocr.py', ['smoke', '--output', boundary.resolve(option(options, 'out')), ...(options.has('cpu') ? ['--cpu'] : [])]);
    return { command: name, format: 'ocr', payload, exitCode: payload.failed ? 1 : 0 };
  }

  throw new Error(`unknown command: ${name}`);
}
