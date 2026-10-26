import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

// Output-specific scripts may use an external artifact runtime. Its dependency
// directory is not release input and is never traversed. No other directory or
// link receives this exemption, including the output directory's ancestors.
function isOutputDependencyDirectory(root, path) {
  const parts = relative(root, path).split(sep);
  return parts.length === 3 && parts[0] === 'outputs' && parts[2] === 'node_modules';
}

function isInside(root, path) {
  const pathFromRoot = relative(root, path);
  return pathFromRoot === ''
    || (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`));
}

export async function validateProjectPaths(projectRoot) {
const requestedRoot = resolve(projectRoot);
if ((await lstat(requestedRoot)).isSymbolicLink()) {
throw new Error('symlink forbidden: project root');
}
// Resolve the root and its descendants in the same namespace. Windows temp
// paths may use an 8.3 alias while realpath returns the expanded spelling.
const root = await realpath(requestedRoot);
  const skippedOutputDependencies = [];

  async function walk(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name);
      const entry = await lstat(path);
      if (isOutputDependencyDirectory(root, path)) {
        // Inspect only target metadata for a link; do not enumerate, resolve or
        // execute anything from the dependency directory.
        if (!(entry.isDirectory() || (entry.isSymbolicLink() && (await stat(path)).isDirectory()))) {
          throw new Error(`output dependency boundary must be a directory: ${relative(root, path)}`);
        }
        skippedOutputDependencies.push(relative(root, path));
        continue;
      }
      if (entry.isSymbolicLink()) throw new Error(`symlink forbidden: ${relative(root, path)}`);
      if (!isInside(root, await realpath(path))) throw new Error(`path escapes project root: ${path}`);
      if (entry.isDirectory()) await walk(path);
    }
  }

  await walk(root);
  return { skippedOutputDependencies };
}
