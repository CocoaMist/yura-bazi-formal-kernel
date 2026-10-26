import { isAbsolute, relative, resolve } from 'node:path';

const PHYSICAL_ROOTS = Object.freeze([
  'data/knowledge',
  'data/registry/foundation',
  'data/audit',
  'library/book/wikisource-mingli',
  'library/book/ctext-mingli',
  'library/book/purchased-20260831',
  'data/sources/wikisource-mingli',
  'data/sources/ctext-mingli',
  'data/sources/purchased-20260831',
'data/legacy/mingli-atomic-knowledge',
'research-tests/deceased-persons/analysis/generated',
]);

const LEGACY_ROOT_ALIASES = Object.freeze(new Map([
  ['corpus-knowledge', 'data/knowledge'],
  ['foundation-registry', 'data/registry/foundation'],
  ['audit', 'data/audit'],
  ['library-wikisource-mingli', 'library/book/wikisource-mingli'],
  ['library-ctext-mingli', 'library/book/ctext-mingli'],
  ['library-purchased-20260831', 'library/book/purchased-20260831'],
  ['wikisource-mingli', 'data/sources/wikisource-mingli'],
  ['ctext-mingli', 'data/sources/ctext-mingli'],
  ['purchased-20260831', 'data/sources/purchased-20260831'],
  ['mingli-atomic-knowledge', 'data/legacy/mingli-atomic-knowledge'],
]));

function slash(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/^\/+/, '');
}

function isInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function canonicalWorkspacePath(rawPath, { defaultRoot = null } = {}) {
  const raw = slash(rawPath);
  if (!raw) throw new TypeError('workspace path is required');
  for (const root of PHYSICAL_ROOTS) {
    if (raw === root || raw.startsWith(`${root}/`)) return raw;
  }
  for (const [legacy, physical] of LEGACY_ROOT_ALIASES) {
    if (raw === legacy) return physical;
    if (raw.startsWith(`${legacy}/`)) return `${physical}/${raw.slice(legacy.length + 1)}`;
  }
  return defaultRoot ? `${slash(defaultRoot)}/${raw}` : raw;
}

export function resolveWorkspacePath(workspaceRoot, rawPath, {
  defaultRoot = null,
  allowedRoots = PHYSICAL_ROOTS,
} = {}) {
  const root = resolve(workspaceRoot);
  const relativePath = canonicalWorkspacePath(rawPath, { defaultRoot });
  const absolute = resolve(root, relativePath);
  if (!isInside(root, absolute)) throw new TypeError(`workspace path escapes workspace: ${rawPath}`);
  const normalizedAllowed = allowedRoots.map(slash);
  if (normalizedAllowed.length && !normalizedAllowed.some(
    allowed => relativePath === allowed || relativePath.startsWith(`${allowed}/`),
  )) throw new TypeError(`workspace path is outside allowed roots: ${rawPath}`);
  return Object.freeze({ absolute, relative: relativePath });
}
