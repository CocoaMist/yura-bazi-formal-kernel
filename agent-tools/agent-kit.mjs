#!/usr/bin/env node
import process from 'node:process';
import { parseKitArgs, runKitCommand } from './kit-commands.mjs';
import { formatLookup, formatSearchHits } from './core.mjs';

const HELP = `agent-kit: repository inspection and explicit data indexing

Usage:
  node agent-tools/agent-kit.mjs files [path] [--ext mjs,json]
  node agent-tools/agent-kit.mjs find <name> [path] [--glob] [--ext mjs]
  node agent-tools/agent-kit.mjs search <text> [path] [--context 2] [--name resolver] [--ext mjs]
  node agent-tools/agent-kit.mjs lookup <text> [path] [--max 40] [--related-max 16] [--context 2]
  node agent-tools/agent-kit.mjs read <file> [--lines 20:80]
  node agent-tools/agent-kit.mjs tree [path] [--depth 3]
  node agent-tools/agent-kit.mjs json <file> [dot.path|/json/pointer]
  node agent-tools/agent-kit.mjs jsonl <file> [--field dot.path]
  node agent-tools/agent-kit.mjs stats [path]
  node agent-tools/agent-kit.mjs inventory [path] [--hash]
  node agent-tools/agent-kit.mjs dupes [path]
  node agent-tools/agent-kit.mjs encoding [path]
  node agent-tools/agent-kit.mjs table <csv|tsv> [--delimiter ,] [--no-header]
  node agent-tools/agent-kit.mjs schema <jsonl>
  node agent-tools/agent-kit.mjs archive <zip|epub>
  node agent-tools/agent-kit.mjs index [path] --out <manifest.jsonl> [--no-hash]
  node agent-tools/agent-kit.mjs book-index [path] --db <corpus.sqlite> [--encoding gb18030]
  node agent-tools/agent-kit.mjs book-search <text> --db <corpus.sqlite>
  node agent-tools/agent-kit.mjs book-status --db <corpus.sqlite>
  node agent-tools/agent-kit.mjs book-verify --db <corpus.sqlite>
  node agent-tools/agent-kit.mjs book-export --db <corpus.sqlite> --out <chunks.jsonl>
  node agent-tools/agent-kit.mjs ocr <image|pdf|directory> --out <directory> [--dpi 300]
  node agent-tools/agent-kit.mjs ocr-relayout <file.ocr.jsonl>
  node agent-tools/agent-kit.mjs ocr-status
  node agent-tools/agent-kit.mjs ocr-smoke --out <directory>

No scan, path, file-size, result-count or line-count limit is imposed by
default. Use --max, --max-bytes, --depth, --columns or --ignore only when a
specific task benefits from them. Output is deterministic and color-free.`;

function option(options, name, fallback) {
  return options.has(name) ? options.get(name) : fallback;
}

function printSummary(summary) {
  process.stdout.write(`# ${Object.entries(summary).map(([key, value]) => `${key}=${value}`).join(' ')}\n`);
}

function emitJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function printKitResult(command, result, jsonMode) {
  if (command === 'help' || result.format === 'help') {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (result.format === 'ocr') {
    emitJson(result.payload);
    return;
  }
  const payload = result.payload;
  if (command === 'files') {
    if (jsonMode) emitJson(payload);
    else {
      for (const path of payload.files) process.stdout.write(`${path}\n`);
      printSummary({ shown: payload.files.length, total: payload.total, omitted: payload.omitted });
    }
    return;
  }
  if (command === 'find' || command === 'search-files') {
    if (jsonMode) emitJson(payload);
    else {
      for (const path of payload.files) process.stdout.write(`${path}\n`);
      printSummary({ shown: payload.files.length, total: payload.total, omitted: payload.omitted });
    }
    return;
  }
  if (command === 'search' || command === 'search-content') {
    if (jsonMode) emitJson(payload);
    else {
      for (const line of formatSearchHits(payload)) process.stdout.write(`${line}\n`);
      printSummary({ matches: payload.totalMatches, shown: payload.results.length, files: payload.searchedFiles, skipped: payload.skippedFiles, truncated: payload.truncated ? 1 : 0 });
    }
    return;
  }
  if (command === 'lookup') {
    if (jsonMode) emitJson(payload);
    else {
      for (const line of formatLookup(payload)) process.stdout.write(`${line}\n`);
      printSummary({ files: payload.files.length, content: payload.content.length, related: payload.related.length, searched: payload.searchedFiles, truncated: payload.truncated ? 1 : 0 });
    }
    return;
  }
  if (command === 'read') {
    if (jsonMode) emitJson(payload);
    else {
      for (const line of payload.lines) process.stdout.write(`${line}\n`);
      printSummary({ file: payload.path, shown: payload.lines.length, range: `${payload.start}-${payload.end}`, total: payload.totalLines });
    }
    return;
  }
  if (command === 'tree') {
    if (jsonMode) emitJson(payload);
    else {
      for (const entry of payload.entries) process.stdout.write(`${entry}\n`);
      printSummary({ root: payload.path, shown: payload.entries.length, total: payload.totalEntries, omitted: Math.max(0, payload.totalEntries - payload.entries.length) });
    }
    return;
  }
  if (command === 'json') {
    process.stdout.write(`${JSON.stringify(payload.value)}\n`);
    printSummary({ omitted: payload.omitted, ...(payload.total == null ? {} : { total: payload.total }) });
    return;
  }
  if (command === 'jsonl' || command === 'stats' || command === 'dupes' || command === 'table' || command === 'schema' || command === 'index' || command === 'book-index' || command === 'book-status' || command === 'book-verify' || command === 'book-export') {
    emitJson(payload);
    return;
  }
  if (command === 'inventory' || command === 'hash' || command === 'encoding' || command === 'archive') {
    for (const row of payload) emitJson(row);
    printSummary(result.summary);
    return;
  }
  if (command === 'book-search') {
    if (jsonMode) emitJson(payload);
    else {
      for (const row of payload.results) emitJson(row);
      printSummary({ matches: payload.total, shown: payload.results.length, omitted: payload.omitted });
    }
  }
}

async function main() {
  const { positionals, options } = parseKitArgs(process.argv.slice(2));
  const [command = 'help', ...args] = positionals;
  const result = await runKitCommand({
    command,
    args,
    options,
    root: option(options, 'root', process.cwd()),
    allowWrites: true,
  });
  printKitResult(command, result, options.has('json'));
  if (result.exitCode) process.exitCode = result.exitCode;
}

main().catch((error) => {
  process.stderr.write(`agent-kit error: ${error.message}\n`);
  process.exitCode = 2;
});
