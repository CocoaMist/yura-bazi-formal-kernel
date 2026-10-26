import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { resolveWorkspacePath } from './support/paths.mjs';

const ALLOWED_ROOTS = Object.freeze([
  'library/book/wikisource-mingli',
  'library/book/ctext-mingli',
  'library/book/purchased-20260831',
  'data/sources/wikisource-mingli',
  'data/sources/ctext-mingli',
'data/sources/purchased-20260831',
'research-tests/deceased-persons/analysis/generated',
]);
const ALLOWED_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.html', '.htm', '.xhtml', '.xml', '.json']);

function asPosix(value) { return value.split(sep).join('/'); }
function hash(value) { return createHash('sha256').update(value).digest('hex'); }

function resolveAllowedPath(cwd, rawPath) {
  const absolute = resolveWorkspacePath(cwd, rawPath, { allowedRoots: ALLOWED_ROOTS }).absolute;
  const rel = asPosix(relative(cwd, absolute));
  if (rel.startsWith('../') || rel === '..' || rel.includes('/../')) throw new TypeError(`source escapes workspace: ${rawPath}`);
  if (!ALLOWED_ROOTS.some(root => rel === root || rel.startsWith(`${root}/`))) throw new TypeError(`source is outside read-only corpus roots: ${rawPath}`);
  const extension = absolute.slice(absolute.lastIndexOf('.')).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) throw new TypeError(`unsupported source extension: ${extension}`);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) throw new TypeError(`source file not found: ${rawPath}`);
  return { absolute, relative: rel };
}

/** Read bounded source excerpts and retain a hash of the complete source file. */
export function materializeRoomSources(request, { cwd = process.cwd() } = {}) {
  if (request.sources.length === 0) return Object.freeze([]);
  const perSourceCap = Math.max(500, Math.floor(request.limits.max_material_chars / request.sources.length));
  const materials = request.sources.map(source => {
    const path = resolveAllowedPath(cwd, source.path);
    const raw = readFileSync(path.absolute);
    const text = raw.toString('utf8');
    let start = source.start;
    let end = source.end;
    if (typeof source.quote === 'string' && source.quote.length > 0) {
      start = text.indexOf(source.quote);
      if (start < 0) throw new TypeError(`quote not found verbatim in ${path.relative}`);
      if (text.indexOf(source.quote, start + 1) >= 0) throw new TypeError(`quote is not unique in ${path.relative}; use start/end offsets`);
      end = start + source.quote.length;
    }
    const focusLength = end - start;
    if (focusLength > perSourceCap) throw new TypeError(`source excerpt exceeds per-source cap (${perSourceCap} chars): ${source.source_id}`);
    const context = Math.min(600, Math.max(0, Math.floor((perSourceCap - focusLength) / 2)));
    const excerptStart = Math.max(0, start - context);
    const excerptEnd = Math.min(text.length, end + context);
    return Object.freeze({
      source_id: source.source_id,
      path: path.relative,
      locator: source.locator ?? `char:${start}-${end}`,
      focus_start: start,
      focus_end: end,
      excerpt_start: excerptStart,
      excerpt_end: excerptEnd,
      focus_text: text.slice(start, end),
      context_text: text.slice(excerptStart, excerptEnd),
      source_sha256: hash(raw),
    });
  });
  const total = materials.reduce((sum, row) => sum + row.context_text.length, 0);
  if (total > request.limits.max_material_chars) throw new TypeError(`material budget exceeded: ${total}/${request.limits.max_material_chars}`);
  return Object.freeze(materials);
}

export { ALLOWED_ROOTS };
