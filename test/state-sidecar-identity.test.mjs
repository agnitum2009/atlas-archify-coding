import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const BIN = new URL('../bin/atlas-engine.mjs', import.meta.url).pathname;
for (const sub of ['active', 'get', 'transition', 'settle', 'block', 'import', 'evidence-add', 'evidence-remove', 'evidence-reanchor', 'spec-ref']) {
  test(`state ${sub} rejects missing sidecar without genesis`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-identity-'));
    const sidecar = path.join(dir, 'missing.json');
    try {
      const r = spawnSync(process.execPath, [BIN, 'state', sub, '--sidecar', sidecar], { encoding: 'utf8' });
      assert.equal(r.status, 1, r.stdout);
      assert.equal(JSON.parse(r.stdout).diagnostics[0].rule, 'sidecar_missing');
      assert.equal(fs.existsSync(sidecar), false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
test('set rejects corrupt sidecar without replacing it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-identity-'));
  const sidecar = path.join(dir, 'broken.json');
  try {
    fs.writeFileSync(sidecar, '{broken');
    const r = spawnSync(process.execPath, [BIN, 'state', 'set', '--node', 'n', '--axis', 'class', '--value', 'task', '--reason', 'r', '--owner', '一线席位', '--sidecar', sidecar], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.equal(fs.readFileSync(sidecar, 'utf8'), '{broken');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
