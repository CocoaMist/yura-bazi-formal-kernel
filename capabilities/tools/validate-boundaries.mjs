import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(root, 'src');
const expected = new Set([
    'calendar.mjs',
  'century-timeline.mjs',
  'candidates.mjs',
  'comparison.mjs',
  'contracts.mjs',
  'index.mjs',
  'life-stage.mjs',
  'life-stage-profile.mjs',
  'luck-schedule.mjs',
  'profile.mjs',
  'reference-provider.mjs',
  'relations.mjs',
  'scope-profile.mjs',
  'shared.mjs',
  'temporal.mjs'
]);
const forbiddenPatterns = [
  [/\bBirthInput\b/, 'BirthInput'],
  [/\bFormalState\b/, 'FormalState'],
  [/\bStateDelta\b/, 'StateDelta'],
  [/\bEffectOp\b/, 'EffectOp'],
  [/\.localeCompare\s*\(/, 'localeCompare'],
  [/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/, 'network API'],
  [/\bprocess\.env\b/, 'process.env'],
  [/\bDate\.now\s*\(/, 'Date.now'],
  [/\bMath\.random\s*\(/, 'Math.random'],
  [/\bimport\s*\(/, 'dynamic import']
];
const importPattern = /^\s*(?:import(?:[^'"\n]*?\sfrom)?|}\s*from)\s*['"]([^'"]+)['"]/gm;

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile() && extname(entry.name) === '.mjs') files.push(absolute);
  }
  return files.sort();
}

function insideSource(absolute) {
  const path = relative(sourceRoot, absolute);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !path.includes(`${sep}..${sep}`);
}

const files = await walk(sourceRoot);
const relativeFiles = files.map((file) => relative(sourceRoot, file).replaceAll('\\', '/'));
for (const name of expected) {
  if (!relativeFiles.includes(name)) throw new Error(`missing source module: ${name}`);
}
for (const name of relativeFiles) {
  if (!expected.has(name)) throw new Error(`unexpected source module: ${name}`);
}

const graph = new Map(files.map((file) => [file, []]));
for (const file of files) {
  const name = relative(sourceRoot, file).replaceAll('\\', '/');
  const source = await readFile(file, 'utf8');
  for (const [pattern, label] of forbiddenPatterns) {
    if (pattern.test(source)) throw new Error(`${name} contains forbidden ${label}`);
  }
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (specifier === 'node:crypto') continue;
    if (specifier.startsWith('node:')) throw new Error(`${name} imports forbidden runtime module: ${specifier}`);
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      throw new Error(`${name} imports an external package: ${specifier}`);
    }
    const target = resolve(dirname(file), specifier);
    if (!insideSource(target)) throw new Error(`${name} imports outside the independent package: ${specifier}`);
    try {
      if (!(await stat(target)).isFile()) throw new Error();
    } catch {
      throw new Error(`${name} imports a missing module: ${specifier}`);
    }
    graph.get(file).push(target);
  }
}

const visiting = new Set();
const visited = new Set();
function visit(file) {
  if (visiting.has(file)) throw new Error(`source import cycle reaches ${relative(sourceRoot, file)}`);
  if (visited.has(file)) return;
  visiting.add(file);
  for (const target of graph.get(file)) visit(target);
  visiting.delete(file);
  visited.add(file);
}
for (const file of files) visit(file);

const temporal = await readFile(resolve(sourceRoot, 'temporal.mjs'), 'utf8');
const comparison = await readFile(resolve(sourceRoot, 'comparison.mjs'), 'utf8');
if (temporal.includes('comparison.mjs') || comparison.includes('temporal.mjs')) {
  throw new Error('temporal and comparison capabilities must remain independent');
}

console.log(`boundary validation passed (${files.length} source modules)`);
