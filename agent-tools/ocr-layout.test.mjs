import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('OCR layout reconstruction pairs stem-over-branch charts', () => {
  const python = fileURLToPath(new URL('./ocr/.venv/Scripts/python.exe', import.meta.url));
  const script = fileURLToPath(new URL('./ocr/layout.py', import.meta.url));
  const result = spawnSync(python, [script, '--self-test'], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /"ok":\s*true/u);
});
