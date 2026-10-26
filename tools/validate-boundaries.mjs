import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(root, 'src');
const files = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.name.endsWith('.mjs')) files.push(path);
  }
}
await walk(srcRoot);

const sourceFileByKey = new Map(files.map((file) => [file.toLowerCase(), file]));
const importGraph = new Map(files.map((file) => [file, new Set()]));

function staticModuleSpecifiers(text) {
  const specifiers = new Set();
  for (const pattern of [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
  ]) {
    for (const match of text.matchAll(pattern)) specifiers.add(match[1]);
  }
  return specifiers;
}

function isInside(directory, path) {
  const pathKey = path.toLowerCase();
  const directoryKey = directory.toLowerCase();
  return pathKey === directoryKey
    || pathKey.startsWith(`${directoryKey}\\`)
    || pathKey.startsWith(`${directoryKey}/`);
}

function validateAcyclicImportGraph() {
  const state = new Map();
  const stack = [];

  function visit(file) {
    if (state.get(file) === 'done') return;
    if (state.get(file) === 'visiting') {
      const cycleStart = stack.indexOf(file);
      const cycle = [...stack.slice(cycleStart), file]
        .map((path) => relative(root, path))
        .join(' -> ');
      throw new Error(`cyclic source import forbidden: ${cycle}`);
    }

    state.set(file, 'visiting');
    stack.push(file);
    for (const dependency of importGraph.get(file)) visit(dependency);
    stack.pop();
    state.set(file, 'done');
  }

  for (const file of files) visit(file);
}

const forbidden = [
  ['BirthInput', /\bBirthInput\b/],
  ['chart construction', /\bbirthChart\b|\bprobePillarsAt\b/],
  ['network access', /\bfetch\s*\(|node:(?:http|https|net|tls)/],
  ['environment dependence', /process\.env/],
  ['wall-clock dependence', /Date\.now\s*\(/],
  ['random dependence', /Math\.random\s*\(|randomUUID/],
  ['dynamic import', /\bimport\s*\(/],
  ['legacy runtime import', /3006-YuraCore|src\/runtime|src\\runtime/],
  // localeCompare depends on the ICU build and the ambient locale, so it can
  // silently change canonical ordering and therefore every downstream hash.
  ['locale-dependent ordering', /\blocaleCompare\s*\(/],
  // Retrieval is a read-only lookup layer outside the kernel. No source module
  // may generate, embed or index corpus text on the deterministic path.
  ['retrieval or generation inside the kernel', /\b(?:ragQuery|retrieveDocuments|embedText|vectorStore|generateRule|draftRuleFromText)\b/],
];

for (const file of files) {
  const text = await readFile(file, 'utf8');
  for (const [label, pattern] of forbidden) {
    if (pattern.test(text)) throw new Error(`${label} forbidden in ${relative(root, file)}`);
  }
  for (const specifier of staticModuleSpecifiers(text)) {
    if (!specifier.startsWith('.') && specifier !== 'node:crypto') {
      throw new Error(`external import forbidden in ${relative(root, file)}: ${specifier}`);
    }
    if (!specifier.startsWith('.')) continue;
    if (!specifier.endsWith('.mjs')) {
      throw new Error(`relative import must name an .mjs file in ${relative(root, file)}: ${specifier}`);
    }
    const requestedPath = resolve(dirname(file), specifier);
    if (!isInside(srcRoot, requestedPath)) {
      throw new Error(`source import escapes src in ${relative(root, file)}: ${specifier}`);
    }
    const dependency = sourceFileByKey.get(requestedPath.toLowerCase());
    if (!dependency) {
      throw new Error(`unresolved source import in ${relative(root, file)}: ${specifier}`);
    }
    importGraph.get(file).add(dependency);
  }
  if (file.includes(`${join('src', 'bazi')}`) && /liuyao|qimen|liuren|ziwei/i.test(text)) {
    throw new Error(`Bazi kernel imports or names another system: ${relative(root, file)}`);
  }
  if (file.includes(`${join('src', 'bazi')}`)
    && /\b(?:buildInteraction|buildEffect|buildStateDelta|resolveEffects)\b/.test(text)) {
    throw new Error(`Bazi code may not construct or resolve formal mutation: ${relative(root, file)}`);
  }
  if ((file.endsWith(join('bazi', 'foundation-profile.mjs'))
      || file.endsWith(join('bazi', 'structure.mjs'))
      || file.endsWith(join('bazi', 'relation-profile.mjs'))
      || file.endsWith(join('bazi', 'relations.mjs')))
    && /\.\.\/(?:state|causal)\//.test(text)) {
    throw new Error(`Bazi raw material may not import mutation or causal code: ${relative(root, file)}`);
  }
  if ((file.includes(`${join('src', 'state')}`) || file.includes(`${join('src', 'causal')}`))
    && /from\s+['"]\.\.\/bazi\/(?:relation-profile|relations)\.mjs['"]/.test(text)) {
    throw new Error(`state or causal code may not import raw relation material: ${relative(root, file)}`);
  }
  if ((file.endsWith(join('bazi', 'structure.mjs'))
      || file.endsWith(join('bazi', 'relations.mjs'))
      || file.endsWith(join('bazi', 'kernel.mjs')))
    && /\b(?:usefulGod|favorableElement|unfavorableElement|xiGod|jiGod)\b/.test(text)) {
    throw new Error(`automatic useful-god judgment forbidden in ${relative(root, file)}`);
  }
  if ((file.endsWith(join('bazi', 'relation-profile.mjs'))
      || file.endsWith(join('bazi', 'relations.mjs')))
    && /\b(?:interactionId|effectId|targetKey|operation|activation|resultElement|transformed\w*)\b/i.test(text)) {
    throw new Error(`relation material may not contain mutation or transformation result fields: ${relative(root, file)}`);
  }
  if (!file.endsWith(join('state', 'contracts.mjs')) && !file.endsWith(join('state', 'resolver.mjs'))
    && /buildStateDelta\s*\(\s*\{/.test(text)) {
    throw new Error(`StateDelta mutation bypass in ${relative(root, file)}`);
  }
  // The canonical fact graph is the one interface a rule condition reads. It
  // must stay branch-independent, or two school branches would silently read
  // different facts for the same chart.
  if (file.endsWith(join('bazi', 'fact-graph.mjs'))) {
    if (/\b(?:branchKey|branchHash|ruleProfileId|methodId|evidencePolicyId|resolverPolicyId)\b/.test(text)) {
      throw new Error(`canonical fact graph may not carry a branch identity: ${relative(root, file)}`);
    }
    if (/from\s+['"]\.\.\/(?:state|causal)\//.test(text)) {
      throw new Error(`canonical fact graph may not import mutation or causal code: ${relative(root, file)}`);
    }
  }
  // Only the resolver may advance a state, and only against a declared prior
  // state hash.
  if (file.endsWith(join('state', 'resolver.mjs'))
    && !/previousStateHash/.test(text)) {
    throw new Error(`resolver must bind an explicit previousStateHash: ${relative(root, file)}`);
  }
}

validateAcyclicImportGraph();

console.log(`boundaries valid (${files.length} source modules, acyclic local import graph)`);
