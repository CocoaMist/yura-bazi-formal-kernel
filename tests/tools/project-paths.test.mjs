import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { validateProjectPaths } from '../../tools/validate-project-paths.mjs';

const execFileAsync = promisify(execFile);

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'yura-project-paths-'));
  assert.equal(dirname(directory), resolve(tmpdir()));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'root');
  const external = join(directory, 'root-external');
  await mkdir(root);
  await mkdir(external);
  return { root, external };
}

async function directoryLink(path, target) {
  await mkdir(dirname(path), { recursive: true });
  await symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir');
}

test('output dependency links are retained without traversing their target', async (t) => {
  const { root, external } = await fixture(t);
  await directoryLink(join(external, 'recursive-link'), external);
  await directoryLink(join(root, 'outputs', 'job', 'node_modules'), external);
  assert.deepEqual(await validateProjectPaths(root), {
    skippedOutputDependencies: [join('outputs', 'job', 'node_modules')],
  });
});

test('an ordinary output dependency directory is also isolated from the scan', async (t) => {
  const { root, external } = await fixture(t);
  const dependencies = join(root, 'outputs', 'job', 'node_modules');
  await mkdir(dependencies, { recursive: true });
  await directoryLink(join(dependencies, 'runtime-link'), external);
  assert.deepEqual(await validateProjectPaths(root), {
    skippedOutputDependencies: [join('outputs', 'job', 'node_modules')],
  });
});

for (const relativePath of [
  'src/link', 'tools/link', 'tests/link', 'library/link', 'evidence/link',
  'src/node_modules', 'node_modules', 'outputs', 'outputs/job',
  'outputs/job/link', 'outputs/job/node_modules-extra',
  'outputs-extra/job/node_modules', 'outputs/node_modules',
  'outputs/job/nested/node_modules', 'src/outputs/job/node_modules',
]) {
  test(`rejects a link outside the exact output dependency boundary: ${relativePath}`, async (t) => {
    const { root, external } = await fixture(t);
    await directoryLink(join(root, relativePath), external);
    await assert.rejects(validateProjectPaths(root), /symlink forbidden:/);
  });
}

test('the output dependency exemption does not accept a regular file', async (t) => {
  const { root } = await fixture(t);
  const path = join(root, 'outputs', 'job', 'node_modules');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, 'not a dependency directory');
  await assert.rejects(validateProjectPaths(root), /output dependency boundary must be a directory:/);
});

test('a linked project root is rejected before its contents are inspected', async (t) => {
const { root, external } = await fixture(t);
const linkedRoot = join(root, 'linked-project');
await directoryLink(linkedRoot, external);
await assert.rejects(validateProjectPaths(linkedRoot), /symlink forbidden: project root/);
});

for (const [source, expected] of [
  ["import '../outputs/job/node_modules/example/index.mjs';", /source import escapes src/],
  ["import '../src-extra/example.mjs';", /source import escapes src/],
  ["import 'example';", /external import forbidden/],
  ["await import('../outputs/job/node_modules/example/index.mjs');", /dynamic import forbidden/],
]) {
  test(`kernel import validation rejects output runtime access: ${source}`, async (t) => {
    const { root } = await fixture(t);
    await mkdir(join(root, 'tools'));
    await mkdir(join(root, 'src'));
    await copyFile(new URL('../../tools/validate-boundaries.mjs', import.meta.url), join(root, 'tools', 'validate-boundaries.mjs'));
    await writeFile(join(root, 'src', 'entry.mjs'), source);
    await assert.rejects(
      execFileAsync(process.execPath, [join(root, 'tools', 'validate-boundaries.mjs')]),
      (error) => expected.test(error.stderr),
    );
  });
}
